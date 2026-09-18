import type { JSX } from 'react';
import type { StepState } from '../../../../shared/ipc.js';
import { errorAreaStyle, primaryButtonStyle, secondaryButtonStyle } from '../styles.js';
import type { SetupFlowView } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

/** A step with no event yet in this run. */
type RowState = StepState | 'waiting';

/** A mark beside the state's word, so the state is not told by colour alone. */
const MARKS: Record<RowState, string> = {
  waiting: '·',
  checking: '…',
  skipped: '–',
  running: '…',
  done: '✓',
  failed: '✗',
};

const COLOURS: Record<RowState, string> = {
  waiting: 'var(--color-text-muted)',
  checking: 'var(--color-text-secondary)',
  skipped: 'var(--color-text-secondary)',
  running: 'var(--color-text-bright)',
  done: 'var(--color-success-fg)',
  failed: 'var(--color-danger-fg)',
};

type Row = { stepId: string; title: string; state: RowState; message: string | null };

/** The steps of the run in order: those of the plan, then any the run reported that the plan did not list. */
function rowsOf(view: SetupFlowView): Row[] {
  const rows: Row[] = (view.plan?.plan.steps ?? []).map((step) => ({
    stepId: step.stepId,
    title: step.title,
    state: 'waiting',
    message: null,
  }));
  const events = Object.values(view.progress).sort((a, b) => a.index - b.index);
  for (const event of events) {
    const row = rows.find((candidate) => candidate.stepId === event.stepId);
    if (row) {
      row.state = event.state;
      row.message = event.message;
      row.title = event.title;
    } else {
      rows.push({
        stepId: event.stepId,
        title: event.title,
        state: event.state,
        message: event.message,
      });
    }
  }
  return rows;
}

/**
 * The run: each step with its state in words, a failed step with its literal
 * sentence and "Run again", which repeats nothing that is done; stop; and on
 * success the steps left to do by hand on GitHub, the repositories found when
 * a Space was opened by address, and the button that opens the new Space.
 */
export function SetupProgressView({ view }: Props): JSX.Element {
  const rows = rowsOf(view);
  const { stage, runError, report } = view;
  const current = rows.find((row) => row.state === 'running' || row.state === 'checking');

  return (
    <section
      style={sectionStyle}
      aria-labelledby="setup-progress-title"
      data-testid="setup-progress"
    >
      <h2 id="setup-progress-title" style={titleStyle}>
        The run
      </h2>
      <output style={statusStyle} data-testid="setup-status" data-stage={stage}>
        {statusSentence(view, current)}
      </output>
      <ol style={listStyle} data-testid="setup-steps">
        {rows.map((row) => (
          <li
            key={row.stepId}
            style={rowStyle}
            data-testid={`setup-step-${row.stepId}`}
            data-state={row.state}
          >
            <span
              style={{ ...stateStyle, color: COLOURS[row.state] }}
              data-testid={`setup-step-state-${row.stepId}`}
            >
              {MARKS[row.state]} {row.state}
            </span>
            <span>{row.title}</span>
            {row.state === 'failed' && row.message !== null && (
              <span style={messageStyle} data-testid={`setup-step-message-${row.stepId}`}>
                {row.message}
              </span>
            )}
          </li>
        ))}
      </ol>

      {stage === 'running' && (
        <div style={actionsStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={view.stopping}
            data-testid="setup-stop"
            onClick={() => void view.stop()}
          >
            {view.stopping ? 'Stopping after this step…' : 'Stop'}
          </button>
          <span style={hintStyle}>
            Closing this window stops the run after the current step. Running again with the same
            form continues it.
          </span>
        </div>
      )}

      {(stage === 'failed' || stage === 'stopped') && runError !== null && (
        <div
          style={failureStyle}
          role="alert"
          data-testid="setup-run-error"
          data-kind={runError.kind}
        >
          {runError.title !== null && (
            <p style={errorAreaStyle}>
              {stage === 'stopped' ? 'Stopped before' : 'Failed at'}: {runError.title}
            </p>
          )}
          <p style={errorAreaStyle}>{runError.message}</p>
          {runError.problems.length > 0 && (
            <ul style={problemListStyle}>
              {runError.problems.map((problem) => (
                <li key={`${problem.field}:${problem.message}`}>
                  {problem.field}: {problem.message}
                </li>
              ))}
            </ul>
          )}
          <p style={hintStyle}>
            What was done is kept. Running again skips every step that is already done.
          </p>
          <div style={actionsStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              data-testid="setup-run-again"
              onClick={() => void view.runAgain()}
            >
              Run again
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              data-testid="setup-back"
              onClick={view.backToForm}
            >
              Back to the form
            </button>
          </div>
        </div>
      )}

      {stage === 'finished' && report !== null && <Finished view={view} />}
    </section>
  );
}

function statusSentence(view: SetupFlowView, current: Row | undefined): string {
  switch (view.stage) {
    case 'running':
      return current === undefined ? 'Running.' : `Running: ${current.title} — ${current.state}.`;
    case 'stopped':
      return 'Stopped. Run again to continue.';
    case 'failed':
      return 'A step failed. Run again to continue.';
    case 'finished':
      return 'Done.';
    default:
      return '';
  }
}

function Finished({ view }: Props): JSX.Element | null {
  const { report } = view;
  if (report === null) return null;
  const notCloned = report.repositories.filter((repository) => !repository.cloned);
  return (
    <div style={finishedStyle} data-testid="setup-finished">
      {report.byHand.length > 0 && (
        <div data-testid="setup-by-hand">
          <h3 style={subtitleStyle}>Left to do by hand on GitHub</h3>
          <p style={hintStyle}>
            GitHub's API cannot make these settings. Do them on the Project's page.
          </p>
          <ol style={problemListStyle}>
            {report.byHand.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ol>
        </div>
      )}
      {view.flow === 'open' && notCloned.length > 0 && (
        <fieldset style={fieldsetStyle} data-testid="setup-repositories-found">
          <legend style={subtitleStyle}>
            repositories — found in the Space's manifest, not cloned yet
          </legend>
          {notCloned.map((repository) => (
            <label key={repository.name} style={checkStyle}>
              <input
                type="checkbox"
                data-testid={`setup-found-${repository.name}`}
                checked={view.confirmed.includes(repository.name)}
                onChange={() => view.toggleConfirmed(repository.name)}
              />
              {repository.name} ({repository.github})
            </label>
          ))}
          <div>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={view.confirmed.length === 0}
              data-testid="setup-clone-confirmed"
              onClick={() => void view.cloneConfirmed()}
            >
              Clone the ticked repositories
            </button>
          </div>
        </fieldset>
      )}
      <div>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={view.busy}
          data-testid="setup-open-space"
          onClick={() => void view.openSpace()}
        >
          Open the Space
        </button>
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 600 };
const statusStyle: React.CSSProperties = { fontSize: '0.85rem' };
const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  fontSize: '0.85rem',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '6.5rem 1fr',
  columnGap: '0.6rem',
  rowGap: '0.15rem',
};
const stateStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
};
const messageStyle: React.CSSProperties = {
  gridColumn: '2',
  color: 'var(--color-danger-fg)',
  wordBreak: 'break-word',
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };
const failureStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};
const problemListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.2rem',
  fontSize: '0.85rem',
};
const finishedStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};
const fieldsetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  margin: 0,
  padding: '0.6rem',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
};
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.85rem',
};
