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

function TeamShieldIcon({ color }) {
  return (
    <svg
      width={28}
      height={28}
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
 * Intended as an overlay inside a `position: relative` container (e.g. tab content).
 */
export default function TeamBadge({ session }) {
  if (!session?.id) return null;

  const playerTeam = String(session.player_team ?? 'white').toLowerCase();
  const teamBadge = TEAM_BADGE[playerTeam] ?? TEAM_BADGE.white;

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 1500,
        top: 10,
        left: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        borderLeft: `4px solid ${teamBadge.accent}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
        maxWidth: 220,
      }}
      role="status"
      aria-label={`Your team: ${teamBadge.title}`}
    >
      <TeamShieldIcon color={teamBadge.accent} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{teamBadge.title}</div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{teamBadge.subtitle}</div>
      </div>
    </div>
  );
}
