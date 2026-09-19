import { type JSX, type ReactNode, useState } from 'react';
import type { SetupInputProblem, SpaceSetupTargetPreview } from '../../../../shared/ipc.js';
import { Disclosure } from '../common/Disclosure.js';
import {
  errorAreaStyle,
  fieldLabelStyle,
  folderPathStyle,
  hintStyle,
  inputStyle,
  primaryButtonStyle,
  resultLineStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { type SetupFlowView, fieldId, previewAddressName, topField } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

/** The plain label shown for a problem that belongs to no field on screen, or above a field. */
const PROBLEM_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  owner: 'GitHub owner',
  parentDir: 'Location',
  sourceDir: 'Repository folder',
  github: 'GitHub address',
  repositoryName: 'Name in the Space',
  address: 'Space on GitHub',
  folderName: 'Folder name',
  repositories: 'Repositories',
};

function problemLabel(field: string): string {
  return PROBLEM_LABELS[topField(field)] ?? field;
}

type Line = { text: string; kind: 'normal' | 'warn' | 'danger' };

function targetLines(
  target: SpaceSetupTargetPreview | null,
  path: string,
  name: string,
  parent: string,
): Line[] {
  if (target === null) return [{ text: `Folder: ${path}`, kind: 'normal' }];
  switch (target.state) {
    case 'absent':
      return [{ text: `Folder: ${path} — a new folder.`, kind: 'normal' }];
    case 'empty':
      return [{ text: `Folder: ${path} — an empty folder that will be used.`, kind: 'normal' }];
    case 'incomplete':
      return [{ text: `${path} holds this Space from an earlier run.`, kind: 'warn' }];
    case 'complete':
      return [{ text: `${path} holds this Space, and it is complete.`, kind: 'normal' }];
    case 'other-content':
      return [
        {
          text: `A folder named ${name} already exists in ${parent} and is not this Space. Choose another name or location.`,
          kind: 'danger',
        },
      ];
    default:
      return [{ text: `Folder: ${path}`, kind: 'normal' }];
  }
}

/** The live "What will be created" block, updated on every change. */
function willCreateLines(view: SetupFlowView): Line[] {
  const { flow, fields, target, parentDir, start, source, sourceDir } = view;
  if (flow === 'open') {
    if (fields.address.trim() === '') {
      return [{ text: 'Enter a GitHub address to see what will be created.', kind: 'normal' }];
    }
    const folderName = fields.folderName.trim() || previewAddressName(fields.address) || '';
    const resolvedPath = target?.spaceRoot ?? `${parentDir ?? ''}/${folderName}`;
    return [
      ...targetLines(target, resolvedPath, folderName, parentDir ?? ''),
      {
        text: "The Space's repositories are cloned into repos/ after you confirm them.",
        kind: 'normal',
      },
    ];
  }
  if (fields.name.trim() === '') {
    return [{ text: 'Enter a name to see what will be created.', kind: 'normal' }];
  }
  const resolvedPath = target?.spaceRoot ?? `${parentDir ?? ''}/${fields.name}`;
  const lines = targetLines(target, resolvedPath, fields.name, parentDir ?? '');
  const owner = fields.owner || '…';
  lines.push({
    text: `On GitHub: the ${fields.private ? 'private' : 'public'} repository ${owner}/${fields.name} and a Project named ${fields.name}.`,
    kind: 'normal',
  });
  lines.push({
    text: 'Installed for Claude Code, so AI sessions can start as soon as the Space opens.',
    kind: 'normal',
  });
  if (flow === 'adopt') {
    const sourceFolder =
      start.kind === 'about-repository' ? sourceDir : (source?.sourceDir ?? null);
    const repoName =
      fields.repositoryName.trim() ||
      source?.name ||
      previewAddressName(fields.github) ||
      fields.name;
    lines.push({
      text: `The repository is cloned into ${resolvedPath}/repos/${repoName}. The folder you chose, ${sourceFolder ?? '…'}, is not changed.`,
      kind: 'normal',
    });
  }
  return lines;
}

