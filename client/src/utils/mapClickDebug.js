/**
 * Map / marker click tracing. Enable always in Vite dev; in production run:
 *   localStorage.setItem('naval_debug_map_clicks', '1')
 * then reload. Disable: removeItem or set to '0'.
 */
export function isMapClickDebugEnabled() {
  if (import.meta.env.DEV) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('naval_debug_map_clicks') === '1';
  } catch {
    return false;
  }
}

/** @param {...unknown} args */
export function mapClickDebug(...args) {
  if (!isMapClickDebugEnabled()) return;
  const c = globalThis.console;
  if (typeof c?.log === 'function') {
    c.log('[naval:map-clicks]', ...args);
  }
}
