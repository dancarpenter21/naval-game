//! Entity movement: WGS84 geodesics, waypoint transit, orbit and racetrack stations.

use crate::earth::{
    self, geodesic_direct_deg, geodesic_on_orbit_station, geodesic_point_toward_at_distance,
    heading_deg_from_enu_tangent, outward_navigation_heading_from_center,
};
use crate::earth::racetrack_geometry;
use crate::sim_timing::KNOTS_TO_MPS;

/// Final station after optional waypoint legs (boxed in transit for a stable enum size).
#[derive(Debug, Clone)]
pub enum StationPhase {
    Orbit {
        center_lat_deg: f64,
        center_lon_deg: f64,
        radius_m: f64,
        clockwise: bool,
    },
    Racetrack {
        end_a_lat: f64,
        end_a_lon: f64,
        end_b_lat: f64,
        end_b_lon: f64,
        turn_radius_m: f64,
        clockwise: bool,
        /// Precomputed stadium centerline.
        loop_path_deg: Vec<(f64, f64)>,
    },
}

/// How the unit advances each tick after a movement order (or default cruise).
#[derive(Debug, Clone)]
pub enum MovementMode {
    /// Fly straight along current heading (default spawn behavior).
    Cruise,
    /// Visit `waypoints` in order, then enter `station`.
    TransitWaypoints {
        waypoints: Vec<(f64, f64)>,
        idx: usize,
        station: StationPhase,
    },
    /// Circular holding pattern.
    Orbit {
        center_lat_deg: f64,
        center_lon_deg: f64,
        radius_m: f64,
        clockwise: bool,
    },
    /// Stadium racetrack: follow `loop_path_deg` vertex-to-vertex.
    Racetrack {
        loop_path_deg: Vec<(f64, f64)>,
        vertex_i: usize,
        turn_radius_m: f64,
    },
}

/// Minimum orbit / racetrack turn radius accepted by the server (meters).
pub const MIN_ORBIT_RADIUS_M: f64 = 75.0;
/// Maximum orbit / racetrack radius (meters).
pub const MAX_ORBIT_RADIUS_M: f64 = 2_000_000.0;

const ORBIT_JOIN_MARGIN_M: f64 = 450.0;
const WAYPOINT_CAPTURE_M: f64 = 650.0;

/// When entering a terminal station from the current position (waypoints finished or direct order).
fn mode_entering_station(station: &StationPhase, lat_deg: f64, lon_deg: f64) -> MovementMode {
    match station {
        StationPhase::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            clockwise,
        } => MovementMode::Orbit {
            center_lat_deg: *center_lat_deg,
            center_lon_deg: *center_lon_deg,
            radius_m: *radius_m,
            clockwise: *clockwise,
        },
        StationPhase::Racetrack {
            loop_path_deg,
            turn_radius_m,
            ..
        } => {
            let vertex_i = if loop_path_deg.len() < 2 {
                0
            } else {
                racetrack_geometry::nearest_vertex_index(lat_deg, lon_deg, loop_path_deg)
            };
            MovementMode::Racetrack {
                loop_path_deg: loop_path_deg.clone(),
                vertex_i,
                turn_radius_m: *turn_radius_m,
            }
        }
    }
}

/// Build mode from waypoint list and terminal station (used when applying orders).
pub fn mode_from_waypoints_and_station(
    waypoints: Vec<(f64, f64)>,
    station: StationPhase,
    lat_deg: f64,
    lon_deg: f64,
) -> MovementMode {
    if waypoints.is_empty() {
        mode_entering_station(&station, lat_deg, lon_deg)
    } else {
        MovementMode::TransitWaypoints {
            waypoints,
            idx: 0,
            station,
        }
    }
}

/// Geodesic path length for ETA: start → each waypoint → station entry point.
pub fn plan_total_path_m(
    start_lat: f64,
    start_lon: f64,
    waypoints: &[(f64, f64)],
    station: &StationPhase,
) -> f64 {
    let mut d = 0.0_f64;
    let mut la = start_lat;
    let mut lo = start_lon;
    for (wlat, wlon) in waypoints {
        d += earth::geodesic_distance_m(la, lo, *wlat, *wlon);
        la = *wlat;
        lo = *wlon;
    }
    d += distance_to_station_entry_m(la, lo, station);
    d
}

