import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  clampTimeScale,
  clockPolar,
  DIAL_FACE_MIN_SCALE,
  donutSectorPath,
  formatTimeScale,
  MAX_TIME_SCALE,
  pointToTimeScale,
  scaleToClockTheta,
  scaleToHandTip,
  THETA_THREE_OCLOCK,
} from '../config/simTiming';
import './SimulationSpeedDial.css';

function formatExerciseClock(simTimeUtc) {
  if (!simTimeUtc || typeof simTimeUtc !== 'string') return null;
  const d = new Date(simTimeUtc);
  if (Number.isNaN(d.getTime())) return simTimeUtc;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' Z';
}

/**
 * Clock face: 12 = ⅛×, 3 = 1×, clockwise to ~11:59 = max ×.
 * Shaded wedges show the active arc from the anchors to the hand.
 */
export default function SimulationSpeedDial({ socket, session, simTiming }) {
  const gradId = useId().replace(/:/g, '');
  const isWhite = String(session?.player_team ?? '').toLowerCase() === 'white';
  const serverScale = simTiming?.time_scale ?? 1;
  const [draftScale, setDraftScale] = useState(serverScale);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const emitTimerRef = useRef(null);

  useEffect(() => {
    if (!dragging) setDraftScale(serverScale);
  }, [serverScale, dragging]);

  const sessionId = session?.id;

  const emitScale = useCallback(
    (value) => {
      if (!sessionId || !isWhite || !socket) return;
      const v = clampTimeScale(value);
      socket.emit('set_time_scale', { session_id: sessionId, time_scale: v });
    },
    [sessionId, isWhite, socket],
  );

  const scheduleEmit = useCallback(
    (value) => {
      if (emitTimerRef.current != null) clearTimeout(emitTimerRef.current);
      emitTimerRef.current = setTimeout(() => {
        emitTimerRef.current = null;
        emitScale(value);
      }, 80);
    },
    [emitScale],
  );

  useEffect(
    () => () => {
      if (emitTimerRef.current != null) clearTimeout(emitTimerRef.current);
    },
    [],
  );

  const viewBoxToLocal = useCallback((clientX, clientY) => {
    const el = svgRef.current;
    if (!el) return { x: 50, y: 50 };
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 100;
    const y = ((clientY - r.top) / r.height) * 100;
    return { x, y };
  }, []);

  const updateFromClient = useCallback(
    (clientX, clientY) => {
      const { x, y } = viewBoxToLocal(clientX, clientY);
      const next = pointToTimeScale(x, y);
      if (next == null) return;
      setDraftScale(next);
      scheduleEmit(next);
    },
    [viewBoxToLocal, scheduleEmit],
  );

  const onPointerDown = (e) => {
    if (!isWhite) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClient(e.clientX, e.clientY);
  };

  const onPointerMove = (e) => {
    if (!isWhite || !dragging) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const onPointerUp = (e) => {
    if (!isWhite) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(false);
    const { x, y } = viewBoxToLocal(e.clientX, e.clientY);
    const finalScale = pointToTimeScale(x, y);
    if (finalScale != null) emitScale(finalScale);
  };

  const displayScale = clampTimeScale(draftScale);
  const thetaHand = scaleToClockTheta(displayScale);
  const tip = scaleToHandTip(displayScale);

  const rOuter = 41;
  const rInnerTrail = 24;
  const rHub = 17;

  const slowQuarterPath = donutSectorPath(50, 50, rInnerTrail, rOuter, 0.02, THETA_THREE_OCLOCK - 0.02);

  const slowTrailPath =
    thetaHand > 0.04 && thetaHand <= THETA_THREE_OCLOCK
      ? donutSectorPath(50, 50, rInnerTrail, rOuter, 0.02, thetaHand)
      : '';

  const fastTrailPath =
    thetaHand > THETA_THREE_OCLOCK + 0.04
      ? donutSectorPath(50, 50, rInnerTrail, rOuter, THETA_THREE_OCLOCK + 0.02, thetaHand)
      : '';

  const midFast = (THETA_THREE_OCLOCK + thetaHand) / 2;
  const gx = 50 + 36 * Math.sin(midFast);
  const gy = 50 - 36 * Math.cos(midFast);

  const tickAngles = [];
  for (let i = 0; i < 12; i += 1) {
    tickAngles.push((i / 12) * 2 * Math.PI);
  }

  const p3 = clockPolar(50, 50, rOuter + 1, THETA_THREE_OCLOCK);

  const caption = formatExerciseClock(simTiming?.sim_time_utc);
  const elapsed =
    typeof simTiming?.sim_elapsed_s === 'number'
      ? `T+${simTiming.sim_elapsed_s.toFixed(0)}s`
      : null;

  return (
    <div
      className={`sim-speed-dial ${isWhite ? 'sim-speed-dial--interactive' : ''}`}
      data-testid="sim-speed-dial"
      aria-label={
        isWhite
          ? `Simulation speed dial, ${formatTimeScale(displayScale)} times real time. Drag to adjust.`
          : `Simulation speed, ${formatTimeScale(displayScale)} times real time. White cell controls.`
      }
    >
      <svg
        ref={svgRef}
        className="sim-speed-dial__svg"
        viewBox="0 0 100 100"
        role={isWhite ? 'slider' : 'img'}
        aria-valuemin={isWhite ? DIAL_FACE_MIN_SCALE : undefined}
        aria-valuemax={isWhite ? MAX_TIME_SCALE : undefined}
        aria-valuenow={isWhite ? displayScale : undefined}
        aria-readonly={!isWhite}
        onPointerDown={isWhite ? onPointerDown : undefined}
        onPointerMove={isWhite ? onPointerMove : undefined}
        onPointerUp={isWhite ? onPointerUp : undefined}
        onPointerCancel={isWhite ? onPointerUp : undefined}
      >
        <defs>
          <filter id={`${gradId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.35" />
          </filter>
          <linearGradient
            id={`${gradId}-fast`}
            gradientUnits="userSpaceOnUse"
            x1="50"
            y1="50"
            x2={gx}
            y2={gy}
          >
            <stop offset="0%" stopColor="rgba(251, 191, 36, 0.06)" />
            <stop offset="100%" stopColor="rgba(251, 191, 36, 0.26)" />
          </linearGradient>
          <linearGradient
            id={`${gradId}-slow`}
            gradientUnits="userSpaceOnUse"
            x1="50"
            y1="50"
            x2={50 + 28 * Math.sin(thetaHand / 2)}
            y2={50 - 28 * Math.cos(thetaHand / 2)}
          >
            <stop offset="0%" stopColor="rgba(147, 197, 253, 0.04)" />
            <stop offset="100%" stopColor="rgba(147, 197, 253, 0.2)" />
          </linearGradient>
        </defs>

        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1.5"
        />

        {/* Whole slow quadrant (12 → 3): faint guide */}
        {slowQuarterPath ? (
          <path d={slowQuarterPath} fill="rgba(255,255,255,0.04)" stroke="none" />
        ) : null}

        {/* Shaded trail: 12 → hand while below 1× */}
        {slowTrailPath ? (
          <path d={slowTrailPath} fill={`url(#${gradId}-slow)`} stroke="none" />
        ) : null}

        {/* Shaded trail: 3 → hand while above 1× */}
        {fastTrailPath ? (
          <path d={fastTrailPath} fill={`url(#${gradId}-fast)`} stroke="none" />
        ) : null}

        {/* Hour ticks (12 at top, 3 at right) */}
        {tickAngles.map((th, i) => {
          const x1 = 50 + 40 * Math.sin(th);
          const y1 = 50 - 40 * Math.cos(th);
          const x2 = 50 + 35 * Math.sin(th);
          const y2 = 50 - 35 * Math.cos(th);
          const major = i % 3 === 0;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.2)'}
              strokeWidth={major ? 1.5 : 0.85}
              strokeLinecap="round"
            />
          );
        })}

        {/* 1× anchor at 3 o’clock */}
        <circle cx={p3.x} cy={p3.y} r="2.2" fill="rgba(251, 191, 36, 0.85)" />
        <text
          x={p3.x + 7}
          y={p3.y + 3}
          fill="rgba(255,255,255,0.5)"
          fontSize="6"
          fontFamily="system-ui, sans-serif"
          style={{ pointerEvents: 'none' }}
        >
          1×
        </text>

        {/* ⅛× hint at 12 */}
        <text
          x="50"
          y="14"
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          fontSize="6"
          fontFamily="system-ui, sans-serif"
          style={{ pointerEvents: 'none' }}
        >
          ⅛×
        </text>

        <g filter={`url(#${gradId}-shadow)`}>
          <line
            x1="50"
            y1="50"
            x2={tip.x}
            y2={tip.y}
            stroke={isWhite ? '#fbbf24' : 'rgba(255,255,255,0.55)'}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            cx={tip.x}
            cy={tip.y}
            r={isWhite ? 4 : 3}
            fill={isWhite ? '#fbbf24' : 'rgba(255,255,255,0.5)'}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="0.5"
          />
        </g>

        <circle cx="50" cy="50" r={rHub} fill="#1a1a1e" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

        <text
          x="50"
          y="54"
          textAnchor="middle"
          fill="#fff"
          fontSize="15"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
          style={{ pointerEvents: 'none' }}
        >
          {`${formatTimeScale(displayScale)}×`}
        </text>
        <text
          x="50"
          y="67"
          textAnchor="middle"
          fill="rgba(255,255,255,0.45)"
          fontSize="7"
          fontFamily="system-ui, sans-serif"
          style={{ pointerEvents: 'none' }}
        >
          sim rate
        </text>

        <title>{`Simulation ${formatTimeScale(displayScale)}× real time`}</title>
      </svg>

      <div className="sim-speed-dial__caption">
        {caption && <div>{caption}</div>}
        {elapsed && <div>{elapsed}</div>}
      </div>
      {isWhite ? (
        <div className="sim-speed-dial__hint">
          12 = ⅛× · 3 = 1× · to ~11:59 = {MAX_TIME_SCALE}× — drag rim
        </div>
      ) : (
        <div className="sim-speed-dial__hint">White cell controls timing</div>
      )}
    </div>
  );
}
