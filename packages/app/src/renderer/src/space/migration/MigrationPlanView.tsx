import type { JSX, ReactNode } from 'react';
import type {
  MigrationField,
  MigrationPlan,
  MigrationSourceRepository,
  SetupTargetState,
} from '../../../../shared/ipc.js';
import {
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import type { MigrationFields, MigrationFlowView } from './useMigrationFlow.js';

type Props = { view: MigrationFlowView };

/** The sentence that states what the migration does to its source. */
export const SOURCE_UNCHANGED_SENTENCE =
  'The v0.8 folder and both its repositories, the payload repository and the Lore repository, are left exactly as they were. The migration only reads them, and its last step checks that both are at the commit and status recorded in its first step.';

const TARGET_SENTENCES: Record<SetupTargetState, string> = {
  absent: 'The folder does not exist yet and is created.',
  empty: 'The folder exists and is empty.',
  'half-made':
    'The folder holds this migration from an earlier run. What is done is kept, and the steps marked done are not repeated.',
};

/**
 * The source, the fields and the plan, shown before anything is created. The
 * plan is made again when the Human Lead asks, after changing a field. The run
 * starts only from the confirm button, and only for a plan that is ready and
 * that no field was changed since.
 */
export function MigrationPlanView({ view }: Props): JSX.Element {
  const { plan, planError } = view;
  const planning = view.stage === 'planning';
  return (
    <>
      {planError !== null && (
        <div role="alert" data-testid="migration-plan-error" data-kind={planError.kind}>
          <p style={errorAreaStyle}>{planError.message}</p>
          <p style={hintStyle}>Nothing was created.</p>
        </div>
      )}
      {plan !== null && <SourceView plan={plan.plan} />}
      <p style={sentenceStyle} data-testid="migration-source-unchanged">
        {SOURCE_UNCHANGED_SENTENCE}
      </p>
      {plan !== null && <FieldsView view={view} fields={plan.plan.fields} />}
      <div style={actionsStyle}>
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={planning || view.busy}
          data-testid="migration-make-plan"
          onClick={() => void view.makePlan()}
        >
          {planning ? 'Making the plan…' : 'Make the plan again'}
        </button>
        {view.changed && (
          <span style={noticeStyle} data-testid="migration-plan-changed">
            A field changed after this plan was made. Make the plan again before confirming.
          </span>
        )}
      </div>
      {plan !== null && <PlanBody plan={plan.plan} />}
      {plan !== null && <Confirm view={view} plan={plan.plan} />}
    </>
  );
}

function repositoryState(repository: MigrationSourceRepository): string {
  if (!repository.present) return 'not found';
  if (repository.hasUncommittedChanges) return `${repository.changedCount} uncommitted changes`;
  return 'no uncommitted changes';
}

function SourceView({ plan }: { plan: MigrationPlan }): JSX.Element {
  const { source } = plan;
  const rows: [string, MigrationSourceRepository][] = [
    ['payloadRepository', source.payloadRepository],
    ['loreRepository', source.loreRepository],
  ];
  return (
    <Section id="migration-source" title="source — the v0.8 project">
      <dl style={definitionStyle}>
        <dt>projectName</dt>
        <dd data-testid="migration-source-name">{source.projectName}</dd>
        <dt>coreVersion</dt>
        <dd data-testid="migration-source-version">{source.coreVersion ?? 'none'}</dd>
        <dt>root</dt>
        <dd style={folderPathStyle}>{source.root}</dd>
        <dt>loreFolder</dt>
        <dd style={folderPathStyle}>{source.loreFolder}</dd>
      </dl>
      <table style={tableStyle} data-testid="migration-source-repositories">
        <thead>
          <tr>
            <th scope="col" style={thStyle}>
              repository
            </th>
            <th scope="col" style={thStyle}>
              path
            </th>
            <th scope="col" style={thStyle}>
              originUrl
            </th>
            <th scope="col" style={thStyle}>
              branch
            </th>
            <th scope="col" style={thStyle}>
              head
            </th>
            <th scope="col" style={thStyle}>
              state
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, repository]) => (
            <tr key={id} data-testid={`migration-source-${id}`}>
              <th scope="row" style={tdStyle}>
                {id}
              </th>
              <td style={tdStyle}>{repository.path}</td>
              <td style={tdStyle}>{repository.originUrl ?? 'none'}</td>
              <td style={tdStyle}>{repository.branch ?? 'none'}</td>
              <td style={tdStyle}>{repository.head?.slice(0, 12) ?? 'none'}</td>
              <td style={tdStyle} data-testid={`migration-source-${id}-state`}>
                {repositoryState(repository)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!source.complete && (
        <p style={noticeStyle}>
          The reader stopped at its file or time limit: the plan is partial.
        </p>
      )}
    </Section>
  );
}