/// Remaining geodesic distance along the active plan (0 when established on station).
pub fn remaining_path_meters(lat_deg: f64, lon_deg: f64, mode: &MovementMode) -> f64 {
    match mode {
        MovementMode::Cruise => 0.0,
        MovementMode::TransitWaypoints {
            waypoints,
            idx,
            station,
        } => {
            let mut d = 0.0_f64;
            let mut la = lat_deg;
            let mut lo = lon_deg;
            let i0 = (*idx).min(waypoints.len());
            for (wlat, wlon) in waypoints.iter().skip(i0) {
                d += earth::geodesic_distance_m(la, lo, *wlat, *wlon);
                la = *wlat;
                lo = *wlon;
            }
            d += distance_to_station_entry_m(la, lo, station);
            d
        }
        MovementMode::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            ..
        } => {
            let r = radius_m.clamp(MIN_ORBIT_RADIUS_M, MAX_ORBIT_RADIUS_M);
            let margin = ORBIT_JOIN_MARGIN_M.max(r * 0.03);
            if geodesic_on_orbit_station(
                *center_lat_deg,
                *center_lon_deg,
                r,
                lat_deg,
                lon_deg,
                margin,
            ) {
                return 0.0;
            }
            let (jl, jo) = geodesic_point_toward_at_distance(
                *center_lat_deg,
                *center_lon_deg,
                lat_deg,
                lon_deg,
                r,
                earth::geodesic_azimuth_deg_1_to_2(lat_deg, lon_deg, *center_lat_deg, *center_lon_deg),
            );
            earth::geodesic_distance_m(lat_deg, lon_deg, jl, jo)
        }
        MovementMode::Racetrack { .. } => 0.0,
    }
}

fn distance_to_station_entry_m(lat: f64, lon: f64, station: &StationPhase) -> f64 {
    match station {
        StationPhase::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            ..
        } => {
            let r = radius_m.clamp(MIN_ORBIT_RADIUS_M, MAX_ORBIT_RADIUS_M);
            let (jl, jo) = geodesic_point_toward_at_distance(
                *center_lat_deg,
                *center_lon_deg,
                lat,
                lon,
                r,
                earth::geodesic_azimuth_deg_1_to_2(lat, lon, *center_lat_deg, *center_lon_deg),
            );
            earth::geodesic_distance_m(lat, lon, jl, jo)
        }
        StationPhase::Racetrack {
            loop_path_deg, ..
        } => {
            if loop_path_deg.is_empty() {
                return 0.0;
            }
            loop_path_deg
                .iter()
                .map(|(la, lo)| earth::geodesic_distance_m(lat, lon, *la, *lo))
                .fold(f64::INFINITY, f64::min)
        }
    }
}

/// Sim-seconds until on station, and progress [0,1] along planned path (if total known).
pub fn station_eta_and_progress(
    lat_deg: f64,
    lon_deg: f64,
    mode: &MovementMode,
    path_total_m: Option<f64>,
    speed_mps: f64,
) -> (Option<f64>, Option<f64>) {
    if speed_mps <= 0.0 {
        return (None, None);
    }
    match mode {
        MovementMode::Cruise => (None, None),
        _ => {
            let rem = remaining_path_meters(lat_deg, lon_deg, mode);
            let eta = Some(rem / speed_mps);
            let progress = path_total_m
                .filter(|t| *t > 1.0)
                .map(|t| (1.0 - rem / t).clamp(0.0, 1.0));
            (eta, progress)
        }
    }
}

fn racetrack_capture_m(turn_r: f64) -> f64 {
    turn_r.max(200.0).max(WAYPOINT_CAPTURE_M * 0.5)
}

