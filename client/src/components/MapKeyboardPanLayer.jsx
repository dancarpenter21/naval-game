import { useMap } from 'react-leaflet';
import { useEffect, useRef } from 'react';

/** Pixels per second (screen space); Total War–style continuous pan while keys are held. */
const PAN_SPEED_PX_PER_S = 520;

function typingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Disables mouse-driven pan (drag/box-zoom); pans with W A S D on the home row.
 * Scroll wheel zoom unchanged. Leaflet keyboard handler is off so arrows/+/- don’t fight WASD.
 */
export default function MapKeyboardPanLayer() {
  const map = useMap();
  const keysRef = useRef(new Set());

  useEffect(() => {
    if (!map) return undefined;

    map.dragging?.disable();
    map.boxZoom?.disable();
    map.keyboard?.disable();

    return () => {
      map.keyboard?.enable();
      map.boxZoom?.enable();
      map.dragging?.enable();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return undefined;

    const clearKeys = () => {
      keysRef.current.clear();
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingTarget(document.activeElement)) return;

      const k = e.key.length === 1 ? e.key.toLowerCase() : '';
      if (!['w', 'a', 's', 'd'].includes(k)) return;

      e.preventDefault();
      keysRef.current.add(k);
    };

    const onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : '';
      keysRef.current.delete(k);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);

    let raf = 0;
    let last = performance.now();

    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const keys = keysRef.current;
      if (keys.size > 0) {
        const step = PAN_SPEED_PX_PER_S * dt;
        let dx = 0;
        let dy = 0;
        // Leaflet panBy pixel deltas; signs tuned so W/A/S/D = north/west/south/east.
        if (keys.has('w')) dy -= step;
        if (keys.has('s')) dy += step;
        if (keys.has('a')) dx -= step;
        if (keys.has('d')) dx += step;
        if (dx !== 0 || dy !== 0) {
          map.panBy([dx, dy], { animate: false });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      keysRef.current.clear();
    };
  }, [map]);

  return null;
}
