/**
 * Last map view per session — survives MapView unmount (e.g. switching tabs).
 * `cameraHeightM` is optional (Cesium); when absent, zoom is used to approximate height.
 * @type {Map<string, { center: [number, number], zoom: number, cameraHeightM?: number }>}
 */
const bySessionId = new Map();

/**
 * @param {string | undefined} sessionId
 * @returns {{ center: [number, number], zoom: number, cameraHeightM?: number } | null}
 */
export function readMapViewMemory(sessionId) {
  if (!sessionId) return null;
  const row = bySessionId.get(sessionId);
  if (!row?.center || !Number.isFinite(row.zoom)) return null;
  return row;
}

/**
 * @param {string | undefined} sessionId
 * @param {[number, number] | { lat: number, lng: number }} center
 * @param {number} zoom
 * @param {number} [cameraHeightM] — Cesium camera height (m) above ellipsoid
 */
export function writeMapViewMemory(sessionId, center, zoom, cameraHeightM) {
  if (!sessionId || !Number.isFinite(zoom)) return;
  const lat = Array.isArray(center) ? center[0] : center.lat;
  const lng = Array.isArray(center) ? center[1] : center.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const row = { center: [lat, lng], zoom };
  if (Number.isFinite(cameraHeightM) && cameraHeightM > 0) {
    row.cameraHeightM = cameraHeightM;
  }
  bySessionId.set(sessionId, row);
}
