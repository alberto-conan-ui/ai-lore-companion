import { type JSX, useEffect, useRef, useState } from 'react';
import { ALWAYS_RUN_STEP_IDS, type StepState } from '../../../../shared/ipc.js';
import { CommandPanel } from '../common/CommandPanel.js';
import {
  cardStyle,
  errorAreaStyle,
  hintStyle,
  primaryButtonStyle,
  resultLineStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { type SetupFlowView, basenameOf, formatElapsed } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

/** A step with no event yet in this run. */
type RowState = StepState | 'waiting';

const MARKS: Record<RowState, string> = {
  waiting: '·',
  checking: '…',
  running: '…',
  done: '✓',
  skipped: '✓',
  failed: '✗',
};

const WORDS: Record<RowState, string> = {
  waiting: 'Waiting',
  checking: 'Checking',
  running: 'Running',
  done: 'Done',
  skipped: 'Already done',
  failed: 'Failed',
};

const COLOURS: Record<RowState, string> = {
  waiting: 'var(--color-text-muted)',
  checking: 'var(--color-text-secondary)',
  running: 'var(--color-text-bright)',
  done: 'var(--color-success-fg)',
  skipped: 'var(--color-text-secondary)',
  failed: 'var(--color-danger-fg)',
};

type Row = { stepId: string; title: string; state: RowState; message: string | null };

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

function titleOf(view: SetupFlowView, stepId: string): string {
  return view.plan?.plan.steps.find((step) => step.stepId === stepId)?.title ?? stepId;
}

function nameOf(view: SetupFlowView): string {
  const root = view.report?.spaceRoot ?? view.plan?.plan.spaceRoot ?? '';
  return basenameOf(root);
}

function fixAction(
  view: SetupFlowView,
  kind: string,
): { label: string; onClick: () => void } | null {
  if (kind === 'github-missing-scope') {
    return {
      label: 'Fix and run again',
      onClick: () => view.fixAndRetry('github-add-project-scope'),
    };
  }
  if (kind === 'github-not-signed-in') {
    return { label: 'Fix and run again', onClick: () => view.fixAndRetry('github-sign-in') };
  }
  if (kind === 'machine-not-ready') {
    return {
      label: 'Fix and run again',
      onClick: () => void window.cockpit.spaceNavigate({ to: 'machine-check' }),
    };
  }
  return null;
}

/**
 * The run and its result (architecture document Part C, M9.9): each step in
 * words (never the raw state name), the current step with its own elapsed
 * time, and three result screens — finished, failed with a fix where one
 * exists, and stopped.
 */
export function SetupProgressView({ view }: Props): JSX.Element {
  const { stage } = view;
  const name = nameOf(view);
  if (stage === 'running') return <Running view={view} name={name} />;
  if (stage === 'finished' && view.report !== null) return <Finished view={view} name={name} />;
  if (stage === 'failed' && view.runError !== null) return <Failed view={view} name={name} />;
  return <Stopped view={view} name={name} />;
}

function Running({ view, name }: Props & { name: string }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const rows = rowsOf(view);
  const current = rows.find((row) => row.state === 'running' || row.state === 'checking');
  const startedAt = current === undefined ? undefined : view.stepStarts[current.stepId];
  const elapsed = startedAt === undefined ? 0 : now - startedAt;

  return (
    <section
      style={sectionStyle}
      aria-labelledby="setup-progress-title"
      data-testid="setup-running"
    >
      <h2 id="setup-progress-title" style={titleStyle}>
        Creating {name}
      </h2>
      {current !== undefined && (
        <p style={currentStepStyle} data-testid="setup-current-step">
          {current.title}… {formatElapsed(elapsed)}
        </p>
      )}
      <StepList rows={rows} />
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
        <span style={hintStyle}>Stops after the current step. What is done is kept.</span>
      </div>
    </section>
  );
}

function StepList({ rows }: { rows: Row[] }): JSX.Element {
  return (
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
            {MARKS[row.state]} {WORDS[row.state]}
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
  );
}

function Finished({ view, name }: Props & { name: string }): JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), []);
  const { report } = view;
  if (report === null) return null;
  const notCloned = report.repositories.filter((repository) => !repository.cloned);
  const repository = report.repository;
  const project = report.project;
  const completedNonAlways = report.completed.filter((id) => !ALWAYS_RUN_STEP_IDS.includes(id));
  const skippedNonAlways = report.skipped.filter((id) => !ALWAYS_RUN_STEP_IDS.includes(id));
  const summary =
    skippedNonAlways.length > 0
      ? `The Space ${name} had been started before. This run finished it: ${completedNonAlways
          .map((id) => titleOf(view, id))
          .join(', ')}.`
      : completedNonAlways.length === 0
        ? "Nothing was left to do. The Project's fields, labels and views were checked again."
        : null;

  return (
    <div style={finishedStyle} data-testid="setup-finished">
      <h2 id="setup-finished-title" ref={headingRef} tabIndex={-1} style={titleStyle}>
        The Space {name} is ready.
      </h2>
      <p style={resultLineStyle}>
        Folder: {report.spaceRoot}
        {repository !== null && (
          <>
            {' · '}
            <LinkButton onClick={() => window.cockpit.urlOpenExternal(repository.url)}>
              Repository: {repository.fullName} ↗
            </LinkButton>
          </>
        )}
        {project !== null && (
          <>
            {' · '}
            <LinkButton onClick={() => window.cockpit.urlOpenExternal(project.url)}>
              Project: {project.title} ↗
            </LinkButton>
          </>
        )}
      </p>
      {summary !== null && <p style={hintStyle}>{summary}</p>}

      <div>
        <button
          type="button"
          ref={buttonRef}
          style={primaryButtonStyle}
          disabled={view.busy}
          data-testid="setup-open-space"
          onClick={() => void view.openSpace()}
        >
          Open the Space
        </button>
      </div>

      {report.viewSettings.length > 0 && (
        <div style={cardStyle} data-testid="setup-by-hand">
          <h3 style={subtitleStyle}>Three settings to make on GitHub (two minutes, can wait)</h3>
          {report.viewSettings.map((setting, index) => {
            const url = setting.url;
            return (
              <div key={`${setting.view}:${setting.setting}`} style={byHandRowStyle}>
                <span style={resultLineStyle}>
                  In the view {setting.view}: {setting.setting}
                </span>
                {url !== null && (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    data-testid={`setup-by-hand-open-${index}`}
                    onClick={() => window.cockpit.urlOpenExternal(url)}
                  >
                    Open this view
                  </button>
                )}
              </div>
            );
          })}
          <p style={hintStyle}>
            GitHub does not allow apps to change these view settings. They do not block opening the
            Space.
          </p>
        </div>
      )}

      {view.flow === 'open' && notCloned.length > 0 && (
        <div style={cardStyle} data-testid="setup-repositories-found">
          <h3 style={subtitleStyle}>Repositories of this Space</h3>
          {notCloned.map((repository) => (
            <label key={repository.name} style={checkStyle}>
              <input
                type="checkbox"
                data-testid={`setup-found-${repository.name}`}
                checked={view.confirmed.includes(repository.name)}
                onChange={() => view.toggleConfirmed(repository.name)}
              />
              {repository.name} · {repository.github}
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
              Copy the ticked repositories
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Failed({ view, name }: Props & { name: string }): JSX.Element | null {
  const { runError } = view;
  if (runError === null) return null;
  const rows = rowsOf(view);
  const fix = fixAction(view, runError.kind);
  return (
    <div style={sectionStyle} data-testid="setup-failed" role="alert" data-kind={runError.kind}>
      <h2 style={titleStyle}>The Space {name} was not finished.</h2>
      {runError.title !== null && (
        <p style={errorAreaStyle}>
          Stopped at: {runError.title} — {runError.message}
        </p>
      )}
      <p style={hintStyle}>
        What was done is kept. Running again finishes the rest and does not repeat what is done.
      </p>
      <StepList rows={rows} />
      <div style={actionsStyle}>
        <button
          type="button"
          style={primaryButtonStyle}
          data-testid="setup-fix-and-run-again"
          onClick={fix !== null ? fix.onClick : () => void view.runAgain()}
        >
          {fix !== null ? fix.label : 'Run again'}
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          data-testid="setup-back-to-welcome"
          onClick={() => void window.cockpit.spaceNavigate({ to: 'space-welcome' })}
        >
          Back to the welcome screen
        </button>
      </div>
      {view.activeCommand !== null && (
        <CommandPanel
          commandId={view.activeCommand.commandId}
          commandLine={view.activeCommand.commandLine}
          onExit={view.onFixExit}
          onClose={view.closeFixCommand}
        />
      )}
    </div>
  );
}

function Stopped({ view, name }: Props & { name: string }): JSX.Element | null {
  const { runError } = view;
  const rows = rowsOf(view);
  return (
    <div style={sectionStyle} data-testid="setup-stopped">
      <h2 style={titleStyle}>Creating {name}</h2>
      {runError !== null && runError.title !== null && (
        <p style={hintStyle} data-testid="setup-status">
          Stopped before {runError.title}. What was done is kept. Running again continues from
          there.
        </p>
      )}
      <StepList rows={rows} />
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
  );
}

function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button type="button" style={linkButtonStyle} onClick={onClick}>
      {children}
    </button>
  );
}

const linkButtonStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-link)',
  font: 'inherit',
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 600 };
const currentStepStyle: React.CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
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
  gridTemplateColumns: '7.5rem 1fr',
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
const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };
const finishedStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};
const byHandRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
};
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.85rem',
};