/// Integrate position for one entity for `dt_sim_s` simulated seconds.
pub fn integrate_entity(
    lat_deg: &mut f64,
    lon_deg: &mut f64,
    heading_deg: &mut f64,
    max_speed_knots: f64,
    mode: &mut MovementMode,
    dt_sim_s: f64,
) {
    if dt_sim_s <= 0.0 {
        return;
    }

    let speed_mps = max_speed_knots * KNOTS_TO_MPS;
    let dist_m = speed_mps * dt_sim_s;

    match mode {
        MovementMode::Cruise => {
            let (lat2, lon2) = geodesic_direct_deg(*lat_deg, *lon_deg, *heading_deg, dist_m);
            *lat_deg = lat2;
            *lon_deg = lon2;
        }
        MovementMode::TransitWaypoints {
            waypoints,
            idx,
            station,
        } => {
            if *idx >= waypoints.len() {
                *mode = mode_entering_station(station, *lat_deg, *lon_deg);
                integrate_entity(lat_deg, lon_deg, heading_deg, max_speed_knots, mode, dt_sim_s);
                return;
            }
            let (wlat, wlon) = waypoints[*idx];
            let dist_wp = earth::geodesic_distance_m(*lat_deg, *lon_deg, wlat, wlon);
            if dist_wp < WAYPOINT_CAPTURE_M {
                *idx += 1;
                if *idx >= waypoints.len() {
                    let st = station.clone();
                    *mode = mode_entering_station(&st, *lat_deg, *lon_deg);
                    integrate_entity(lat_deg, lon_deg, heading_deg, max_speed_knots, mode, dt_sim_s);
                } else {
                    let (wlat2, wlon2) = waypoints[*idx];
                    let steer =
                        earth::geodesic_azimuth_deg_1_to_2(*lat_deg, *lon_deg, wlat2, wlon2);
                    *heading_deg = earth::normalize_heading_deg(steer);
                    let (lat2, lon2) = geodesic_direct_deg(*lat_deg, *lon_deg, *heading_deg, dist_m);
                    *lat_deg = lat2;
                    *lon_deg = lon2;
                }
                return;
            }
            let steer = earth::geodesic_azimuth_deg_1_to_2(*lat_deg, *lon_deg, wlat, wlon);
            *heading_deg = earth::normalize_heading_deg(steer);
            let (lat2, lon2) = geodesic_direct_deg(*lat_deg, *lon_deg, *heading_deg, dist_m);
            *lat_deg = lat2;
            *lon_deg = lon2;
        }
        MovementMode::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            clockwise,
        } => {
            let r = radius_m.clamp(MIN_ORBIT_RADIUS_M, MAX_ORBIT_RADIUS_M);
            let margin = ORBIT_JOIN_MARGIN_M.max(r * 0.03);

            let on_circle = geodesic_on_orbit_station(
                *center_lat_deg,
                *center_lon_deg,
                r,
                *lat_deg,
                *lon_deg,
                margin,
            );

            let dist_from_center = earth::geodesic_distance_m(
                *center_lat_deg,
                *center_lon_deg,
                *lat_deg,
                *lon_deg,
            );

            let next_heading = if on_circle && dist_from_center >= 1.0 {
                let out_hdg = outward_navigation_heading_from_center(
                    *center_lat_deg,
                    *center_lon_deg,
                    *lat_deg,
                    *lon_deg,
                );
                let hr = out_hdg.to_radians();
                let ue = hr.sin();
                let un = hr.cos();
                let (te, tn) = if *clockwise {
                    (un, -ue)
                } else {
                    (-un, ue)
                };
                heading_deg_from_enu_tangent(te, tn)
            } else {
                let (t_lat, t_lon) = geodesic_point_toward_at_distance(
                    *center_lat_deg,
                    *center_lon_deg,
                    *lat_deg,
                    *lon_deg,
                    r,
                    *heading_deg,
                );
                let steer = earth::geodesic_azimuth_deg_1_to_2(*lat_deg, *lon_deg, t_lat, t_lon);
                earth::normalize_heading_deg(steer)
            };

            *heading_deg = next_heading;
            let (lat2, lon2) = geodesic_direct_deg(*lat_deg, *lon_deg, *heading_deg, dist_m);
            *lat_deg = lat2;
            *lon_deg = lon2;
        }
        MovementMode::Racetrack {
            loop_path_deg,
            vertex_i,
            turn_radius_m,
        } => {
            let n = loop_path_deg.len();
            if n < 2 {
                return;
            }
            let cap = racetrack_capture_m(*turn_radius_m);
            let next_i = (*vertex_i + 1) % n;
            let (tx, ty) = loop_path_deg[next_i];
            let dist_v = earth::geodesic_distance_m(*lat_deg, *lon_deg, tx, ty);
            if dist_v < cap {
                *vertex_i = next_i;
            }
            let next_i = (*vertex_i + 1) % n;
            let (tlat, tlon) = loop_path_deg[next_i];
            let steer = earth::geodesic_azimuth_deg_1_to_2(*lat_deg, *lon_deg, tlat, tlon);
            *heading_deg = earth::normalize_heading_deg(steer);
            let (lat2, lon2) = geodesic_direct_deg(*lat_deg, *lon_deg, *heading_deg, dist_m);
            *lat_deg = lat2;
            *lon_deg = lon2;
        }
    }
}

