//! TLE / SGP4 propagation and satellite footprint geometry (space assets).
//!
//! Position uses the same ECI→geodetic path as `satellite.js` (`eciToGeodetic` + `gstime`).

use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc};
use sgp4::{Constants, Elements};

use crate::dto::{LatLonDegDto, SpaceCoverageEventDto, SpaceSnapshotDto};
use std::collections::HashSet;
use crate::earth::geodesic_distance_m;

/// WGS84 equatorial radius (km), matching `satellite.js` `eciToGeodetic`.
const WGS84_A_KM: f64 = 6378.137;
const WGS84_B_KM: f64 = 6356.7523142;
const TWO_PI: f64 = std::f64::consts::TAU;

/// Ground-track / future footprint samples (simulated seconds ahead, point count).
pub const DEFAULT_TRACK_AHEAD_S: f64 = 1800.0;
pub const DEFAULT_TRACK_SAMPLES: usize = 64;

/// Default wall-tick interval between space propagation + coverage checks (see `ENV_SPACE_TICK_INTERVAL`).
pub const DEFAULT_SPACE_TICK_INTERVAL: u64 = 16;

/// Environment variable: run space propagation every N wall ticks (default [`DEFAULT_SPACE_TICK_INTERVAL`]).
pub const ENV_SPACE_TICK_INTERVAL: &str = "SPACE_TICK_INTERVAL";

#[derive(Debug, Clone)]
pub struct SpaceOrbitConfig {
    pub line1: String,
    pub line2: String,
    pub fov_half_angle_deg: f64,
    /// When true, map does not draw a unit marker (still listed in roster / selectable).
    #[allow(dead_code)]
    pub hide_map_marker: bool,
}

#[derive(Debug, Clone)]
pub struct SpaceOrbitRuntime {
    pub config: SpaceOrbitConfig,
    pub constants: Constants,
    pub elements: Elements,
}

impl SpaceOrbitRuntime {
    pub fn from_config(config: SpaceOrbitConfig) -> Result<Self, String> {
        let line1 = config.line1.trim().to_string();
        let line2 = config.line2.trim().to_string();
        let elements = Elements::from_tle(
            None,
            line1.as_bytes(),
            line2.as_bytes(),
        )
        .map_err(|e| format!("TLE parse: {e}"))?;
        let constants = Constants::from_elements(&elements).map_err(|e| format!("SGP4 constants: {e}"))?;
        Ok(Self {
            config,
            constants,
            elements,
        })
    }
}

/// Julian date (UT) — same formula as `satellite.js` `jday`.
fn julian_date_ut1(dt: DateTime<Utc>) -> f64 {
    let year = dt.year();
    let mon = dt.month() as f64;
    let day = dt.day() as f64;
    let hr = dt.hour() as f64;
    let minute = dt.minute() as f64;
    let sec = dt.second() as f64 + (dt.nanosecond() as f64) / 1e9;
    let msec = dt.nanosecond() as f64 / 1e6;
    367.0 * year as f64
        - (7.0 * (year as f64 + ((mon + 9.0) / 12.0).floor()) * 0.25).floor()
        + (275.0 * mon / 9.0).floor()
        + day
        + 1721013.5
        + ((msec / 60000.0 + sec / 60.0 + minute) / 60.0 + hr) / 24.0
}

/// Greenwich sidereal time (rad), matching `satellite.js` `gstime`.
fn gstime_rad(jd_ut1: f64) -> f64 {
    let tut1 = (jd_ut1 - 2451545.0) / 36525.0;
    let mut temp = -6.2e-6 * tut1.powi(3)
        + 0.093104 * tut1.powi(2)
        + (876600.0 * 3600.0 + 8640184.812866) * tut1
        + 67310.54841;
    temp = (temp * (std::f64::consts::PI / 180.0) / 240.0).rem_euclid(TWO_PI);
    temp
}

