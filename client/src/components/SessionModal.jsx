import React, { useState, useEffect } from 'react';
import './SessionModal.css';

const SessionModal = ({ socket, onSessionEstablished }) => {
  const [view, setView] = useState('initial'); // 'initial', 'new_session', 'join_session'
  const [sessions, setSessions] = useState([]);
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    if (view === 'join_session' && socket) {
      socket.emit('get_sessions');
      
      const handleSessionsList = (sessionList) => {
        setSessions(sessionList);
      };

      socket.on('sessions_list', handleSessionsList);

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
                {sessions.map(s => (
                  <li key={s.id} className="session-item">
                    <span className="session-info">{s.name} ({s.id})</span>
                    <button className="btn-join" onClick={() => handleJoinSession(s.id)}>
                      Join
                    </button>
                  </li>
                ))}
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
