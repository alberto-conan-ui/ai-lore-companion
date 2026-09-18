import { type JSX, useState } from 'react';
import type { RecentSpace, SpaceInitOf } from '../../../../shared/ipc.js';
import { setupReadiness, useMachineCheck } from '../machine/useMachineCheck.js';
import {
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';
import { SetupEntries } from './SetupEntries.js';

type Props = { init: SpaceInitOf<'space-welcome'> };

/**
 * The 1.0 welcome screen: open a folder, the three entries that lead to setup
 * (create a Space, adopt a repository, open a Space by its GitHub address),
 * the state of the machine check, and the recents of Spaces.
 *
 * "Open a folder…" asks main for the system's folder dialog. Main runs
 * detection on the chosen folder and shows what it is: a Space opens in the
 * Space window, an AI-Lore project of v0.8 or older opens the migration
 * screen, and any other folder opens the not-a-Space screen. This screen sends
 * no path except that of a recent Space, which main checks against its own list.
 *
 * The three setup entries do nothing while the machine check is not ready, and
 * the reason is written below them. `init.notice` is the reason a launch
 * folder was not opened.
 */
export function SpaceWelcomeScreen({ init }: Props): JSX.Element {
  const { run, busy, error } = useWindowRequest();
  const view = useMachineCheck({ freshOnMount: false });
  const [recents, setRecents] = useState<RecentSpace[]>(init.recents);
  const message = error ?? init.notice ?? null;
  const { report, checking } = view;

  const removeRecent = async (path: string): Promise<void> => {
    try {
      setRecents(await window.cockpit.spaceRecentsRemove({ path }));
    } catch {
      // The list stays as it is; the next welcome screen reads it from main again.
    }
  };

  return (
    <main style={screenStyle} data-testid="space-welcome" aria-labelledby="space-welcome-title">
      <div style={columnStyle}>
        <h1 id="space-welcome-title" style={titleStyle}>
          AI-Lore
        </h1>
        <p style={sentenceStyle}>Open a Space, or set one up.</p>

        {message !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="space-welcome-error">
            {message}
          </p>
        )}

        <div style={openRowStyle}>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={busy}
            aria-describedby="space-welcome-open-description"
            data-testid="space-welcome-open"
            onClick={() => void run(() => window.cockpit.spaceOpenFolder({}))}
          >
            Open a folder…
          </button>
          <span id="space-welcome-open-description" style={descriptionStyle}>
            A Space opens in its window. An AI-Lore project of v0.8 or older opens the migration
            screen. Any other folder opens a screen that says what it is.
          </span>
        </div>

        <SetupEntries
          idPrefix="space-welcome"
          readiness={setupReadiness(view)}
          busy={busy}
          run={run}
        />

        <section style={sectionStyle} aria-labelledby="space-welcome-machine-heading">
          <h2 id="space-welcome-machine-heading" style={headingStyle}>
            Machine check
          </h2>
          <div style={machineRowStyle}>
            <output
              style={machineStatusStyle}
              data-testid="space-welcome-machine-status"
              data-ready={report === null ? 'unknown' : String(report.check.ready)}
            >
              {report === null
                ? checking
                  ? 'Checking the machine…'
                  : 'Machine check: not run.'
                : report.check.ready
                  ? '✓ Machine check: ready.'
                  : '✗ Machine check: not ready.'}
            </output>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={busy}
              data-testid="space-welcome-machine-check"
              onClick={() => void run(() => window.cockpit.spaceNavigate({ to: 'machine-check' }))}
            >
              Open the machine check
            </button>
          </div>
        </section>

        {recents.length > 0 && (
          <section style={sectionStyle} aria-labelledby="space-welcome-recents-heading">
            <h2 id="space-welcome-recents-heading" style={headingStyle}>
              Recent Spaces
            </h2>
            <ul style={recentsListStyle} data-testid="space-welcome-recents">
              {recents.map((recent) => (
                <li key={recent.path} style={recentRowStyle}>
                  <button
                    type="button"
                    style={recentButtonStyle}
                    disabled={busy}
                    data-testid="space-welcome-recent"
                    onClick={() =>
                      void run(() => window.cockpit.spaceOpenFolder({ folder: recent.path }))
                    }
                  >
                    <span style={recentNameStyle}>{recent.name}</span>
                    <span style={folderPathStyle}>{recent.path}</span>
                  </button>
                  <button
                    type="button"
                    style={removeButtonStyle}
                    aria-label={`Remove ${recent.name} from the recent Spaces`}
                    data-testid="space-welcome-recent-remove"
                    onClick={() => void removeRecent(recent.path)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

const screenStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  height: '100vh',
  width: '100vw',
  margin: 0,
  overflowY: 'auto',
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const columnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  width: '100%',
  maxWidth: '38rem',
  height: 'max-content',
  padding: '2rem 1.5rem',
  boxSizing: 'border-box',
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '1.3rem', fontWeight: 600 };

const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: 'var(--color-text-secondary)',
};

const openRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.3rem',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  width: '100%',
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-muted)',
};

const machineRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
  flexWrap: 'wrap',
};

const machineStatusStyle: React.CSSProperties = { fontSize: '0.85rem' };

const recentsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const recentRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: '0.4rem',
};

const recentButtonStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  minWidth: 0,
  padding: '0.45rem 0.7rem',
  textAlign: 'left',
  color: 'var(--color-text)',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
  cursor: 'pointer',
};

const recentNameStyle: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 600 };

const removeButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.2rem 0.6rem',
  fontSize: '0.75rem',
};
