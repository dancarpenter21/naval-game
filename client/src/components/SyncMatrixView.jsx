import React, { useMemo } from 'react';

function formatEtaSim(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds <= 0) return 'On station';
  if (seconds < 120) return `${Math.round(seconds)}s sim`;
  const m = seconds / 60;
  if (m < 120) return `${m.toFixed(1)} min sim`;
  const h = m / 60;
  return `${h.toFixed(1)} h sim`;
}

/**
 * Gantt-style progress toward assigned orbit/racetrack (from server `station_*` fields),
 * plus satellite coverage enter/leave events.
 */
const SyncMatrixView = ({ entities = [], simTiming = null, spaceCoverageFeed = [] }) => {
  const stationRows = useMemo(() => {
    return (entities || []).filter(
      (e) =>
        e.movable !== false &&
        (e.station_eta_sim_s != null || e.station_progress != null),
    );
  }, [entities]);

  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        color: '#e5e7eb',
      }}
    >
      <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem', color: '#86efac' }}>
        Sync Matrix
      </h2>
      <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem', maxWidth: 640 }}>
        Progress toward station (orbit or racetrack) from the authoritative sim. Times are{' '}
        <strong>simulated seconds</strong> remaining, not wall clock.
        {simTiming?.time_scale != null && (
          <>
            {' '}
            Current time scale: <strong>{simTiming.time_scale.toFixed(2)}×</strong>.
          </>
        )}
      </p>

      {spaceCoverageFeed.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#a5b4fc' }}>
            Satellite coverage
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spaceCoverageFeed.map((ev, i) => {
              const enter = String(ev.kind).toLowerCase() === 'enter';
              return (
                <div
                  key={`${ev.satellite_id}-${ev.asset_id}-${ev.sim_time_utc}-${i}`}
                  data-testid={`sync-coverage-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'rgba(30, 41, 59, 0.55)',
                    border: `1px solid ${enter ? 'rgba(134, 239, 172, 0.35)' : 'rgba(248, 113, 113, 0.35)'}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: '0.88rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '1.1rem',
                      lineHeight: 1,
                      opacity: 0.95,
                    }}
                    title={enter ? 'Entered FoV' : 'Left FoV'}
                    aria-hidden
                  >
                    {enter ? '🛰️→' : '🛰️←'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {enter ? 'In FoV' : 'Out of FoV'}: <span style={{ color: '#e2e8f0' }}>{ev.asset_id}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                      sat {ev.satellite_id} · {ev.sim_time_utc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stationRows.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          No active movement-to-station plans. Issue a plan on the map (waypoints + O or R) to see
          rows here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stationRows.map((e) => {
            const eta = e.station_eta_sim_s;
            const p = typeof e.station_progress === 'number' ? e.station_progress : 0;
            const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
            return (
              <div
                key={e.id}
                data-testid={`sync-row-${e.id}`}
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(134, 239, 172, 0.25)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{e.name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#a7f3d0', whiteSpace: 'nowrap' }}>
                    ETA: {formatEtaSim(eta)}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2, fontFamily: 'monospace' }}>
                  {e.id}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    height: 10,
                    borderRadius: 5,
                    background: 'rgba(15, 23, 42, 0.9)',
                    overflow: 'hidden',
                  }}
                  title={`Progress ${pct}%`}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 5,
                      background: 'linear-gradient(90deg, #22c55e, #86efac)',
                      transition: 'width 0.35s ease-out',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                  {pct}% to station
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SyncMatrixView;