fn orbit_ring_from_join(
    center_lat: f64,
    center_lon: f64,
    radius_m: f64,
    join_lat: f64,
    join_lon: f64,
    steps: usize,
) -> Vec<(f64, f64)> {
    let r = radius_m.clamp(MIN_ORBIT_RADIUS_M, MAX_ORBIT_RADIUS_M);
    let a0 = earth::geodesic_azimuth_deg_1_to_2(center_lat, center_lon, join_lat, join_lon);
    let mut v = Vec::with_capacity(steps + 2);
    for i in 0..=steps {
        let azi = a0 + i as f64 * (360.0 / steps as f64);
        let (la, lo) = geodesic_direct_deg(
            center_lat,
            center_lon,
            earth::normalize_heading_deg(azi),
            r,
        );
        v.push((la, lo));
    }
    v
}

fn append_orbit_display(
    out: &mut Vec<(f64, f64)>,
    from_lat: f64,
    from_lon: f64,
    center_lat: f64,
    center_lon: f64,
    radius_m: f64,
) {
    let r = radius_m.clamp(MIN_ORBIT_RADIUS_M, MAX_ORBIT_RADIUS_M);
    let fallback = earth::geodesic_azimuth_deg_1_to_2(from_lat, from_lon, center_lat, center_lon);
    let (jl, jo) = geodesic_point_toward_at_distance(
        center_lat,
        center_lon,
        from_lat,
        from_lon,
        r,
        fallback,
    );
    out.push((jl, jo));
    let ring = orbit_ring_from_join(center_lat, center_lon, r, jl, jo, 36);
    for p in ring.into_iter().skip(1) {
        out.push(p);
    }
}

fn append_racetrack_display(out: &mut Vec<(f64, f64)>, from_lat: f64, from_lon: f64, path: &[(f64, f64)]) {
    if path.len() < 2 {
        if let Some(p) = path.first() {
            out.push(*p);
        }
        return;
    }
    let i0 = racetrack_geometry::nearest_vertex_index(from_lat, from_lon, path);
    let n = path.len();
    out.push(path[i0]);
    for k in 1..=n {
        let j = (i0 + k) % n;
        out.push(path[j]);
    }
}

/// Polyline for map preview: current position, remaining legs, and station geometry.
pub fn display_path_polyline_deg(lat_deg: f64, lon_deg: f64, mode: &MovementMode) -> Option<Vec<(f64, f64)>> {
    match mode {
        MovementMode::Cruise => None,
        MovementMode::TransitWaypoints {
            waypoints,
            idx,
            station,
        } => {
            let mut out = Vec::new();
            out.push((lat_deg, lon_deg));
            let i0 = (*idx).min(waypoints.len());
            for (wlat, wlon) in waypoints.iter().skip(i0) {
                out.push((*wlat, *wlon));
            }
            let (la, lo) = out.last().copied().unwrap();
            match station {
                StationPhase::Orbit {
                    center_lat_deg,
                    center_lon_deg,
                    radius_m,
                    ..
                } => {
                    append_orbit_display(
                        &mut out,
                        la,
                        lo,
                        *center_lat_deg,
                        *center_lon_deg,
                        *radius_m,
                    );
                }
                StationPhase::Racetrack {
                    loop_path_deg, ..
                } => {
                    append_racetrack_display(&mut out, la, lo, loop_path_deg);
                }
            }
            Some(out)
        }
        MovementMode::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            ..
        } => {
            let mut out = vec![(lat_deg, lon_deg)];
            append_orbit_display(
                &mut out,
                lat_deg,
                lon_deg,
                *center_lat_deg,
                *center_lon_deg,
                *radius_m,
            );
            Some(out)
        }
        MovementMode::Racetrack {
            loop_path_deg, ..
        } => {
            let mut out = vec![(lat_deg, lon_deg)];
            append_racetrack_display(&mut out, lat_deg, lon_deg, loop_path_deg);
            Some(out)
        }
    }
}
