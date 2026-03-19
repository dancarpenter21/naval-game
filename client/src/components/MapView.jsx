import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

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

const ShipDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  allegiance: z.enum(['hostile', 'friendly']),
  lat_deg: z.number(),
  lon_deg: z.number(),
  hae_m: z.number(),
  heading_deg: z.number(),
  sidc: z.string(),
});

// Enforce that the payload is an object with a `ships` array.
// We'll validate each element separately so malformed ships don't break rendering.
const WorldSnapshotDtoShapeSchema = z.object({
  ships: z.array(z.unknown()),
});

const MapView = ({ socket, session }) => {
  const [entities, setEntities] = useState([]);
  const outerRef = useRef(null);
  const [outerSize, setOuterSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!socket || !session?.id) return;

    const handleWorldSnapshot = (snapshot) => {
      const candidate = Array.isArray(snapshot) ? { ships: snapshot } : snapshot;

      const topLevel = WorldSnapshotDtoShapeSchema.safeParse(candidate);
      if (!topLevel.success) {
        console.error('[world_snapshot] invalid DTO shape', {
          receivedType: snapshot === null ? 'null' : typeof snapshot,
          issues: topLevel.error.issues.slice(0, 5),
        });
        setEntities([]);
        return;
      }

      const shipsUnknown = topLevel.data.ships;
      const validEntities = [];
      let invalidCount = 0;

      for (const shipUnknown of shipsUnknown) {
        const parsedShip = ShipDtoSchema.safeParse(shipUnknown);
        if (!parsedShip.success) {
          invalidCount += 1;
          continue;
        }
        validEntities.push(parsedShip.data);
      }

      console.log('[world_snapshot] received', {
        isArray: Array.isArray(snapshot),
        normalizedCount: shipsUnknown.length,
        validCount: validEntities.length,
        sample: validEntities.slice(0, 3).map((s) => ({ id: s.id, allegiance: s.allegiance })),
      });

      if (invalidCount > 0) {
        console.error('[world_snapshot] invalid ship DTOs detected', {
          invalidCount,
          sampleInvalid: shipsUnknown
            .filter((s) => !ShipDtoSchema.safeParse(s).success)
            .slice(0, 3)
            .map((s) => typeof s),
        });
      }

      setEntities(validEntities);
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

  const center = entities.length > 0 ? [entities[0].lat_deg, entities[0].lon_deg] : [35.0, -40.0];
  const redTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? 'hostile').toLowerCase() === 'hostile',
  );
  const blueTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? '').toLowerCase() === 'friendly',
  );

  // Unit card size is a fixed fraction of the map height.
  const unitCardHeight = outerSize.height ? outerSize.height * 0.1 : 30;
  const unitCardWidth = unitCardHeight / 2;
  const unitIconSize = Math.max(8, Math.round(unitCardHeight * 0.55));
  const unitNameFontSize = Math.max(8, Math.round(unitCardHeight * 0.28));
  const unitIdFontSize = Math.max(7, Math.round(unitCardHeight * 0.18));
  const unitGap = Math.max(2, Math.round(unitCardHeight * 0.06));

  const redUnitCardHeight = unitCardHeight;
  const redUnitCardWidth = unitCardWidth;
  const redUnitIconSize = unitIconSize;
  const redUnitNameFontSize = unitNameFontSize;
  const redUnitIdFontSize = unitIdFontSize;
  const redUnitGap = unitGap;

  const blueUnitCardHeight = unitCardHeight;
  const blueUnitCardWidth = unitCardWidth;
  const blueUnitIconSize = unitIconSize;
  const blueUnitNameFontSize = unitNameFontSize;
  const blueUnitIdFontSize = unitIdFontSize;
  const blueUnitGap = unitGap;

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
        <div><strong>Entities</strong>: {entities.length}</div>
        <div style={{ opacity: 0.85 }}>
          {entities.map((s) => s.id).join(', ')}
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
          gap: redUnitGap,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {redTeamEntities.map((ship) => {
          const svg = createMilSymbolSvg({ sidc: ship.sidc, size: redUnitIconSize });

          return (
            <div
              key={ship.id}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: redUnitGap,
                padding: 0,
                width: redUnitCardWidth,
                height: redUnitCardHeight,
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
                  width: redUnitIconSize,
                  height: redUnitIconSize,
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
                    fontSize: redUnitNameFontSize,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: redUnitCardWidth,
                  }}
                >
                  {ship.name}
                </div>
                <div
                  style={{
                    opacity: 0.8,
                    fontSize: redUnitIdFontSize,
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: redUnitCardWidth,
                  }}
                >
                  {ship.id}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {blueTeamEntities.length > 0 && (
        <div
          style={{
            position: 'absolute',
            zIndex: 5000,
            left: 12,
            right: 12,
            top: 0,
            bottom: 'auto',
            display: 'flex',
            justifyContent: 'center',
            gap: blueUnitGap,
            alignItems: 'flex-start',
            pointerEvents: 'none',
          }}
        >
          {blueTeamEntities.map((ship) => {
            const svg = createMilSymbolSvg({ sidc: ship.sidc, size: blueUnitIconSize });

            return (
              <div
                key={ship.id}
                style={{
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: blueUnitGap,
                  padding: 0,
                  width: blueUnitCardWidth,
                  height: blueUnitCardHeight,
                  borderRadius: 0,
                  background: 'rgba(59, 130, 246, 0.35)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  color: 'white',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  overflow: 'hidden',
                }}
                title={ship.name}
              >
                <div
                  style={{
                    width: blueUnitIconSize,
                    height: blueUnitIconSize,
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
                      fontSize: blueUnitNameFontSize,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: blueUnitCardWidth,
                    }}
                  >
                    {ship.name}
                  </div>
                  <div
                    style={{
                      opacity: 0.8,
                      fontSize: blueUnitIdFontSize,
                      fontFamily: 'monospace',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: blueUnitCardWidth,
                    }}
                  >
                    {ship.id}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
        {entities.map((ship) => {
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
