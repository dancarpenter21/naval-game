/**
 * WGS84 HAE on the wire is in international feet; Cesium / geodesic math use meters.
 * Keep `METERS_PER_INTERNATIONAL_FOOT` in sync with `server/src/earth.rs`.
 */
export const METERS_PER_INTERNATIONAL_FOOT = 0.3048;

/** @param {number} haeFt height above ellipsoid (ft) */
export function haeFeetToMeters(haeFt) {
  return Number.isFinite(haeFt) ? haeFt * METERS_PER_INTERNATIONAL_FOOT : 0;
}

/** @param {number} haeM height above ellipsoid (m) */
export function haeMetersToFeet(haeM) {
  return Number.isFinite(haeM) ? haeM / METERS_PER_INTERNATIONAL_FOOT : 0;
}
