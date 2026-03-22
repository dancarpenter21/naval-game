/**
 * WGS84 geodesic helpers (GeographicLib JS).
 * Keep in sync with `server/src/earth.rs` — same ellipsoid & conventions.
 *
 * Heading: 0° = north, 90° = east, clockwise (navigation).
 */
import { Geodesic } from 'geographiclib-geodesic';

const wgs84 = Geodesic.WGS84;

/** @param {number} lat1Deg @param {number} lon1Deg @param {number} lat2Deg @param {number} lon2Deg */
export function geodesicDistanceM(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const r = wgs84.Inverse(lat1Deg, lon1Deg, lat2Deg, lon2Deg);
  return r.s12;
}

/**
 * Destination after moving `distanceM` from (lat, lon) on initial heading `headingDeg`.
 * @returns {{ latDeg: number, lonDeg: number }}
 */
export function geodesicDirect(latDeg, lonDeg, headingDeg, distanceM) {
  const r = wgs84.Direct(latDeg, lonDeg, headingDeg, distanceM);
  return { latDeg: r.lat2, lonDeg: r.lon2 };
}

/** Initial azimuth at point 1 toward point 2 (degrees). */
export function geodesicAzimuth1To2(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const r = wgs84.Inverse(lat1Deg, lon1Deg, lat2Deg, lon2Deg);
  return r.azi1;
}

/**
 * Point on geodesic from `center` toward `pos` at geodesic distance `radiusM` from center.
 * Matches `server/src/earth.rs` `geodesic_point_toward_at_distance`.
 */
export function geodesicPointTowardFromCenter(
  centerLat,
  centerLon,
  posLat,
  posLon,
  radiusM,
  headingFallbackDeg,
) {
  const inv = wgs84.Inverse(centerLat, centerLon, posLat, posLon);
  if (inv.s12 < 1) {
    const d = wgs84.Direct(centerLat, centerLon, headingFallbackDeg, radiusM);
    return { latDeg: d.lat2, lonDeg: d.lon2 };
  }
  const d = wgs84.Direct(centerLat, centerLon, inv.azi1, radiusM);
  return { latDeg: d.lat2, lonDeg: d.lon2 };
}
