/** Server hard limits (emit / clamp); min/max sim rate are powers of two (`2^-3` … `2^6`). */
export const MIN_TIME_SCALE = 0.125;
export const MAX_TIME_SCALE = 64;

/** Dial face: 12 o'clock = ⅛×, 3 o'clock = 1×, clockwise to ~11:59 = max ×. */
export const DIAL_FACE_MIN_SCALE = 0.125;

/** Small angular gap before 12 so max speed sits at “11:59” (not on top of ¼×). */
const THETA_EPS = 0.07;

/** Radians: 12 o’clock → 3 o’clock (slow zone end = 1× anchor). */
export const THETA_THREE_OCLOCK = Math.PI / 2;

/** Radians: just shy of full turn (max speed). */
export const THETA_MAX_SPEED = 2 * Math.PI - THETA_EPS;

const FAST_ARC_LEN = THETA_MAX_SPEED - THETA_THREE_OCLOCK;

export function clampTimeScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return MIN_TIME_SCALE;
  return Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, n));
}

/**
 * Clockwise angle from 12 o’clock (0) increasing; 3 o’clock = π/2.
 */
export function scaleToClockTheta(scale) {
  const s = clampTimeScale(scale);
  if (s <= DIAL_FACE_MIN_SCALE) return 0;
  if (s <= 1) {
    const t = (s - DIAL_FACE_MIN_SCALE) / (1 - DIAL_FACE_MIN_SCALE);
    return t * THETA_THREE_OCLOCK;
  }
  const u = Math.log(s) / Math.log(MAX_TIME_SCALE);
  return THETA_THREE_OCLOCK + Math.min(1, Math.max(0, u)) * FAST_ARC_LEN;
}

/**
 * Inverse: pointer angle (same convention as atan2(dx,-dy) normalized to [0,2π)).
 */
export function clockThetaToScale(theta) {
  let t = theta;
  while (t < 0) t += 2 * Math.PI;
  while (t >= 2 * Math.PI) t -= 2 * Math.PI;

  // Forbidden wedge between max × and ⅛× (just below 12)
  if (t > THETA_MAX_SPEED) {
    const mid = (THETA_MAX_SPEED + 2 * Math.PI) / 2;
    return t >= mid ? MAX_TIME_SCALE : DIAL_FACE_MIN_SCALE;
  }

  if (t <= THETA_THREE_OCLOCK) {
    return DIAL_FACE_MIN_SCALE + (t / THETA_THREE_OCLOCK) * (1 - DIAL_FACE_MIN_SCALE);
  }
  const u = (t - THETA_THREE_OCLOCK) / FAST_ARC_LEN;
  return Math.pow(MAX_TIME_SCALE, Math.min(1, Math.max(0, u)));
}

/** Point on dial at clock angle θ (0 = 12 o’clock, clockwise). */
export function clockPolar(cx, cy, r, theta) {
  return {
    x: cx + r * Math.sin(theta),
    y: cy - r * Math.cos(theta),
  };
}

export function scaleToHandTip(scale, r = 34) {
  const θ = scaleToClockTheta(scale);
  return clockPolar(50, 50, r, θ);
}

/**
 * Map pointer (viewBox 0–100) to scale; null if too close to center.
 */
export function pointToTimeScale(x, y) {
  const dx = x - 50;
  const dy = y - 50;
  const dist2 = dx * dx + dy * dy;
  if (dist2 < 36) return null;
  let theta = Math.atan2(dx, -dy);
  while (theta < 0) theta += 2 * Math.PI;
  while (theta >= 2 * Math.PI) theta -= 2 * Math.PI;
  return clockThetaToScale(theta);
}

/**
 * Donut sector from theta0 → theta1 clockwise (theta1 > theta0, span ≤ 2π).
 */
export function donutSectorPath(cx, cy, rInner, rOuter, theta0, theta1) {
  if (theta1 <= theta0) return '';
  const p0o = clockPolar(cx, cy, rOuter, theta0);
  const p1o = clockPolar(cx, cy, rOuter, theta1);
  const p1i = clockPolar(cx, cy, rInner, theta1);
  const p0i = clockPolar(cx, cy, rInner, theta0);
  const largeArc = theta1 - theta0 > Math.PI ? 1 : 0;
  return [
    `M ${p0i.x} ${p0i.y}`,
    `L ${p0o.x} ${p0o.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p1o.x} ${p1o.y}`,
    `L ${p1i.x} ${p1i.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p0i.x} ${p0i.y}`,
    'Z',
  ].join(' ');
}

export function formatTimeScale(scale) {
  const s = clampTimeScale(scale);
  if (Math.abs(s - 0.125) < 0.015) return '⅛';
  if (Math.abs(s - 0.25) < 0.02) return '¼';
  const r = Math.round(s);
  if (Math.abs(s - r) < 0.051) return String(r);
  return s.toFixed(1);
}
