import type { JSX } from 'react';
import {
  MACHINE_REQUIREMENT_ORDER,
  type MachineCheckReport,
  type SpaceInitOf,
} from '../../../../shared/ipc.js';
import { errorAreaStyle, primaryButtonStyle, secondaryButtonStyle } from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';
import { SetupEntries } from '../welcome/SetupEntries.js';
import { RequirementRow, stateText } from './RequirementRow.js';
import { setupReadiness, useMachineCheck } from './useMachineCheck.js';

type Props = { init: SpaceInitOf<'machine-check'> };

/**
 * The machine check screen: the four requirements in fixed order (`git`, `gh`,
 * `engine`, `python3`), each with its state, the version found, the guidance
 * sentence and the literal command with a copy button; "Check again"; and the
 * overall result, ready or not ready.
 *
 * The companion checks the machine and guides. It installs nothing and signs
 * in nowhere: the Human Lead runs a command in a terminal of their own and
 * presses "Check again". The check runs in main; the sentences and commands
 * are core's and arrive in the report.
 *
 * While the check is not ready, create, adopt and open by address do nothing,
 * and the reason is written below them.
 */
export function MachineCheckScreen(_props: Props): JSX.Element {
  const view = useMachineCheck({ freshOnMount: true });
  const { run, busy, error } = useWindowRequest();
  const { report, checking } = view;

  return (
    <main style={screenStyle} data-testid="machine-check" aria-labelledby="machine-check-title">
      <div style={columnStyle}>
        <header style={headerStyle}>
          <div style={headerTextStyle}>
            <h1 id="machine-check-title" style={titleStyle}>
              Machine check
            </h1>
            <p style={sentenceStyle}>
              The companion checks that the machine has what a Space needs. It installs nothing. Run
              a command in a terminal, then check again.
            </p>
          </div>
          <div style={actionsStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={checking}
              data-testid="machine-check-again"
              onClick={view.checkAgain}
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={busy}
              data-testid="machine-check-back"
              onClick={() => void run(() => window.cockpit.spaceNavigate({ to: 'space-welcome' }))}
            >
              Back to welcome
            </button>
          </div>
        </header>

        {/* `output` has the status role: a screen reader reads the result when it changes. */}
        <output
          style={overallStyle(report)}
          data-testid="machine-check-overall"
          data-ready={report === null ? 'unknown' : String(report.check.ready)}
        >
          {overallText(report, checking)}
        </output>

        {view.error !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="machine-check-error">
            The machine check did not run. {view.error}
          </p>
        )}
        {error !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="machine-check-window-error">
            {error}
          </p>
        )}

        {report !== null && (
          <>
            <ol
              style={listStyle}
              aria-label="Requirements"
              aria-busy={checking}
              data-testid="machine-check-requirements"
            >
              {MACHINE_REQUIREMENT_ORDER.map((id) => {
                const requirement = report.check.requirements.find((entry) => entry.id === id);
                return requirement === undefined ? null : (
                  <RequirementRow
                    key={id}
                    requirement={requirement}
                    engines={id === 'engine' ? report.check.engines : []}
                  />
                );
              })}
            </ol>
            <p style={noteStyle} data-testid="machine-check-path-source">
              {report.pathSource === 'login-shell'
                ? 'The commands ran with the PATH of the login shell.'
                : 'The PATH of the login shell could not be read. The commands ran with the PATH of the app.'}{' '}
              Checked at {new Date(report.checkedAt).toLocaleTimeString()}.
            </p>
          </>
        )}

        <SetupEntries
          idPrefix="machine-check"
          readiness={setupReadiness(view)}
          busy={busy}
          run={run}
        />
      </div>
    </main>
  );
}

/** The overall sentence. The words `ready` and `not ready` are those of `MachineCheck.ready`. */
function overallText(report: MachineCheckReport | null, checking: boolean): string {
  if (report === null) return checking ? 'Checking the machine…' : 'Machine check: not run.';
  const suffix = checking ? ' Checking again…' : '';
  if (report.check.ready) return `✓ Machine check: ready. All four requirements are fine.${suffix}`;
  const notFine = report.check.requirements
    .filter((requirement) => requirement.state.kind !== 'fine')
    .map((requirement) => `${requirement.id} is ${stateText(requirement.state)}`);
  return `✗ Machine check: not ready. ${notFine.join(', ')}.${suffix}`;
}

function overallStyle(report: MachineCheckReport | null): React.CSSProperties {
  const color =
    report === null
      ? 'var(--color-text-secondary)'
      : report.check.ready
        ? 'var(--color-success-fg)'
        : 'var(--color-danger-fg)';
  return { margin: 0, fontSize: '0.95rem', fontWeight: 600, color };
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
  gap: '0.9rem',
  width: '100%',
  maxWidth: '46rem',
  padding: '1.5rem',
  boxSizing: 'border-box',
  height: 'max-content',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
};

const headerTextStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  minWidth: 0,
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '1.1rem', fontWeight: 600 };

const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text-secondary)',
};

const actionsStyle: React.CSSProperties = { display: 'flex', flexShrink: 0, gap: '0.5rem' };

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};