/// ECI/TEME position (km) → geodetic rad / km — `satellite.js` `eciToGeodetic`.
fn eci_to_geodetic_km(eci_x: f64, eci_y: f64, eci_z: f64, gmst: f64) -> (f64, f64, f64) {
    let a = WGS84_A_KM;
    let b = WGS84_B_KM;
    let r = (eci_x * eci_x + eci_y * eci_y).sqrt();
    let f = (a - b) / a;
    let e2 = 2.0 * f - f * f;

    let mut longitude = eci_y.atan2(eci_x) - gmst;
    while longitude < -std::f64::consts::PI {
        longitude += TWO_PI;
    }
    while longitude > std::f64::consts::PI {
        longitude -= TWO_PI;
    }

    let mut latitude = eci_z.atan2((eci_x * eci_x + eci_y * eci_y).sqrt());
    let mut k = 0usize;
    let mut c = 1.0;
    while k < 20 {
        k += 1;
        c = 1.0 / (1.0 - e2 * latitude.sin() * latitude.sin()).sqrt();
        latitude = (eci_z + a * c * e2 * latitude.sin()).atan2(r);
    }
    let height = r / latitude.cos() - a * c;
    (latitude, longitude, height)
}

/// Geocentric angle (rad) from subsatellite point to edge of nadir cone on a spherical Earth.
fn footprint_geocentric_angle_rad(r_earth_m: f64, h_m: f64, cone_half_angle_rad: f64) -> f64 {
    let rs = r_earth_m + h_m;
    let x = (rs / r_earth_m) * cone_half_angle_rad.sin();
    if x >= 1.0 {
        return std::f64::consts::FRAC_PI_2;
    }
    if x <= -1.0 {
        return 0.0;
    }
    (x.asin() - cone_half_angle_rad).max(0.0)
}

/// Ground footprint radius (m) for a spherical Earth cap (matches map circle approximation).
pub fn footprint_radius_m(hae_m: f64, fov_half_angle_deg: f64) -> f64 {
    let r = crate::earth::WGS84_A_M;
    let alpha = fov_half_angle_deg.to_radians();
    let eta = footprint_geocentric_angle_rad(r, hae_m, alpha);
    r * eta
}

pub fn propagate_lat_lon_hae(
    runtime: &SpaceOrbitRuntime,
    t: DateTime<Utc>,
) -> Result<(f64, f64, f64), String> {
    let naive = t.naive_utc();
    let m = runtime
        .elements
        .datetime_to_minutes_since_epoch(&naive)
        .map_err(|e| format!("minutes since epoch: {e}"))?;
    let pred = runtime
        .constants
        .propagate(m)
        .map_err(|e| format!("SGP4 propagate: {e}"))?;
    let x = pred.position[0];
    let y = pred.position[1];
    let z = pred.position[2];
    let jd = julian_date_ut1(t);
    let gmst = gstime_rad(jd);
    let (lat_rad, lon_rad, h_km) = eci_to_geodetic_km(x, y, z, gmst);
    Ok((lat_rad.to_degrees(), lon_rad.to_degrees(), h_km * 1000.0))
}

/// Sample subsatellite track and footprint centers ahead in simulated time.
pub fn sample_ground_track_deg(
    runtime: &SpaceOrbitRuntime,
    t0: DateTime<Utc>,
    ahead_s: f64,
    samples: usize,
) -> Vec<(f64, f64)> {
    if samples < 2 || ahead_s <= 0.0 {
        return Vec::new();
    }
    let step = ahead_s / (samples - 1) as f64;
    let mut out = Vec::with_capacity(samples);
    for i in 0..samples {
        let t = t0 + chrono::Duration::milliseconds((step * i as f64 * 1000.0).round() as i64);
        if let Ok((lat, lon, _)) = propagate_lat_lon_hae(runtime, t) {
            out.push((lat, lon));
        }
    }
    out
}

/// Pairs `(satellite_id, asset_id)` for ground units currently inside a satellite footprint.
pub fn current_coverage_pairs(
    satellites: &[(String, f64, f64, f64)],
    ground: &[(String, f64, f64)],
) -> HashSet<(String, String)> {
    let mut next = HashSet::new();
    for (sid, slat, slon, fr) in satellites {
        for (gid, glat, glon) in ground {
            if ground_point_in_fov(*slat, *slon, *fr, *glat, *glon) {
                next.insert((sid.clone(), gid.clone()));
            }
        }
    }
    next
}

/// Whether `ground` (lat/lon, surface) lies inside the satellite nadir footprint (geodesic cap).
pub fn ground_point_in_fov(
    sub_lat_deg: f64,
    sub_lon_deg: f64,
    footprint_radius_m: f64,
    ground_lat_deg: f64,
    ground_lon_deg: f64,
) -> bool {
    let d = geodesic_distance_m(sub_lat_deg, sub_lon_deg, ground_lat_deg, ground_lon_deg);
    d <= footprint_radius_m
}

