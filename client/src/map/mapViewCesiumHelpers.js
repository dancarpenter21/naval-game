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
 * World outer ring + geodesic inner ring for satellite FoV shading (hole).
 * @returns {{ outerPositions: Cesium.Cartesian3[], innerPositions: Cesium.Cartesian3[] }}
 */
export function worldShadeWithHoleCartesian3(centerLat, centerLon, footprintRadiusM) {
  const r = Math.min(Math.max(Number(footprintRadiusM) || 0, 15_000), 5_000_000);
  const outerPositions = Cesium.Cartesian3.fromDegreesArray([
    -180, -89.9, 180, -89.9, 180, 89.9, -180, 89.9, -180, -89.9,
  ]);
  const steps = 72;
  const innerFlat = [];
  for (let i = 0; i < steps; i++) {
    const brng = (i / steps) * 360;
    const { latDeg, lonDeg } = geodesicDirect(centerLat, centerLon, brng, r);
    innerFlat.push(lonDeg, latDeg);
  }
  const innerPositions = Cesium.Cartesian3.fromDegreesArray(innerFlat);
  return { outerPositions, innerPositions };
}

/** @param {string} svgString */
export function svgToImageDataUrl(svgString) {
  const compact = String(svgString).replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(compact)}`;
}
