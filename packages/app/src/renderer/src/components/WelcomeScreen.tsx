import type { JSX } from 'react';
import type { RecentProject } from '../../../shared/ipc.js';

/** Last path segment of a project folder — its display name. */
function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * The launch screen for a window with no project. Offers Open Project… and,
 * when there are any, the recently-opened projects. Both route through
 * `window.cockpit.openProject` — with no argument it prompts a folder dialog,
 * with a path it opens that folder directly.
 */
export function WelcomeScreen({
  recents,
  onRemoveRecent,
}: {
  recents: RecentProject[];
  /** Drop a single project from the recents list (the × on each row). */
  onRemoveRecent: (path: string) => void;
}): JSX.Element {
  return (
    <main style={screenStyle} data-testid="welcome">
      <div style={cardStyle}>
        <h1 style={titleStyle}>AI-Lore</h1>
        <p style={subtitleStyle}>Open an AI-Lore project to begin.</p>

        <button
          type="button"
          style={openButtonStyle}
          data-testid="welcome-open"
          onClick={() => void window.cockpit.openProject()}
        >
          Open Project…
        </button>

        {recents.length > 0 && (
          <div style={recentsStyle}>
            <h2 style={recentsHeadingStyle}>Open Recent</h2>
            <ul style={recentsListStyle}>
              {recents.map((r) => (
                <li key={r.path} className="welcome-recent" style={recentRowStyle}>
                  <button
                    type="button"
                    style={recentItemStyle}
                    data-testid="welcome-recent"
                    title={r.path}
                    onClick={() => void window.cockpit.openProject(r.path)}
                  >
                    <span style={recentNameStyle}>{folderName(r.path)}</span>
                    <span style={recentPathStyle}>{r.path}</span>
                  </button>
                  <button
                    type="button"
                    className="welcome-recent-remove"
                    style={recentRemoveStyle}
                    data-testid="welcome-recent-remove"
                    title="Remove from Recents"
                    aria-label={`Remove ${folderName(r.path)} from Recents`}
                    onClick={() => onRemoveRecent(r.path)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

const screenStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  width: '100vw',
  margin: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const cardStyle: React.CSSProperties = {
  width: '420px',
  maxWidth: '90vw',
  textAlign: 'center',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '2rem',
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: 'var(--color-text-bright)',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0.4rem 0 1.4rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.9rem',
};

const openButtonStyle: React.CSSProperties = {
  padding: '0.6rem 1.4rem',
  fontSize: '0.95rem',
  fontWeight: 600,
  color: 'var(--color-text-bright)',
  background: 'var(--color-surface-blue)',
  border: '1px solid var(--color-surface-blue-border)',
  borderRadius: '6px',
  cursor: 'pointer',
};

const recentsStyle: React.CSSProperties = {
  marginTop: '1.8rem',
  textAlign: 'left',
};

const recentsHeadingStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)',
};

const recentsListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const recentRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
};

const recentItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  flex: 1,
  minWidth: 0,
  padding: '0.4rem 0.6rem',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'left',
};

const recentRemoveStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 28,
  alignSelf: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '1rem',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: '4px',
  padding: 0,
};

const recentNameStyle: React.CSSProperties = {
  color: 'var(--color-text)',
  fontSize: '0.9rem',
  fontWeight: 500,
};

const recentPathStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.75rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
