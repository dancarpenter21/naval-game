import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';

const normalizeSidc = (sidc) => sidc?.replace(/-/g, '');

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

  const center = ships.length > 0 ? [ships[0].lat_deg, ships[0].lon_deg] : [35.0, -40.0];

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
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
