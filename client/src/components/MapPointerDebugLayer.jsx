import { useMap } from 'react-leaflet';
import { useEffect } from 'react';
import { mapClickDebug, isMapClickDebugEnabled } from '../utils/mapClickDebug';

/**
 * Logs Leaflet map-level pointer events (tile pane). Marker clicks also bubble here
 * unless stopped — compare with MapView marker logs.
 */
export default function MapPointerDebugLayer() {
  const map = useMap();

  useEffect(() => {
    if (!isMapClickDebugEnabled()) return undefined;

    const summarizeTarget = (ev) => {
      const t = ev?.originalEvent?.target;
      if (!t || typeof t !== 'object') return {};
      return {
        tag: t.tagName,
        className: typeof t.className === 'string' ? t.className.slice(0, 120) : String(t.className),
        id: t.id || undefined,
      };
    };

    const onClick = (ev) => {
      mapClickDebug('leaflet:map:click', {
        latlng: ev.latlng,
        containerPoint: ev.containerPoint,
        ...summarizeTarget(ev),
      });
    };
    const onMouseDown = (ev) => {
      mapClickDebug('leaflet:map:mousedown', {
        button: ev.originalEvent?.button,
        latlng: ev.latlng,
        ...summarizeTarget(ev),
      });
    };
    const onContextMenu = (ev) => {
      mapClickDebug('leaflet:map:contextmenu', {
        latlng: ev.latlng,
        ...summarizeTarget(ev),
      });
    };

    map.on('click', onClick);
    map.on('mousedown', onMouseDown);
    map.on('contextmenu', onContextMenu);
    return () => {
      map.off('click', onClick);
      map.off('mousedown', onMouseDown);
      map.off('contextmenu', onContextMenu);
    };
  }, [map]);

  return null;
}
