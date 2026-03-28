//! Land vs sea from Natural Earth land polygons (GeoJSON).
//!
//! Data: `config/natural-earth/ne_110m_land.geojson` (110m physical, public domain).
//! Override path with env [`ENV_LAND_MASK_GEOJSON`]. If the file is missing or invalid,
//! the server uses an all-sea mask (no land rejection).

use std::fs;
use std::path::Path;
use std::sync::Arc;

use geo::Contains;
use geo_types::{Geometry, MultiPolygon, Point, Polygon};
use geojson::GeoJson;
use tracing::{info, warn};

use crate::earth::{geodesic_direct_deg, geodesic_segment_samples};
use crate::movement::StationPhase;

/// Env var: absolute or relative path to a Natural-Earth-style land GeoJSON
/// (`FeatureCollection` of `Polygon` / `MultiPolygon` features).
pub const ENV_LAND_MASK_GEOJSON: &str = "LAND_MASK_GEOJSON";

/// ~25 km between samples along legs; coarse vs 110m land shapes but cheap.
const PATH_SAMPLE_MAX_STEP_M: f64 = 25_000.0;
const ORBIT_RIM_SAMPLES: i32 = 24;

#[derive(Debug)]
pub struct NaturalEarthLandMask {
    land: MultiPolygon<f64>,
}

impl NaturalEarthLandMask {
    pub fn from_geojson_str(s: &str) -> Result<Self, String> {
        let gj: GeoJson = s
            .parse()
            .map_err(|e: geojson::Error| format!("geojson parse: {e}"))?;
        let mut polygons: Vec<Polygon<f64>> = Vec::new();
        match gj {
            GeoJson::FeatureCollection(fc) => {
                for feature in fc.features {
                    let Some(geom) = feature.geometry else {
                        continue;
                    };
                    append_geometry_polygons(&mut polygons, geom)?;
                }
            }
            GeoJson::Feature(f) => {
                let Some(geom) = f.geometry else {
                    return Err("feature has no geometry".into());
                };
                append_geometry_polygons(&mut polygons, geom)?;
            }
            _ => return Err("expected FeatureCollection or Feature root".into()),
        }
        if polygons.is_empty() {
            return Err("no land polygons in geojson".into());
        }
        Ok(Self {
            land: MultiPolygon(polygons),
        })
    }

    pub fn load_from_path(path: &Path) -> Result<Self, String> {
        let s = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        Self::from_geojson_str(&s)
    }

    #[inline]
    pub fn is_land(&self, lat_deg: f64, lon_deg: f64) -> bool {
        let pt = Point::new(lon_deg, lat_deg);
        self.land.contains(&pt)
    }
}

fn append_geometry_polygons(out: &mut Vec<Polygon<f64>>, geom: geojson::Geometry) -> Result<(), String> {
    let g: Geometry<f64> = geom
        .try_into()
        .map_err(|e| format!("geometry conversion: {e}"))?;
    append_geometry_as_polygons(out, g)
}

