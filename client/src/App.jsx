import React, { useCallback, useEffect, useState } from 'react';
import io from 'socket.io-client';
import Tabs, { Tab } from './components/Tabs';
import MapView from './components/MapView';
import TeamBadge from './components/TeamBadge';
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
    const handleSessionStopped = () => {
      setMenuOpen(false);
      setSession(null);
      setPlayers([]);
      setLeaveConfirmOpen(false);
    };
    const handleLeftSession = () => {
      setMenuOpen(false);
      setSession(null);
      setPlayers([]);
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
            <TeamBadge session={session} />
            <SessionChatPanel socket={socket} session={session} onPlayersList={handlePlayersList} />
          </>
        }
      >
        <Tab label="Map">
          <MapView socket={socket} session={session} />
        </Tab>
        <Tab label="Sync Matrix">
          <SyncMatrixView />
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
