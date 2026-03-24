//! WGS84 ellipsoid geodesic math (Charles F. F. Karney / GeographicLib).
//!
//! Used for entity motion, orbit station-keeping distances, and any server-side
//! range/bearing checks. See `docs/EARTH_AND_TERRAIN.md` for terrain / DTED plans.

use geographiclib_rs::{Geodesic, DirectGeodesic, InverseGeodesic};
use std::sync::OnceLock;

fn wgs84() -> &'static Geodesic {
    static G: OnceLock<Geodesic> = OnceLock::new();
    G.get_or_init(Geodesic::wgs84)
}

/// WGS84 semi-major axis (m).
pub const WGS84_A_M: f64 = 6378137.0;

/// Geodesic distance between two WGS84 positions (meters).
#[inline]
pub fn geodesic_distance_m(lat1_deg: f64, lon1_deg: f64, lat2_deg: f64, lon2_deg: f64) -> f64 {
    let (s12, _a12): (f64, f64) = wgs84().inverse(lat1_deg, lon1_deg, lat2_deg, lon2_deg);
    s12
}

/// Solve the direct geodesic: from `(lat, lon)` move `distance_m` along geodesic with
/// **navigation** azimuth `heading_deg` (0° = north, 90° = east, clockwise).
///
/// Returns `(lat2_deg, lon2_deg)`.
#[inline]
pub fn geodesic_direct_deg(
    lat_deg: f64,
    lon_deg: f64,
    heading_deg: f64,
    distance_m: f64,
) -> (f64, f64) {
    wgs84().direct(lat_deg, lon_deg, heading_deg, distance_m)
}

/// Initial azimuth at point 1 toward point 2 (degrees, GeographicLib convention [-180, 180]).
#[inline]
pub fn geodesic_azimuth_deg_1_to_2(
    lat1_deg: f64,
    lon1_deg: f64,
    lat2_deg: f64,
    lon2_deg: f64,
) -> f64 {
    let (_s12, azi1, _azi2): (f64, f64, f64) =
        wgs84().inverse(lat1_deg, lon1_deg, lat2_deg, lon2_deg);
    azi1
}

/// Signed radial error vs a desired geodesic orbit radius: `distance(center, pos) - radius_m`.
#[inline]
pub fn geodesic_orbit_radial_error_m(
    center_lat_deg: f64,
    center_lon_deg: f64,
    orbit_radius_m: f64,
    pos_lat_deg: f64,
    pos_lon_deg: f64,
) -> f64 {
    geodesic_distance_m(center_lat_deg, center_lon_deg, pos_lat_deg, pos_lon_deg) - orbit_radius_m
}

/// Whether the entity is within `margin_m` of the geodesic circle (on-station for orbits).
#[inline]
pub fn geodesic_on_orbit_station(
    center_lat_deg: f64,
    center_lon_deg: f64,
    orbit_radius_m: f64,
    pos_lat_deg: f64,
    pos_lon_deg: f64,
    margin_m: f64,
) -> bool {
    geodesic_orbit_radial_error_m(
        center_lat_deg,
        center_lon_deg,
        orbit_radius_m,
        pos_lat_deg,
        pos_lon_deg,
    )
    .abs()
        <= margin_m
}

/// Point on the geodesic from `center` toward `pos` at geodesic distance `radius_m`.
/// If center and position coincide (~< 1 m), uses `heading_fallback_deg` from center.
pub fn geodesic_point_toward_at_distance(
    center_lat_deg: f64,
    center_lon_deg: f64,
    pos_lat_deg: f64,
    pos_lon_deg: f64,
    radius_m: f64,
    heading_fallback_deg: f64,
) -> (f64, f64) {
    let (dist, azi_c_to_p, _): (f64, f64, f64) =
        wgs84().inverse(center_lat_deg, center_lon_deg, pos_lat_deg, pos_lon_deg);
    if dist < 1.0 {
        return geodesic_direct_deg(center_lat_deg, center_lon_deg, heading_fallback_deg, radius_m);
    }
    geodesic_direct_deg(center_lat_deg, center_lon_deg, azi_c_to_p, radius_m)
}

/// Heading (0..360°, north CW) from east/north components of a horizontal tangent vector.
#[inline]
pub fn heading_deg_from_enu_tangent(east: f64, north: f64) -> f64 {
    normalize_heading_deg(east.atan2(north).to_degrees())
}

