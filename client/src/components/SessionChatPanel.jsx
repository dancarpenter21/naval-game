import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import './SessionChatPanel.css';

const ChatMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  scope: z.enum(['all', 'team']).optional().default('all'),
});

const RoomPlayerSchema = z.object({
  socket_id: z.string(),
  display_name: z.string(),
  player_team: z.enum(['blue', 'red', 'white']),
});

const PlayersListSchema = z.object({
  players: z.array(RoomPlayerSchema),
});

const TEAM_LABEL = {
  blue: 'Blue',
  red: 'Red',
  white: 'White cell',
};

/** @typedef {'all' | 'team'} ChatChannel */

export default function SessionChatPanel({ socket, session, onPlayersList }) {
  const [minimized, setMinimized] = useState(false);
  const [panelTab, setPanelTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [players, setPlayers] = useState([]);
  const [draft, setDraft] = useState('');
  /** Subsequent sends use this until changed via /all or /team */
  const [chatChannel, setChatChannel] = useState(/** @type {ChatChannel} */ ('all'));
  const listEndRef = useRef(null);

  const sessionId = session?.id;

  useEffect(() => {
    setChatChannel('all');
  }, [sessionId]);

  useEffect(() => {
    if (!socket || !sessionId) {
      setMessages([]);
      setPlayers([]);
      return undefined;
    }

    const handlePlayersList = (raw) => {
      const parsed = PlayersListSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn('[players_list] invalid shape', parsed.error?.issues?.slice(0, 3));
        return;
      }
      const list = parsed.data.players;
      setPlayers(list);
      onPlayersList?.(list);
    };

    const onChatMessage = (raw) => {
      const parsed = ChatMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const row = {
        ...parsed.data,
        scope: parsed.data.scope ?? 'all',
      };
      setMessages((prev) => [...prev.slice(-199), row]);
    };

    socket.on('players_list', handlePlayersList);
    socket.on('chat_message', onChatMessage);
    socket.emit('request_players_list', { id: sessionId });

    return () => {
      socket.off('players_list', handlePlayersList);
      socket.off('chat_message', onChatMessage);
    };
  }, [socket, sessionId, onPlayersList]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, panelTab]);

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text || !socket || !sessionId) return;

    const lower = text.toLowerCase();
    if (lower === '/all') {
      setChatChannel('all');
      setDraft('');
      return;
    }
    if (lower === '/team') {
      setChatChannel('team');
      setDraft('');
      return;
    }

    socket.emit('session_chat', {
      session_id: sessionId,
      text,
      scope: chatChannel,
    });
    setDraft('');
  }, [draft, socket, sessionId, chatChannel]);

  if (!sessionId) return null;

  if (minimized) {
    return (
      <div className="session-chat-panel session-chat-panel--minimized">
        <div className="session-chat-panel__header">
          <span className="session-chat-panel__title">Chat & players</span>
          <div className="session-chat-panel__header-actions">
            <button
              type="button"
              data-testid="chat-panel-expand"
              className="session-chat-panel__icon-btn"
              aria-label="Expand panel"
              onClick={() => setMinimized(false)}
            >
              ▲
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="session-chat-panel">
      <div className="session-chat-panel__header">
        <span className="session-chat-panel__title">Session</span>
        <div className="session-chat-panel__header-actions">
          <button
            type="button"
            data-testid="chat-panel-minimize"
            className="session-chat-panel__icon-btn"
            aria-label="Minimize panel"
            onClick={() => setMinimized(true)}
          >
            ▼
          </button>
        </div>
      </div>
      <div className="session-chat-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          data-testid="chat-tab-chat"
          aria-selected={panelTab === 'chat'}
          className={`session-chat-panel__tab ${panelTab === 'chat' ? 'session-chat-panel__tab--active' : ''}`}
          onClick={() => setPanelTab('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          data-testid="chat-tab-players"
          aria-selected={panelTab === 'players'}
          className={`session-chat-panel__tab ${panelTab === 'players' ? 'session-chat-panel__tab--active' : ''}`}
          onClick={() => setPanelTab('players')}
        >
          Players
        </button>
      </div>
      <div className="session-chat-panel__body">
        {panelTab === 'chat' && (
          <>
            <div className="session-chat-panel__messages" role="log" aria-live="polite">
              {messages.length === 0 && (
                <div style={{ opacity: 0.5, fontSize: 11 }}>No messages yet.</div>
              )}
              {messages.map((m, i) => {
                const scope = m.scope ?? 'all';
                return (
                  <div
                    key={`${m.from}-${i}-${m.text.slice(0, 20)}`}
                    className={`session-chat-panel__msg session-chat-panel__msg--${scope}`}
                  >
                    <span className="session-chat-panel__msg-scope" title={scope === 'team' ? 'Team chat' : 'Everyone'}>
                      {scope === 'team' ? '[Team]' : '[All]'}
                    </span>
                    <span className="session-chat-panel__msg-from">{m.from}:</span>
                    <span>{m.text}</span>
                  </div>
                );
              })}
              <div ref={listEndRef} />
            </div>
            <div className="session-chat-panel__channel-bar" aria-live="polite">
              <span className="session-chat-panel__channel-label">Sending to:</span>
              <span className={`session-chat-panel__channel-pill session-chat-panel__channel-pill--${chatChannel}`}>
                {chatChannel === 'team' ? 'Your team only' : 'Everyone'}
              </span>
              <span className="session-chat-panel__channel-hint">Type /all or /team to switch</span>
            </div>
            <div className="session-chat-panel__input-row">
              <input
                className="session-chat-panel__input"
                data-testid="chat-message-input"
                type="text"
                placeholder={chatChannel === 'team' ? 'Team message…' : 'Message everyone…'}
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                aria-label="Chat message"
              />
              <button
                type="button"
                data-testid="chat-send"
                className="session-chat-panel__send"
                disabled={!draft.trim()}
                onClick={sendChat}
              >
                Send
              </button>
            </div>
          </>
        )}
        {panelTab === 'players' && (
          <div className="session-chat-panel__players">
            {players.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 11 }}>Loading players…</div>
            )}
            {players.map((p) => {
              const isSelf = socket?.id && p.socket_id === socket.id;
              return (
                <div key={p.socket_id} className="session-chat-panel__player-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="session-chat-panel__player-name">
                      {p.display_name}
                      {isSelf && (
                        <span className="session-chat-panel__player-you"> (you)</span>
                      )}
                    </div>
                  </div>
                  <span className="session-chat-panel__team">{TEAM_LABEL[p.player_team]}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
