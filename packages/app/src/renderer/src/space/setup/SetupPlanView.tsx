import { type JSX, useEffect, useRef } from 'react';
import type {
  PlanLine,
  SetupTargetState,
  SpaceSetupGitHubNames,
  SpaceSetupPlanValue,
} from '../../../../shared/ipc.js';
import { Disclosure } from '../common/Disclosure.js';
import {
  type StateTagKind,
  bannerStyle,
  cardStyle,
  errorAreaStyle,
  hintStyle,
  primaryButtonStyle,
  resultLineStyle,
  rowCardStyle,
  secondaryButtonStyle,
  stateTagStyle,
} from '../styles.js';
import { type SetupFlowView, basenameOf } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

const CONFIRM_LABELS: Record<'create' | 'adopt' | 'open', string> = {
  create: 'Create the Space',
  adopt: 'Create the Space',
  open: 'Copy the Space to this computer',
};

function tagKind(reused: boolean): StateTagKind {
  return reused ? 'reused' : 'new';
}

function tagWord(reused: boolean): string {
  return reused ? 'Already exists, will be used' : 'New';
}

function folderReused(target: SetupTargetState): boolean {
  return target !== 'absent';
}

/** A step's lines, written as sentences: `what`, then " From <from>.", " To <to>.", " <count> in all." */
function stepSentence(line: PlanLine): string {
  let text = line.what;
  if (line.from !== undefined) text += ` From ${line.from}.`;
  if (line.to !== undefined) text += ` To ${line.to}.`;
  if (line.count !== undefined) text += ` ${line.count} in all.`;
  return text;
}

/**
 * The confirmation (architecture document Part C, M9.9): a short question, a
 * card of the three things GitHub and the disk will hold, with a tag for
 * each, "Nothing has been created yet.", and the full plan behind a
 * disclosure. Creating a repository and a Project on GitHub is an
 * outward-facing act, so the run starts only from this explicit confirm.
 */
export function SetupPlanView({ view }: Props): JSX.Element | null {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  const { plan, flow } = view;
  if (plan === null) return null;
  const { plan: setupPlan, github } = plan;
  const name = basenameOf(setupPlan.spaceRoot);
  const halfMade = setupPlan.target === 'half-made';

  const question = halfMade
    ? `Finish the Space ${name}?`
    : flow === 'open'
      ? `Copy the Space ${setupPlan.repository?.fullName ?? name} to this computer?`
      : `Create the Space ${name}?`;

  const confirmLabel = halfMade ? 'Finish the Space' : CONFIRM_LABELS[flow];

  return (
    <section style={sectionStyle} aria-labelledby="setup-confirm-question" data-testid="setup-plan">
      <h2 id="setup-confirm-question" data-testid="setup-confirm-question" style={titleStyle}>
        {question}
      </h2>

      {halfMade && (
        <div style={bannerStyle('warn')} data-testid="setup-confirm-half-made">
          This Space was started before and not finished. Left to do:{' '}
          {setupPlan.leftToDo.join(', ')}.
        </div>
      )}

      <div style={cardStyle}>
        <Row
          testId="setup-confirm-folder"
          label={`Folder ${setupPlan.spaceRoot}`}
          reused={folderReused(setupPlan.target)}
        />
        {flow === 'open' ? (
          <p style={resultLineStyle} data-testid="setup-confirm-repository">
            The Space repository {setupPlan.repository?.fullName ?? ''}
          </p>
        ) : (
          github !== null && (
            <>
              <Row
                testId="setup-confirm-repository"
                label={`GitHub repository ${github.repository} · ${github.visibility === 'private' ? 'Private' : 'Public'}`}
                reused={github.repositoryExists}
              />
              <Row
                testId="setup-confirm-project"
                label={`GitHub Project ${github.project}, with its fields, labels and three views`}
                reused={github.projectExists}
              />
            </>
          )
        )}
      </div>

      <p style={resultLineStyle}>The Space is installed for Claude Code.</p>
      <p style={hintStyle}>Nothing has been created yet.</p>

      <Disclosure label="Show every step" testId="setup-show-every-step" defaultOpen={false}>
        <EveryStep plan={plan} />
      </Disclosure>

      <div style={actionsStyle}>
        <button
          type="button"
          ref={confirmRef}
          style={primaryButtonStyle}
          data-testid="setup-confirm"
          onClick={() => void view.confirm()}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          style={secondaryButtonStyle}
          data-testid="setup-back"
          onClick={view.backToForm}
        >
          Back
        </button>
      </div>
    </section>
  );
}

