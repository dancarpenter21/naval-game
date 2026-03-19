import React, { useState, useEffect } from 'react';
import './SessionModal.css';

const normalizeSessionsList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === 'object') {
    // If we received a single session object like: { id, name }
    if (typeof payload?.id === 'string' && typeof payload?.name === 'string') {
      return [payload];
    }

    // If we received an object whose values are sessions (numeric keys etc.)
    const values = Object.values(payload);
    if (
      values.length > 0
      && values.every(
        (v) => v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string',
      )
    ) {
      return values;
    }
  }
  return [];
};

const SessionModal = ({ socket, onSessionEstablished }) => {
  const [view, setView] = useState('initial'); // 'initial', 'new_session', 'join_session'
  const [sessions, setSessions] = useState([]);
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    if (view === 'join_session' && socket) {
      const handleSessionsList = (sessionList) => {
        console.log('[sessions_list] raw payload', sessionList);
        setSessions(normalizeSessionsList(sessionList));
      };

      socket.on('sessions_list', handleSessionsList);

      // Register listener before requesting, to avoid missing fast responses.
      socket.emit('get_sessions');

      return () => {
        socket.off('sessions_list', handleSessionsList);
      };
    }
  }, [view, socket]);

  useEffect(() => {
    if (socket) {
      const handleSessionJoined = (sessionData) => {
        onSessionEstablished(sessionData);
      };

      const handleSessionCreated = (sessionData) => {
        onSessionEstablished(sessionData);
      };

      socket.on('session_joined', handleSessionJoined);
      socket.on('session_created', handleSessionCreated);

      return () => {
        socket.off('session_joined', handleSessionJoined);
        socket.off('session_created', handleSessionCreated);
      };
    }
  }, [socket, onSessionEstablished]);

  const handleStartNewSession = () => {
    if (sessionName.trim() === '') return;
    socket.emit('create_session', { name: sessionName });
  };

  const handleJoinSession = (sessionId) => {
    socket.emit('join_session', { id: sessionId });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {view === 'initial' && (
          <>
            <h2>Naval Game</h2>
            <p>Welcome to the tactical operations center.</p>
            <div className="modal-buttons">
              <button className="btn btn-primary" onClick={() => setView('new_session')}>
                Start a New Session
              </button>
              <button className="btn btn-secondary" onClick={() => setView('join_session')}>
                Join a Session
              </button>
            </div>
          </>
        )}

        {view === 'new_session' && (
          <>
            <h2>New Session Setup</h2>
            <div className="config-form">
              <label>Operation Name (Placeholder)</label>
              <input 
                type="text" 
                placeholder="e.g. Operation Trident" 
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
            </div>
            <div className="modal-buttons">
              <button className="btn btn-primary" onClick={handleStartNewSession}>
                Initialize Operation
              </button>
            </div>
            <button className="btn btn-back" onClick={() => setView('initial')}>
              &larr; Back
            </button>
          </>
        )}

        {view === 'join_session' && (
          <>
            <h2>Ongoing Sessions</h2>
            {sessions.length === 0 ? (
              <p style={{ color: '#aaa', margin: '30px 0' }}>No active sessions found.</p>
            ) : (
              <ul className="session-list">
                {sessions.map((s, idx) => {
                  const sessionId = s?.id ?? null;
                  const key = sessionId ?? `${s?.name ?? 'session'}-${idx}`;

                  return (
                    <li key={key} className="session-item">
                      <span className="session-info">
                        {s?.name ?? 'Unnamed'} ({sessionId ?? 'unknown'})
                      </span>
                      <button
                        className="btn-join"
                        disabled={!sessionId}
                        onClick={() => sessionId && handleJoinSession(sessionId)}
                      >
                      Join
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button className="btn btn-back" onClick={() => setView('initial')}>
              &larr; Back
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SessionModal;
