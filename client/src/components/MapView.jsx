import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, Polygon, Pane, useMap } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import missileOutlinePngUrl from '../assets/missile-outline-transparent.png';
import MovementPlanningLayer from './MovementPlanningLayer';
import MapKeyboardPanLayer from './MapKeyboardPanLayer';
import MapPointerDebugLayer from './MapPointerDebugLayer';
import { mapClickDebug } from '../utils/mapClickDebug';
import { readMapViewMemory, writeMapViewMemory } from '../map/mapViewMemory';
import { geodesicDirect } from '../geo/wgs84Geodesic';

/** Zoom when re-opening the map with a unit already selected (no saved view). */
const SELECTED_ENTITY_FOCUS_ZOOM = 7;
const DEFAULT_MAP_ZOOM = 4;

/** Persist center/zoom while the map exists (tab switches unmount MapView). */
function MapViewMemoryWriter({ sessionId }) {
  const map = useMap();
  useEffect(() => {
    if (!sessionId) return undefined;
    const save = () => {
      const c = map.getCenter();
      writeMapViewMemory(sessionId, [c.lat, c.lng], map.getZoom());
    };
    map.on('moveend', save);
    map.on('zoomend', save);
    return () => {
      map.off('moveend', save);
      map.off('zoomend', save);
    };
  }, [map, sessionId]);
  return null;
}

/**
 * If we booted on an empty entity list (e.g. tab remount before snapshot), snap to
 * selected unit or first visible entity once data exists — unless we restored from memory.
 */
function MapViewDeferredGeoFocus({ fromMemory, selectedEntityId, visibleEntities }) {
  const map = useMap();
  const appliedRef = useRef(false);
  useEffect(() => {
    if (fromMemory || appliedRef.current) return;
    if (!visibleEntities.length) return;
    const sel =
      selectedEntityId && visibleEntities.find((s) => s.id === selectedEntityId);
    if (sel) {
      map.setView([sel.lat_deg, sel.lon_deg], SELECTED_ENTITY_FOCUS_ZOOM, { animate: false });
    } else {
      const first = visibleEntities[0];
      map.setView([first.lat_deg, first.lon_deg], DEFAULT_MAP_ZOOM, { animate: false });
    }
    appliedRef.current = true;
  }, [map, fromMemory, selectedEntityId, visibleEntities]);
  return null;
}

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

