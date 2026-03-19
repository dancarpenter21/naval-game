import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Tabs, { Tab } from './components/Tabs';
import MapView from './components/MapView';
import SyncMatrixView from './components/SyncMatrixView';
import SessionModal from './components/SessionModal';
import './App.css';
import { SOCKET_PATH, SOCKET_URL } from './config';

const socket = SOCKET_URL
  ? io(SOCKET_URL, { path: SOCKET_PATH })
  : io({ path: SOCKET_PATH });

function App() {
  const [session, setSession] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSessionEstablished = (sessionData) => {
    setSession(sessionData);
  };

  useEffect(() => {
    const handleSessionStopped = () => {
      setMenuOpen(false);
      setSession(null);
    };

    socket.on('session_stopped', handleSessionStopped);
    return () => {
      socket.off('session_stopped', handleSessionStopped);
    };
  }, []);

  const handleStopGame = () => {
    if (!session?.id) return;
    socket.emit('stop_session', { id: session.id });
  };

  return (
    <div className="App">
      {!session && <SessionModal socket={socket} onSessionEstablished={handleSessionEstablished} />}
      <div className="app-topbar">
        <button
          className="hamburger-button"
          type="button"
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
                href="/help/sidc.html"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
              >
                SIDC help (opens in new tab)
              </a>
              <a
                className="menu-item menu-link"
                role="menuitem"
                href="/sidc-picker/index.html"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
              >
                SIDC builder (opens in new tab)
              </a>

              <button
                className="menu-item danger"
                type="button"
                role="menuitem"
                disabled={!session}
                onClick={handleStopGame}
              >
                Stop game
              </button>
            </div>
          </>
        )}
      </div>
      <Tabs>
        <Tab label="Map">
          <MapView socket={socket} session={session} />
        </Tab>
        <Tab label="Sync Matrix">
          <SyncMatrixView />
        </Tab>
      </Tabs>
    </div>
  );
}

export default App;