pub fn normalize_heading_deg(mut h: f64) -> f64 {
    h %= 360.0;
    if h < 0.0 {
        h += 360.0;
    }
    h
}

/// Outward geodesic azimuth at `pos` from `center`, as navigation heading [0, 360).
pub fn outward_navigation_heading_from_center(
    center_lat_deg: f64,
    center_lon_deg: f64,
    pos_lat_deg: f64,
    pos_lon_deg: f64,
) -> f64 {
    let (_s, azi_pos_to_center, _): (f64, f64, f64) =
        wgs84().inverse(pos_lat_deg, pos_lon_deg, center_lat_deg, center_lon_deg);
    normalize_heading_deg(azi_pos_to_center + 180.0)
}

/// Stadium (capsule) racetrack on the ellipsoid: local ENU + geodesic vertex projection.
pub mod racetrack_geometry {
    use super::{geodesic_azimuth_deg_1_to_2, geodesic_direct_deg, geodesic_distance_m};

    /// Keep in sync with `crate::movement::MIN_ORBIT_RADIUS_M` / `MAX_ORBIT_RADIUS_M`.
    const MIN_R_M: f64 = 75.0;
    const MAX_R_M: f64 = 2_000_000.0;
    const MIN_STRAIGHT_M: f64 = 80.0;
    const ARC_STEPS: usize = 18;
    const STRAIGHT_STEPS: usize = 12;

    fn local_to_lat_lon(
        anchor_lat: f64,
        anchor_lon: f64,
        forward_azi_deg: f64,
        lx_m: f64,
        ly_m: f64,
    ) -> (f64, f64) {
        let azi = forward_azi_deg.to_radians();
        let east_m = lx_m * azi.sin() + ly_m * (-azi.cos());
        let north_m = lx_m * azi.cos() + ly_m * azi.sin();
        let dist = east_m.hypot(north_m);
        if dist < 1e-3 {
            return (anchor_lat, anchor_lon);
        }
        let hdg = east_m.atan2(north_m).to_degrees();
        geodesic_direct_deg(anchor_lat, anchor_lon, hdg, dist)
    }

    fn sample_geodesic_two_way(
        a_lat: f64,
        a_lon: f64,
        b_lat: f64,
        b_lon: f64,
        n: usize,
    ) -> Vec<(f64, f64)> {
        let mut out = Vec::with_capacity(n * 2 + 2);
        out.push((a_lat, a_lon));
        for i in 1..=n {
            let t = i as f64 / n as f64;
            let d = geodesic_distance_m(a_lat, a_lon, b_lat, b_lon) * t;
            let az = geodesic_azimuth_deg_1_to_2(a_lat, a_lon, b_lat, b_lon);
            let (la, lo) = geodesic_direct_deg(a_lat, a_lon, az, d);
            out.push((la, lo));
        }
        for i in 1..n {
            let t = i as f64 / n as f64;
            let d = geodesic_distance_m(b_lat, b_lon, a_lat, a_lon) * t;
            let az = geodesic_azimuth_deg_1_to_2(b_lat, b_lon, a_lat, a_lon);
            let (la, lo) = geodesic_direct_deg(b_lat, b_lon, az, d);
            out.push((la, lo));
        }
        out.push((a_lat, a_lon));
        out
    }

