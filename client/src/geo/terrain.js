/**
 * Terrain / DTED hooks (client).
 *
 * When you add elevation (DTED-derived tiles, MapLibre terrain, Cesium globe, etc.),
 * implement sampling here and optionally expose hooks to React (context or store).
 *
 * @see docs/EARTH_AND_TERRAIN.md
 */

/**
 * @param {number} _latDeg
 * @param {number} _lonDeg
 * @returns {number | null} meters above terrain datum, or null if unavailable
 */
export function sampleTerrainElevationM(_latDeg, _lonDeg) {
  return null;
}

/**
 * Future: true when a DEM / DTED-backed provider is active (for UI toggles).
 */
export function isTerrainProviderActive() {
  return false;
}
