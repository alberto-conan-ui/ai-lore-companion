import type { JSX } from 'react';
import type { AlteredReason } from '../../../shared/ipc.js';
import { TerminalTab } from './TerminalTab.js';

/** Where a user converts a plain folder into an AI-Lore project. */
const SDLC_URL = 'https://github.com/alberto-conan-ui/ai-sdlc';

type Props = {
  folder: string;
  reason: AlteredReason;
};

/**
 * The window shown when a folder cannot open as a cockpit: either it is not
 * an AI-Lore project, or it is one on a version older than the cockpit
 * supports. Both renders share a banner, a working terminal rooted at the
 * folder, and a Reload that re-runs detection — the user bootstraps or
 * upgrades in place, then reloads to land in the cockpit.
 */
export function AlteredScreen({ folder, reason }: Props): JSX.Element {
  return (
    <div style={layoutStyle} data-testid="altered">
      <div style={bannerStyle}>
        <div style={messageStyle}>
          {reason.kind === 'not-ai-lore' ? (
            <NotAiLoreMessage folder={folder} />
          ) : (
            <VersionTooOldMessage
              folder={folder}
              currentVersion={reason.currentVersion}
              minimumVersion={reason.minimumVersion}
            />
          )}
        </div>
        <button
          type="button"
          style={reloadStyle}
          data-testid="altered-reload"
          onClick={() => void window.cockpit.reload()}
        >
          Reload
        </button>
      </div>
      <TerminalTab active />
    </div>
  );
}

function NotAiLoreMessage({ folder }: { folder: string }): JSX.Element {
  return (
    <>
      <div>
        <strong style={{ color: '#ffcf8a' }}>Not an AI-Lore project.</strong>{' '}
        <span style={folderStyle}>{folder}</span>
      </div>
      <div style={hintStyle}>
        Bootstrap it with your CLI AI of choice —{' '}
        <button
          type="button"
          style={linkStyle}
          data-testid="altered-link"
          onClick={() => void window.cockpit.openExternal(SDLC_URL)}
        >
          {SDLC_URL}
        </button>
        , then Reload.
      </div>
    </>
  );
}

function VersionTooOldMessage({
  folder,
  currentVersion,
  minimumVersion,
}: {
  folder: string;
  currentVersion: string | null;
  minimumVersion: string;
}): JSX.Element {
  const versionLabel = currentVersion ? `v${currentVersion}` : 'an older version';
  return (
    <>
      <div>
        <strong style={{ color: '#ffcf8a' }}>
          AI-Lore {versionLabel} — upgrade required.
        </strong>{' '}
        <span style={folderStyle}>{folder}</span>
      </div>
      <div style={hintStyle} data-testid="altered-version-hint">
        This cockpit needs v{minimumVersion} or newer. Run the upgrade playbook in the terminal
        below (your CLI AI will fetch{' '}
        <button
          type="button"
          style={linkStyle}
          data-testid="altered-link"
          onClick={() => void window.cockpit.openExternal(SDLC_URL)}
        >
          {SDLC_URL}
        </button>
        's `migration-from-v0.X.md`), then Reload.
      </div>
    </>
  );
}

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  margin: 0,
  background: '#0a0f17',
  color: '#dde3ea',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.7rem 1rem',
  background: '#2a2418',
  borderBottom: '1px solid #4a3f23',
};

const messageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
  fontSize: '0.85rem',
};

const folderStyle: React.CSSProperties = {
  color: '#9aa6b2',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
};

const hintStyle: React.CSSProperties = {
  color: '#9aa6b2',
  fontSize: '0.8rem',
};

const linkStyle: React.CSSProperties = {
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: '#5a9bd4',
  fontSize: '0.8rem',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const reloadStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.4rem 1rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: '#e6edf3',
  background: '#1c2c3e',
  border: '1px solid #2f4860',
  borderRadius: '5px',
  cursor: 'pointer',
};
