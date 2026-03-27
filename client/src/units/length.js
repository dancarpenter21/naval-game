/** International foot → meters (WGS84 / Cesium ellipsoid height uses meters). */
export const INTERNATIONAL_FOOT_TO_METERS = 0.3048;

/** @param {number} haeFt height above ellipsoid (ft) */
export function haeFeetToMeters(haeFt) {
  return Number.isFinite(haeFt) ? haeFt * INTERNATIONAL_FOOT_TO_METERS : 0;
}
