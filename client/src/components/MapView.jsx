import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';

// Example Milsymbol creation
const createMilSymbolIcon = () => {
  const symbol = new ms.Symbol('SFG-EVI----', {
    size: 30,
    quantity: 200,
    staffComments: "Demo text",
    additionalInformation: "Additional Info",
    direction: (360 * Math.random()),
    type: "Machine Gun",
    dtg: "291200Z0808"
  });
  
  return L.divIcon({
    className: 'custom-milsymbol',
    html: symbol.asSVG(),
    iconSize: [symbol.getSize().width, symbol.getSize().height],
    iconAnchor: [symbol.getAnchor().x, symbol.getAnchor().y]
  });
};


const MapView = () => {
  const [icon, setIcon] = useState(null);

  useEffect(() => {
    // Ensuring this runs only on the client
    setIcon(createMilSymbolIcon());
  }, []);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <MapContainer center={[35.0, -40.0]} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        />
        {icon && (
          <Marker position={[35.0, -40.0]} icon={icon}>
            <Popup>
              Example Enemy Infantry Unit
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default MapView;
