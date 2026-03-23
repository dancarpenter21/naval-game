import L from 'leaflet';
import { Circle, CircleMarker, Polyline, useMapEvents } from 'react-leaflet';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { geodesicDistanceM, geodesicPointTowardFromCenter } from '../geo/wgs84Geodesic';
import { mapClickDebug } from '../utils/mapClickDebug';

const MIN_ORBIT_RADIUS_M = 75;

const greenLine = {
  color: '#86efac',
  weight: 3,
  opacity: 0.9,
  dashArray: '10 6',
};

const greenWaypoint = {
  color: '#4ade80',
  fillColor: '#bbf7d0',
  fillOpacity: 0.85,
  weight: 2,
};

function waypointPayload(pts) {
  return pts.map((p) => ({ lat_deg: p.lat, lon_deg: p.lng }));
}

/**
 * Right-click waypoints, O+drag orbit, R + click A + click B + drag radius (racetrack).
 */
const MovementPlanningLayer = forwardRef(function MovementPlanningLayer(
  {
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
      /** Cancel in-progress orbit / racetrack radius drag (no order emit). @returns {boolean} whether anything was cleared */
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

  // Mouse map pan is disabled globally (WASD pan in MapKeyboardPanLayer); orbit/racetrack use raw drag.

  useEffect(() => {
    mapClickDebug('planning:state', {
      canPlan,
      stationModifierActive,
      selectedId: selectedEntity?.id,
      movable: selectedEntity?.movable,
      racetrackPhase: racetrackDraft.phase,
    });
  }, [canPlan, stationModifierActive, selectedEntity?.id, selectedEntity?.movable, racetrackDraft.phase]);

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

  useMapEvents({
    contextmenu(e) {
      e.originalEvent?.preventDefault?.();
      mapClickDebug('planning:contextmenu', { canPlan, latlng: e.latlng });
      if (!canPlan) return;
      const oe = e.originalEvent;
      if (oe) {
        L.DomEvent.stopPropagation(oe);
      }
      const { lat, lng } = e.latlng;
      mapClickDebug('planning:waypoint:add', { lat, lng });
      setPlanWaypoints((prev) => [...prev, { lat, lng }]);
    },
    mousedown(e) {
      const btn = e.originalEvent.button;
      if (btn === 0) {
        mapClickDebug('planning:mousedown:left', {
          canPlan,
          stationModifierActive,
          oHeld,
          rHeld,
          racetrackPhase: racetrackRef.current.phase,
        });
      }
      if (!canPlan || btn !== 0) return;
      if (!stationModifierActive) return;

      mapClickDebug('planning:mousedown:station-capture', { oHeld, rHeld, phase: racetrackRef.current.phase });

      const oe = e.originalEvent;
      if (oe) {
        L.DomEvent.stopPropagation(oe);
        // Prevent focus/outline quirks; pan is already off while canPlan.
        oe.preventDefault?.();
      }

      if (oHeld && !rHeld) {
        dragRef.current = { kind: 'orbit', center: e.latlng };
        lastEdgeRef.current = e.latlng;
        setOrbitPreview({ center: e.latlng, edge: e.latlng });
        setRacetrackRadiusPreview(null);
        return;
      }

      if (rHeld && !oHeld) {
        const d = racetrackRef.current;
        if (d.phase === 'idle') {
          setRacetrackDraft({ phase: 'need_b', a: e.latlng, b: null });
          setOrbitPreview(null);
          return;
        }
        if (d.phase === 'need_b' && d.a) {
          const b = e.latlng;
          setRacetrackDraft({ phase: 'drag', a: d.a, b });
          dragRef.current = { kind: 'racetrack', center: b };
          lastEdgeRef.current = b;
          setRacetrackRadiusPreview({ center: b, edge: b });
          setOrbitPreview(null);
        }
      }
    },
    mousemove(e) {
      if (!dragRef.current) return;
      lastEdgeRef.current = e.latlng;
      if (dragRef.current.kind === 'orbit') {
        setOrbitPreview({ center: dragRef.current.center, edge: e.latlng });
      } else if (dragRef.current.kind === 'racetrack') {
        setRacetrackRadiusPreview({ center: dragRef.current.center, edge: e.latlng });
      }
    },
    mouseup(e) {
      if (e.originalEvent.button !== 0 || !dragRef.current) return;
      if (dragRef.current.kind === 'orbit') finishOrbitDrag(e.latlng);
      else finishRacetrackDrag(e.latlng);
    },
  });

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

  const racetrackLine =
    racetrackDraft.a && racetrackDraft.b
      ? [
          [racetrackDraft.a.lat, racetrackDraft.a.lng],
          [racetrackDraft.b.lat, racetrackDraft.b.lng],
        ]
      : null;

  return (
    <>
      {planWaypoints.map((w, i) => (
        <CircleMarker
          key={`wp-${i}-${w.lat}-${w.lng}`}
          center={[w.lat, w.lng]}
          radius={5}
          pathOptions={greenWaypoint}
        />
      ))}
      {pathPositions.length >= 2 && (
        <Polyline positions={pathPositions} pathOptions={greenLine} />
      )}
      {orbitApproachSegment && (
        <Polyline
          positions={orbitApproachSegment}
          pathOptions={{ ...greenLine, opacity: 0.7, dashArray: '6 10' }}
        />
      )}
      {racetrackLine && (
        <Polyline positions={racetrackLine} pathOptions={{ ...greenLine, dashArray: '4 8' }} />
      )}

      {orbitPreview?.center && orbitPreview?.edge && (
        <Circle
          center={[orbitPreview.center.lat, orbitPreview.center.lng]}
          radius={Math.max(
            geodesicDistanceM(
              orbitPreview.center.lat,
              orbitPreview.center.lng,
              orbitPreview.edge.lat,
              orbitPreview.edge.lng,
            ),
            1,
          )}
          pathOptions={{
            color: '#4ade80',
            fillColor: '#22c55e',
            fillOpacity: 0.06,
            weight: 2,
            dashArray: '6 8',
          }}
        />
      )}

      {racetrackRadiusPreview?.center && racetrackRadiusPreview?.edge && (
        <Circle
          center={[racetrackRadiusPreview.center.lat, racetrackRadiusPreview.center.lng]}
          radius={Math.max(
            geodesicDistanceM(
              racetrackRadiusPreview.center.lat,
              racetrackRadiusPreview.center.lng,
              racetrackRadiusPreview.edge.lat,
              racetrackRadiusPreview.edge.lng,
            ),
            1,
          )}
          pathOptions={{
            color: '#6ee7b7',
            fillColor: '#34d399',
            fillOpacity: 0.05,
            weight: 2,
            dashArray: '4 6',
          }}
        />
      )}
    </>
  );
});

export default MovementPlanningLayer;