fn append_geometry_as_polygons(out: &mut Vec<Polygon<f64>>, g: Geometry<f64>) -> Result<(), String> {
    match g {
        Geometry::Polygon(p) => {
            out.push(p);
            Ok(())
        }
        Geometry::MultiPolygon(mp) => {
            for p in mp {
                out.push(p);
            }
            Ok(())
        }
        Geometry::GeometryCollection(gc) => {
            for inner in gc {
                append_geometry_as_polygons(out, inner)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[derive(Clone, Debug)]
pub enum LandSeaMask {
    /// No land data — [`Self::is_land`](LandSeaMask::is_land) is always false.
    AllSea,
    NaturalEarth(Arc<NaturalEarthLandMask>),
}

impl LandSeaMask {
    /// Load from [`ENV_LAND_MASK_GEOJSON`] if set and non-empty; else default file
    /// `config/natural-earth/ne_110m_land.geojson` when present; else [`AllSea`](LandSeaMask::AllSea).
    pub fn load_default() -> Self {
        if let Ok(p) = std::env::var(ENV_LAND_MASK_GEOJSON) {
            let t = p.trim();
            if !t.is_empty() {
                let path = Path::new(t);
                match NaturalEarthLandMask::load_from_path(path) {
                    Ok(m) => {
                        info!(
                            "Land mask loaded from {} (Natural Earth-style GeoJSON)",
                            path.display()
                        );
                        return Self::NaturalEarth(Arc::new(m));
                    }
                    Err(e) => {
                        warn!(
                            "{}={} failed ({e}); using all-sea mask.",
                            ENV_LAND_MASK_GEOJSON,
                            path.display()
                        );
                        return Self::AllSea;
                    }
                }
            }
        }

        let default_rel = Path::new("config/natural-earth/ne_110m_land.geojson");
        if default_rel.exists() {
            match NaturalEarthLandMask::load_from_path(default_rel) {
                Ok(m) => {
                    info!(
                        "Land mask loaded from {} (Natural Earth 110m land)",
                        default_rel.display()
                    );
                    return Self::NaturalEarth(Arc::new(m));
                }
                Err(e) => {
                    warn!(
                        "Land mask {:?} could not be loaded ({e}); using all-sea mask.",
                        default_rel
                    );
                }
            }
        } else {
            info!(
                "No {:?}; land movement checks disabled (all sea).",
                default_rel
            );
        }
        Self::AllSea
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        matches!(self, Self::NaturalEarth(_))
    }

    #[inline]
    pub fn is_land(&self, lat_deg: f64, lon_deg: f64) -> bool {
        match self {
            Self::AllSea => false,
            Self::NaturalEarth(m) => m.is_land(lat_deg, lon_deg),
        }
    }
}

/// When `enforce` is true and the mask is active, returns an error message if the planned
/// path or station lies on land. Air / missile units set `skip_land_mask` in YAML to skip.
pub fn movement_order_violates_land(
    mask: &LandSeaMask,
    enforce: bool,
    start_lat: f64,
    start_lon: f64,
    waypoints: &[(f64, f64)],
    station: &StationPhase,
) -> Option<String> {
    if !enforce || !mask.is_active() {
        return None;
    }

    let mut prev_lat = start_lat;
    let mut prev_lon = start_lon;
    for (la, lo) in waypoints {
        for (slat, slon) in geodesic_segment_samples(prev_lat, prev_lon, *la, *lo, PATH_SAMPLE_MAX_STEP_M)
        {
            if mask.is_land(slat, slon) {
                return Some("Movement crosses land (waypoint leg).".into());
            }
        }
        prev_lat = *la;
        prev_lon = *lo;
    }

    match station {
        StationPhase::Orbit {
            center_lat_deg,
            center_lon_deg,
            radius_m,
            ..
        } => {
            for (slat, slon) in geodesic_segment_samples(
                prev_lat,
                prev_lon,
                *center_lat_deg,
                *center_lon_deg,
                PATH_SAMPLE_MAX_STEP_M,
            ) {
                if mask.is_land(slat, slon) {
                    return Some("Movement crosses land (toward orbit center).".into());
                }
            }
            if mask.is_land(*center_lat_deg, *center_lon_deg) {
                return Some("Orbit center is on land.".into());
            }
            let r = radius_m
                .clamp(
                    crate::units::distance::ORBIT_RADIUS_MIN,
                    crate::units::distance::ORBIT_RADIUS_MAX,
                )
                .raw();
            for k in 0..ORBIT_RIM_SAMPLES {
                let azi = (k as f64) * (360.0 / ORBIT_RIM_SAMPLES as f64);
                let (rlat, rlon) =
                    geodesic_direct_deg(*center_lat_deg, *center_lon_deg, azi, r);
                if mask.is_land(rlat, rlon) {
                    return Some("Orbit path intersects land.".into());
                }
            }
        }
        StationPhase::Racetrack {
            loop_path_deg, ..
        } => {
            if loop_path_deg.len() < 2 {
                return None;
            }
            let entry = loop_path_deg[0];
            for (slat, slon) in geodesic_segment_samples(
                prev_lat,
                prev_lon,
                entry.0,
                entry.1,
                PATH_SAMPLE_MAX_STEP_M,
            ) {
                if mask.is_land(slat, slon) {
                    return Some("Movement crosses land (toward racetrack).".into());
                }
            }
            let n = loop_path_deg.len();
            for i in 0..n {
                let (a_lat, a_lon) = loop_path_deg[i];
                let (b_lat, b_lon) = loop_path_deg[(i + 1) % n];
                for (slat, slon) in
                    geodesic_segment_samples(a_lat, a_lon, b_lat, b_lon, PATH_SAMPLE_MAX_STEP_M)
                {
                    if mask.is_land(slat, slon) {
                        return Some("Racetrack path intersects land.".into());
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const TINY_LAND: &str = r#"{
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]]
            }
        }]
    }"#;

    #[test]
    fn tiny_square_point_inside_is_land() {
        let m = NaturalEarthLandMask::from_geojson_str(TINY_LAND).unwrap();
        assert!(m.is_land(0.0, 0.0));
        assert!(!m.is_land(20.0, 0.0));
    }

    #[test]
    fn all_sea_never_land() {
        let m = LandSeaMask::AllSea;
        assert!(!m.is_land(0.0, 0.0));
        assert!(!m.is_active());
    }
}
