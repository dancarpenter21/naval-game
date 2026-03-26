import * as Cesium from 'cesium';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  geodesicDistanceM,
  geodesicPointTowardFromCenter,
} from '../geo/wgs84Geodesic';
import { mapClickDebug } from '../utils/mapClickDebug';
import { haeFeetToMeters } from '../units/length';

const MIN_ORBIT_RADIUS_M = 75;

const greenLine = {
  color: Cesium.Color.fromCssColorString('#86efac').withAlpha(0.9),
  width: 3,
};

const greenWaypoint = {
  color: Cesium.Color.fromCssColorString('#4ade80'),
  outlineColor: Cesium.Color.fromCssColorString('#bbf7d0'),
  outlineWidth: 2,
  pixelSize: 8,
};

function waypointPayload(pts) {
  return pts.map((p) => ({ lat_deg: p.lat, lon_deg: p.lng }));
}

function pickLatLng(viewer, screenPosition) {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const cartesian = viewer.camera.pickEllipsoid(screenPosition, ellipsoid);
  if (!Cesium.defined(cartesian)) return null;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lng: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

function removePreviewEntities(viewer) {
  const toRemove = [];
  viewer.entities.values.forEach((e) => {
    if (e.id && String(e.id).startsWith('preview-')) toRemove.push(e);
  });
  toRemove.forEach((e) => viewer.entities.remove(e));
}

/** @param {[number, number][]} latLonPairs — [lat, lon]; @param haeM WGS84 height (m) for Cesium. */
function llToPositionsWithHae(latLonPairs, haeM) {
  const h = Number.isFinite(haeM) ? haeM : 0;
  const flat = [];
  for (const [lat, lon] of latLonPairs) {
    flat.push(lon, lat, h);
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat);
}

/**
 * Right-click waypoints.
 * With `O` held: right-click + drag orbit.
 * With `R` held: right-click A, right-click B, then right-click + drag turn radius (racetrack).
 * Requires an initialized Cesium.Viewer.
 */
const MovementPlanningCesium = forwardRef(function MovementPlanningCesium(
  {
    viewer,
    sessionId,
    socket,
    selectedEntity,
    oHeld,
    rHeld,
    planWaypoints,
    setPlanWaypoints,
    racetrackDraft,
    setRacetrackDraft,
    onPlanCommitted,
  },
  ref,
) {
  const dragRef = useRef(null);
  const lastEdgeRef = useRef(null);
  const planWaypointsRef = useRef(planWaypoints);
  const racetrackRef = useRef(racetrackDraft);
  const [orbitPreview, setOrbitPreview] = useState(null);
  const [racetrackRadiusPreview, setRacetrackRadiusPreview] = useState(null);
  const originalCameraControllerFlagsRef = useRef(null);
  const rightMousePlanningSuppressedRef = useRef(false);
  const rightMouseDownRef = useRef(false);
  /** Pointer id when O/R station planning captured the canvas (so pointerup fires reliably after drag). */
  const stationPointerIdRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      clearTransientDrafts() {
        const had =
          dragRef.current != null ||
          orbitPreview != null ||
          racetrackRadiusPreview != null;
        dragRef.current = null;
        lastEdgeRef.current = null;
        setOrbitPreview(null);
        setRacetrackRadiusPreview(null);
        return had;
      },
    }),
    [orbitPreview, racetrackRadiusPreview],
  );

  useEffect(() => {
    planWaypointsRef.current = planWaypoints;
  }, [planWaypoints]);
  useEffect(() => {
    racetrackRef.current = racetrackDraft;
  }, [racetrackDraft]);

  const canPlan = Boolean(sessionId && socket && selectedEntity?.id && selectedEntity?.movable);
  const stationModifierActive = (oHeld && !rHeld) || (rHeld && !oHeld);

  const clearOrbitPreview = useCallback(() => {
    dragRef.current = null;
    lastEdgeRef.current = null;
    setOrbitPreview(null);
  }, []);

  const clearRacetrackDrag = useCallback(() => {
    dragRef.current = null;
    lastEdgeRef.current = null;
    setRacetrackRadiusPreview(null);
  }, []);

  const finishOrbitDrag = useCallback(
    (edgeLatLng) => {
      if (!dragRef.current || dragRef.current.kind !== 'orbit') return;
      const start = dragRef.current.center;

      if (!edgeLatLng || !selectedEntity?.id || !socket || !sessionId) return;

      const radiusM = geodesicDistanceM(start.lat, start.lng, edgeLatLng.lat, edgeLatLng.lng);
      if (radiusM < MIN_ORBIT_RADIUS_M) return;

      clearOrbitPreview();

      const deltaLon = edgeLatLng.lng - start.lng;
      const clockwise = deltaLon > 0;

      socket.emit('issue_movement_order', {
        session_id: sessionId,
        entity_id: selectedEntity.id,
        waypoints: waypointPayload(planWaypointsRef.current),
        order: {
          kind: 'orbit',
          center_lat_deg: start.lat,
          center_lon_deg: start.lng,
          radius_m: radiusM,
          clockwise,
        },
      });
      onPlanCommitted?.();
    },
    [clearOrbitPreview, onPlanCommitted, selectedEntity, sessionId, socket],
  );

  const finishRacetrackDrag = useCallback(
    (edgeLatLng) => {
      if (!dragRef.current || dragRef.current.kind !== 'racetrack') return;
      const b = dragRef.current.center;
      const draft = racetrackRef.current;
      const a = draft.a;

      if (!edgeLatLng || !a || !selectedEntity?.id || !socket || !sessionId) return;

      const radiusM = geodesicDistanceM(b.lat, b.lng, edgeLatLng.lat, edgeLatLng.lng);
      if (radiusM < MIN_ORBIT_RADIUS_M) return;

      clearRacetrackDrag();
      setRacetrackDraft({ phase: 'idle', a: null, b: null });

      const cosA = Math.cos((a.lat * Math.PI) / 180);
      const cosB = Math.cos((b.lat * Math.PI) / 180);
      const dabE = (b.lng - a.lng) * cosA;
      const dabN = b.lat - a.lat;
      const debE = (edgeLatLng.lng - b.lng) * cosB;
      const debN = edgeLatLng.lat - b.lat;
      const cross = dabE * debN - dabN * debE;
      const racetrack_clockwise = cross > 0;

      socket.emit('issue_movement_order', {
        session_id: sessionId,
        entity_id: selectedEntity.id,
        waypoints: waypointPayload(planWaypointsRef.current),
        order: {
          kind: 'racetrack',
          point_a_lat_deg: a.lat,
          point_a_lon_deg: a.lng,
          point_b_lat_deg: b.lat,
          point_b_lon_deg: b.lng,
          orbit_distance_m: radiusM,
          racetrack_clockwise,
        },
      });
      onPlanCommitted?.();
    },
    [clearRacetrackDrag, onPlanCommitted, selectedEntity, sessionId, socket, setRacetrackDraft],
  );

  const commitStationDragIfAny = useCallback(() => {
    if (!dragRef.current) return;
    const kind = dragRef.current.kind;
    if (kind !== 'orbit' && kind !== 'racetrack') return;
    const edge = lastEdgeRef.current ?? dragRef.current.center;
    if (kind === 'orbit') finishOrbitDrag(edge);
    else finishRacetrackDrag(edge);
  }, [finishOrbitDrag, finishRacetrackDrag]);

  useEffect(() => {
    if (oHeld || rHeld) return;
    if (dragRef.current) {
      // Don't cancel an in-progress drag just because the modifier key was released.
      // We commit on mouse-up; clearing early would drop the order.
      if (!rightMouseDownRef.current) {
        if (dragRef.current.kind === 'orbit') clearOrbitPreview();
        else clearRacetrackDrag();
      }
    }
  }, [oHeld, rHeld, clearOrbitPreview, clearRacetrackDrag]);

  useEffect(() => {
    if (!viewer) return undefined;

    const canvas = viewer.scene.canvas;
    const onCtx = (e) => e.preventDefault();
    canvas.addEventListener('contextmenu', onCtx);

    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    const controller = viewer.scene.screenSpaceCameraController;
    const suppressRightMouseNavigation = () => {
      if (!canPlan) return;
      if (!originalCameraControllerFlagsRef.current) {
        const possibleFlags = [
          'enableTranslate',
          'enableLook',
          'enableRotate',
          'enableZoom',
          'enableInputs',
        ];
        const snapshot = {};
        for (const key of possibleFlags) {
          if (Object.prototype.hasOwnProperty.call(controller, key)) {
            snapshot[key] = controller[key];
          }
        }
        originalCameraControllerFlagsRef.current = snapshot;
      }
      if ('enableTranslate' in originalCameraControllerFlagsRef.current) controller.enableTranslate = false;
      if ('enableLook' in originalCameraControllerFlagsRef.current) controller.enableLook = false;
      if ('enableRotate' in originalCameraControllerFlagsRef.current) controller.enableRotate = false;
      if ('enableZoom' in originalCameraControllerFlagsRef.current) controller.enableZoom = false;
      if ('enableInputs' in originalCameraControllerFlagsRef.current) controller.enableInputs = false;
      rightMousePlanningSuppressedRef.current = true;
    };
    const restoreRightMouseNavigation = () => {
      if (!rightMousePlanningSuppressedRef.current) return;
      const flags = originalCameraControllerFlagsRef.current;
      if (flags) {
        if ('enableTranslate' in flags) controller.enableTranslate = flags.enableTranslate;
        if ('enableLook' in flags) controller.enableLook = flags.enableLook;
        if ('enableRotate' in flags) controller.enableRotate = flags.enableRotate;
        if ('enableZoom' in flags) controller.enableZoom = flags.enableZoom;
        if ('enableInputs' in flags) controller.enableInputs = flags.enableInputs;
      }
      rightMousePlanningSuppressedRef.current = false;
    };

    /**
     * Pointer capture on secondary button while O/R station mode is active guarantees pointerup
     * reaches us after drag (Cesium often misses window mouseup / wrong MouseEvent.button on canvas).
     */
    const onCanvasPointerDownCapture = (e) => {
      if (!canPlan) return;
      if (e.button !== 2) return;
      rightMouseDownRef.current = true;
      if (stationModifierActive) {
        try {
          canvas.setPointerCapture(e.pointerId);
          stationPointerIdRef.current = e.pointerId;
        } catch {
          stationPointerIdRef.current = null;
        }
      }
      try {
        suppressRightMouseNavigation();
      } catch {
        /* ignore */
      }
      try {
        e.preventDefault?.();
      } catch {
        /* ignore */
      }
    };

    const onDocPointerUpCapture = (e) => {
      if (stationPointerIdRef.current !== null && e.pointerId !== stationPointerIdRef.current) {
        return;
      }
      if (stationPointerIdRef.current !== null && e.pointerId === stationPointerIdRef.current) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        stationPointerIdRef.current = null;
      }
      rightMouseDownRef.current = false;
      try {
        restoreRightMouseNavigation();
      } catch {
        /* ignore */
      }

      if (!dragRef.current) return;
      const k = dragRef.current.kind;
      if (k !== 'orbit' && k !== 'racetrack') return;
      if (e.pointerType === 'mouse' && e.button !== 2) return;

      // Use pointerup coordinates as the "edge" lat/lon so racetrack commits even if Cesium
      // didn't fire any MOUSE_MOVE events during the drag.
      if (
        e.pointerType === 'mouse' &&
        Number.isFinite(e.clientX) &&
        Number.isFinite(e.clientY)
      ) {
        try {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const ll = pickLatLng(viewer, new Cesium.Cartesian2(x, y));
          if (ll) lastEdgeRef.current = { lat: ll.lat, lng: ll.lng };
        } catch {
          /* ignore pointer->lat/lon conversion failures */
        }
      }
      commitStationDragIfAny();
    };

    const onDocPointerCancelCapture = (e) => {
      if (stationPointerIdRef.current !== null && e.pointerId === stationPointerIdRef.current) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        stationPointerIdRef.current = null;
      }
      rightMouseDownRef.current = false;
      try {
        restoreRightMouseNavigation();
      } catch {
        /* ignore */
      }
      if (dragRef.current?.kind === 'orbit') clearOrbitPreview();
      else if (dragRef.current?.kind === 'racetrack') clearRacetrackDrag();
    };

    /** No PointerEvent (very old browsers): commit station drag on document mouseup, right button. */
    const onDocMouseUpCapture = (e) => {
      if (window.PointerEvent) return;
      if (!dragRef.current) return;
      if (dragRef.current.kind !== 'orbit' && dragRef.current.kind !== 'racetrack') return;
      if (e.button !== 2) return;
      rightMouseDownRef.current = false;
      try {
        restoreRightMouseNavigation();
      } catch {
        /* ignore */
      }
      commitStationDragIfAny();
    };

    canvas.addEventListener('pointerdown', onCanvasPointerDownCapture, true);
    document.addEventListener('pointerup', onDocPointerUpCapture, true);
    document.addEventListener('pointercancel', onDocPointerCancelCapture, true);
    document.addEventListener('mouseup', onDocMouseUpCapture, true);

    handler.setInputAction((click) => {
      mapClickDebug('planning:contextmenu', { canPlan, screenPosition: click.position });
      if (!canPlan) return;
      if (!click.position) return;

      const ll = pickLatLng(viewer, click.position);
      if (!ll) return;

      // If a station drag is in progress, RIGHT_CLICK commits it.
      if (dragRef.current) {
        if (dragRef.current.kind === 'orbit') finishOrbitDrag(ll);
        else finishRacetrackDrag(ll);
        return;
      }

      // Otherwise: do nothing. Waypoints are added on RIGHT_DOWN.
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction((movement) => {
      if (!canPlan) return;
      suppressRightMouseNavigation();
      const pos = movement.position;
      if (!pos) return;

      const ll = pickLatLng(viewer, pos);
      if (!ll) return;

      // When no station modifier is held, RIGHT_DOWN becomes waypoint placement.
      if (!stationModifierActive) {
        if (dragRef.current) return;
        if (oHeld || rHeld) return; // defensive: shouldn't happen if stationModifierActive is correct
        mapClickDebug('planning:waypoint:add', ll);
        setPlanWaypoints((prev) => [...prev, { lat: ll.lat, lng: ll.lng }]);
        return;
      }

      mapClickDebug('planning:rightdown:station-capture', { oHeld, rHeld });

      if (oHeld && !rHeld) {
        dragRef.current = { kind: 'orbit', center: { lat: ll.lat, lng: ll.lng } };
        lastEdgeRef.current = { lat: ll.lat, lng: ll.lng };
        setOrbitPreview({ center: { lat: ll.lat, lng: ll.lng }, edge: { lat: ll.lat, lng: ll.lng } });
        setRacetrackRadiusPreview(null);
        return;
      }

      if (rHeld && !oHeld) {
        const d = racetrackRef.current;
        if (d.phase === 'idle') {
          setRacetrackDraft({ phase: 'need_b', a: { lat: ll.lat, lng: ll.lng }, b: null });
          setOrbitPreview(null);
          return;
        }
        if (d.phase === 'need_b' && d.a) {
          const b = { lat: ll.lat, lng: ll.lng };
          setRacetrackDraft({ phase: 'drag', a: d.a, b });
          dragRef.current = { kind: 'racetrack', center: b };
          lastEdgeRef.current = b;
          setRacetrackRadiusPreview({ center: b, edge: b });
          setOrbitPreview(null);
        }
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);

    handler.setInputAction((movement) => {
      if (!dragRef.current) return;
      const pos = movement.endPosition;
      if (!pos) return;
      const ll = pickLatLng(viewer, pos);
      if (!ll) return;
      lastEdgeRef.current = ll;
      if (dragRef.current.kind === 'orbit') {
        setOrbitPreview({ center: dragRef.current.center, edge: ll });
      } else if (dragRef.current.kind === 'racetrack') {
        setRacetrackRadiusPreview({ center: dragRef.current.center, edge: ll });
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // RIGHT_UP is intentionally unused: Cesium's internal right-mouse events are more consistent
    // when we commit on RIGHT_CLICK (after the release/click cycle).
    handler.setInputAction(() => {}, Cesium.ScreenSpaceEventType.RIGHT_UP);

    return () => {
      try {
        canvas.removeEventListener('pointerdown', onCanvasPointerDownCapture, true);
      } catch {
        /* ignore */
      }
      try {
        document.removeEventListener('pointerup', onDocPointerUpCapture, true);
        document.removeEventListener('pointercancel', onDocPointerCancelCapture, true);
        document.removeEventListener('mouseup', onDocMouseUpCapture, true);
      } catch {
        /* ignore */
      }
      stationPointerIdRef.current = null;
      try {
        restoreRightMouseNavigation();
      } catch {
        /* ignore: viewer might already be destroyed */
      }
      try {
        canvas.removeEventListener('contextmenu', onCtx);
      } catch {
        /* canvas may be gone if viewer was destroyed */
      }
      try {
        handler.destroy();
      } catch {
        /* may run after viewer teardown */
      }
    };
  }, [
    viewer,
    canPlan,
    stationModifierActive,
    oHeld,
    rHeld,
    setPlanWaypoints,
    setRacetrackDraft,
    finishOrbitDrag,
    finishRacetrackDrag,
    commitStationDragIfAny,
    clearOrbitPreview,
    clearRacetrackDrag,
  ]);

  const pathPositions = useMemo(() => {
    if (!selectedEntity) return [];
    const pts = [[selectedEntity.lat_deg, selectedEntity.lon_deg]];
    for (const w of planWaypoints) {
      pts.push([w.lat, w.lng]);
    }
    return pts;
  }, [selectedEntity, planWaypoints]);

  const orbitApproachSegment = useMemo(() => {
    if (!orbitPreview?.center || !orbitPreview?.edge || !selectedEntity) return null;
    const lastLat =
      planWaypoints.length > 0
        ? planWaypoints[planWaypoints.length - 1].lat
        : selectedEntity.lat_deg;
    const lastLon =
      planWaypoints.length > 0
        ? planWaypoints[planWaypoints.length - 1].lng
        : selectedEntity.lon_deg;
    const r = geodesicDistanceM(
      orbitPreview.center.lat,
      orbitPreview.center.lng,
      orbitPreview.edge.lat,
      orbitPreview.edge.lng,
    );
    const hdg = selectedEntity.heading_deg ?? 0;
    const join = geodesicPointTowardFromCenter(
      orbitPreview.center.lat,
      orbitPreview.center.lng,
      lastLat,
      lastLon,
      r,
      hdg,
    );
    return [
      [lastLat, lastLon],
      [join.latDeg, join.lonDeg],
    ];
  }, [orbitPreview, planWaypoints, selectedEntity]);

  const racetrackLine = useMemo(
    () =>
      racetrackDraft.a && racetrackDraft.b
        ? [
            [racetrackDraft.a.lat, racetrackDraft.a.lng],
            [racetrackDraft.b.lat, racetrackDraft.b.lng],
          ]
        : null,
    [racetrackDraft],
  );

  useEffect(() => {
    if (!viewer) return;
    removePreviewEntities(viewer);

    const planHaeM = haeFeetToMeters(selectedEntity?.hae_ft);

    for (let i = 0; i < planWaypoints.length; i++) {
      const w = planWaypoints[i];
      viewer.entities.add({
        id: `preview-wp-${i}`,
        position: Cesium.Cartesian3.fromDegrees(w.lng, w.lat, planHaeM),
        point: {
          pixelSize: greenWaypoint.pixelSize,
          color: greenWaypoint.color,
          outlineColor: greenWaypoint.outlineColor,
          outlineWidth: greenWaypoint.outlineWidth,
        },
      });
    }

    if (pathPositions.length >= 2) {
      viewer.entities.add({
        id: 'preview-path',
        polyline: {
          positions: llToPositionsWithHae(pathPositions, planHaeM),
          width: 3,
          material: greenLine.color,
        },
      });
    }

    if (orbitApproachSegment) {
      viewer.entities.add({
        id: 'preview-orbit-approach',
        polyline: {
          positions: llToPositionsWithHae(orbitApproachSegment, planHaeM),
          width: 2,
          material: Cesium.Color.CYAN.withAlpha(0.7),
        },
      });
    }

    if (racetrackLine) {
      viewer.entities.add({
        id: 'preview-racetrack-ab',
        polyline: {
          positions: llToPositionsWithHae(racetrackLine, planHaeM),
          width: 2,
          material: Cesium.Color.LIME.withAlpha(0.85),
        },
      });
    }

    if (orbitPreview?.center && orbitPreview?.edge) {
      const r = Math.max(
        geodesicDistanceM(
          orbitPreview.center.lat,
          orbitPreview.center.lng,
          orbitPreview.edge.lat,
          orbitPreview.edge.lng,
        ),
        1,
      );
      viewer.entities.add({
        id: 'preview-orbit-circle',
        position: Cesium.Cartesian3.fromDegrees(orbitPreview.center.lng, orbitPreview.center.lat, planHaeM),
        ellipse: {
          semiMajorAxis: r,
          semiMinorAxis: r,
          material: Cesium.Color.LIME.withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.LIME,
          outlineWidth: 2,
          height: 0,
        },
      });
    }

    if (racetrackRadiusPreview?.center && racetrackRadiusPreview?.edge) {
      const r = Math.max(
        geodesicDistanceM(
          racetrackRadiusPreview.center.lat,
          racetrackRadiusPreview.center.lng,
          racetrackRadiusPreview.edge.lat,
          racetrackRadiusPreview.edge.lng,
        ),
        1,
      );
      viewer.entities.add({
        id: 'preview-racetrack-circle',
        position: Cesium.Cartesian3.fromDegrees(
          racetrackRadiusPreview.center.lng,
          racetrackRadiusPreview.center.lat,
          planHaeM,
        ),
        ellipse: {
          semiMajorAxis: r,
          semiMinorAxis: r,
          material: Cesium.Color.MEDIUMSPRINGGREEN.withAlpha(0.1),
          outline: true,
          outlineColor: Cesium.Color.MEDIUMSPRINGGREEN,
          outlineWidth: 2,
          height: 0,
        },
      });
    }

    return () => {
      try {
        removePreviewEntities(viewer);
      } catch {
        /* viewer may already be destroyed */
      }
    };
  }, [
    viewer,
    selectedEntity,
    planWaypoints,
    pathPositions,
    orbitApproachSegment,
    racetrackLine,
    orbitPreview,
    racetrackRadiusPreview,
  ]);

  return null;
});

export default MovementPlanningCesium;
