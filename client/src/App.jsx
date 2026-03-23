import React, { useCallback, useEffect, useState } from 'react';
import io from 'socket.io-client';
import Tabs, { Tab } from './components/Tabs';
import MapView from './components/MapView';
import TeamBadge from './components/TeamBadge';
import SimulationSpeedDial from './components/SimulationSpeedDial';
import SessionChatPanel from './components/SessionChatPanel';
import SyncMatrixView from './components/SyncMatrixView';
import PlanComparisonView from './components/PlanComparisonView';
import SystemView from './components/SystemView';
import SessionModal from './components/SessionModal';
import './App.css';
import { SIDC_HELP_HREF, SOCKET_PATH, SOCKET_URL } from './config';

const socket = SOCKET_URL
  ? io(SOCKET_URL, { path: SOCKET_PATH })
  : io({ path: SOCKET_PATH });

function App() {
  const [session, setSession] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [players, setPlayers] = useState([]);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [simTiming, setSimTiming] = useState(null);
  const [worldEntities, setWorldEntities] = useState([]);
  /** Survives tab switches so Map tab can restore focus around the selected unit. */
  const [mapSelectedEntityId, setMapSelectedEntityId] = useState(null);

  const handleSessionEstablished = useCallback((sessionData) => {
    setSession(sessionData);
  }, []);

  const handlePlayersList = useCallback((list) => {
    setPlayers(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    if (!session) setPlayers([]);
  }, [session]);

  useEffect(() => {
    if (!session) setSimTiming(null);
  }, [session]);

  useEffect(() => {
    if (!session) setWorldEntities([]);
  }, [session]);

  useEffect(() => {
    setMapSelectedEntityId(null);
  }, [session?.id]);

  /** Server timing fields on every `world_snapshot` (all tabs, not only Map). */
  useEffect(() => {
    if (!session?.id) return undefined;
    const handleWorldSnapshot = (snapshot) => {
      const o = Array.isArray(snapshot) || snapshot == null ? null : snapshot;
      if (!o || typeof o !== 'object') return;
      if (typeof o.time_scale !== 'number' && typeof o.sim_elapsed_s !== 'number') return;
      setSimTiming({
        sim_elapsed_s: typeof o.sim_elapsed_s === 'number' ? o.sim_elapsed_s : 0,
        sim_time_utc: typeof o.sim_time_utc === 'string' ? o.sim_time_utc : null,
        wall_dt_s: typeof o.wall_dt_s === 'number' ? o.wall_dt_s : null,
        time_scale: typeof o.time_scale === 'number' ? o.time_scale : 1,
      });
    };
    socket.on('world_snapshot', handleWorldSnapshot);
    return () => socket.off('world_snapshot', handleWorldSnapshot);
  }, [session?.id]);

  useEffect(() => {
    const handleSessionStopped = () => {
      setMenuOpen(false);
      setSession(null);
      setPlayers([]);
      setSimTiming(null);
      setLeaveConfirmOpen(false);
    };
    const handleLeftSession = () => {
      setMenuOpen(false);
      setSession(null);
      setPlayers([]);
      setSimTiming(null);
      setLeaveConfirmOpen(false);
    };

    socket.on('session_stopped', handleSessionStopped);
    socket.on('left_session', handleLeftSession);
    return () => {
      socket.off('session_stopped', handleSessionStopped);
      socket.off('left_session', handleLeftSession);
    };
  }, []);

  const handleStopGame = () => {
    if (!session?.id) return;
    if (session?.player_team !== 'white') return;
    socket.emit('stop_session', { id: session.id });
  };

  const isLastWhiteCell =
    session?.player_team === 'white' &&
    players.filter((p) => p.player_team === 'white').length === 1 &&
    players.some((p) => p.socket_id === socket.id);

  const handleLeaveClick = () => {
    if (!session?.id) return;
    if (isLastWhiteCell) {
      setLeaveConfirmOpen(true);
    } else {
      doLeaveSession();
    }
  };

  const doLeaveSession = () => {
    if (!session?.id) return;
    socket.emit('leave_session', { id: session.id });
    setMenuOpen(false);
    setSession(null);
    setSimTiming(null);
    setLeaveConfirmOpen(false);
  };

  return (
    <div className="App">
      {!session && <SessionModal socket={socket} onSessionEstablished={handleSessionEstablished} />}
      <div className="app-topbar">
        <button
          className="hamburger-button"
          type="button"
          data-testid="hamburger-menu"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ☰
        </button>

        {menuOpen && (
          <>
            <button
              className="menu-backdrop"
              type="button"
              data-testid="menu-backdrop"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            />
            <div className="hamburger-menu" role="menu" aria-label="Game menu">
              <div className="menu-header">
                <div className="menu-title">Menu</div>
                {session && <div className="menu-subtitle">{session.name} ({session.id})</div>}
              </div>

              <a
                className="menu-item menu-link"
                role="menuitem"
                data-testid="menu-sidc-help"
                href={SIDC_HELP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
              >
                SIDC help (opens in new tab)
              </a>
              <a
                className="menu-item menu-link"
                role="menuitem"
                data-testid="menu-sidc-builder"
                href="/sidc-picker/index.html"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
              >
                SIDC builder (opens in new tab)
              </a>

              {session?.player_team === 'white' && (
                <button
                  className="menu-item danger"
                  type="button"
                  role="menuitem"
                  data-testid="menu-stop-game"
                  onClick={handleStopGame}
                >
                  Stop game
                </button>
              )}
              <button
                className="menu-item"
                type="button"
                role="menuitem"
                data-testid="menu-leave-game"
                disabled={!session}
                onClick={handleLeaveClick}
              >
                Leave game
              </button>
            </div>
          </>
        )}
      </div>
      {leaveConfirmOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title">
          <div className="leave-confirm-modal">
            <h2 id="leave-confirm-title">Last white cell player</h2>
            <p>You are the last white cell player. Leaving will end the game for everyone.</p>
            <div className="modal-buttons">
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="leave-confirm-cancel"
                onClick={() => setLeaveConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary danger"
                type="button"
                data-testid="leave-confirm-leave"
                onClick={doLeaveSession}
              >
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}
      <Tabs
        contentOverlay={
          <>
            <div className="session-top-overlay">
              <TeamBadge session={session} />
              <SimulationSpeedDial socket={socket} session={session} simTiming={simTiming} />
            </div>
            <SessionChatPanel socket={socket} session={session} onPlayersList={handlePlayersList} />
          </>
        }
      >
        <Tab label="Map">
          <MapView
            key={session?.id ?? 'no-session'}
            socket={socket}
            session={session}
            onEntitiesUpdate={setWorldEntities}
            selectedEntityId={mapSelectedEntityId}
            onSelectedEntityIdChange={setMapSelectedEntityId}
          />
        </Tab>
        <Tab label="Sync Matrix">
          <SyncMatrixView entities={worldEntities} simTiming={simTiming} />
        </Tab>
        <Tab label="System View">
          <SystemView />
        </Tab>
        <Tab label="Plan Comparison">
          <PlanComparisonView />
        </Tab>
      </Tabs>
    </div>
  );
}

export default App;