const createMilSymbolIcon = ({ sidc, name, selected = false }) => {
  try {
    const normalizedSidc = normalizeSidc(sidc);
    const symbol = new ms.Symbol(normalizedSidc, {
      size: 25,
      standard: MILSYMBOL_STANDARD,
    });
    const svg = symbol.asSVG();

    const ring = selected
      ? 'box-shadow: 0 0 0 3px #fbbf24, 0 0 14px rgba(251,191,36,0.9); border-radius: 6px; padding: 2px;'
      : '';

    return L.divIcon({
      className: selected ? 'custom-milsymbol map-entity-selected' : 'custom-milsymbol',
      html: `
        <div style="
          width: 25px;
          height: 25px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
          ${ring}
        " title="${name}">
          ${svg}
        </div>
      `,
      iconSize: selected ? [31, 31] : [25, 25],
      iconAnchor: selected ? [15, 15] : [12, 12],
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

const SpaceSnapshotSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  fov_half_angle_deg: z.number(),
  footprint_radius_m: z.number(),
  ground_track_deg: z.array(LatLonDegSchema),
  future_footprint_deg: z.array(LatLonDegSchema),
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
  hide_map_marker: z.boolean().optional(),
  space: SpaceSnapshotSchema.optional().nullable(),
  station_eta_sim_s: z.number().optional().nullable(),
  station_progress: z.number().optional().nullable(),
  display_path_deg: z.array(LatLonDegSchema).optional().nullable(),
});

// Enforce that the payload is an object with an `entities` array.
// We'll validate each element separately so malformed entries don't break rendering.
const SpaceCoverageEventSchema = z.object({
  kind: z.string(),
  satellite_id: z.string(),
  asset_id: z.string(),
  sim_time_utc: z.string(),
});

const WorldSnapshotDtoShapeSchema = z.object({
  entities: z.array(z.unknown()),
  sim_elapsed_s: z.number().optional(),
  sim_time_utc: z.string().optional(),
  wall_dt_s: z.number().optional(),
  time_scale: z.number().optional(),
  space_coverage_events: z.array(SpaceCoverageEventSchema).optional(),
});

function isTypingInFormField() {
  const el = document.activeElement;
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function visibleEntitiesFromEntitiesAndTeam(entities, playerTeam) {
  const redTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? 'hostile').toLowerCase() === 'hostile',
  );
  const blueTeamEntities = entities.filter(
    (s) => String(s.allegiance ?? '').toLowerCase() === 'friendly',
  );
  return playerTeam === 'white'
    ? entities
    : playerTeam === 'red'
      ? redTeamEntities
      : playerTeam === 'blue'
        ? blueTeamEntities
        : entities;
}

/** One-shot per MapView mount; `entitiesAtMount` is usually [] (see deferred focus). */
function computeInitialMapBootstrap(sessionId, selectedEntityIdAtMount, entitiesAtMount, playerTeam) {
  const visibleEntities = visibleEntitiesFromEntitiesAndTeam(entitiesAtMount, playerTeam);
  const mem = readMapViewMemory(sessionId);
  if (mem?.center && Number.isFinite(mem.zoom)) {
    return { center: mem.center, zoom: mem.zoom, restoredFromMemory: true };
  }
  const sel =
    selectedEntityIdAtMount &&
    visibleEntities.find((s) => s.id === selectedEntityIdAtMount);
  if (sel) {
    return {
      center: [sel.lat_deg, sel.lon_deg],
      zoom: SELECTED_ENTITY_FOCUS_ZOOM,
      restoredFromMemory: false,
    };
  }
  if (visibleEntities.length > 0) {
    return {
      center: [visibleEntities[0].lat_deg, visibleEntities[0].lon_deg],
      zoom: DEFAULT_MAP_ZOOM,
      restoredFromMemory: false,
    };
  }
  return {
    center: [35.0, -40.0],
    zoom: DEFAULT_MAP_ZOOM,
    restoredFromMemory: false,
  };
}

/**
 * World outer ring + geodesic inner ring for FoV "flashlight" (Leaflet [lat, lng]).
 * Inner ring matches WGS84 geodesic distance (same convention as server / `Circle` radius in m).
 * Outer is clockwise; inner is counter-clockwise so SVG evenodd/nonzero both subtract the hole.
 */
function worldShadeWithHoleRing(centerLat, centerLon, footprintRadiusM) {
  const r = Math.min(Math.max(Number(footprintRadiusM) || 0, 15_000), 5_000_000);
  const outer = [
    [-89.9, -180],
    [-89.9, 180],
    [89.9, 180],
    [89.9, -180],
    [-89.9, -180],
  ];
  const steps = 72;
  const inner = [];
  for (let i = 0; i < steps; i++) {
    const brng = (i / steps) * 360;
    const { latDeg, lonDeg } = geodesicDirect(centerLat, centerLon, brng, r);
    inner.push([latDeg, lonDeg]);
  }
  return [outer, inner];
}

/** Small nadir “eyeball” for selected satellite FoV center (not a SIDC / unit symbol). */
function createSatelliteNadirEyeDivIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
  <circle cx="13" cy="13" r="11.5" fill="rgba(15,23,42,0.94)" stroke="#86efac" stroke-width="1.2"/>
  <ellipse cx="13" cy="13" rx="8.5" ry="5" fill="none" stroke="#a7f3d0" stroke-width="1.1"/>
  <circle cx="13" cy="13" r="3.25" fill="#38bdf8"/>
  <circle cx="14.4" cy="11.7" r="0.95" fill="#f8fafc" opacity="0.92"/>
</svg>`;
  return L.divIcon({
    className: 'satellite-nadir-eye-marker',
    html: `<div title="Nadir — approximate center of field of view" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5));pointer-events:none;">${svg}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const MapView = ({
  socket,
  session,
  onEntitiesUpdate,
  onSpaceCoverageEvents,
  selectedEntityId: selectedEntityIdProp = null,
  onSelectedEntityIdChange,
}) => {
  const [entities, setEntities] = useState([]);
  const [internalSelectedEntityId, setInternalSelectedEntityId] = useState(null);
  const selectionControlled = typeof onSelectedEntityIdChange === 'function';
  const selectedEntityId = selectionControlled ? selectedEntityIdProp : internalSelectedEntityId;
  const setSelectedEntityId = selectionControlled ? onSelectedEntityIdChange : setInternalSelectedEntityId;

  const [mapBootstrap] = useState(() =>
    computeInitialMapBootstrap(
      session?.id ?? '',
      selectionControlled ? selectedEntityIdProp : null,
      [],
      String(session?.player_team ?? 'white').toLowerCase(),
    ),
  );

  const [oKeyHeld, setOKeyHeld] = useState(false);
  const [rKeyHeld, setRKeyHeld] = useState(false);
  const [planWaypoints, setPlanWaypoints] = useState([]);
  const [racetrackDraft, setRacetrackDraft] = useState({
    phase: 'idle',
    a: null,
    b: null,
  });
  const outerRef = useRef(null);
  const planningLayerRef = useRef(null);
  const planWaypointsRef = useRef(planWaypoints);
  const racetrackDraftRef = useRef(racetrackDraft);
  const selectedEntityIdRef = useRef(selectedEntityId);
  const [outerSize, setOuterSize] = useState({ width: 0, height: 0 });

  const satelliteNadirEyeIcon = useMemo(() => createSatelliteNadirEyeDivIcon(), []);

  useEffect(() => {
    planWaypointsRef.current = planWaypoints;
    racetrackDraftRef.current = racetrackDraft;
    selectedEntityIdRef.current = selectedEntityId;
  });

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
          hide_map_marker: row.hide_map_marker === true,
        });
      }

      const cov = topLevel.data.space_coverage_events;
      if (Array.isArray(cov) && cov.length > 0) {
        onSpaceCoverageEvents?.(cov);
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
  }, [socket, session?.id, onEntitiesUpdate, onSpaceCoverageEvents]);

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
      if (e.key !== 'Escape') return;
      if (isTypingInFormField()) return;
      const hasParentPlan =
        planWaypointsRef.current.length > 0 || racetrackDraftRef.current.phase !== 'idle';
      if (hasParentPlan) {
        setPlanWaypoints([]);
        setRacetrackDraft({ phase: 'idle', a: null, b: null });
        planningLayerRef.current?.clearTransientDrafts();
        return;
      }
      if (planningLayerRef.current?.clearTransientDrafts()) return;
      if (selectedEntityIdRef.current) setSelectedEntityId(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [setSelectedEntityId]);

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

  const sessionIdForMap = session?.id ?? '';

  useEffect(() => {
    if (!selectedEntityId) return;
    if (!visibleEntities.some((s) => s.id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
  }, [visibleEntities, selectedEntityId, setSelectedEntityId]);

  const selectedEntity = useMemo(
    () => visibleEntities.find((s) => s.id === selectedEntityId) ?? null,
    [visibleEntities, selectedEntityId],
  );

  const serverActivePathPositions = useMemo(() => {
    const dp = selectedEntity?.display_path_deg;
    if (!Array.isArray(dp) || dp.length < 2) return null;
    return dp.map((p) => [p.lat_deg, p.lon_deg]);
  }, [selectedEntity?.display_path_deg]);

  const satelliteSelectionOverlays = useMemo(() => {
    const sp = selectedEntity?.space;
    if (!sp || typeof sp.footprint_radius_m !== 'number') return null;
    const lat = selectedEntity.lat_deg;
    const lon = selectedEntity.lon_deg;
    const footprintRadiusM = Math.min(
      Math.max(sp.footprint_radius_m, 15_000),
      5_000_000,
    );
    const rings = worldShadeWithHoleRing(lat, lon, footprintRadiusM);
    const groundTrack = Array.isArray(sp.ground_track_deg)
      ? sp.ground_track_deg.map((p) => [p.lat_deg, p.lon_deg])
      : [];
    const future = Array.isArray(sp.future_footprint_deg)
      ? sp.future_footprint_deg.map((p) => [p.lat_deg, p.lon_deg])
      : [];
    return {
      rings,
      center: [lat, lon],
      footprintRadiusM,
      groundTrack,
      future,
    };
  }, [selectedEntity]);

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
      const selected = entity.id === selectedEntityId;
      if (isMissileSidc(entity.sidc)) {
        const color = entity.allegiance === 'hostile' ? '#ef4444' : '#3b82f6';
        const heading = Number(entity.heading_deg ?? 0);
        const maskId = `missile-mask-${entity.id}`;
        const ring = selected
          ? 'box-shadow: 0 0 0 3px #fbbf24, 0 0 14px rgba(251,191,36,0.9); border-radius: 50%;'
          : '';
        next.set(
          entityKey,
          L.divIcon({
            className: selected ? 'custom-missile-icon map-entity-selected' : 'custom-missile-icon',
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
                ${ring}
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
            iconSize: selected ? [40, 40] : [32, 32],
            iconAnchor: selected ? [20, 20] : [16, 16],
          })
        );
      } else {
        next.set(
          entityKey,
          createMilSymbolIcon({
            sidc: entity.sidc,
            name: entity.name,
            selected,
          })
        );
      }
    }
    return next;
  }, [entities, selectedEntityId]);

  return (
    <div ref={outerRef} style={{ height: '100%', width: '100%', position: 'relative' }}>
      {/* Map first + z-index 0 so later overlays (roster, HUD) receive clicks — otherwise the map layer sits on top and blocks selection. */}
      <MapContainer
        center={mapBootstrap.center}
        zoom={mapBootstrap.zoom}
        zoomControl={false}
        dragging={false}
        boxZoom={false}
        keyboard={false}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          height: '100%',
          width: '100%',
        }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        />
        <MapViewMemoryWriter sessionId={sessionIdForMap} />
        <MapViewDeferredGeoFocus
          fromMemory={mapBootstrap.restoredFromMemory}
          selectedEntityId={selectedEntityId}
          visibleEntities={visibleEntities}
        />
        <MapKeyboardPanLayer />
        <MapPointerDebugLayer />
        <MovementPlanningLayer
          ref={planningLayerRef}
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
        {satelliteSelectionOverlays && (
          <Pane name="satelliteFov" style={{ zIndex: 380 }}>
            <Polygon
              positions={satelliteSelectionOverlays.rings}
              pathOptions={{
                stroke: false,
                fillColor: '#020617',
                fillOpacity: 0.58,
                // Leaflet default is evenodd; keep explicit for SVG hole subtraction.
                fillRule: 'evenodd',
                interactive: false,
              }}
            />
            <Circle
              center={satelliteSelectionOverlays.center}
              radius={satelliteSelectionOverlays.footprintRadiusM}
              pathOptions={{
                color: '#86efac',
                weight: 2,
                opacity: 0.95,
                fillColor: '#86efac',
                fillOpacity: 0.14,
              }}
            />
            {satelliteSelectionOverlays.groundTrack.length > 1 && (
              <Polyline
                positions={satelliteSelectionOverlays.groundTrack}
                pathOptions={{ color: '#22d3ee', weight: 2, opacity: 0.9 }}
              />
            )}
            {satelliteSelectionOverlays.future.length > 1 && (
              <Polyline
                positions={satelliteSelectionOverlays.future}
                pathOptions={{
                  color: '#fbbf24',
                  weight: 2,
                  opacity: 0.4,
                  dashArray: '10 12',
                }}
              />
            )}
            <Marker
              position={satelliteSelectionOverlays.center}
              icon={satelliteNadirEyeIcon}
              interactive={false}
              keyboard={false}
              zIndexOffset={800}
            />
          </Pane>
        )}
        {visibleEntities.filter((e) => !e.hide_map_marker).map((entity) => {
          const entityKey = `${entity.id}:${entity.sidc}`;
          const icon = markerIconsByEntityKey.get(entityKey);
          return (
            <Marker
              key={entityKey}
              position={[entity.lat_deg, entity.lon_deg]}
              icon={icon}
              eventHandlers={{
                click: (e) => {
                  mapClickDebug('marker:click:handler', {
                    entityId: entity.id,
                    entityKey,
                    hasIcon: Boolean(icon),
                    latlng: e.latlng,
                    domTarget: e.originalEvent?.target?.tagName,
                  });
                  L.DomEvent.stopPropagation(e.originalEvent);
                  setSelectedEntityId(entity.id);
                  mapClickDebug('marker:click:setSelectedEntityId', entity.id);
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

      <div
        style={{
          position: 'absolute',
          zIndex: 1000,
          bottom: 12,
          right: 12,
          background: 'rgba(0,0,0,0.65)',
          color: 'white',
          padding: '8px 10px',
          borderRadius: 6,
          fontSize: 12,
          maxWidth: 'min(360px, calc(100vw - 24px))',
          maxHeight: 'min(42vh, 320px)',
          overflowY: 'auto',
          pointerEvents: 'none',
        }}
      >
        <div><strong>Entities</strong>: {visibleEntities.length}</div>
        <div style={{ opacity: 0.85 }}>
          {visibleEntities.map((s) => s.id).join(', ')}
        </div>
        <div style={{ marginTop: 8, opacity: 0.9, lineHeight: 1.4 }}>
          <strong>Map</strong>: <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>W</kbd>
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>A</kbd>
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>S</kbd>
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>D</kbd> pan (no mouse
          drag). Scroll wheel zooms.
        </div>
        <div style={{ marginTop: 6, opacity: 0.9, lineHeight: 1.4 }}>
          <strong>Movement plan</strong>: select a movable unit → <strong>right-click</strong> waypoints →{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>O</kbd>
          + drag orbit or{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>R</kbd>
          + A → B → drag radius.{' '}
          <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Esc</kbd> clears
          plan / preview first; another <kbd style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>Esc</kbd>{' '}
          deselects.
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
          isolation: 'isolate',
        }}
      >
        {visibleRedTeamEntities.map((entity) => {
          const svg = createMilSymbolSvg({ sidc: entity.sidc, size: redUnitIconSize });

          return (
            <div
              key={entity.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                mapClickDebug('roster:red:click', entity.id);
                setSelectedEntityId(entity.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  mapClickDebug('roster:red:keyboard', entity.id);
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
                borderRadius: 4,
                background: 'rgba(220, 38, 38, 0.35)',
                border:
                  selectedEntityId === entity.id
                    ? '3px solid #fbbf24'
                    : '1px solid rgba(220, 38, 38, 0.35)',
                boxShadow:
                  selectedEntityId === entity.id
                    ? '0 0 0 2px rgba(251,191,36,0.5), 0 4px 20px rgba(251,191,36,0.35)'
                    : undefined,
                transform: selectedEntityId === entity.id ? 'scale(1.08)' : undefined,
                zIndex: selectedEntityId === entity.id ? 3 : 1,
                transition: 'transform 0.12s ease, box-shadow 0.12s ease',
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
            isolation: 'isolate',
          }}
        >
          {visibleBlueTeamEntities.map((entity) => {
            const svg = createMilSymbolSvg({ sidc: entity.sidc, size: blueUnitIconSize });

            return (
              <div
                key={entity.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  mapClickDebug('roster:blue:click', entity.id);
                  setSelectedEntityId(entity.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    mapClickDebug('roster:blue:keyboard', entity.id);
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
                  borderRadius: 4,
                  background: 'rgba(59, 130, 246, 0.35)',
                  border:
                    selectedEntityId === entity.id
                      ? '3px solid #fbbf24'
                      : '1px solid rgba(59, 130, 246, 0.35)',
                  boxShadow:
                    selectedEntityId === entity.id
                      ? '0 0 0 2px rgba(251,191,36,0.5), 0 4px 20px rgba(251,191,36,0.35)'
                      : undefined,
                  transform: selectedEntityId === entity.id ? 'scale(1.08)' : undefined,
                  zIndex: selectedEntityId === entity.id ? 3 : 1,
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
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
    </div>
  );
};

export default MapView;
