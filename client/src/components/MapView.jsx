import * as Cesium from 'cesium';
import ms from 'milsymbol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { heightMetersFromZoom, svgToImageDataUrl, worldShadeWithHoleCartesian3, zoomFromHeightMeters } from '../map/mapViewCesiumHelpers';
import { readMapViewMemory, writeMapViewMemory } from '../map/mapViewMemory';
import { mapClickDebug } from '../utils/mapClickDebug';
import { haeFeetToMeters } from '../units/length';
import MovementPlanningCesium from './MovementPlanningCesium';

/** Camera height (m) when focusing a selected unit (was zoom 7 in Leaflet). */
const SELECTED_ENTITY_FOCUS_HEIGHT_M = heightMetersFromZoom(7);
const DEFAULT_VIEW_HEIGHT_M = heightMetersFromZoom(4);

/** NASA Blue Marble (Visible Earth) — bundled at `public/blue-marble-world.jpg`. */
const BLUE_MARBLE_WORLD_IMAGE_URL = `${import.meta.env.BASE_URL}blue-marble-world.jpg`;

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

function isGlobeUnitSelected(entity, selectedEntityId) {
  return selectedEntityId != null && String(entity.id) === String(selectedEntityId);
}

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

function computeInitialMapBootstrap(sessionId, selectedEntityIdAtMount, entitiesAtMount, playerTeam) {
  const visibleEntities = visibleEntitiesFromEntitiesAndTeam(entitiesAtMount, playerTeam);
  const mem = readMapViewMemory(sessionId);
  if (mem?.center && Number.isFinite(mem.zoom)) {
    const h = mem.cameraHeightM ?? heightMetersFromZoom(mem.zoom);
    return {
      center: mem.center,
      zoom: mem.zoom,
      heightM: h,
      restoredFromMemory: true,
    };
  }
  const sel =
    selectedEntityIdAtMount &&
    visibleEntities.find((s) => s.id === selectedEntityIdAtMount);
  if (sel) {
    return {
      center: [sel.lat_deg, sel.lon_deg],
      zoom: 7,
      heightM: SELECTED_ENTITY_FOCUS_HEIGHT_M,
      restoredFromMemory: false,
    };
  }
  if (visibleEntities.length > 0) {
    const first = visibleEntities[0];
    return {
      center: [first.lat_deg, first.lon_deg],
      zoom: 4,
      heightM: DEFAULT_VIEW_HEIGHT_M,
      restoredFromMemory: false,
    };
  }
  return {
    center: [35.0, -40.0],
    zoom: 4,
    heightM: DEFAULT_VIEW_HEIGHT_M,
    restoredFromMemory: false,
  };
}

