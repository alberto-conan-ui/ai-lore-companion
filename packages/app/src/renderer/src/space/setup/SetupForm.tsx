import type { JSX, ReactNode } from 'react';
import type { SetupInputProblem } from '../../../../shared/ipc.js';
import { folderPathStyle, primaryButtonStyle, secondaryButtonStyle } from '../styles.js';
import { type SetupFlowView, fieldId } from './useSetupFlow.js';

type Props = { view: SetupFlowView };

/**
 * The form of the window's flow. Every problem is core's sentence, shown beside
 * its field; a problem of a field the form does not show is listed at its top.
 * The folders are never typed: the folder the Space is created in is chosen in
 * main's dialog, and the repository to adopt is the folder main opened.
 */
export function SetupForm({ view }: Props): JSX.Element {
  const { flow, fields, setField, problems, busy } = view;
  const planning = view.stage === 'planning';
  const shown = new Set<string>();
  const problemOf = (field: string): string | null => {
    const found = problems.find((problem) => problem.field === field);
    if (found === undefined) return null;
    shown.add(field);
    return found.message;
  };

  const create = flow === 'create';
  const open = flow === 'open';

  const body = (
    <>
      {flow === 'adopt' && (
        <Field
          field="sourceDir"
          label="sourceDir — the repository to adopt"
          problem={problemOf('sourceDir')}
        >
          <p
            id={fieldId('sourceDir')}
            tabIndex={-1}
            style={folderPathStyle}
            data-testid="setup-about-folder"
          >
            {view.sourceDir ?? 'No folder was opened.'}
          </p>
          <p style={hintStyle} data-testid="setup-origin">
            {view.originUrl === null
              ? 'Its origin could not be read.'
              : `Cloned fresh from its origin ${view.originUrl}. The folder itself is left as it is.`}
          </p>
        </Field>
      )}

      {open ? (
        <Field
          field="address"
          label="address — the Space repository on GitHub"
          problem={problemOf('address')}
        >
          <TextInput
            field="address"
            value={fields.address}
            problem={problemOf('address')}
            placeholder="owner/name"
            onChange={(value) => setField('address', value)}
          />
        </Field>
      ) : (
        <>
          <Field field="name" label="name — the Space's name" problem={problemOf('name')}>
            <TextInput
              field="name"
              value={fields.name}
              problem={problemOf('name')}
              onChange={(value) => setField('name', value)}
            />
            <p style={hintStyle}>
              It is also the name of the Space's folder, of its repository and of its Project.
            </p>
          </Field>
          <Field
            field="description"
            label="description — what the Space is about"
            problem={problemOf('description')}
          >
            <textarea
              id={fieldId('description')}
              data-testid={fieldId('description')}
              style={{ ...inputStyle, minHeight: '4.5rem', resize: 'vertical' }}
              value={fields.description}
              aria-invalid={problemOf('description') !== null}
              aria-describedby={
                problemOf('description') !== null ? problemId('description') : undefined
              }
              onChange={(event) => setField('description', event.target.value)}
            />
          </Field>
          <Field
            field="owner"
            label="owner — the GitHub user or organisation"
            problem={problemOf('owner')}
          >
            <TextInput
              field="owner"
              value={fields.owner}
              problem={problemOf('owner')}
              onChange={(value) => setField('owner', value)}
            />
          </Field>
          <div style={fieldStyle}>
            <label style={checkLabelStyle}>
              <input
                type="checkbox"
                id={fieldId('private')}
                data-testid={fieldId('private')}
                checked={fields.private}
                onChange={(event) => setField('private', event.target.checked)}
              />
              private — the Space repository is private
            </label>
          </div>
        </>
      )}

      <Field
        field="parentDir"
        label="parentDir — the folder the Space is created in"
        problem={problemOf('parentDir')}
      >
        <div style={rowStyle}>
          <button
            type="button"
            id={fieldId('parentDir')}
            data-testid={fieldId('parentDir')}
            style={secondaryButtonStyle}
            disabled={busy}
            aria-invalid={problemOf('parentDir') !== null}
            aria-describedby={problemOf('parentDir') !== null ? problemId('parentDir') : undefined}
            onClick={() => void view.chooseFolder()}
          >
            Choose a folder…
          </button>
          <span style={folderPathStyle} data-testid="setup-parent-dir">
            {view.parentDir ?? 'No folder chosen.'}
          </span>
        </div>
      </Field>

      {open && (
        <Field
          field="folderName"
          label="folderName — the name of the Space's folder (optional)"
          problem={problemOf('folderName')}
        >
          <TextInput
            field="folderName"
            value={fields.folderName}
            problem={problemOf('folderName')}
            placeholder="the repository's name"
            onChange={(value) => setField('folderName', value)}
          />
        </Field>
      )}

      {flow === 'adopt' && (
        <>
          <Field
            field="github"
            label="github — the repository as owner/name (optional)"
            problem={problemOf('github')}
          >
            <TextInput
              field="github"
              value={fields.github}
              problem={problemOf('github')}
              placeholder="read from the origin"
              onChange={(value) => setField('github', value)}
            />
          </Field>
          <Field
            field="repositoryName"
            label="repositoryName — its name in the Space (optional)"
            problem={problemOf('repositoryName')}
          >
            <TextInput
              field="repositoryName"
              value={fields.repositoryName}
              problem={problemOf('repositoryName')}
              placeholder="the name part of github"
              onChange={(value) => setField('repositoryName', value)}
            />
          </Field>
        </>
      )}

      {create && <RepositoriesField view={view} problemOf={problemOf} />}
    </>
  );

  const unshown = problems.filter((problem) => !shown.has(problem.field));

  return (
    <form
      style={formStyle}
      aria-labelledby="setup-form-title"
      data-testid="setup-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !planning) void view.showPlan();
      }}
    >
      <h2 id="setup-form-title" style={sectionTitleStyle}>
        The form
      </h2>
      {unshown.length > 0 && <ProblemList problems={unshown} />}
      {body}
      <div style={rowStyle}>
        <button
          type="submit"
          style={primaryButtonStyle}
          disabled={busy || planning}
          data-testid="setup-show-plan"
        >
          {planning ? 'Making the plan…' : 'Show the plan'}
        </button>
        <span style={hintStyle}>Nothing is created before you confirm the plan.</span>
      </div>
    </form>
  );
}

