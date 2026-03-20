import React, { useState, useEffect } from 'react';
import './SessionModal.css';
import { SIDC_HELP_HREF } from '../config';
import { z } from 'zod';

const SessionDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ScenarioSideEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
});

const ScenarioSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  win_conditions: z.string(),
  red: z.array(ScenarioSideEntitySchema),
  blue: z.array(ScenarioSideEntitySchema),
});

// Enforce that the payload is an object with a `sessions` array.
const SessionsListDtoShapeSchema = z.object({
  sessions: z.array(z.unknown()),
});

const ScenariosListDtoShapeSchema = z.object({
  scenarios: z.array(z.unknown()),
});

const ErrorDtoSchema = z.object({
  message: z.string(),
});

const SessionModal = ({ socket, onSessionEstablished }) => {
  /** initial | pick_scenario | join_session */
  const [view, setView] = useState('initial');
  const [sessions, setSessions] = useState([]);
  const [sessionName, setSessionName] = useState('');
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [scenariosLoadError, setScenariosLoadError] = useState(null);
  const [sessionCreateError, setSessionCreateError] = useState(null);

  useEffect(() => {
    if (view !== 'join_session' || !socket) {
      return undefined;
    }

    const handleSessionsList = (sessionList) => {
      console.log('[sessions_list] raw payload', sessionList);
      let candidate = null;

      if (Array.isArray(sessionList)) {
        candidate = { sessions: sessionList };
      } else if (sessionList && typeof sessionList === 'object') {
        if (Array.isArray(sessionList.sessions)) {
          candidate = sessionList;
        } else if (Array.isArray(sessionList.data)) {
          candidate = { sessions: sessionList.data };
        }
      }

      if (!candidate) {
        console.error('[sessions_list] invalid DTO shape', {
          receivedType: sessionList === null ? 'null' : typeof sessionList,
        });
        setSessions([]);
        return;
      }

      const topLevel = SessionsListDtoShapeSchema.safeParse(candidate);
      if (!topLevel.success) {
        console.error('[sessions_list] invalid DTO shape', {
          issues: topLevel.error.issues.slice(0, 5),
        });
        setSessions([]);
        return;
      }

      const sessionsUnknown = topLevel.data.sessions;
      const validSessions = [];
      let invalidCount = 0;

      for (const sessionUnknown of sessionsUnknown) {
        const parsedSession = SessionDtoSchema.safeParse(sessionUnknown);
        if (!parsedSession.success) {
          invalidCount += 1;
          continue;
        }
        validSessions.push(parsedSession.data);
      }

      if (invalidCount > 0) {
        console.error('[sessions_list] invalid session DTOs detected', {
          invalidCount,
          sampleInvalid: sessionsUnknown
            .filter((s) => !SessionDtoSchema.safeParse(s).success)
            .slice(0, 3),
        });
      }

      setSessions(validSessions);
    };

    const requestSessions = () => {
      socket.emit('get_sessions');
    };

    socket.on('sessions_list', handleSessionsList);
    // After stop_session the server disconnects sockets in the room; on reconnect we must ask again.
    socket.on('connect', requestSessions);
    requestSessions();

    return () => {
      socket.off('sessions_list', handleSessionsList);
      socket.off('connect', requestSessions);
    };
  }, [view, socket]);

  useEffect(() => {
    if (view !== 'pick_scenario' || !socket) {
      return undefined;
    }

    setScenariosLoadError(null);

    const handleScenariosList = (payload) => {
        let candidate = null;
        if (Array.isArray(payload)) {
          candidate = { scenarios: payload };
        } else if (payload && typeof payload === 'object') {
          if (Array.isArray(payload.scenarios)) {
            candidate = payload;
          } else if (Array.isArray(payload.data)) {
            candidate = { scenarios: payload.data };
          }
        }

        if (!candidate) {
          setScenarios([]);
          setSelectedScenarioId(null);
          setScenariosLoadError('Invalid scenario list from server.');
          return;
        }

        const top = ScenariosListDtoShapeSchema.safeParse(candidate);
        if (!top.success) {
          setScenarios([]);
          setSelectedScenarioId(null);
          setScenariosLoadError('Invalid scenario list shape.');
          return;
        }

        const valid = [];
        for (const row of top.data.scenarios) {
          const p = ScenarioSummarySchema.safeParse(row);
          if (p.success) valid.push(p.data);
        }

        setScenarios(valid);
        setSelectedScenarioId((prev) => {
          if (prev && valid.some((s) => s.id === prev)) return prev;
          return valid[0]?.id ?? null;
        });

        if (valid.length === 0) {
          setScenariosLoadError('No scenarios are available on the server.');
        }
    };

    const requestScenarios = () => {
      socket.emit('get_scenarios');
    };

    socket.on('scenarios_list', handleScenariosList);
    socket.on('connect', requestScenarios);
    requestScenarios();

    return () => {
      socket.off('scenarios_list', handleScenariosList);
      socket.off('connect', requestScenarios);
    };
  }, [view, socket]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleSessionJoined = (sessionData) => {
      onSessionEstablished(sessionData);
    };

    const handleSessionCreated = (sessionData) => {
      setSessionCreateError(null);
      onSessionEstablished(sessionData);
    };

    const handleCreateRejected = (raw) => {
      const parsed = ErrorDtoSchema.safeParse(raw);
      const msg = parsed.success
        ? parsed.data.message
        : typeof raw === 'object' && raw && 'message' in raw
          ? String(raw.message)
          : 'Could not create session.';
      setSessionCreateError(msg);
    };

    socket.on('session_joined', handleSessionJoined);
    socket.on('session_created', handleSessionCreated);
    socket.on('create_session_rejected', handleCreateRejected);

    return () => {
      socket.off('session_joined', handleSessionJoined);
      socket.off('session_created', handleSessionCreated);
      socket.off('create_session_rejected', handleCreateRejected);
    };
  }, [socket, onSessionEstablished]);

  const selectedScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? null;

  // Default session name: ISO 8601 time + chosen scenario title (user can edit).
  // Only re-run when the chosen scenario changes (not when `scenarios` array identity changes).
  useEffect(() => {
    if (view !== 'pick_scenario' || !selectedScenarioId) return;
    const s = scenarios.find((x) => x.id === selectedScenarioId);
    if (!s) return;
    setSessionName(`${new Date().toISOString()} ${s.name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: refresh name when selection changes only
  }, [view, selectedScenarioId]);

  const handleInitializeOperation = () => {
    if (sessionName.trim() === '' || !selectedScenarioId) return;
    setSessionCreateError(null);
    socket.emit('create_session', {
      name: sessionName.trim(),
      scenario_id: selectedScenarioId,
    });
  };

  const handleJoinSession = (sessionId, team) => {
    socket.emit('join_session', { id: sessionId, team });
  };

  const modalClassName =
    view === 'pick_scenario'
      ? 'modal-content modal-content--scenario-picker'
      : 'modal-content';

  return (
    <div className="modal-overlay">
      <div className={modalClassName}>
        {view === 'initial' && (
          <>
            <h2>Naval Game</h2>
            <p>Welcome to the tactical operations center.</p>
            <div className="modal-buttons">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSessionCreateError(null);
                  setSessionName('');
                  setView('pick_scenario');
                }}
              >
                Start a New Session
              </button>
              <button className="btn btn-secondary" onClick={() => setView('join_session')}>
                Join a Session
              </button>
            </div>
            <a
              className="modal-help-button"
              href={SIDC_HELP_HREF}
              target="_blank"
              rel="noopener noreferrer"
            >
              SIDC help (opens in new tab)
            </a>
          </>
        )}

        {view === 'pick_scenario' && (
          <>
            <h2>Select scenario</h2>
            <div className="config-form scenario-picker__session-name">
              <label htmlFor="session-operation-name">Session name</label>
              <input
                id="session-operation-name"
                type="text"
                placeholder="Filled automatically when you pick a scenario"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {scenariosLoadError && (
              <p className="modal-error" role="alert">
                {scenariosLoadError}
              </p>
            )}
            {sessionCreateError && (
              <p className="modal-error" role="alert">
                {sessionCreateError}
              </p>
            )}

            <div className="scenario-picker">
              <div className="scenario-picker__list-wrap">
                <h3 className="scenario-picker__subhead">Scenarios</h3>
                {scenarios.length === 0 && !scenariosLoadError ? (
                  <p className="scenario-picker__placeholder">Loading scenarios…</p>
                ) : (
                  <ul className="scenario-list" role="listbox" aria-label="Scenarios">
                    {scenarios.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={
                            s.id === selectedScenarioId
                              ? 'scenario-list__item scenario-list__item--active'
                              : 'scenario-list__item'
                          }
                          onClick={() => setSelectedScenarioId(s.id)}
                        >
                          {s.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="scenario-picker__detail">
                <h3 className="scenario-picker__subhead">Briefing</h3>
                {selectedScenario ? (
                  <div className="scenario-detail">
                    <section className="scenario-detail__block">
                      <h4>Description</h4>
                      <pre className="scenario-detail__text">{selectedScenario.description}</pre>
                    </section>
                    <section className="scenario-detail__block">
                      <h4>Win conditions</h4>
                      <pre className="scenario-detail__text">{selectedScenario.win_conditions}</pre>
                    </section>
                    {(selectedScenario.red.length > 0 || selectedScenario.blue.length > 0) && (
                      <section className="scenario-detail__block scenario-detail__forces">
                        <h4>Order of battle</h4>
                        <div className="scenario-detail__forces-grid">
                          <div>
                            <span className="scenario-detail__side scenario-detail__side--red">
                              Red
                            </span>
                            <ul>
                              {selectedScenario.red.map((e) => (
                                <li key={e.id}>{e.name}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <span className="scenario-detail__side scenario-detail__side--blue">
                              Blue
                            </span>
                            <ul>
                              {selectedScenario.blue.map((e) => (
                                <li key={e.id}>{e.name}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                ) : (
                  <p className="scenario-picker__placeholder">Select a scenario to view details.</p>
                )}
              </div>
            </div>

            <div className="modal-buttons modal-buttons--row">
              <button
                className="btn btn-primary"
                disabled={
                  sessionName.trim() === '' || !selectedScenarioId || scenarios.length === 0
                }
                onClick={handleInitializeOperation}
              >
                Initialize operation
              </button>
            </div>
            <button
              className="btn btn-back"
              onClick={() => {
                setView('initial');
                setSessionName('');
                setSessionCreateError(null);
              }}
            >
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
                      <div className="join-team-buttons">
                        <button
                          disabled={!sessionId}
                          className="btn-join"
                          onClick={() => sessionId && handleJoinSession(sessionId, 'blue')}
                        >
                          Join Blue
                        </button>
                        <button
                          className="btn-join"
                          disabled={!sessionId}
                          onClick={() => sessionId && handleJoinSession(sessionId, 'red')}
                        >
                          Join Red
                        </button>
                        <button
                          className="btn-join"
                          disabled={!sessionId}
                          onClick={() => sessionId && handleJoinSession(sessionId, 'white')}
                        >
                          Join White Cell
                        </button>
                      </div>
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