function lineColor(kind: Line['kind']): string {
  if (kind === 'warn') return 'var(--color-warn-fg)';
  if (kind === 'danger') return 'var(--color-danger-fg)';
  return 'var(--color-text)';
}

/**
 * The form of the window's flow: plain labels (never core's field names), a
 * live "What will be created" block, and the Continue action that leads to
 * the checking screen. The folders are never typed: the folder the Space is
 * created in is chosen in main's dialog, and the repository to adopt is
 * either the folder main opened or the one chosen with `chooseSource`.
 */
export function SetupForm({ view }: Props): JSX.Element {
  const { flow, fields, setField, problems, busy, target, stage } = view;
  const disabled = busy || stage === 'checking';
  const shown = new Set<string>();
  const problemOf = (field: string): string | null => {
    const found = problems.find((problem) => problem.field === field);
    if (found === undefined) return null;
    shown.add(field);
    return found.message;
  };

  const adopt = flow === 'adopt';
  const open = flow === 'open';

  const nameOrAddressEmpty = open ? fields.address.trim() === '' : fields.name.trim() === '';
  const otherContent = target?.state === 'other-content';
  const incomplete = target?.state === 'incomplete';
  const complete = target?.state === 'complete';
  const continueLabel = incomplete ? 'Finish setting it up' : 'Continue';

  const unshown = problems.filter((problem) => !shown.has(problem.field));

  const sharedFields = (
    <>
      <Field
        label="Name"
        field="name"
        problem={problemOf('name')}
        hint="Also the name of the folder, the repository and the Project."
      >
        <TextInput
          field="name"
          value={fields.name}
          problem={problemOf('name')}
          disabled={disabled}
          onChange={(value) => setField('name', value)}
        />
      </Field>
      <Field label="Description (optional)" field="description" problem={problemOf('description')}>
        <textarea
          id={fieldId('description')}
          data-testid={fieldId('description')}
          style={{ ...inputStyle, minHeight: '4.5rem', resize: 'vertical' }}
          value={fields.description}
          disabled={disabled}
          placeholder="What this Space is for."
          aria-invalid={problemOf('description') !== null}
          aria-describedby={
            problemOf('description') !== null ? problemId('description') : undefined
          }
          onChange={(event) => setField('description', event.target.value)}
        />
      </Field>
      <OwnerField view={view} problem={problemOf('owner')} disabled={disabled} />
      <div style={fieldStyle}>
        <span style={fieldLabelStyle}>Visibility</span>
        <div style={radioRowStyle}>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="setup-visibility"
              data-testid="setup-field-private-true"
              checked={fields.private}
              disabled={disabled}
              onChange={() => setField('private', true)}
            />
            Private
            <span style={hintStyle}>Only you and people you add can see it.</span>
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="setup-visibility"
              data-testid="setup-field-private-false"
              checked={!fields.private}
              disabled={disabled}
              onChange={() => setField('private', false)}
            />
            Public
            <span style={hintStyle}>Anyone can see it.</span>
          </label>
        </div>
      </div>
      <LocationField view={view} problem={problemOf('parentDir')} disabled={disabled} />
    </>
  );

  const body = open ? (
    <>
      <OwnerField view={view} problem={problemOf('owner')} disabled={disabled} />
      <SpaceOnGitHubField view={view} problem={problemOf('address')} disabled={disabled} />
      <LocationField view={view} problem={problemOf('parentDir')} disabled={disabled} />
      <Disclosure
        label="Use a different folder name"
        testId="setup-different-folder-name"
        defaultOpen={fields.folderName !== ''}
      >
        <Field label="Folder name" field="folderName" problem={problemOf('folderName')}>
          <TextInput
            field="folderName"
            value={fields.folderName}
            problem={problemOf('folderName')}
            disabled={disabled}
            placeholder="the repository's name"
            onChange={(value) => setField('folderName', value)}
          />
        </Field>
      </Disclosure>
    </>
  ) : adopt ? (
    <>
      <SourceCard view={view} />
      {sharedFields}
      <Disclosure
        label="More options"
        testId="setup-more-options"
        defaultOpen={fields.github !== '' || fields.repositoryName !== ''}
      >
        <Field label="GitHub address" field="github" problem={problemOf('github')}>
          <TextInput
            field="github"
            value={fields.github}
            problem={problemOf('github')}
            disabled={disabled}
            placeholder="read from the origin"
            onChange={(value) => setField('github', value)}
          />
        </Field>
        <Field
          label="Name in the Space"
          field="repositoryName"
          problem={problemOf('repositoryName')}
        >
          <TextInput
            field="repositoryName"
            value={fields.repositoryName}
            problem={problemOf('repositoryName')}
            disabled={disabled}
            placeholder="the repository's name"
            onChange={(value) => setField('repositoryName', value)}
          />
        </Field>
      </Disclosure>
    </>
  ) : (
    <>
      {sharedFields}
      <Disclosure
        label="Add repositories (optional)"
        testId="setup-add-repositories"
        defaultOpen={fields.repositories.length > 0}
      >
        <RepositoriesField view={view} problemOf={problemOf} disabled={disabled} />
      </Disclosure>
    </>
  );

  return (
    <form
      style={formStyle}
      data-testid="setup-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !complete) void view.showPlan();
      }}
    >
      {unshown.length > 0 && <ProblemList problems={unshown} />}
      {body}

      <div style={willCreateStyle} data-testid="setup-will-create" aria-live="polite">
        {willCreateLines(view).map((line) => (
          <p key={line.text} style={{ ...resultLineStyle, color: lineColor(line.kind) }}>
            {line.text}
          </p>
        ))}
      </div>

      <div style={actionsStyle}>
        {!complete && (
          <button
            type="submit"
            style={primaryButtonStyle}
            disabled={disabled || nameOrAddressEmpty || otherContent}
            data-testid="setup-continue"
          >
            {stage === 'checking' ? 'Checking…' : continueLabel}
          </button>
        )}
        {(incomplete || complete) && (
          <button
            type="button"
            style={complete ? primaryButtonStyle : secondaryButtonStyle}
            disabled={busy}
            data-testid="setup-open-existing"
            onClick={() => void view.openExisting()}
          >
            Open it
          </button>
        )}
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={disabled}
          data-testid="setup-to-welcome"
          onClick={() => void window.cockpit.spaceNavigate({ to: 'space-welcome' })}
        >
          Back
        </button>
        <span style={hintStyle}>Nothing is created before you confirm.</span>
      </div>
    </form>
  );
}

