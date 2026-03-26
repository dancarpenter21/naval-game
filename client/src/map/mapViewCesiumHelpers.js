import * as Cesium from 'cesium';
import { geodesicDirect } from '../geo/wgs84Geodesic';

/** Match prior Leaflet zoom ↔ camera height (approximate). */
export function heightMetersFromZoom(zoom) {
  const z = Math.max(0, Math.min(22, zoom));
  return 40_000_000 / 2 ** z;
}

export function zoomFromHeightMeters(h) {
  if (!Number.isFinite(h) || h <= 0) return 4;
  return Math.log2(40_000_000 / Math.max(h, 100));
}

/**
 * Dense world-boundary ring (lon/lat, height 0 on ellipsoid).
 * Reversed before use as polygon outer ring so the hole winds opposite (Cesium triangulation).
 */
export function worldOuterRingPositionsHeights() {
  const latS = -89.9;
  const latN = 89.9;
  const lonW = -180;
  const lonE = 180;
  const n = 48;
  const flat = [];
  for (let i = 0; i <= n; i++) {
    flat.push(lonW + ((lonE - lonW) * i) / n, latS, 0);
  }
  for (let i = 1; i <= n; i++) {
    flat.push(lonE, latS + ((latN - latS) * i) / n, 0);
  }
  for (let i = 1; i <= n; i++) {
    flat.push(lonE - ((lonE - lonW) * i) / n, latN, 0);
  }
  for (let i = 1; i < n; i++) {
    flat.push(lonW, latN - ((latN - latS) * i) / n, 0);
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat);
}

/**
 * Closed geodesic loop on the ellipsoid (height 0), for polylines / fallback outlines.
 */
export function geodesicRingPositionsHeights(latDeg, lonDeg, radiusM, steps = 128, heightM = 0) {
  const r = Math.max(Number(radiusM) || 0, 1);
  const z = Number(heightM) || 0;
  const flat = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 360;
    const p = geodesicDirect(latDeg, lonDeg, brng, r);
    flat.push(p.lonDeg, p.latDeg, z);
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat);
}

/**
 * World outer ring + inner hole (visibility cap). Caller should pass radius already clamped (e.g. ≤ 15e6 m).
 * Inner ring is reversed vs. the geodesic loop so Cesium treats it as a hole; do not duplicate the first vertex.
 */
export function worldShadeWithHoleCartesian3(centerLat, centerLon, holeRadiusM) {
  const r = Math.min(Math.max(Number(holeRadiusM) || 0, 500), 15_000_000);
  const outerPositions = worldOuterRingPositionsHeights().slice().reverse();
  const steps = 128;
  const innerFlat = [];
  for (let i = 0; i < steps; i++) {
    const brng = (i / steps) * 360;
    const p = geodesicDirect(centerLat, centerLon, brng, r);
    innerFlat.push(p.lonDeg, p.latDeg, 0);
  }
  const innerOpen = Cesium.Cartesian3.fromDegreesArrayHeights(innerFlat);
  const innerPositions = innerOpen.slice().reverse();
  return { outerPositions, innerPositions };
}

/** @param {string} svgString */
export function svgToImageDataUrl(svgString) {
  const compact = String(svgString).replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(compact)}`;
}
