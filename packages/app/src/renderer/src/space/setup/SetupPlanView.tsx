import { type JSX, useEffect, useRef } from 'react';
import type { PlanLine, SetupTargetState, SpaceSetupGitHubNames } from '../../../../shared/ipc.js';
import {
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import type { SetupFlowView } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

const TARGET_SENTENCES: Record<SetupTargetState, string> = {
  absent: 'The folder does not exist yet and is created.',
  empty: 'The folder exists and is empty.',
  'half-made': 'The folder holds this same Space from an earlier run. What is done is kept.',
};

const CONFIRM_LABELS = {
  create: 'Confirm: create on GitHub and run',
  adopt: 'Confirm: create on GitHub and run',
  open: 'Confirm: clone and run',
} as const;

/**
 * The dry run, shown before anything runs: the names of what is created on
 * GitHub, and every step with what it will do. Creating a repository and a
 * Project on GitHub is an outward-facing act, so the run starts only from the
 * confirm button. A plan that could not be made shows core's sentence and
 * offers no run.
 */
export function SetupPlanView({ view }: Props): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const { plan, planError } = view;

  return (
    <section style={sectionStyle} aria-labelledby="setup-plan-title" data-testid="setup-plan">
      <h2 id="setup-plan-title" ref={headingRef} tabIndex={-1} style={titleStyle}>
        The plan
      </h2>
      {planError !== null && (
        <div role="alert" data-testid="setup-plan-error" data-kind={planError.kind}>
          <p style={errorAreaStyle}>{planError.message}</p>
          <p style={hintStyle}>
            Nothing was created. Change the form, then ask for the plan again.
          </p>
        </div>
      )}
      {plan !== null && (
        <>
          <p style={hintStyle}>
            Nothing has been done yet. The Space's folder is{' '}
            <span style={folderPathStyle} data-testid="setup-plan-root">
              {plan.plan.spaceRoot}
            </span>
            . {TARGET_SENTENCES[plan.plan.target]}
          </p>
          {plan.github !== null && <GitHubNames names={plan.github} />}
          <ol style={stepListStyle} data-testid="setup-plan-steps">
            {plan.plan.steps.map((step) => (
              <li
                key={step.stepId}
                data-testid={`setup-plan-step-${step.stepId}`}
                data-done={step.done}
              >
                <span style={stepTitleStyle}>{step.title}</span>
                {step.done ? (
                  <span style={hintStyle}> — already done; it is skipped.</span>
                ) : (
                  <ul style={lineListStyle}>
                    {step.lines.map((line, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a step's lines have no id.
                      <li key={index} style={lineStyle}>
                        {lineText(line)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      <div style={actionsStyle}>
        {plan !== null && planError === null && (
          <button
            type="button"
            style={primaryButtonStyle}
            data-testid="setup-confirm"
            onClick={() => void view.confirm()}
          >
            {CONFIRM_LABELS[view.flow]}
          </button>
        )}
        <button
          type="button"
          style={secondaryButtonStyle}
          data-testid="setup-back"
          onClick={view.backToForm}
        >
          Back to the form
        </button>
      </div>
    </section>
  );
}

function lineText(line: PlanLine): string {
  const parts = [line.what];
  if (line.from !== undefined) parts.push(`From: ${line.from}.`);
  if (line.to !== undefined) parts.push(`To: ${line.to}.`);
  if (line.count !== undefined) parts.push(`Count: ${line.count}.`);
  return parts.join(' ');
}

function GitHubNames({ names }: { names: SpaceSetupGitHubNames }): JSX.Element {
  const state = (exists: boolean): string => (exists ? 'exists; it is used' : 'is created');
  return (
    <div style={githubStyle} data-testid="setup-plan-github">
      <h3 style={subtitleStyle}>On GitHub, as {names.owner}</h3>
      <ul style={lineListStyle}>
        <li data-testid="setup-plan-github-repository">
          Repository <code>{names.repository}</code> ({names.visibility}){' '}
          {state(names.repositoryExists)}.
        </li>
        <li data-testid="setup-plan-github-project">
          Project <code>{names.project}</code> {state(names.projectExists)}.
        </li>
        <li data-testid="setup-plan-github-labels">Labels: {names.labels.join(', ')}.</li>
        <li data-testid="setup-plan-github-views">Views: {names.views.join(', ')}.</li>
      </ul>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 600,
  outline: 'none',
};
const subtitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 600 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
const githubStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.6rem',
  border: '1px solid var(--color-accent-border)',
  borderRadius: '5px',
  fontSize: '0.85rem',
};
const stepListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.3rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  fontSize: '0.85rem',
};
const stepTitleStyle: React.CSSProperties = { fontWeight: 600 };
const lineListStyle: React.CSSProperties = { margin: '0.15rem 0 0', paddingLeft: '1.1rem' };
const lineStyle: React.CSSProperties = { color: 'var(--color-text-2)', wordBreak: 'break-word' };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: '0.5rem' };