function OwnerField({
  view,
  problem,
  disabled,
}: {
  view: SetupFlowView;
  problem: string | null;
  disabled: boolean;
}): JSX.Element {
  const { fields, setField, owners, flow, listSpaces } = view;
  const account = owners.account;
  return (
    <Field label="GitHub owner" field="owner" problem={problem}>
      {account !== null ? (
        <select
          id={fieldId('owner')}
          data-testid={fieldId('owner')}
          style={inputStyle}
          value={fields.owner}
          disabled={disabled}
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? problemId('owner') : undefined}
          onChange={(event) => {
            setField('owner', event.target.value);
            if (flow === 'open') void listSpaces(event.target.value);
          }}
        >
          <option value={account}>{account} (you)</option>
          {owners.organisations.map((organisation) => (
            <option key={organisation} value={organisation}>
              {organisation}
            </option>
          ))}
        </select>
      ) : (
        <p style={hintStyle} data-testid={fieldId('owner')}>
          Not signed in to GitHub yet. Sign in from Set up this computer.
        </p>
      )}
      <p style={hintStyle}>
        {account !== null
          ? `Signed in as ${account} · Not listed? Your organisation may need to allow access for the GitHub CLI.`
          : 'Sign in to choose the account or organisation that owns this Space.'}
      </p>
    </Field>
  );
}

