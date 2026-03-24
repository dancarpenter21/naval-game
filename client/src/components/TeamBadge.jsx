import './TeamBadge.css';

const TEAM_BADGE = {
  blue: {
    title: 'Blue team',
    subtitle: 'Friendly side',
    accent: '#3b82f6',
  },
  red: {
    title: 'Red team',
    subtitle: 'Hostile side',
    accent: '#ef4444',
  },
  white: {
    title: 'White cell',
    subtitle: 'Administrator',
    accent: '#fbbf24',
  },
};

function TeamShieldIcon({ color, size = 28 }) {
  return (
    <svg
      className="team-badge__shield"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path fill={color} d="M12 2 4 5v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3z" />
    </svg>
  );
}

/**
 * Shows which team the player is on (blue / red / white cell).
 * Use `compact` for the session chat panel header.
 */
export default function TeamBadge({ session, compact = false }) {
  if (!session?.id) return null;

  const playerTeam = String(session.player_team ?? 'white').toLowerCase();
  const teamBadge = TEAM_BADGE[playerTeam] ?? TEAM_BADGE.white;

  return (
    <div
      className={`team-badge ${compact ? 'team-badge--compact' : ''}`}
      style={compact ? undefined : { borderLeft: `4px solid ${teamBadge.accent}` }}
      role="status"
      aria-label={`Your team: ${teamBadge.title}`}
    >
      <TeamShieldIcon color={teamBadge.accent} size={compact ? 22 : 28} />
      <div className="team-badge__text">
        <div className="team-badge__title">{teamBadge.title}</div>
        <div className="team-badge__subtitle">{teamBadge.subtitle}</div>
      </div>
    </div>
  );
}
