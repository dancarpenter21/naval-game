//! Compile-time–friendly physical quantities: distances, altitudes (by datum), and RF power scales.
//!
//! **Boundaries:** serde DTOs and third-party crates (e.g. `geo`, `geographiclib-rs`, `sgp4`) use raw
//! [`f64`]. Convert at the edge with each newtype’s `.raw()` method, or explicit `from_raw` / `to_*`
//! helpers.

pub mod altitude;
pub mod comm;
pub mod distance;