function RepositoriesField({
  view,
  problemOf,
}: {
  view: SetupFlowView;
  problemOf: (field: string) => string | null;
}): JSX.Element {
  const { fields, setField } = view;
  const update = (index: number, patch: Partial<{ address: string; name: string }>): void =>
    setField(
      'repositories',
      fields.repositories.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    );
  return (
    <fieldset style={fieldsetStyle} data-testid="setup-repositories">
      <legend style={labelStyle}>repositories — the repositories to include, by address</legend>
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
              <label htmlFor={fieldId(github)} style={labelStyle}>
                github — address {index + 1}
              </label>
              <TextInput
                field={github}
                value={entry.address}
                problem={addressProblem}
                placeholder="owner/name"
                onChange={(value) => update(index, { address: value })}
              />
              {addressProblem !== null && <Problem field={github} message={addressProblem} />}
            </div>
            <div style={fieldStyle}>
              <label htmlFor={fieldId(name)} style={labelStyle}>
                name — in the Space (optional)
              </label>
              <TextInput
                field={name}
                value={entry.name}
                problem={nameProblem}
                placeholder="the name part of the address"
                onChange={(value) => update(index, { name: value })}
              />
              {nameProblem !== null && <Problem field={name} message={nameProblem} />}
            </div>
            <button
              type="button"
              style={secondaryButtonStyle}
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
          data-testid="setup-repository-add"
          onClick={() =>
            setField('repositories', [...fields.repositories, { address: '', name: '' }])
          }
        >
          Add a repository
        </button>
      </div>
    </fieldset>
  );
}

function problemId(field: string): string {
  return `${fieldId(field)}-problem`;
}

function Field({
  field,
  label,
  problem,
  children,
}: {
  field: string;
  label: string;
  problem: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <label htmlFor={fieldId(field)} style={labelStyle}>
        {label}
      </label>
      {children}
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
    <ul id="setup-problems" tabIndex={-1} style={problemListStyle} data-testid="setup-problems">
      {problems.map((problem) => (
        <li key={`${problem.field}:${problem.message}`} style={problemStyle}>
          {problem.field}: {problem.message}
        </li>
      ))}
    </ul>
  );
}

function TextInput({
  field,
  value,
  problem,
  placeholder,
  onChange,
}: {
  field: string;
  value: string;
  problem: string | null;
  placeholder?: string;
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
      spellCheck={false}
      autoComplete="off"
      aria-invalid={problem !== null}
      aria-describedby={problem !== null ? problemId(field) : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.8rem' };

const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const fieldsetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  margin: 0,
  padding: '0.6rem',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
};

const repositoryRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr auto',
  alignItems: 'end',
  gap: '0.5rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--color-text-2)',
};

const checkLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.85rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  fontSize: '0.85rem',
  color: 'var(--color-text)',
  background: 'var(--color-inset)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  fontFamily: 'inherit',
};

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
};

const problemStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-danger-fg)',
};

const problemListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1.1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};
