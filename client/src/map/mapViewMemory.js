/**
 * Last map center/zoom per session — survives MapView unmount (e.g. switching tabs).
 * @type {Map<string, { center: [number, number], zoom: number }>}
 */
const bySessionId = new Map();

/**
 * @param {string | undefined} sessionId
 * @returns {{ center: [number, number], zoom: number } | null}
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
 */
export function writeMapViewMemory(sessionId, center, zoom) {
  if (!sessionId || !Number.isFinite(zoom)) return;
  const lat = Array.isArray(center) ? center[0] : center.lat;
  const lng = Array.isArray(center) ? center[1] : center.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  bySessionId.set(sessionId, { center: [lat, lng], zoom });
}
