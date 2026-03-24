import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { parseLeadingChatCommand } from '../chatParse.js';
import TeamBadge from './TeamBadge';
import './SessionChatPanel.css';

const ChatMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  scope: z
    .enum(['all', 'team', 'white_red', 'white_blue', 'team_white'])
    .optional()
    .default('all'),
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

/** @typedef {'all' | 'team' | 'white_red' | 'white_blue' | 'team_white'} ChatChannel */

function scopeBadge(scope) {
  switch (scope) {
    case 'team':
      return { label: '[Team]', title: 'Your team only' };
    case 'white_red':
      return { label: '[W+R]', title: 'White cell + Red team' };
    case 'white_blue':
      return { label: '[W+B]', title: 'White cell + Blue team' };
    case 'team_white':
      return { label: '[+W]', title: 'Your team + White cell' };
    default:
      return { label: '[All]', title: 'Everyone' };
  }
}

function channelPillLabel(channel) {
  switch (channel) {
    case 'team':
      return 'Your team only';
    case 'white_red':
      return 'White + Red';
    case 'white_blue':
      return 'White + Blue';
    case 'team_white':
      return 'Team + White cell';
    default:
      return 'Everyone';
  }
}

function channelPlaceholder(channel) {
  switch (channel) {
    case 'team':
      return 'Team message…';
    case 'white_red':
      return 'Message white + red…';
    case 'white_blue':
      return 'Message white + blue…';
    case 'team_white':
      return 'Message your team + white cell…';
    default:
      return 'Message everyone…';
  }
}

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
  const playerTeam = String(session?.player_team ?? 'white').toLowerCase();
  const teamHeaderMod =
    playerTeam === 'blue' || playerTeam === 'red' || playerTeam === 'white'
      ? `session-chat-panel__header--team-${playerTeam}`
      : 'session-chat-panel__header--team-white';

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

    const parsed = parseLeadingChatCommand(text, playerTeam, chatChannel);
    if (parsed.channel !== null) {
      setChatChannel(parsed.channel);
    }
    if (!parsed.emitMessage) {
      setDraft('');
      return;
    }

    socket.emit('session_chat', {
      session_id: sessionId,
      text: parsed.body,
      scope: parsed.scope,
    });
    setDraft('');
  }, [draft, socket, sessionId, chatChannel, playerTeam]);

  if (!sessionId) return null;

  if (minimized) {
    return (
      <div className="session-chat-panel session-chat-panel--minimized">
        <div className={`session-chat-panel__header ${teamHeaderMod}`}>
          <div className="session-chat-panel__header-title-row">
            <TeamBadge session={session} compact />
            <span className="session-chat-panel__title session-chat-panel__title--minimized">
              Chat & players
            </span>
          </div>
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
      <div className={`session-chat-panel__header ${teamHeaderMod}`}>
        <div className="session-chat-panel__header-title-row">
          <TeamBadge session={session} compact />
        </div>
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
            <div
              className="session-chat-panel__messages"
              role="log"
              aria-live="polite"
              data-testid="chat-messages"
            >
              {messages.length === 0 && (
                <div style={{ opacity: 0.5, fontSize: 11 }}>No messages yet.</div>
              )}
              {messages.map((m, i) => {
                const scope = m.scope ?? 'all';
                const badge = scopeBadge(scope);
                return (
                  <div
                    key={`${m.from}-${i}-${m.text.slice(0, 20)}`}
                    data-testid="chat-message"
                    data-chat-scope={scope}
                    className={`session-chat-panel__msg session-chat-panel__msg--${scope}`}
                  >
                    <span className="session-chat-panel__msg-scope" title={badge.title}>
                      {badge.label}
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
              <span
                data-testid="chat-channel-pill"
                data-chat-channel={chatChannel}
                className={`session-chat-panel__channel-pill session-chat-panel__channel-pill--${chatChannel}`}
              >
                {channelPillLabel(chatChannel)}
              </span>
              <span className="session-chat-panel__channel-hint">
                {playerTeam === 'blue'
                  ? '/all /team /blue — /blue = team · /white = your team + white cell'
                  : playerTeam === 'red'
                    ? '/all /team /red — /red = team · /white = your team + white cell'
                    : playerTeam === 'white'
                      ? '/all /team /white for white cell only · /red or /blue to reach that side + white cell'
                      : '/all or /team to switch — add text after a space to send in that mode'}
              </span>
            </div>
            <div className="session-chat-panel__input-row">
              <input
                className="session-chat-panel__input"
                data-testid="chat-message-input"
                type="text"
                placeholder={channelPlaceholder(chatChannel)}
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
