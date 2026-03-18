import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';

const createMilSymbolIcon = ({ sidc, headingDeg, name }) => {
  try {
    const symbol = new ms.Symbol(sidc, {
      size: 48,
      direction: headingDeg,
      uniqueDesignation: name,
    });
    const svg = symbol.asSVG();
    console.log('[milsymbol] built', { sidc, svgLength: svg?.length, size: symbol.getSize() });

    return L.divIcon({
      className: 'custom-milsymbol',
      html: `
        <div style="
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
          background: rgba(15, 76, 129, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.45);
          border-radius: 8px;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
        ">
          ${svg}
        </div>
      `,
      iconSize: [64, 64],
      iconAnchor: [32, 32],
    });
  } catch (error) {
    console.warn('[milsymbol] failed to build icon, using fallback', { sidc, error });
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


const MapView = ({ socket, session }) => {
  const [ships, setShips] = useState([]);

  useEffect(() => {
    if (!socket || !session?.id) return;

    const handleWorldSnapshot = (snapshot) => {
      console.log('[world_snapshot] received', snapshot);
      if (Array.isArray(snapshot)) setShips(snapshot);
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
            headingDeg: ship.heading_deg,
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