    /// Closed centerline loop. `clockwise == true` reverses loop direction (viewed with north up).
    pub fn build_stadium_racetrack(
        a_lat: f64,
        a_lon: f64,
        b_lat: f64,
        b_lon: f64,
        mut r_m: f64,
        clockwise: bool,
    ) -> Vec<(f64, f64)> {
        let d_ab = geodesic_distance_m(a_lat, a_lon, b_lat, b_lon);
        let azi_ab = geodesic_azimuth_deg_1_to_2(a_lat, a_lon, b_lat, b_lon);
        let azi_ba = geodesic_azimuth_deg_1_to_2(b_lat, b_lon, a_lat, a_lon);

        r_m = r_m.clamp(MIN_R_M, MAX_R_M);

        if d_ab < 2.0 * r_m + MIN_STRAIGHT_M {
            let r2 = ((d_ab - MIN_STRAIGHT_M) / 2.0).clamp(MIN_R_M, r_m);
            if d_ab < 2.0 * MIN_R_M + 20.0 {
                return sample_geodesic_two_way(a_lat, a_lon, b_lat, b_lon, 8);
            }
            return build_stadium_racetrack(a_lat, a_lon, b_lat, b_lon, r2, clockwise);
        }

        let (o_l_lat, o_l_lon) = geodesic_direct_deg(a_lat, a_lon, azi_ab, r_m);
        let (o_r_lat, o_r_lon) = geodesic_direct_deg(b_lat, b_lon, azi_ba, r_m);

        let l_centers = geodesic_distance_m(o_l_lat, o_l_lon, o_r_lat, o_r_lon).max(20.0);
        let forward_azi = geodesic_azimuth_deg_1_to_2(o_l_lat, o_l_lon, o_r_lat, o_r_lon);

        let mut local_pts: Vec<(f64, f64)> = Vec::new();

        for i in 0..=ARC_STEPS {
            let t = i as f64 / ARC_STEPS as f64;
            let phi = 1.5 * std::f64::consts::PI - std::f64::consts::PI * t;
            let lx = r_m * phi.cos();
            let ly = r_m * phi.sin();
            if clockwise {
                local_pts.push((lx, -ly));
            } else {
                local_pts.push((lx, ly));
            }
        }

        for i in 1..=STRAIGHT_STEPS {
            let t = i as f64 / STRAIGHT_STEPS as f64;
            let lx = t * l_centers;
            let ly = r_m;
            if clockwise {
                local_pts.push((lx, -ly));
            } else {
                local_pts.push((lx, ly));
            }
        }

        for i in 1..=ARC_STEPS {
            let t = i as f64 / ARC_STEPS as f64;
            let phi = std::f64::consts::FRAC_PI_2 - std::f64::consts::PI * t;
            let lx = l_centers + r_m * phi.cos();
            let ly = r_m * phi.sin();
            if clockwise {
                local_pts.push((lx, -ly));
            } else {
                local_pts.push((lx, ly));
            }
        }

        for i in 1..=STRAIGHT_STEPS {
            let t = i as f64 / STRAIGHT_STEPS as f64;
            let lx = l_centers * (1.0 - t);
            let ly = -r_m;
            if clockwise {
                local_pts.push((lx, -ly));
            } else {
                local_pts.push((lx, ly));
            }
        }

        local_pts
            .into_iter()
            .map(|(lx, ly)| local_to_lat_lon(o_l_lat, o_l_lon, forward_azi, lx, ly))
            .collect()
    }

    /// Geodesic length of polyline (open chain; no automatic closing).
    pub fn open_polyline_length_m(pts: &[(f64, f64)]) -> f64 {
        if pts.len() < 2 {
            return 0.0;
        }
        let mut s = 0.0;
        for w in pts.windows(2) {
            s += geodesic_distance_m(w[0].0, w[0].1, w[1].0, w[1].1);
        }
        s
    }

    /// Index of vertex nearest to `lat/lon`.
    pub fn nearest_vertex_index(lat: f64, lon: f64, pts: &[(f64, f64)]) -> usize {
        if pts.is_empty() {
            return 0;
        }
        pts.iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                geodesic_distance_m(lat, lon, a.0, a.1)
                    .partial_cmp(&geodesic_distance_m(lat, lon, b.0, b.1))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(0)
    }

    #[cfg(test)]
    mod racetrack_tests {
        use super::*;

        #[test]
        fn stadium_loop_nonzero_length() {
            let p = build_stadium_racetrack(35.0, -40.0, 35.05, -40.08, 5000.0, false);
            assert!(p.len() > 10);
            let len = open_polyline_length_m(&p);
            assert!(len > 20_000.0, "len={}", len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equator_one_degree_lon_distance_approximate() {
        let d = geodesic_distance_m(0.0, 0.0, 0.0, 1.0);
        assert!((d - 111_319.0).abs() < 50.0, "d={}", d);
    }

    #[test]
    fn direct_and_inverse_round_trip_loose() {
        let lat0 = 35.0;
        let lon0 = -40.0;
        let hdg = 45.0;
        let dist = 50_000.0;
        let (lat1, lon1) = geodesic_direct_deg(lat0, lon0, hdg, dist);
        let back = geodesic_distance_m(lat0, lon0, lat1, lon1);
        assert!((back - dist).abs() < 0.5, "back={} dist={}", back, dist);
    }
}
