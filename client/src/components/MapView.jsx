import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import missileOutlinePngUrl from '../assets/missile-outline-transparent.png';
import MovementPlanningLayer from './MovementPlanningLayer';

/** milsymbol: APP-6 drawing (matches server / picker milstd `app6d` data). */
const MILSYMBOL_STANDARD = 'APP6';

if (typeof ms.setStandard === 'function') {
  ms.setStandard(MILSYMBOL_STANDARD);
}

const normalizeSidc = (sidc) => sidc?.replace(/-/g, '');

const createMilSymbolSvg = ({ sidc, size }) => {
  const normalizedSidc = normalizeSidc(sidc);
  const symbol = new ms.Symbol(normalizedSidc, {
    size,
    standard: MILSYMBOL_STANDARD,
  });
  return symbol.asSVG();
};

const createMilSymbolIcon = ({ sidc, name }) => {
  try {
    const normalizedSidc = normalizeSidc(sidc);
    const symbol = new ms.Symbol(normalizedSidc, {
      size: 25,
      standard: MILSYMBOL_STANDARD,
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

const isMissileSidc = (sidc) => {
  // Hyphenated SIDC segments: seg4 is symbol_set (we treat 02 as "missile").
  // Example format: seg1-seg2-seg3-seg4-seg5-...
  const parts = String(sidc ?? '').split('-');
  return parts.length >= 4 && parts[3] === '02';
};

// Used by the alpha-mask SVG for the missile marker.
// Keep in sync with `client/src/assets/missile-outline-transparent.png`.
const MISSILE_OUTLINE_PNG_W = 1024;
const MISSILE_OUTLINE_PNG_H = 1536;

const LatLonDegSchema = z.object({
  lat_deg: z.number(),
  lon_deg: z.number(),
});

const EntityDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  allegiance: z.enum(['hostile', 'friendly']),
  lat_deg: z.number(),
  lon_deg: z.number(),
  hae_m: z.number(),
  heading_deg: z.number(),
  sidc: z.string(),
  movable: z.boolean().optional(),
  station_eta_sim_s: z.number().optional().nullable(),
  station_progress: z.number().optional().nullable(),
  display_path_deg: z.array(LatLonDegSchema).optional().nullable(),
});

// Enforce that the payload is an object with an `entities` array.
// We'll validate each element separately so malformed entries don't break rendering.
const WorldSnapshotDtoShapeSchema = z.object({
  entities: z.array(z.unknown()),
  sim_elapsed_s: z.number().optional(),
  sim_time_utc: z.string().optional(),
  wall_dt_s: z.number().optional(),
  time_scale: z.number().optional(),
});

const MapView = ({ socket, session, onEntitiesUpdate }) => {
  const [entities, setEntities] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [oKeyHeld, setOKeyHeld] = useState(false);
  const [rKeyHeld, setRKeyHeld] = useState(false);
  const [planWaypoints, setPlanWaypoints] = useState([]);
  const [racetrackDraft, setRacetrackDraft] = useState({
    phase: 'idle',
    a: null,
    b: null,
  });
  const outerRef = useRef(null);
  const [outerSize, setOuterSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!socket || !session?.id) return;

    const handleWorldSnapshot = (snapshot) => {
      const candidate = Array.isArray(snapshot) ? { entities: snapshot } : snapshot;

      const topLevel = WorldSnapshotDtoShapeSchema.safeParse(candidate);
      if (!topLevel.success) {
        console.error('[world_snapshot] invalid DTO shape', {
          receivedType: snapshot === null ? 'null' : typeof snapshot,
          issues: topLevel.error.issues.slice(0, 5),
        });
        setEntities([]);
        onEntitiesUpdate?.([]);
        return;
      }

      const entitiesUnknown = topLevel.data.entities;
      const validEntities = [];
      let invalidCount = 0;

      for (const entityUnknown of entitiesUnknown) {
        const parsedEntity = EntityDtoSchema.safeParse(entityUnknown);
        if (!parsedEntity.success) {
          invalidCount += 1;
          continue;
        }
        const row = parsedEntity.data;
        validEntities.push({
          ...row,
          movable: row.movable !== false,
        });
      }

      console.log('[world_snapshot] received', {
        isArray: Array.isArray(snapshot),
        normalizedCount: entitiesUnknown.length,
        validCount: validEntities.length,
        sample: validEntities.slice(0, 3).map((s) => ({ id: s.id, allegiance: s.allegiance })),
      });

      if (invalidCount > 0) {
        console.error('[world_snapshot] invalid entity DTOs detected', {
          invalidCount,
          sampleInvalid: entitiesUnknown
            .filter((s) => !EntityDtoSchema.safeParse(s).success)
            .slice(0, 3)
            .map((s) => typeof s),
        });
      }

      setEntities(validEntities);
      onEntitiesUpdate?.(validEntities);
    };

    socket.on('world_snapshot', handleWorldSnapshot);
    socket.emit('request_world_snapshot', { id: session.id });
    return () => {
      socket.off('world_snapshot', handleWorldSnapshot);
    };
  }, [socket, session?.id, onEntitiesUpdate]);

  useEffect(() => {
    if (!socket) return;
    const onRejected = (err) => {
      console.warn('[movement_order_rejected]', err);
    };
    socket.on('movement_order_rejected', onRejected);
    return () => socket.off('movement_order_rejected', onRejected);
  }, [socket]);

  useEffect(() => {
    const down = (e) => {
      if (e.key === 'o' || e.key === 'O') setOKeyHeld(true);
      if (e.key === 'r' || e.key === 'R') setRKeyHeld(true);
    };
    const up = (e) => {
      if (e.key === 'o' || e.key === 'O') setOKeyHeld(false);
      if (e.key === 'r' || e.key === 'R') setRKeyHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        setPlanWaypoints([]);
        setRacetrackDraft({ phase: 'idle', a: null, b: null });
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  useEffect(() => {
    setPlanWaypoints([]);
    setRacetrackDraft({ phase: 'idle', a: null, b: null });
  }, [selectedEntityId]);

  const clearMovementPlan = useCallback(() => {
    setPlanWaypoints([]);
    setRacetrackDraft({ phase: 'idle', a: null, b: null });
  }, []);

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

  const playerTeam = String(session?.player_team ?? 'white').toLowerCase();

  const redTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? 'hostile').toLowerCase() === 'hostile',
  );
  const blueTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? '').toLowerCase() === 'friendly',
  );

  const visibleRedTeamEntities =
    playerTeam === 'white' || playerTeam === 'red' ? redTeamEntities : [];
  const visibleBlueTeamEntities =
    playerTeam === 'white' || playerTeam === 'blue' ? blueTeamEntities : [];

  const visibleEntities =
    playerTeam === 'white'
      ? entities
      : playerTeam === 'red'
        ? redTeamEntities
        : playerTeam === 'blue'
          ? blueTeamEntities
          : entities;

  useEffect(() => {
    if (!selectedEntityId) return;
    if (!visibleEntities.some((s) => s.id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
  }, [visibleEntities, selectedEntityId]);

  const selectedEntity = useMemo(
    () => visibleEntities.find((s) => s.id === selectedEntityId) ?? null,
    [visibleEntities, selectedEntityId],
  );

  const serverActivePathPositions = useMemo(() => {
    const dp = selectedEntity?.display_path_deg;
    if (!Array.isArray(dp) || dp.length < 2) return null;
    return dp.map((p) => [p.lat_deg, p.lon_deg]);
  }, [selectedEntity?.display_path_deg]);

  const center =
    visibleEntities.length > 0 ? [visibleEntities[0].lat_deg, visibleEntities[0].lon_deg] : [35.0, -40.0];

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

  const markerIconsByEntityKey = useMemo(() => {
    const next = new Map();
    for (const entity of entities) {
      const entityKey = `${entity.id}:${entity.sidc}`;
      if (isMissileSidc(entity.sidc)) {
        const color = entity.allegiance === 'hostile' ? '#ef4444' : '#3b82f6';
        const heading = Number(entity.heading_deg ?? 0);
        const maskId = `missile-mask-${entity.id}`;
        next.set(
          entityKey,
          L.divIcon({
            className: 'custom-missile-icon',
            html: `
              <div style="
                color: ${color};
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                transform: rotate(${heading}deg);
                transform-origin: 50% 50%;
              ">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 ${MISSILE_OUTLINE_PNG_W} ${MISSILE_OUTLINE_PNG_H}" aria-hidden="true">
                  <defs>
                    <mask id="${maskId}" mask-type="alpha">
                      <image
                        href="${missileOutlinePngUrl}"
                        x="0"
                        y="0"
                        width="${MISSILE_OUTLINE_PNG_W}"
                        height="${MISSILE_OUTLINE_PNG_H}"
                      />
                    </mask>
                  </defs>
                  <rect
                    x="0"
                    y="0"
                    width="${MISSILE_OUTLINE_PNG_W}"
                    height="${MISSILE_OUTLINE_PNG_H}"
                    fill="currentColor"
                    mask="url(#${maskId})"
                  />
                </svg>
              </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          })
        );
      } else {
        next.set(
          entityKey,
          createMilSymbolIcon({
            sidc: entity.sidc,
            name: entity.name,
          })
        );
      }
    }
    return next;
  }, [entities]);

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
        <div><strong>Entities</strong>: {visibleEntities.length}</div>
        <div style={{ opacity: 0.85 }}>
          {visibleEntities.map((s) => s.id).join(', ')}
        </div>
        <div style={{ marginTop: 8, opacity: 0.9, lineHeight: 1.4 }}>
          <strong>Movement plan</strong>: select a movable unit →{' '}
          <strong>right-click</strong> to add waypoints (0–n) → then{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>O</kbd>
          + left-drag = orbit (center &amp; radius; east = CW) or{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>R</kbd>
          + click A → click B → drag from B for racetrack turn radius.{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Esc</kbd> clears
          waypoints. Preview in light green; ETA on Sync Matrix tab.
        </div>
        {planWaypoints.length > 0 && (
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            Waypoints queued: {planWaypoints.length}
          </div>
        )}
        {racetrackDraft.phase !== 'idle' && (
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            Racetrack:{' '}
            {racetrackDraft.phase === 'need_b'
              ? 'click second point (B)'
              : 'drag from B for turn radius'}
          </div>
        )}
        {selectedEntity && (
          <div style={{ marginTop: 6, opacity: 0.95 }}>
            Selected: <strong>{selectedEntity.name}</strong> ({selectedEntity.id})
            {!selectedEntity.movable && (
              <span style={{ color: '#f87171' }}> — not movable</span>
            )}
          </div>
        )}
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
        {visibleRedTeamEntities.map((entity) => {
          const svg = createMilSymbolSvg({ sidc: entity.sidc, size: redUnitIconSize });

          return (
            <div
              key={entity.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedEntityId(entity.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedEntityId(entity.id);
                }
              }}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
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
                border:
                  selectedEntityId === entity.id
                    ? '2px solid #fbbf24'
                    : '1px solid rgba(220, 38, 38, 0.35)',
                color: 'white',
                boxSizing: 'border-box',
                textAlign: 'center',
                overflow: 'hidden',
              }}
              title={entity.name}
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
                  {entity.name}
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
                  {entity.id}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {visibleBlueTeamEntities.length > 0 && (
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
          {visibleBlueTeamEntities.map((entity) => {
            const svg = createMilSymbolSvg({ sidc: entity.sidc, size: blueUnitIconSize });

            return (
              <div
                key={entity.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedEntityId(entity.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedEntityId(entity.id);
                  }
                }}
                style={{
                  pointerEvents: 'auto',
                  cursor: 'pointer',
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
                  border:
                    selectedEntityId === entity.id
                      ? '2px solid #fbbf24'
                      : '1px solid rgba(59, 130, 246, 0.35)',
                  color: 'white',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  overflow: 'hidden',
                }}
                title={entity.name}
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
                    {entity.name}
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
                    {entity.id}
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
        <MovementPlanningLayer
          sessionId={session?.id}
          socket={socket}
          selectedEntity={selectedEntity}
          oHeld={oKeyHeld}
          rHeld={rKeyHeld}
          planWaypoints={planWaypoints}
          setPlanWaypoints={setPlanWaypoints}
          racetrackDraft={racetrackDraft}
          setRacetrackDraft={setRacetrackDraft}
          onPlanCommitted={clearMovementPlan}
        />
        {serverActivePathPositions && (
          <Polyline
            positions={serverActivePathPositions}
            pathOptions={{
              color: '#38bdf8',
              weight: 3,
              opacity: 0.92,
              dashArray: '12 8',
            }}
          />
        )}
        {visibleEntities.map((entity) => {
          const entityKey = `${entity.id}:${entity.sidc}`;
          const icon = markerIconsByEntityKey.get(entityKey);
          return (
            <Marker
              key={entityKey}
              position={[entity.lat_deg, entity.lon_deg]}
              icon={icon}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  setSelectedEntityId(entity.id);
                },
              }}
            >
              <Popup>
                {entity.name} ({entity.id})
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default MapView;
