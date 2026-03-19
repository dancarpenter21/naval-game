import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';

const normalizeSidc = (sidc) => sidc?.replace(/-/g, '');

const createMilSymbolSvg = ({ sidc, size }) => {
  const normalizedSidc = normalizeSidc(sidc);
  const symbol = new ms.Symbol(normalizedSidc, {
    size,
    standard: '2525D',
  });
  return symbol.asSVG();
};

const createMilSymbolIcon = ({ sidc, name }) => {
  try {
    const normalizedSidc = normalizeSidc(sidc);
    const symbol = new ms.Symbol(normalizedSidc, {
      size: 25,
      standard: '2525D',
    });
    const svg = symbol.asSVG();
    console.log('[milsymbol] built', {
      sidc,
      normalizedSidc,
      svgLength: svg?.length,
      size: symbol.getSize(),
    });

    return L.divIcon({
      className: 'custom-milsymbol',
      html: `
        <div style="
          width: 25px;
          height: 25px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
        " title="${name}">
          ${svg}
        </div>
      `,
      iconSize: [25, 25],
      iconAnchor: [12, 12],
    });
  } catch (error) {
    console.warn('[milsymbol] failed to build icon, using fallback', {
      sidc,
      normalizedSidc: normalizeSidc(sidc),
      error,
    });
    return L.divIcon({
      className: 'custom-milsymbol fallback',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #fff;
          background: #0f4c81;
          box-shadow: 0 0 0 2px rgba(0,0,0,0.35);
        "></div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }
};

const normalizeShipsSnapshot = (snapshot) => {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.ships)) return snapshot.ships;
  if (Array.isArray(snapshot?.data)) return snapshot.data;
  if (snapshot && typeof snapshot === 'object' && snapshot.id && snapshot.sidc) {
    return [snapshot];
  }
  return [];
};

const MapView = ({ socket, session }) => {
  const [ships, setShips] = useState([]);
  const outerRef = useRef(null);
  const [outerSize, setOuterSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!socket || !session?.id) return;

    const handleWorldSnapshot = (snapshot) => {
      console.log('[world_snapshot] received', snapshot);
      setShips(normalizeShipsSnapshot(snapshot));
    };

    socket.on('world_snapshot', handleWorldSnapshot);
    socket.emit('request_world_snapshot', { id: session.id });
    return () => {
      socket.off('world_snapshot', handleWorldSnapshot);
    };
  }, [socket, session?.id]);

  useEffect(() => {
    if (!outerRef.current) return;

    const el = outerRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect || {};
      setOuterSize({
        width: width || 0,
        height: height || 0,
      });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const center = ships.length > 0 ? [ships[0].lat_deg, ships[0].lon_deg] : [35.0, -40.0];
  // Example implementation: treat all units as red team cards.
  const redTeamShips = ships;

  const cardCount = Math.max(1, redTeamShips.length);
  const unitCardHeight = outerSize.height ? (outerSize.height * 0.1) / cardCount : 30;
  const unitCardWidth = unitCardHeight / 2;
  const unitIconSize = Math.max(8, Math.round(unitCardHeight * 0.55));
  const unitNameFontSize = Math.max(8, Math.round(unitCardHeight * 0.28));
  const unitIdFontSize = Math.max(7, Math.round(unitCardHeight * 0.18));
  const unitGap = Math.max(2, Math.round(unitCardHeight * 0.06));

  return (
    <div ref={outerRef} style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          zIndex: 1000,
          top: 10,
          right: 10,
          background: 'rgba(0,0,0,0.65)',
          color: 'white',
          padding: '8px 10px',
          borderRadius: 6,
          fontSize: 12,
          maxWidth: 320,
          pointerEvents: 'none',
        }}
      >
        <div><strong>Ships</strong>: {ships.length}</div>
        <div style={{ opacity: 0.85 }}>
          {ships.map((s) => s.id).join(', ')}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          zIndex: 1001,
          left: 12,
          right: 12,
          bottom: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: unitGap,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {redTeamShips.map((ship) => {
          const svg = createMilSymbolSvg({ sidc: ship.sidc, size: 18 });

          return (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={ship.id}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: unitGap,
                padding: 0,
                width: unitCardWidth,
                height: unitCardHeight,
                borderRadius: 0,
                background: 'rgba(220, 38, 38, 0.35)',
                border: '1px solid rgba(220, 38, 38, 0.35)',
                color: 'white',
                boxSizing: 'border-box',
                textAlign: 'center',
                overflow: 'hidden',
              }}
              title={ship.name}
            >
              <div
                style={{
                  width: unitIconSize,
                  height: unitIconSize,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                // milsymbol returns SVG XML string
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: unitNameFontSize,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: unitCardWidth,
                  }}
                >
                  {ship.name}
                </div>
                <div
                  style={{
                    opacity: 0.8,
                    fontSize: unitIdFontSize,
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: unitCardWidth,
                  }}
                >
                  {ship.id}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <MapContainer
        center={center}
        zoom={4}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        />
        {ships.map((ship) => {
          const icon = createMilSymbolIcon({
            sidc: ship.sidc,
            name: ship.name,
          });

          return (
            <Marker key={ship.id} position={[ship.lat_deg, ship.lon_deg]} icon={icon}>
              <Popup>
                {ship.name} ({ship.id})
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default MapView;
