import type { JSX } from 'react';
import type { SpaceWindowResult } from '../../../../shared/ipc.js';
import type { SetupReadiness } from '../machine/useMachineCheck.js';
import { secondaryButtonStyle } from '../styles.js';

type Props = {
  /** Used in every `data-testid` and element id: `space-welcome`, `machine-check`. */
  idPrefix: string;
  /** Whether the machine check is ready, and the sentence that says why not. */
  readiness: SetupReadiness;
  /** True while a window request runs. */
  busy: boolean;
  /** Runs a window channel and keeps its error; `run` of `useWindowRequest`. */
  run: (request: () => Promise<SpaceWindowResult>) => Promise<void>;
};

type Entry = {
  id: 'create' | 'adopt' | 'open-by-address';
  label: string;
  description: string;
  request: () => Promise<SpaceWindowResult>;
};

const ENTRIES: readonly Entry[] = [
  {
    id: 'create',
    label: 'Create a Space',
    description:
      'A new Space: its repository and Project on GitHub, and its folder on this machine.',
    request: () => window.cockpit.spaceNavigate({ to: 'setup', start: 'new' }),
  },
  {
    id: 'adopt',
    label: 'Adopt a repository…',
    description:
      'Choose the folder of a git repository. Its screen offers to create a Space about it. The repository is cloned into the new Space, and the folder is left as it is.',
    request: () => window.cockpit.spaceOpenFolder({}),
  },
  {
    id: 'open-by-address',
    label: 'Open a Space by GitHub address',
    description: 'Clone a Space that exists on GitHub onto this machine, with its repositories.',
    request: () => window.cockpit.spaceNavigate({ to: 'setup', start: 'from-address' }),
  },
];

/**
 * The three entries that lead to setup: create a Space, adopt a repository,
 * open a Space by its GitHub address. The welcome screen and the machine check
 * screen both show them.
 *
 * While the machine check is not ready the entries do nothing, and the reason
 * is written below them. They are marked with `aria-disabled` and not with
 * `disabled`, so that the keyboard still reaches them and a screen reader
 * reads the reason, which each entry names with `aria-describedby`.
 *
 * Adopting starts from a folder, and main opens no path on this screen's word.
 * The entry asks main for the folder dialog; detection then shows the screen
 * of a plain git repository, which carries the offer to create a Space about it.
 */
export function SetupEntries({ idPrefix, readiness, busy, run }: Props): JSX.Element {
  const reasonId = `${idPrefix}-setup-reason`;
  const unavailable = !readiness.ready || busy;
  return (
    <section style={sectionStyle} aria-labelledby={`${idPrefix}-setup-heading`}>
      <h2 id={`${idPrefix}-setup-heading`} style={headingStyle}>
        Set up a Space
      </h2>
      <ul style={listStyle}>
        {ENTRIES.map((entry) => (
          <li key={entry.id} style={itemStyle}>
            <button
              type="button"
              style={unavailable ? unavailableButtonStyle : entryButtonStyle}
              aria-disabled={unavailable}
              aria-describedby={
                readiness.ready
                  ? `${idPrefix}-${entry.id}-description`
                  : `${idPrefix}-${entry.id}-description ${reasonId}`
              }
              data-testid={`${idPrefix}-${entry.id}`}
              onClick={() => {
                if (!unavailable) void run(entry.request);
              }}
            >
              {entry.label}
            </button>
            <span id={`${idPrefix}-${entry.id}-description`} style={descriptionStyle}>
              {entry.description}
            </span>
          </li>
        ))}
      </ul>
      {readiness.reason !== null && (
        <p id={reasonId} style={reasonStyle} data-testid={reasonId}>
          {readiness.reason}
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

const entryButtonStyle: React.CSSProperties = { ...secondaryButtonStyle };

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
