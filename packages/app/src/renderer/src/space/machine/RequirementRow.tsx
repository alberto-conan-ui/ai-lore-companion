import { type JSX, useState } from 'react';
import type {
  EngineCheck,
  MachineCheckState,
  MachineRequirementCheck,
} from '../../../../shared/ipc.js';
import { secondaryButtonStyle } from '../styles.js';

type Props = {
  requirement: MachineRequirementCheck;
  /** The engines of the registry, for the `engine` row; empty for the other rows. */
  engines: readonly EngineCheck[];
};

/** The name of a state as the screen writes it: the state's own name, unchanged. */
export function stateText(state: MachineCheckState): string {
  return state.kind;
}

/**
 * The mark before a state's name. The state is told by the mark and the name,
 * not by the colour: `✓` fine, `?` undetermined, `✗` any other state.
 */
export function stateMark(state: MachineCheckState): string {
  if (state.kind === 'fine') return '✓';
  if (state.kind === 'undetermined') return '?';
  return '✗';
}

/** What the check found beside the state: the version, the lowest accepted version, the missing scope. */
export function foundText(state: MachineCheckState): string | null {
  switch (state.kind) {
    case 'fine':
      return state.version === null ? 'version not reported' : `version ${state.version}`;
    case 'too-old':
      return `version ${state.version}, lowest accepted ${state.minimum}`;
    case 'missing-scope':
      return `scope ${state.scope}`;
    default:
      return null;
  }
}

function stateColor(state: MachineCheckState): string {
  if (state.kind === 'fine') return 'var(--color-success-fg)';
  if (state.kind === 'undetermined') return 'var(--color-warn-fg)';
  return 'var(--color-danger-fg)';
}

/**
 * One requirement of the machine check: its id, the command that was looked
 * for, its state, what was found, the guidance sentence, and the literal
 * command with a button that copies it. The sentence and the command are
 * core's and are shown as they arrive.
 */
export function RequirementRow({ requirement, engines }: Props): JSX.Element {
  const { id, binary, state, guidance, command } = requirement;
  const [copied, setCopied] = useState(false);
  const found = foundText(state);
  const nameId = `machine-check-${id}-name`;

  return (
    <li
      style={rowStyle}
      aria-labelledby={nameId}
      data-testid={`machine-check-row-${id}`}
      data-state={state.kind}
    >
      <div style={headStyle}>
        <h2 id={nameId} style={nameStyle}>
          {id}
        </h2>
        <span style={binaryStyle} data-testid={`machine-check-binary-${id}`}>
          {binary === null ? 'no engine in the registry' : `command ${binary}`}
        </span>
        <span
          style={{ ...stateStyle, color: stateColor(state) }}
          data-testid={`machine-check-state-${id}`}
        >
          <span aria-hidden="true">{stateMark(state)} </span>
          {stateText(state)}
        </span>
      </div>
      {found !== null && (
        <p style={foundStyle} data-testid={`machine-check-found-${id}`}>
          {found}
        </p>
      )}
      {guidance !== null && (
        <p style={guidanceStyle} data-testid={`machine-check-guidance-${id}`}>
          {guidance}
        </p>
      )}
      {command !== null && (
        <div style={commandRowStyle}>
          <code style={commandStyle} data-testid={`machine-check-command-${id}`}>
            {command}
          </code>
          <button
            type="button"
            style={copyButtonStyle}
            aria-label={`Copy the command ${command}`}
            data-testid={`machine-check-copy-${id}`}
            onClick={() => {
              window.cockpit.copyText(command);
              setCopied(true);
            }}
          >
            Copy
          </button>
          <output style={copiedStyle}>{copied ? 'Copied.' : ''}</output>
        </div>
      )}
      {engines.length > 1 && (
        <ul
          style={enginesStyle}
          aria-label="Engines of the registry"
          data-testid="machine-check-engines"
        >
          {engines.map((engine) => (
            <li key={engine.engineId} data-testid={`machine-check-engine-${engine.engineId}`}>
              {engine.name}, command {engine.binary}:{' '}
              <span style={{ color: stateColor(engine.state) }}>
                <span aria-hidden="true">{stateMark(engine.state)} </span>
                {stateText(engine.state)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const MONOSPACE = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  padding: '0.7rem 0.8rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.7rem',
  flexWrap: 'wrap',
};

const nameStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: MONOSPACE,
  fontSize: '0.95rem',
  fontWeight: 600,
};

const binaryStyle: React.CSSProperties = {
  fontFamily: MONOSPACE,
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};

const stateStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: MONOSPACE,
  fontSize: '0.85rem',
  fontWeight: 600,
};

const foundStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const guidanceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text)',
  userSelect: 'text',
};

const commandRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const commandStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontFamily: MONOSPACE,
  fontSize: '0.8rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  userSelect: 'text',
  wordBreak: 'break-all',
};

const copyButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.2rem 0.6rem',
  fontSize: '0.75rem',
};

const copiedStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
};

const enginesStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.1rem',
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