function Row({
  testId,
  label,
  reused,
}: {
  testId: string;
  label: string;
  reused: boolean;
}): JSX.Element {
  return (
    <div style={rowCardStyle} data-testid={testId}>
      <span style={resultLineStyle}>{label}</span>
      <span style={stateTagStyle(tagKind(reused))}>{tagWord(reused)}</span>
    </div>
  );
}

function EveryStep({ plan }: { plan: SpaceSetupPlanValue }): JSX.Element {
  return (
    <div style={everyStepStyle} data-testid="setup-every-step">
      {plan.github !== null && <GitHubDetail names={plan.github} />}
      <ol style={stepListStyle} data-testid="setup-plan-steps">
        {plan.plan.steps.map((step) => (
          <li
            key={step.stepId}
            data-testid={`setup-plan-step-${step.stepId}`}
            data-done={step.done}
          >
            <span style={stepTitleStyle}>{step.title}</span>
            <span style={hintStyle}> — {step.done ? 'Already done' : 'Will run'}</span>
            {!step.done && (
              <ul style={lineListStyle}>
                {step.lines.map((line, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a step's lines have no id.
                  <li key={index} style={lineStyle}>
                    {stepSentence(line)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function GitHubDetail({ names }: { names: SpaceSetupGitHubNames }): JSX.Element {
  return (
    <div style={githubStyle} data-testid="setup-plan-github">
      <p style={hintStyle} data-testid="setup-plan-github-labels">
        Labels: {names.labels.join(', ')}.
      </p>
      <p style={hintStyle} data-testid="setup-plan-github-views">
        Views: {names.views.join(', ')}.
      </p>
    </div>
  );
}

/**
 * "The Space already exists and is complete." (architecture document Part C,
 * M9.9 item 6): shown when the plan found every step already done except the
 * two that always run. Only opening the Space is offered.
 */
export function SetupCompleteView({ view }: Props): JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const { plan } = view;
  if (plan === null) return null;
  const { plan: setupPlan, github } = plan;
  const name = basenameOf(setupPlan.spaceRoot);
  const repository = github?.repository ?? setupPlan.repository?.fullName ?? null;
  const repositoryUrl = github?.repositoryUrl ?? setupPlan.repository?.url ?? null;
  const project = github?.project ?? setupPlan.project?.title ?? null;
  const projectUrl = github?.projectUrl ?? setupPlan.project?.url ?? null;

  return (
    <section
      style={sectionStyle}
      aria-labelledby="setup-complete-title"
      data-testid="setup-complete"
    >
      <h2 id="setup-complete-title" ref={headingRef} tabIndex={-1} style={titleStyle}>
        The Space {name} already exists and is complete.
      </h2>
      <p style={resultLineStyle}>Folder: {setupPlan.spaceRoot}</p>
      {repository !== null && (
        <p style={resultLineStyle}>
          {repositoryUrl !== null ? (
            <LinkButton onClick={() => window.cockpit.urlOpenExternal(repositoryUrl)}>
              Repository: {repository} ↗
            </LinkButton>
          ) : (
            `Repository: ${repository}`
          )}
        </p>
      )}
      {project !== null && (
        <p style={resultLineStyle}>
          {projectUrl !== null ? (
            <LinkButton onClick={() => window.cockpit.urlOpenExternal(projectUrl)}>
              Project: {project} ↗
            </LinkButton>
          ) : (
            `Project: ${project}`
          )}
        </p>
      )}
      {view.error !== null && (
        <p role="alert" style={errorAreaStyle}>
          {view.error}
        </p>
      )}
      <div>
        <button
          type="button"
          style={primaryButtonStyle}
          data-testid="setup-open-space"
          onClick={() => void view.openSpace()}
        >
          Open the Space
        </button>
      </div>
    </section>
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
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 600,
  outline: 'none',
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: '0.5rem' };
const everyStepStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};
const githubStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
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