function LocationField({
  view,
  problem,
  disabled,
}: {
  view: SetupFlowView;
  problem: string | null;
  disabled: boolean;
}): JSX.Element {
  return (
    <Field label="Location" field="parentDir" problem={problem}>
      <div style={rowStyle}>
        <span style={folderPathStyle} data-testid="setup-location">
          {view.parentDir ?? 'No folder chosen.'}
        </span>
        <button
          type="button"
          id={fieldId('parentDir')}
          data-testid="setup-location-change"
          style={secondaryButtonStyle}
          disabled={disabled}
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? problemId('parentDir') : undefined}
          onClick={() => void view.chooseFolder()}
        >
          Change…
        </button>
      </div>
      <p style={hintStyle}>For this Space only; the Spaces folder in Settings stays as it is.</p>
    </Field>
  );
}

function SourceCard({ view }: { view: SetupFlowView }): JSX.Element {
  const { start, source, sourceDir, originUrl } = view;
  if (start.kind === 'about-repository') {
    return (
      <div style={cardStyle} data-testid="setup-source">
        <p style={resultLineStyle}>
          Repository: <span style={folderPathStyle}>{sourceDir}</span>
        </p>
        <p style={resultLineStyle}>On GitHub: {originUrl ?? 'no GitHub address'}</p>
        <p style={hintStyle}>
          The new Space gets its own copy from GitHub. This folder is not changed.
        </p>
      </div>
    );
  }
  if (source === null) {
    return (
      <div style={cardStyle} data-testid="setup-source">
        <span style={fieldLabelStyle}>Repository folder</span>
        <div>
          <button
            type="button"
            style={secondaryButtonStyle}
            data-testid="setup-choose-source"
            onClick={() => void view.chooseSource()}
          >
            Choose…
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={cardStyle} data-testid="setup-source">
      <p style={resultLineStyle}>
        Repository: <span style={folderPathStyle}>{source.sourceDir}</span>
      </p>
      <p style={resultLineStyle}>On GitHub: {source.github ?? 'no GitHub address'}</p>
      <p style={hintStyle}>
        The new Space gets its own copy from GitHub. This folder is not changed.
      </p>
      <div>
        <button
          type="button"
          style={secondaryButtonStyle}
          data-testid="setup-choose-source"
          onClick={() => void view.chooseSource()}
        >
          Choose…
        </button>
      </div>
    </div>
  );
}

function SpaceOnGitHubField({
  view,
  problem,
  disabled,
}: {
  view: SetupFlowView;
  problem: string | null;
  disabled: boolean;
}): JSX.Element {
  const { fields, setField, spaceList } = view;
  const options = spaceList ?? [];
  const [custom, setCustom] = useState(
    () => fields.address !== '' && !options.some((entry) => entry.fullName === fields.address),
  );
  return (
    <Field label="Space on GitHub" field="address" problem={problem}>
      {custom ? (
        <TextInput
          field="address"
          value={fields.address}
          problem={problem}
          disabled={disabled}
          placeholder="owner/name or https://github.com/owner/name"
          onChange={(value) => setField('address', value)}
        />
      ) : (
        <select
          id={fieldId('address')}
          data-testid={fieldId('address')}
          style={inputStyle}
          disabled={disabled}
          value={options.some((entry) => entry.fullName === fields.address) ? fields.address : ''}
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? problemId('address') : undefined}
          onChange={(event) => {
            if (event.target.value === '__custom__') {
              setCustom(true);
              return;
            }
            setField('address', event.target.value);
          }}
        >
          <option value="" disabled>
            Choose a Space…
          </option>
          {options.map((entry) => (
            <option key={entry.fullName} value={entry.fullName}>
              {entry.fullName}
              {entry.private ? ' (private)' : ''}
            </option>
          ))}
          <option value="__custom__">Another address…</option>
        </select>
      )}
    </Field>
  );
}