type TextKey = 'name' | 'owner' | 'payloadGitHub';

function FieldsView({
  view,
  fields,
}: {
  view: MigrationFlowView;
  fields: MigrationField[];
}): JSX.Element {
  const field = (id: string): MigrationField | undefined =>
    fields.find((candidate) => candidate.id === id);
  const labelOf = (id: string): string => {
    const found = field(id);
    return found === undefined ? id : `${id} — ${found.label}`;
  };
  const problemOf = (id: string): string | null => field(id)?.problem ?? null;
  const disabled = view.stage === 'planning';
  const text = (id: TextKey) => (
    <FieldRow id={id} label={labelOf(id)} problem={problemOf(id)} proposed={field(id)?.proposed}>
      <input
        id={`migration-field-${id}`}
        data-testid={`migration-field-${id}`}
        style={inputStyle}
        value={view.fields[id]}
        disabled={disabled}
        aria-invalid={problemOf(id) !== null}
        aria-describedby={problemOf(id) !== null ? `migration-problem-${id}` : undefined}
        onChange={(event) => view.setField(id, event.target.value)}
      />
    </FieldRow>
  );
  const stageField = field('focusStage');
  const suggestions = field('description')?.suggestions ?? [];
  const parentDir = field('parentDir');

  return (
    <Section id="migration-fields" title="fields — what you fill">
      <FieldRow
        id="parentDir"
        label={labelOf('parentDir')}
        problem={problemOf('parentDir')}
        proposed={parentDir?.proposed}
      >
        <div style={rowStyle}>
          <button
            type="button"
            id="migration-field-parentDir"
            data-testid="migration-field-parentDir"
            style={secondaryButtonStyle}
            disabled={disabled || view.busy}
            onClick={() => void view.chooseFolder()}
          >
            Choose a folder…
          </button>
          <span style={folderPathStyle} data-testid="migration-parent-dir">
            {view.parentDir ?? parentDir?.value ?? ''}
          </span>
        </div>
      </FieldRow>
      {text('name')}
      {text('owner')}
      <div style={fieldStyle}>
        <label style={checkLabelStyle}>
          <input
            type="checkbox"
            data-testid="migration-field-private"
            checked={view.fields.private}
            disabled={disabled}
            onChange={(event) => view.setField('private', event.target.checked)}
          />
          private — the Space repository is private
        </label>
      </div>
      <FieldRow
        id="description"
        label={labelOf('description')}
        problem={problemOf('description')}
        proposed={field('description')?.proposed}
      >
        <textarea
          id="migration-field-description"
          data-testid="migration-field-description"
          style={{ ...inputStyle, minHeight: '4.5rem', resize: 'vertical' }}
          value={view.fields.description}
          disabled={disabled}
          aria-invalid={problemOf('description') !== null}
          aria-describedby={
            problemOf('description') !== null ? 'migration-problem-description' : undefined
          }
          onChange={(event) => view.setField('description', event.target.value)}
        />
        {suggestions.length > 0 && (
          <ul style={listStyle} data-testid="migration-description-suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion} style={suggestionStyle}>
                <span>{suggestion}</span>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={disabled}
                  onClick={() => view.setField('description', suggestion)}
                >
                  Use this text
                </button>
              </li>
            ))}
          </ul>
        )}
      </FieldRow>
      <FieldRow
        id="focusStage"
        label={labelOf('focusStage')}
        problem={problemOf('focusStage')}
        proposed={stageField?.proposed}
      >
        <select
          id="migration-field-focusStage"
          data-testid="migration-field-focusStage"
          style={inputStyle}
          value={view.fields.focusStage}
          disabled={disabled}
          onChange={(event) =>
            view.setField('focusStage', event.target.value as MigrationFields['focusStage'])
          }
        >
          {(stageField?.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </FieldRow>
      {text('payloadGitHub')}
    </Section>
  );
}

