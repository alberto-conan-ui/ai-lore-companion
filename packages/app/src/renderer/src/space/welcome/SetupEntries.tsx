import type { JSX } from 'react';
import type { SpaceWindowResult } from '../../../../shared/ipc.js';
import { primaryButtonStyle, secondaryButtonStyle } from '../styles.js';

type Props = {
  /** Whether Set up this computer is ready; while it is not, the entries do nothing. */
  ready: boolean;
  /** True on a first launch with no recent Spaces: New Space then uses the primary style. */
  primaryFirst: boolean;
  /** True while a window request runs. */
  busy: boolean;
  /** Runs a window channel and keeps its error; `run` of `useWindowRequest`. */
  run: (request: () => Promise<SpaceWindowResult>) => Promise<void>;
};

type Entry = {
  id: 'create' | 'open-address' | 'from-repository';
  label: string;
  description: string;
  start: 'new' | 'from-address' | 'from-repository';
};

const ENTRIES: readonly Entry[] = [
  {
    id: 'create',
    label: 'New Space',
    description: 'Creates a Space on GitHub and in a folder on this computer.',
    start: 'new',
  },
  {
    id: 'open-address',
    label: 'Space from GitHub',
    description: 'Copies an existing Space from GitHub to this computer.',
    start: 'from-address',
  },
  {
    id: 'from-repository',
    label: 'Space from a repository on this computer',
    description:
      "Creates a new Space that includes a repository you already have. The repository's folder is left as it is.",
    start: 'from-repository',
  },
];

/**
 * The three entries the welcome screen offers to start a Space: New Space,
 * Space from GitHub, and Space from a repository on this computer. Each
 * navigates to the setup screen with the matching start. While Set up this
 * computer is not ready, the entries are marked `aria-disabled` (reachable by
 * keyboard, so a screen reader reads the reason) and a line under them leads
 * to setup.
 */
export function SetupEntries({ ready, primaryFirst, busy, run }: Props): JSX.Element {
  const unavailable = !ready || busy;
  return (
    <section style={sectionStyle} aria-labelledby="space-welcome-start-heading">
      <h2 id="space-welcome-start-heading" style={headingStyle}>
        Start
      </h2>
      <ul style={listStyle}>
        {ENTRIES.map((entry) => (
          <li key={entry.id} style={itemStyle}>
            <button
              type="button"
              style={
                entry.id === 'create' && primaryFirst
                  ? primaryButtonStyle
                  : unavailable
                    ? unavailableButtonStyle
                    : secondaryButtonStyle
              }
              aria-disabled={unavailable}
              data-testid={`space-welcome-${entry.id}`}
              onClick={() => {
                if (unavailable) return;
                void run(() => window.cockpit.spaceNavigate({ to: 'setup', start: entry.start }));
              }}
            >
              {entry.label}
            </button>
            <span style={descriptionStyle}>{entry.description}</span>
          </li>
        ))}
      </ul>
      {!ready && (
        <p style={reasonStyle} data-testid="space-welcome-setup-reason">
          Finish setting up this computer first.{' '}
          <button
            type="button"
            style={linkButtonStyle}
            data-testid="space-welcome-setup-reason-continue"
            onClick={() => void run(() => window.cockpit.spaceNavigate({ to: 'machine-check' }))}
          >
            Continue setup
          </button>
        </p>
      )}
    </section>
  );
}

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

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.2rem',
};

const unavailableButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: 'var(--color-text-muted)',
  border: '1px dashed var(--color-border-strong)',
  cursor: 'not-allowed',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const reasonStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-warn-fg)',
};

const linkButtonStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-link)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};