function RepositoriesField({
  view,
  problemOf,
  disabled,
}: {
  view: SetupFlowView;
  problemOf: (field: string) => string | null;
  disabled: boolean;
}): JSX.Element {
  const { fields, setField } = view;
  const update = (index: number, patch: Partial<{ address: string; name: string }>): void =>
    setField(
      'repositories',
      fields.repositories.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    );
  return (
    <div style={fieldsetStyle} data-testid="setup-repositories">
      {fields.repositories.length === 0 && (
        <p style={hintStyle}>None. The Space can have them later.</p>
      )}
      {fields.repositories.map((entry, index) => {
        const github = `repositories[${index}].github`;
        const name = `repositories[${index}].name`;
        const cloneAddress = `repositories[${index}].cloneAddress`;
        const addressProblem = problemOf(github) ?? problemOf(cloneAddress);
        const nameProblem = problemOf(name);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their place.
          <div key={index} style={repositoryRowStyle} data-testid={`setup-repository-${index}`}>
            <div style={fieldStyle}>
              <label htmlFor={fieldId(github)} style={fieldLabelStyle}>
                GitHub address
              </label>
              <TextInput
                field={github}
                value={entry.address}
                problem={addressProblem}
                disabled={disabled}
                placeholder="owner/name or https://github.com/owner/name"
                onChange={(value) => update(index, { address: value })}
              />
              {addressProblem !== null && <Problem field={github} message={addressProblem} />}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={fieldId(name)} style={fieldLabelStyle}>
                Name in the Space (optional)
              </label>
              <TextInput
                field={name}
                value={entry.name}
                problem={nameProblem}
                disabled={disabled}
                placeholder="the name part of the address"
                onChange={(value) => update(index, { name: value })}
              />
              {nameProblem !== null && <Problem field={name} message={nameProblem} />}
            </div>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={disabled}
              aria-label={`Remove repository ${index + 1}`}
              data-testid={`setup-repository-remove-${index}`}
              onClick={() =>
                setField(
                  'repositories',
                  fields.repositories.filter((_entry, at) => at !== index),
                )
              }
            >
              Remove
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={disabled}
          data-testid="setup-repository-add"
          onClick={() =>
            setField('repositories', [...fields.repositories, { address: '', name: '' }])
          }
        >
          Add another
        </button>
      </div>
      <p style={hintStyle}>You can add repositories later.</p>
    </div>
  );
}

function problemId(field: string): string {
  return `${fieldId(field)}-problem`;
}

function Field({
  field,
  label,
  problem,
  hint,
  children,
}: {
  field: string;
  label: string;
  problem: string | null;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={fieldStyle} data-testid={`setup-row-${field}`}>
      <label htmlFor={fieldId(field)} style={fieldLabelStyle}>
        {label}
      </label>
      {children}
      {hint !== undefined && <p style={hintStyle}>{hint}</p>}
      {problem !== null && <Problem field={field} message={problem} />}
    </div>
  );
}

function Problem({ field, message }: { field: string; message: string }): JSX.Element {
  return (
    <p id={problemId(field)} style={problemStyle} data-testid={`setup-problem-${field}`}>
      {message}
    </p>
  );
}

function ProblemList({ problems }: { problems: SetupInputProblem[] }): JSX.Element {
  return (
    <div id="setup-problems" tabIndex={-1} style={problemBoxStyle} data-testid="setup-problems">
      <p style={fieldLabelStyle}>Fix these before continuing:</p>
      <ul style={problemListStyle}>
        {problems.map((problem) => (
          <li key={`${problem.field}:${problem.message}`} style={problemStyle}>
            {problemLabel(problem.field)}: {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TextInput({
  field,
  value,
  problem,
  placeholder,
  disabled,
  onChange,
}: {
  field: string;
  value: string;
  problem: string | null;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <input
      type="text"
      id={fieldId(field)}
      data-testid={fieldId(field)}
      style={inputStyle}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      aria-invalid={problem !== null}
      aria-describedby={problem !== null ? problemId(field) : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.9rem' };

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.7rem 0.85rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const fieldsetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const repositoryRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr auto',
  alignItems: 'end',
  gap: '0.5rem',
};

const radioRowStyle: React.CSSProperties = { display: 'flex', gap: '1.2rem', flexWrap: 'wrap' };

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.35rem',
  fontSize: '0.85rem',
};

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };

const willCreateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.7rem 0.85rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };

const problemStyle: React.CSSProperties = { ...errorAreaStyle };

const problemBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.6rem 0.8rem',
  border: '1px solid var(--color-danger-box-border, var(--color-danger-fg))',
  borderRadius: '6px',
};

const problemListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};
