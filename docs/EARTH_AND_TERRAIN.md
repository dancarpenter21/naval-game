# Earth geometry & terrain (WGS84, DTED)

## Principles

- **Horizontal fixing** uses **WGS84** latitude/longitude (degrees).
- **Distance, bearing, and motion** use the same **geodesic** model on server and client:
  - **Rust:** [`geographiclib-rs`](https://crates.io/crates/geographiclib-rs) (`server/src/earth.rs`).
  - **JavaScript:** [`geographiclib-geodesic`](https://www.npmjs.com/package/geographiclib-geodesic) (`client/src/geo/wgs84Geodesic.js`).
- **Heading** is **navigation convention**: **0° = north**, **90° = east**, clockwise.
- **Speed** remains **knots** converted with the SI nautical mile (1852 m / 3600 s) in `sim_timing.rs`.

This keeps orbit radii, “on station” checks, and user-drawn orders aligned with what the server integrates.

## Server modules

| Module        | Role |
|---------------|------|
| `earth.rs`    | WGS84 inverse/distance, direct (move along heading), orbit helpers. |
| `movement.rs` | Cruise + orbit integration using `earth`. |
| `terrain.rs`  | `TerrainElevationSource` trait + `FlatTerrain` / `DtedTerrainPlaceholder` — wire into sessions when you add DTED/DEM sampling. |

## Orbit “on station”

The server treats the aircraft/ship as on the orbit when the **geodesic** distance from the orbit center differs from the ordered radius by less than a margin (`movement.rs` / `earth::geodesic_on_orbit_station`). That replaces the old local tangent-plane circle test.

## DTED & elevation (future)

**DTED** (NGA) and other DEMs supply **terrain height** on a geographic grid. They do not replace geodesic horizontal math; they add a **vertical** channel for:

- Ground / shoreline proximity, radar masking, LOS.
- Altitude above terrain vs MSL for aviation when you move beyond “ocean-only” testing.

### Suggested data path

1. Ingest DTED levels (or COP30 / SRTM) into **tiles** or a **spatial index** your server can query by `(lat, lon)`.
2. Implement `TerrainElevationSource` in `server/src/terrain.rs` (replace `DtedTerrainPlaceholder`).
3. Optionally pass sparse height samples to the client for visualization.

### Rendering / libraries that support terrain (including DTED-derived products)

| Stack | Notes |
|-------|--------|
| **CesiumJS** | Strong **globe + terrain** story (quantized-mesh, heightmaps). Common path: DTED → tool chain → terrain tileset. Good when you need 3D coastlines and vertical perspective. |
| **MapLibre GL JS** | **Terrain** via raster-DEM sources (e.g. MapTiler, self-hosted RGB tiles). DTED is often converted to **Terrain-RGB** or similar. Stays closer to a “map” UX than full Cesium. |
| **Leaflet** (current 2D map) | No native DTED; options are **overlays**, **small DEM plugins**, or **hybrid** (Leaflet for symbology + separate 3D view). For serious land conflict, plan a **second view** or migrate the map layer. |

The repo **does not** bundle DTED files. `terrain.rs` and `client/src/geo/terrain.js` are **hooks only** until you connect data.

## Client

- Use **`wgs84Geodesic.js`** for any user-drawn geometry that must match the server (orbit radius, future racetrack legs).
- Leaflet’s `Circle` still draws in Web Mercator; the **numeric** `radius_m` sent to the server should always come from **geodesic** distance so semantics match WGS84.
