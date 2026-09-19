import type { JSX } from 'react';
import {
  MIGRATION_ISSUES_STEP_ID,
  MIGRATION_VERIFY_STEP_ID,
  type MigrationIssueProgress,
  type StepState,
} from '../../../../shared/ipc.js';
import {
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import type { MigrationFlowView } from './useMigrationFlow.js';

type Props = { view: MigrationFlowView };

/** A step with no event yet in this run. */
type RowState = StepState | 'waiting';

/** A mark beside the state's word, so the state is not told by colour alone. */
const MARKS: Record<RowState, string> = {
  waiting: '·',
  checking: '…',
  skipped: '✓',
  running: '…',
  done: '✓',
  failed: '✗',
};

/** The word shown beside the mark. Every other state is its own name. */
const WORDS: Record<RowState, string> = {
  waiting: 'waiting',
  checking: 'checking',
  skipped: 'Already done',
  running: 'running',
  done: 'done',
  failed: 'failed',
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
function rowsOf(view: MigrationFlowView): Row[] {
  const rows: Row[] = (view.plan?.plan.steps ?? []).map((step) => ({
    stepId: step.stepId,
    title: `${step.number}. ${step.title}`,
    state: 'waiting',
    message: null,
  }));
  const events = Object.values(view.progress).sort((a, b) => a.index - b.index);
  for (const event of events) {
    const row = rows.find((candidate) => candidate.stepId === event.stepId);
    if (row) {
      row.state = event.state;
      row.message = event.message;
    } else {
      rows.push({
        stepId: event.stepId,
        title: `${event.index + 1}. ${event.title}`,
        state: event.state,
        message: event.message,
      });
    }
  }
  return rows;
}

/**
 * The run: each of the thirteen steps with its state in words, each issue of
 * step 11 with its state, a failed step with its literal sentence and "Run
 * again", which continues and repeats nothing that is done; stop; and at the
 * end the verification result of step 13 and "Open the Space".
 */
export function MigrationProgressView({ view }: Props): JSX.Element {
  const rows = rowsOf(view);
  const { stage, runError, report } = view;
  const current = rows.find((row) => row.state === 'running' || row.state === 'checking');
  const issues = Object.values(view.issueProgress).sort((a, b) => a.index - b.index);
  const failedTitle =
    runError?.stepId == null
      ? null
      : (rows.find((row) => row.stepId === runError.stepId)?.title ?? runError.stepId);

  return (
    <section
      style={sectionStyle}
      aria-labelledby="migration-progress-title"
      data-testid="migration-progress"
    >
      <h2 id="migration-progress-title" style={titleStyle}>
        The run
      </h2>
      <output style={statusStyle} data-testid="migration-status" data-stage={stage}>
        {statusSentence(stage, current)}
      </output>
      <ol style={listStyle} data-testid="migration-steps">
        {rows.map((row) => (
          <li
            key={row.stepId}
            style={rowStyle}
            data-testid={`migration-step-${row.stepId}`}
            data-state={row.state}
          >
            <span
              style={{ ...stateStyle, color: COLOURS[row.state] }}
              data-testid={`migration-step-state-${row.stepId}`}
            >
              {MARKS[row.state]} {WORDS[row.state]}
            </span>
            <span>{row.title}</span>
            {row.state === 'failed' && row.message !== null && (
              <span style={messageStyle} data-testid={`migration-step-message-${row.stepId}`}>
                {row.message}
              </span>
            )}
            {row.stepId === MIGRATION_ISSUES_STEP_ID && issues.length > 0 && (
              <IssueList issues={issues} />
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
            data-testid="migration-stop"
            onClick={() => void view.stop()}
          >
            {view.stopping ? 'Stopping after this step…' : 'Stop'}
          </button>
          <span style={hintStyle}>
            Closing this window stops the run after the current step. Opening this folder again and
            confirming the same plan continues it.
          </span>
        </div>
      )}

      {(stage === 'failed' || stage === 'stopped') && runError !== null && (
        <div
          style={failureStyle}
          role="alert"
          data-testid="migration-run-error"
          data-kind={runError.kind}
        >
          {failedTitle !== null && (
            <p style={errorAreaStyle}>
              {stage === 'stopped' ? 'Stopped before' : 'Failed at'}: {failedTitle}
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
            What was done is kept. Running again skips every step that is already done and creates
            no issue twice.
          </p>
          <div style={actionsStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              data-testid="migration-run-again"
              onClick={() => void view.runAgain()}
            >
              Run again
            </button>
          </div>
        </div>
      )}

      {stage === 'finished' && report !== null && <Finished view={view} />}
    </section>
  );
}

const ISSUE_MARKS: Record<MigrationIssueProgress['state'], string> = {
  found: '–',
  created: '…',
  waiting: '…',
  completed: '✓',
};

function IssueList({ issues }: { issues: MigrationIssueProgress[] }): JSX.Element {
  const [first] = issues;
  const total = first?.total ?? issues.length;
  const finished = issues.filter(
    (issue) => issue.state === 'completed' || issue.state === 'found',
  ).length;
  return (
    <div style={issuesStyle} data-testid="migration-issue-progress">
      <span style={hintStyle} data-testid="migration-issue-count">
        {finished} of {total} issues
      </span>
      <ol style={issueListStyle}>
        {issues.map((issue) => (
          <li
            key={issue.key}
            data-testid={`migration-issue-${issue.index}`}
            data-state={issue.state}
          >
            <span style={stateStyle}>
              {ISSUE_MARKS[issue.state]} {issue.state}
            </span>{' '}
            {issue.title}
            {issue.issue !== null && ` (${issue.issue.repository}#${issue.issue.number})`}
            {issue.state === 'waiting' && <span style={hintStyle}> — {issue.message}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function statusSentence(stage: MigrationFlowView['stage'], current: Row | undefined): string {
  switch (stage) {
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
  const verify = view.plan?.plan.steps.find((step) => step.stepId === MIGRATION_VERIFY_STEP_ID);
  const verified = report.completed.includes(MIGRATION_VERIFY_STEP_ID);
  return (
    <div style={finishedStyle} data-testid="migration-finished">
      <p style={statusStyle}>
        The Space is at <span style={folderPathStyle}>{report.spaceRoot}</span>, and its repository
        is {report.repository}.
      </p>
      <div data-testid="migration-verification" data-passed={verified}>
        <h3 style={subtitleStyle}>verify — step 13</h3>
        <p style={statusStyle}>
          {verified ? 'The verification passed. It checked:' : 'The verification was not run.'}
        </p>
        {verified && verify !== undefined && (
          <ul style={problemListStyle}>
            {verify.lines.map((line) => (
              <li key={line.what}>{line.what}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={view.busy}
          data-testid="migration-open-space"
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
const statusStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem' };
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
const issuesStyle: React.CSSProperties = {
  gridColumn: '2',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};
const issueListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.1rem',
  fontSize: '0.8rem',
  maxHeight: '12rem',
  overflowY: 'auto',
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