const MapView = ({
  socket,
  session,
  entities = [],
  selectedEntityId: selectedEntityIdProp = null,
  onSelectedEntityIdChange,
}) => {
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
  const containerRef = useRef(null);
  const planningLayerRef = useRef(null);
  const planWaypointsRef = useRef(planWaypoints);
  const racetrackDraftRef = useRef(racetrackDraft);
  const selectedEntityIdRef = useRef(selectedEntityId);
  const [outerSize, setOuterSize] = useState({ width: 0, height: 0 });
  const [viewer, setViewer] = useState(null);
  /** Set when Cesium.Viewer fails (e.g. WebGL); keeps tab chrome usable. */
  const [viewerInitError, setViewerInitError] = useState(null);
  const deferredFocusAppliedRef = useRef(false);

  useEffect(() => {
    planWaypointsRef.current = planWaypoints;
    racetrackDraftRef.current = racetrackDraft;
    selectedEntityIdRef.current = selectedEntityId;
  });

  useEffect(() => {
    if (!socket) return undefined;
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
    if (!outerRef.current) return undefined;

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

  useEffect(() => {
    if (!containerRef.current) return undefined;

    let v;
    try {
      v = new Cesium.Viewer(containerRef.current, {
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        homeButton: false,
        sceneModePicker: false,
        geocoder: false,
        navigationHelpButton: false,
        skyBox: false,
        skyAtmosphere: false,
        shouldAnimate: false,
        imageryProvider: false,
        selectionIndicator: false,
        infoBox: false,
      });

      v.imageryLayers.addImageryProvider(
        new Cesium.SingleTileImageryProvider({
          url: BLUE_MARBLE_WORLD_IMAGE_URL,
          rectangle: Cesium.Rectangle.fromDegrees(-180.0, -90.0, 180.0, 90.0),
          credit: 'NASA Visible Earth — Blue Marble',
        }),
      );
      v.scene.globe.show = true;

      const [lat0, lon0] = mapBootstrap.center;
      v.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(lon0, lat0, mapBootstrap.heightM),
      });

      setViewerInitError(null);
      setViewer(v);
    } catch (err) {
      console.error('[MapView] Cesium.Viewer failed', err);
      setViewerInitError(err instanceof Error ? err.message : String(err));
      setViewer(null);
      return undefined;
    }

    return () => {
      try {
        v?.destroy?.();
      } catch (e) {
        console.warn('[MapView] viewer destroy', e);
      }
      setViewer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once per mount
  }, []);

  useEffect(() => {
    if (!viewer) return undefined;
    const canvas = viewer.scene.canvas;
    const onCtx = (e) => e.preventDefault();
    canvas.addEventListener('contextmenu', onCtx);
    return () => canvas.removeEventListener('contextmenu', onCtx);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !outerRef.current) return undefined;
    const ro = new ResizeObserver(() => {
      try {
        viewer.resize();
        viewer.scene.requestRender?.();
      } catch {
        /* viewer may be destroyed between tick and callback */
      }
    });
    ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [viewer]);

  const sessionIdForMap = session?.id ?? '';

  useEffect(() => {
    if (!viewer) return undefined;

    const camera = viewer.camera;
    const save = () => {
      try {
        const canvas = viewer.scene.canvas;
        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const ellipsoid = viewer.scene.globe.ellipsoid;
        const cartesian = viewer.camera.pickEllipsoid(center, ellipsoid);
        if (!cartesian || !sessionIdForMap) return;
        const c = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(c.latitude);
        const lon = Cesium.Math.toDegrees(c.longitude);
        const h = viewer.camera.positionCartographic.height;
        const z = zoomFromHeightMeters(h);
        writeMapViewMemory(sessionIdForMap, [lat, lon], z, h);
      } catch {
        /* viewer torn down during save */
      }
    };

    camera.moveEnd.addEventListener(save);
    return () => {
      try {
        camera.moveEnd.removeEventListener(save);
      } catch {
        /* viewer.destroy() may have run before this cleanup */
      }
    };
  }, [viewer, sessionIdForMap]);

  useEffect(() => {
    if (!viewer) return undefined;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (!Cesium.defined(picked) || !picked.id) return;
      const ent = picked.id;
      const rawId = ent instanceof Cesium.Entity ? ent.id : ent?.id;
      if (rawId == null) return;
      const sid = String(rawId);
      if (sid.startsWith('unit-')) {
        const entityId = sid.slice(5);
        mapClickDebug('marker:click:cesium', { entityId });
        setSelectedEntityId(entityId);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      try {
        handler.destroy();
      } catch {
        /* handler / canvas may already be torn down with viewer */
      }
    };
  }, [viewer, setSelectedEntityId]);

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
    const { outerPositions, innerPositions } = worldShadeWithHoleCartesian3(lat, lon, footprintRadiusM);
    const groundTrack = Array.isArray(sp.ground_track_deg)
      ? sp.ground_track_deg.map((p) => [p.lat_deg, p.lon_deg])
      : [];
    const future = Array.isArray(sp.future_footprint_deg)
      ? sp.future_footprint_deg.map((p) => [p.lat_deg, p.lon_deg])
      : [];
    return {
      outerPositions,
      innerPositions,
      center: [lat, lon],
      footprintRadiusM,
      groundTrack,
      future,
    };
  }, [selectedEntity]);

  useEffect(() => {
    if (!viewer) return;
    if (mapBootstrap.restoredFromMemory || deferredFocusAppliedRef.current) return;
    if (!visibleEntities.length) return;
    const sel =
      selectedEntityId && visibleEntities.find((s) => s.id === selectedEntityId);
    const target = sel ?? visibleEntities[0];
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        target.lon_deg,
        target.lat_deg,
        sel ? SELECTED_ENTITY_FOCUS_HEIGHT_M : DEFAULT_VIEW_HEIGHT_M,
      ),
    });
    deferredFocusAppliedRef.current = true;
  }, [viewer, visibleEntities, selectedEntityId, mapBootstrap.restoredFromMemory]);

  useEffect(() => {
    if (!viewer) return;

    const toRemove = [];
    viewer.entities.values.forEach((e) => {
      const id = e.id != null ? String(e.id) : '';
      if (id.startsWith('unit-') || id.startsWith('overlay-')) toRemove.push(e);
    });
    toRemove.forEach((e) => viewer.entities.remove(e));

    for (const entity of entities) {
      if (entity.hide_map_marker) continue;
      const selected = isGlobeUnitSelected(entity, selectedEntityId);

      let image;
      let width = 32;
      let height = 32;

      try {
        const normalizedSidc = normalizeSidc(entity.sidc);
        const symbol = new ms.Symbol(normalizedSidc, {
          size: selected ? 36 : 28,
          standard: MILSYMBOL_STANDARD,
          direction: Number(entity.heading_deg ?? 0),
          outlineWidth: selected ? 6 : 0,
          outlineColor: selected ? '#fbbf24' : 'rgb(239, 239, 239)',
        });
        image = svgToImageDataUrl(symbol.asSVG());
      } catch {
        image = svgToImageDataUrl(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="10" fill="#0f4c81" stroke="#fff" stroke-width="2"/></svg>',
        );
      }
      width = selected ? 42 : 34;
      height = selected ? 42 : 34;

      const haeM = haeFeetToMeters(entity.hae_ft);
      viewer.entities.add({
        id: `unit-${entity.id}`,
        position: Cesium.Cartesian3.fromDegrees(entity.lon_deg, entity.lat_deg, haeM),
        billboard: {
          image,
          width,
          height,
          scale: selected ? 1.12 : 1.0,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    if (serverActivePathPositions && selectedEntity) {
      const pathHaeM = haeFeetToMeters(selectedEntity.hae_ft);
      const flat = [];
      for (const [lat, lon] of serverActivePathPositions) {
        flat.push(lon, lat, pathHaeM);
      }
      viewer.entities.add({
        id: 'overlay-activity-path',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
          width: 3,
          material: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.92),
        },
      });
    }

    if (satelliteSelectionOverlays) {
      const o = satelliteSelectionOverlays;
      const hierarchy = new Cesium.PolygonHierarchy(o.outerPositions, [
        new Cesium.PolygonHierarchy(o.innerPositions),
      ]);
      viewer.entities.add({
        id: 'overlay-sat-shade',
        polygon: {
          hierarchy,
          material: Cesium.Color.fromCssColorString('#020617').withAlpha(0.58),
          perPositionHeight: false,
          height: 0,
        },
      });
      viewer.entities.add({
        id: 'overlay-sat-footprint',
        position: Cesium.Cartesian3.fromDegrees(o.center[1], o.center[0], 0),
        ellipse: {
          semiMajorAxis: o.footprintRadiusM,
          semiMinorAxis: o.footprintRadiusM,
          material: Cesium.Color.fromCssColorString('#86efac').withAlpha(0.14),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#86efac'),
          outlineWidth: 2,
          height: 0,
        },
      });
      if (o.groundTrack.length > 1) {
        const gf = [];
        for (const [lat, lon] of o.groundTrack) gf.push(lon, lat);
        viewer.entities.add({
          id: 'overlay-sat-track',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(gf),
            width: 2,
            material: Cesium.Color.CYAN.withAlpha(0.9),
            clampToGround: true,
          },
        });
      }
      if (o.future.length > 1) {
        const ff = [];
        for (const [lat, lon] of o.future) ff.push(lon, lat);
        viewer.entities.add({
          id: 'overlay-sat-future',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(ff),
            width: 2,
            material: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.4),
            clampToGround: true,
          },
        });
      }
    }
  }, [
    viewer,
    entities,
    selectedEntityId,
    selectedEntity,
    serverActivePathPositions,
    satelliteSelectionOverlays,
  ]);

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
      {viewerInitError && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 6000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'rgba(18,18,18,0.92)',
            color: '#fecaca',
            textAlign: 'center',
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          <div>
            <strong style={{ display: 'block', marginBottom: 8 }}>Map failed to initialize</strong>
            {viewerInitError}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          height: '100%',
          width: '100%',
        }}
      />
      {viewer && (
        <MovementPlanningCesium
          ref={planningLayerRef}
          viewer={viewer}
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
      )}

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
          <strong>Map</strong>: default Cesium camera (mouse / touch). Use the viewer’s help (?) control for gestures.
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
