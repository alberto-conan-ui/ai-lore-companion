import type { JSX } from 'react';
import { type StateTagKind, primaryButtonStyle, rowCardStyle, stateTagStyle } from '../styles.js';

const MONOSPACE = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The mark shown before a state word. State is told by the mark and the word, never colour alone. */
function stateMark(kind: StateTagKind): string {
  switch (kind) {
    case 'ready':
      return '✓';
    case 'action':
      return '!';
    case 'failed':
      return '✗';
    case 'muted':
      return '·';
    default:
      return '';
  }
}

export type StatusRowAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

type Props = {
  /** Used as the row's own `data-testid`, and the prefix of every id inside it. */
  testId: string;
  name: string;
  /** `Required`, `Optional`, or another plain tag; `null` for none. */
  tag: string | null;
  purpose: string;
  stateWord: string;
  stateKind: StateTagKind;
  /** Muted text beside the state, such as a version; `null` for none. */
  detail?: string | null;
  action: StatusRowAction | null;
  /** Shown as `Runs: <command line>` in monospace under the row, or `null`. */
  commandLine?: string | null;
  note?: string | null;
};

/**
 * One row of Set up this computer: a name and its tag, a one-line purpose, a
 * state (mark and word, never colour alone), one action button, and an
 * optional command line and note. Shared by the Tools and GitHub sections.
 */
export function StatusRow({
  testId,
  name,
  tag,
  purpose,
  stateWord,
  stateKind,
  detail = null,
  action,
  commandLine = null,
  note = null,
}: Props): JSX.Element {
  return (
    <div style={rowCardStyle} data-testid={testId}>
      <div style={headStyle}>
        <div style={nameGroupStyle}>
          <span style={nameStyle}>{name}</span>
          {tag !== null && <span style={tagStyle}>{tag}</span>}
        </div>
        <div style={stateGroupStyle}>
          <span style={stateTagStyle(stateKind)} data-testid={`${testId}-state`}>
            <span aria-hidden="true">{stateMark(stateKind)} </span>
            {stateWord}
          </span>
          {detail !== null && <span style={detailStyle}>{detail}</span>}
        </div>
        {action !== null && (
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={action.disabled}
            title={action.title}
            data-testid={`${testId}-action`}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      <p style={purposeStyle}>{purpose}</p>
      {commandLine !== null && (
        <code style={commandStyle} data-testid={`${testId}-command`}>
          Runs: {commandLine}
        </code>
      )}
      {note !== null && (
        <p style={noteStyle} data-testid={`${testId}-note`}>
          {note}
        </p>
      )}
    </div>
  );
}

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
  flexWrap: 'wrap',
};

const nameGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
};

const nameStyle: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 600 };

const tagStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-muted)',
};

const stateGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  marginLeft: 'auto',
};

const detailStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--color-text-muted)' };

const purposeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: 'var(--color-text-secondary)',
};

const commandStyle: React.CSSProperties = {
  fontFamily: MONOSPACE,
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
  wordBreak: 'break-all',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
};
