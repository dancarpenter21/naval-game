/**
 * Username for sessions (modal) and fallbacks for display name.
 * Persisted manual entry: HTTP cookie `naval_player_username` (SameSite=Lax).
 * Smart card name is resolved separately in `smartCardIdentity.js` and overrides
 * the cookie on load when present.
 */

const COOKIE_NAME = 'naval_player_username';
/** Legacy key from earlier builds; read-only fallback */
const LEGACY_STORAGE_KEY = 'naval_player_display_name';

export const USERNAME_MIN_LEN = 2;
export const USERNAME_MAX_LEN = 48;

/** Letters (any script), numbers, spaces, and common name punctuation */
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;

/**
 * @param {unknown} s
 * @returns {boolean}
 */
export function validateUsername(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < USERNAME_MIN_LEN || t.length > USERNAME_MAX_LEN) return false;
  return USERNAME_RE.test(t);
}

function readCookies() {
  if (typeof document === 'undefined') return {};
  const out = {};
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * @returns {string | null}
 */
export function getUsernameFromCookie() {
  try {
    const v = readCookies()[COOKIE_NAME];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, USERNAME_MAX_LEN);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Persists a manually entered username (omit when name came from smart card only).
 * @param {string} raw
 */
export function setUsernameCookie(raw) {
  const t = raw.trim().slice(0, USERNAME_MAX_LEN);
  if (!validateUsername(t)) return;
  try {
    const maxAge = 60 * 60 * 24 * 400; // ~400 days
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:';
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(t)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
  } catch {
    /* ignore */
  }
}

/**
 * Fallback display name for code paths that don't have the modal state (env, cookie, legacy storage).
 * @returns {string}
 */
export function getPlayerDisplayName() {
  const fromCookie = getUsernameFromCookie();
  if (fromCookie && validateUsername(fromCookie)) return fromCookie;

  const env = import.meta.env?.VITE_PLAYER_NAME;
  if (typeof env === 'string' && env.trim()) {
    return env.trim().slice(0, USERNAME_MAX_LEN);
  }

  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim().slice(0, USERNAME_MAX_LEN);
  } catch {
    /* ignore */
  }

  return '';
}