/// Update coverage sets and emit enter/leave events.
pub fn diff_coverage_events(
    satellites: &[(String, f64, f64, f64)],
    ground_units: &[(String, f64, f64)],
    prev_in_fov: &mut HashSet<(String, String)>,
    sim_time_utc: String,
) -> Vec<SpaceCoverageEventDto> {
    let mut next = HashSet::new();
    for (sid, slat, slon, fr) in satellites {
        for (gid, glat, glon) in ground_units {
            if ground_point_in_fov(*slat, *slon, *fr, *glat, *glon) {
                next.insert((sid.clone(), gid.clone()));
            }
        }
    }

    let mut events = Vec::new();
    for key @ (ref sat_id, ref asset_id) in &next {
        if !prev_in_fov.contains(key) {
            events.push(SpaceCoverageEventDto {
                kind: "enter".to_string(),
                satellite_id: sat_id.clone(),
                asset_id: asset_id.clone(),
                sim_time_utc: sim_time_utc.clone(),
            });
        }
    }
    for key @ (ref sat_id, ref asset_id) in prev_in_fov.iter() {
        if !next.contains(key) {
            events.push(SpaceCoverageEventDto {
                kind: "leave".to_string(),
                satellite_id: sat_id.clone(),
                asset_id: asset_id.clone(),
                sim_time_utc: sim_time_utc.clone(),
            });
        }
    }
    *prev_in_fov = next;
    events
}

/// Propagate TLE position and build client overlay payload.
pub fn propagate_and_snapshot(
    runtime: &SpaceOrbitRuntime,
    t: DateTime<Utc>,
) -> Result<(f64, f64, f64, SpaceSnapshotDto), String> {
    let (lat, lon, hae) = propagate_lat_lon_hae(runtime, t)?;
    let snap = build_space_snapshot(
        runtime,
        t,
        DEFAULT_TRACK_AHEAD_S,
        DEFAULT_TRACK_SAMPLES,
    )?;
    Ok((lat, lon, hae, snap))
}

pub fn build_space_snapshot(
    runtime: &SpaceOrbitRuntime,
    t: DateTime<Utc>,
    track_ahead_s: f64,
    track_samples: usize,
) -> Result<SpaceSnapshotDto, String> {
    let (_lat, _lon, hae) = propagate_lat_lon_hae(runtime, t)?;
    let fr = footprint_radius_m(hae, runtime.config.fov_half_angle_deg);
    let ground_track_deg: Vec<LatLonDegDto> = sample_ground_track_deg(runtime, t, track_ahead_s, track_samples)
        .into_iter()
        .map(|(lat_deg, lon_deg)| LatLonDegDto { lat_deg, lon_deg })
        .collect();
    // "Soon visible" region: same subsat track, lighter overlay on client.
    let future_footprint_deg = ground_track_deg.clone();

    Ok(SpaceSnapshotDto {
        line1: runtime.config.line1.clone(),
        line2: runtime.config.line2.clone(),
        fov_half_angle_deg: runtime.config.fov_half_angle_deg,
        footprint_radius_m: fr,
        ground_track_deg,
        future_footprint_deg,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iss_tle_propagates_finite() {
        let line1 = "1 25544U 98067A   20194.88612269 -.00002218  00000-0 -31515-4 0  9992";
        let line2 = "2 25544  51.6461 221.2784 0001413  89.1723 280.4612 15.49507896236008";
        let cfg = SpaceOrbitConfig {
            line1: line1.to_string(),
            line2: line2.to_string(),
            fov_half_angle_deg: 2.0,
            hide_map_marker: true,
        };
        let rt = SpaceOrbitRuntime::from_config(cfg).expect("tle");
        let t = Utc.with_ymd_and_hms(2020, 7, 13, 12, 0, 0).unwrap();
        let (la, lo, h) = propagate_lat_lon_hae(&rt, t).expect("prop");
        assert!(la.is_finite() && lo.is_finite() && h.is_finite());
        assert!(la.abs() <= 90.0 && lo.abs() <= 180.0);
        // LEO altitude (m) — catches broken ECI→geodetic height (would break FoV radius).
        assert!(
            (200_000.0..900_000.0).contains(&h),
            "expected ISS-like HAE (m), got {h}"
        );
    }
}
