import { type JSX, useEffect, useRef, useState } from 'react';
import type {
  MachineCheckReport,
  RecentSpace,
  SetUpReadiness,
  SpaceInitOf,
} from '../../../../shared/ipc.js';
import { useMachineCheck } from '../machine/useMachineCheck.js';
import {
  cardStyle,
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';
import { SetupEntries } from './SetupEntries.js';

type Props = { init: SpaceInitOf<'space-welcome'> };

/** "5 minus the number of distinct item groups in `left`", counting `gh` and `github` as one. */
function readyCount(setUp: SetUpReadiness): number {
  const groups = new Set(setUp.left.map((item) => (item.id === 'gh' ? 'github' : item.id)));
  return 5 - groups.size;
}

/** "✓ This computer is set up: GitHub …" once ready; empty until then. */
function readySentence(report: MachineCheckReport | null): string {
  if (report === null || !report.setUp.ready) return '';
  return `✓ This computer is set up: GitHub ${report.check.github.account ?? ''}, Claude Code signed in, Spaces in ${report.spacesFolder.value ?? ''}.`;
}

/**
 * The 1.0 welcome screen: open a folder, the three entries that lead to setup
 * (New Space, Space from GitHub, Space from a repository on this computer),
 * the state of this computer's setup, and the recents of Spaces.
 *
 * At launch (`init.checkOnLaunch`), a report that is not ready moves the
 * window to Set up this computer once; going Back to this screen does not
 * move again. "Open a folder…" asks main for the system's folder dialog and
 * sends no path except that of a recent Space, which main checks against its
 * own list.
 */
export function SpaceWelcomeScreen({ init }: Props): JSX.Element {
  const { run, busy, error } = useWindowRequest();
  const view = useMachineCheck({ freshOnMount: false });
  const [recents, setRecents] = useState<RecentSpace[]>(init.recents);
  const message = error ?? init.notice ?? null;
  const { report } = view;

  const movedOnLaunch = useRef(false);
  useEffect(() => {
    if (!init.checkOnLaunch || movedOnLaunch.current || report === null) return;
    if (report.setUp.ready) return;
    movedOnLaunch.current = true;
    void run(() => window.cockpit.spaceNavigate({ to: 'machine-check' }));
  }, [init.checkOnLaunch, report, run]);

  const removeRecent = async (path: string): Promise<void> => {
    try {
      setRecents(await window.cockpit.spaceRecentsRemove({ path }));
    } catch {
      // The list stays as it is; the next welcome screen reads it from main again.
    }
  };

  const ready = report?.setUp.ready ?? false;

  return (
    <main style={screenStyle} data-testid="space-welcome" aria-labelledby="space-welcome-title">
      <div style={columnStyle}>
        <h1 id="space-welcome-title" style={titleStyle}>
          AI-Lore
        </h1>

        {message !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="space-welcome-error">
            {message}
          </p>
        )}

        {report === null ? (
          <div style={cardStyle} data-testid="space-welcome-setup-card">
            <h2 style={cardHeadingStyle}>Set up this computer</h2>
            <p style={cardTextStyle}>Checking this computer…</p>
          </div>
        ) : (
          !report.setUp.ready && (
            <div style={cardStyle} data-testid="space-welcome-setup-card">
              <h2 style={cardHeadingStyle}>Set up this computer</h2>
              <p style={cardTextStyle}>
                AI-Lore needs Git, Python 3, a GitHub sign-in, Claude Code and a Spaces folder
                before it can create a Space. {readyCount(report.setUp)} of 5 are ready.
              </p>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={busy}
                data-testid="space-welcome-continue-setup"
                onClick={() =>
                  void run(() => window.cockpit.spaceNavigate({ to: 'machine-check' }))
                }
              >
                Continue setup
              </button>
            </div>
          )
        )}

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

        <SetupEntries ready={ready} primaryFirst={recents.length === 0} busy={busy} run={run} />

        <output
          style={machineStatusStyle}
          data-testid="space-welcome-machine-status"
          data-ready={report === null ? 'unknown' : String(report.setUp.ready)}
        >
          {readySentence(report)}
        </output>
        {ready && (
          <button
            type="button"
            style={linkButtonStyle}
            data-testid="space-welcome-change-setup"
            onClick={() => void run(() => window.cockpit.spaceNavigate({ to: 'machine-check' }))}
          >
            Change…
          </button>
        )}

        <div style={openRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
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

const cardHeadingStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };

const cardTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
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

const machineStatusStyle: React.CSSProperties = { fontSize: '0.85rem' };

const linkButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-link)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

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