function FieldRow({
  id,
  label,
  problem,
  proposed,
  children,
}: {
  id: string;
  label: string;
  problem: string | null;
  proposed: boolean | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={fieldStyle} data-testid={`migration-row-${id}`}>
      <label htmlFor={`migration-field-${id}`} style={labelStyle}>
        {label}
        {proposed === true && <span style={hintStyle}> (proposed)</span>}
      </label>
      {children}
      {problem !== null && (
        <p
          id={`migration-problem-${id}`}
          style={errorAreaStyle}
          data-testid={`migration-problem-${id}`}
        >
          {problem}
        </p>
      )}
    </div>
  );
}

function PlanBody({ plan }: { plan: MigrationPlan }): JSX.Element {
  return (
    <>
      <Section id="migration-plan" title="plan — what will be created">
        <p style={hintStyle} data-testid="migration-plan-target">
          {plan.target === 'half-made'
            ? 'An earlier run did part of this migration; nothing more is done until you confirm.'
            : 'Nothing has been done yet.'}{' '}
          {plan.spaceRoot !== null && (
            <>
              The new Space's folder is{' '}
              <span style={folderPathStyle} data-testid="migration-plan-root">
                {plan.spaceRoot}
              </span>
              .{' '}
            </>
          )}
          {plan.target !== null && TARGET_SENTENCES[plan.target]}{' '}
          {plan.repository !== null && (
            <>
              The Space repository on GitHub is{' '}
              <span data-testid="migration-plan-repository">{plan.repository}</span>.
            </>
          )}
        </p>
        {plan.refusals.length > 0 && (
          <div role="alert" data-testid="migration-refusals">
            <h3 style={subtitleStyle}>refusals — nothing can be run</h3>
            <ul style={listStyle}>
              {plan.refusals.map((refusal) => (
                <li key={refusal.kind} data-testid={`migration-refusal-${refusal.kind}`}>
                  {refusal.kind}: {refusal.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.warnings.length > 0 && (
          <div data-testid="migration-warnings">
            <h3 style={subtitleStyle}>warnings — the migration can go on</h3>
            <ul style={listStyle}>
              {plan.warnings.map((warning) => (
                <li
                  key={`${warning.kind}:${warning.message}`}
                  data-testid={`migration-warning-${warning.kind}`}
                >
                  {warning.kind}: {warning.message}
                  {warning.paths.length > 0 && (
                    <details>
                      <summary>paths ({warning.paths.length})</summary>
                      <ul style={pathListStyle}>
                        {warning.paths.map((path) => (
                          <li key={path} style={folderPathStyle}>
                            {path}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="migration-mapping" title="mapping — what goes where">
        <table style={tableStyle} data-testid="migration-mapping">
          <thead>
            <tr>
              <th scope="col" style={thStyle}>
                row
              </th>
              <th scope="col" style={thStyle}>
                v0.8
              </th>
              <th scope="col" style={thStyle}>
                goes to
              </th>
              <th scope="col" style={thStyle}>
                count
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.mapping.map((row) => (
              <tr key={row.id} data-testid={`migration-mapping-${row.id}`}>
                <th scope="row" style={tdStyle}>
                  {row.id}
                </th>
                <td style={tdStyle}>{row.source}</td>
                <td style={tdStyle}>
                  {row.destination}
                  {row.items.length > 0 && (
                    <details>
                      <summary>items ({row.items.length})</summary>
                      <ul style={pathListStyle}>
                        {row.items.map((item) => (
                          <li key={`${item.from}>${item.to}`}>
                            <span style={folderPathStyle}>{item.from}</span> →{' '}
                            <span style={folderPathStyle}>{item.to}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td style={tdStyle} data-testid={`migration-mapping-count-${row.id}`}>
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="migration-not-carried" title="notCarried — kept only in the archive">
        {plan.notCarried.length === 0 ? (
          <p style={hintStyle}>Nothing is kept only in the archive.</p>
        ) : (
          <ul style={listStyle} data-testid="migration-not-carried">
            {plan.notCarried.map((kind) => (
              <li key={kind.what}>
                {kind.what}: {kind.count}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="migration-issues" title="issues — created on GitHub">
        <p style={hintStyle} data-testid="migration-issues-count">
          {plan.issues.length} issues will be created.
        </p>
        {plan.issues.length > 0 && (
          <ol style={issueListStyle} data-testid="migration-issues">
            {plan.issues.map((issue) => (
              <li key={issue.key}>
                <span style={kindStyle}>{issue.kind}</span> {issue.title}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="migration-steps" title="steps — in order">
        <ol style={listStyle} data-testid="migration-plan-steps">
          {plan.steps.map((step) => (
            <li key={step.stepId} data-testid={`migration-plan-step-${step.stepId}`}>
              <span style={labelStyle}>
                {step.number}. {step.title}
              </span>
              {step.done ? (
                <span style={hintStyle}> — Already done</span>
              ) : (
                <ul style={pathListStyle}>
                  {step.lines.map((line) => (
                    <li key={`${line.what}${line.to ?? ''}`}>
                      {line.what}
                      {line.count !== undefined && ` (${line.count})`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

function Confirm({ view, plan }: { view: MigrationFlowView; plan: MigrationPlan }): JSX.Element {
  const token = view.plan?.token ?? null;
  const ready = token !== null && !view.changed && view.stage === 'plan' && !view.runningElsewhere;
  return (
    <Section id="migration-confirm" title="confirm">
      <p style={sentenceStyle} data-testid="migration-confirm-sentence">
        {plan.ready && plan.repository !== null
          ? `Confirming creates on GitHub the ${view.fields.private ? 'private' : 'public'} repository ${plan.repository}, its Project, and ${plan.issues.length} issues, which others with access can see.`
          : 'The plan is not ready: a field has a problem or the migration is refused. Nothing can be confirmed.'}
      </p>
      <div>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={!ready}
          data-testid="migration-confirm"
          onClick={() => void view.confirm()}
        >
          Confirm: create on GitHub and migrate
        </button>
      </div>
    </Section>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section style={sectionStyle} aria-labelledby={`${id}-title`} data-testid={`${id}-section`}>
      <h2 id={`${id}-title`} style={titleStyle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };
const subtitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 600 };
const sentenceStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem' };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
const noticeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-warn-fg)',
};
const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};
const labelStyle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 500 };
const checkLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.85rem',
};
const inputStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: '0.85rem',
  padding: '0.35rem 0.5rem',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  background: 'var(--color-input-bg, transparent)',
  color: 'inherit',
};
const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.2rem',
  fontSize: '0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};
const issueListStyle: React.CSSProperties = {
  ...listStyle,
  maxHeight: '14rem',
  overflowY: 'auto',
};
const pathListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.1rem',
  fontSize: '0.8rem',
};
const suggestionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
};
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  columnGap: '0.8rem',
  rowGap: '0.2rem',
  margin: 0,
  fontSize: '0.85rem',
};
const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: '0.8rem',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.3rem 0.4rem',
  borderBottom: '1px solid var(--color-border-strong)',
  fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  textAlign: 'left',
  verticalAlign: 'top',
  padding: '0.3rem 0.4rem',
  borderBottom: '1px solid var(--color-border)',
  fontWeight: 'normal',
  wordBreak: 'break-word',
};
const kindStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
};
