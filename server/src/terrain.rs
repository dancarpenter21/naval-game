//! Terrain / elevation hooks (DTED, DEM, coastal masking).
//!
//! The sim currently treats the surface as **MSL / ellipsoid height from entity state** only.
//! When you add NGA DTED, COP30, or custom GeoTIFF tiles, implement [`TerrainElevationSource`]
//! and thread it into the session / movement pipeline (ground collision, radar masking, etc.).
//!
//! **Land vs sea** for movement is handled separately in [`crate::land_mask`] (Natural Earth
//! GeoJSON), not by this elevation trait.
//!
//! See `docs/EARTH_AND_TERRAIN.md` for client rendering options and data workflows.

/// Orthometric or ellipsoidal height at a horizontal fix; interpretation is product-specific.
///
/// - `None` — no sample (open ocean default, or terrain layer disabled).
/// - `Some(h)` — meters above the vertical datum used by your DTED/DEM product.
pub trait TerrainElevationSource: Send + Sync {
    fn elevation_m(&self, lat_deg: f64, lon_deg: f64) -> Option<f64>;
}

/// Default: no terrain database (ocean testing, pre-DTED).
#[derive(Debug, Default, Clone, Copy)]
pub struct FlatTerrain;

impl TerrainElevationSource for FlatTerrain {
    fn elevation_m(&self, _lat_deg: f64, _lon_deg: f64) -> Option<f64> {
        None
    }
}

/// Marker type reserved for a future DTED-backed implementation (file cache, tile API, etc.).
#[derive(Debug, Default, Clone, Copy)]
pub struct DtedTerrainPlaceholder;

impl TerrainElevationSource for DtedTerrainPlaceholder {
    fn elevation_m(&self, _lat_deg: f64, _lon_deg: f64) -> Option<f64> {
        None
    }
}
