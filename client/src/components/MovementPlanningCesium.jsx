import * as Cesium from 'cesium';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  geodesicDistanceM,
  geodesicPointTowardFromCenter,
} from '../geo/wgs84Geodesic';
import { mapClickDebug } from '../utils/mapClickDebug';

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

/** @param {[number, number][]} latLonPairs — [lat, lon] */
function llToPositions(latLonPairs) {
  const flat = [];
  for (const [lat, lon] of latLonPairs) {
    flat.push(lon, lat);
  }
  return Cesium.Cartesian3.fromDegreesArray(flat);
}

/**
 * Right-click waypoints, O+drag orbit, R + click A + click B + drag radius (racetrack).
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
      clearOrbitPreview();

      if (!edgeLatLng || !selectedEntity?.id || !socket || !sessionId) return;

      const radiusM = geodesicDistanceM(start.lat, start.lng, edgeLatLng.lat, edgeLatLng.lng);
      if (radiusM < MIN_ORBIT_RADIUS_M) return;

      const deltaLon = edgeLatLng.lng - start.lng;
      const clockwise = deltaLon > 0;

      socket.emit('issue_movement_order', {
        session_id: sessionId,
        entity_id: selectedEntity.id,
        waypoints: waypointPayload(planWaypointsRef.current),
        kind: 'orbit',
        center_lat_deg: start.lat,
        center_lon_deg: start.lng,
        radius_m: radiusM,
        clockwise,
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
      clearRacetrackDrag();
      setRacetrackDraft({ phase: 'idle', a: null, b: null });

      if (!edgeLatLng || !a || !selectedEntity?.id || !socket || !sessionId) return;

      const radiusM = geodesicDistanceM(b.lat, b.lng, edgeLatLng.lat, edgeLatLng.lng);
      if (radiusM < MIN_ORBIT_RADIUS_M) return;

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
        kind: 'racetrack',
        point_a_lat_deg: a.lat,
        point_a_lon_deg: a.lng,
        point_b_lat_deg: b.lat,
        point_b_lon_deg: b.lng,
        orbit_distance_m: radiusM,
        racetrack_clockwise,
      });
      onPlanCommitted?.();
    },
    [clearRacetrackDrag, onPlanCommitted, selectedEntity, sessionId, socket, setRacetrackDraft],
  );

  useEffect(() => {
    const onWinMouseUp = () => {
      if (!dragRef.current) return;
      const edge = lastEdgeRef.current ?? dragRef.current.center;
      if (dragRef.current.kind === 'orbit') finishOrbitDrag(edge);
      else finishRacetrackDrag(edge);
    };
    window.addEventListener('mouseup', onWinMouseUp);
    return () => window.removeEventListener('mouseup', onWinMouseUp);
  }, [finishOrbitDrag, finishRacetrackDrag]);

  useEffect(() => {
    if (oHeld || rHeld) return;
    if (dragRef.current) {
      if (dragRef.current.kind === 'orbit') clearOrbitPreview();
      else clearRacetrackDrag();
    }
  }, [oHeld, rHeld, clearOrbitPreview, clearRacetrackDrag]);

  useEffect(() => {
    if (!viewer) return undefined;

    const canvas = viewer.scene.canvas;
    const onCtx = (e) => e.preventDefault();
    canvas.addEventListener('contextmenu', onCtx);

    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    handler.setInputAction((click) => {
      mapClickDebug('planning:contextmenu', { canPlan, screenPosition: click.position });
      if (!canPlan) return;
      const ll = pickLatLng(viewer, click.position);
      if (!ll) return;
      mapClickDebug('planning:waypoint:add', ll);
      setPlanWaypoints((prev) => [...prev, { lat: ll.lat, lng: ll.lng }]);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction((movement) => {
      if (!canPlan) return;
      const pos = movement.position;
      if (!pos) return;
      if (!stationModifierActive) return;

      const ll = pickLatLng(viewer, pos);
      if (!ll) return;

      mapClickDebug('planning:mousedown:station-capture', { oHeld, rHeld });

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
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

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

    handler.setInputAction((click) => {
      if (!click.position) return;
      const ll = pickLatLng(viewer, click.position);
      if (!ll) return;
      if (!dragRef.current) return;
      if (dragRef.current.kind === 'orbit') finishOrbitDrag(ll);
      else finishRacetrackDrag(ll);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    return () => {
      canvas.removeEventListener('contextmenu', onCtx);
      handler.destroy();
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

    for (let i = 0; i < planWaypoints.length; i++) {
      const w = planWaypoints[i];
      viewer.entities.add({
        id: `preview-wp-${i}`,
        position: Cesium.Cartesian3.fromDegrees(w.lng, w.lat, 0),
        point: {
          pixelSize: greenWaypoint.pixelSize,
          color: greenWaypoint.color,
          outlineColor: greenWaypoint.outlineColor,
          outlineWidth: greenWaypoint.outlineWidth,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    if (pathPositions.length >= 2) {
      viewer.entities.add({
        id: 'preview-path',
        polyline: {
          positions: llToPositions(pathPositions),
          width: 3,
          material: greenLine.color,
          clampToGround: true,
        },
      });
    }

    if (orbitApproachSegment) {
      viewer.entities.add({
        id: 'preview-orbit-approach',
        polyline: {
          positions: llToPositions(orbitApproachSegment),
          width: 2,
          material: Cesium.Color.CYAN.withAlpha(0.7),
          clampToGround: true,
        },
      });
    }

    if (racetrackLine) {
      viewer.entities.add({
        id: 'preview-racetrack-ab',
        polyline: {
          positions: llToPositions(racetrackLine),
          width: 2,
          material: Cesium.Color.LIME.withAlpha(0.85),
          clampToGround: true,
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
        position: Cesium.Cartesian3.fromDegrees(orbitPreview.center.lng, orbitPreview.center.lat, 0),
        ellipse: {
          semiMajorAxis: r,
          semiMinorAxis: r,
          material: Cesium.Color.LIME.withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.LIME,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
          0,
        ),
        ellipse: {
          semiMajorAxis: r,
          semiMinorAxis: r,
          material: Cesium.Color.MEDIUMSPRINGGREEN.withAlpha(0.1),
          outline: true,
          outlineColor: Cesium.Color.MEDIUMSPRINGGREEN,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }

    return () => {
      if (viewer && typeof viewer.isDestroyed === 'function' && !viewer.isDestroyed()) {
        removePreviewEntities(viewer);
      }
    };
  }, [
    viewer,
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
