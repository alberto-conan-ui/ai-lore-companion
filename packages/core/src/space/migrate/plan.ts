/**
 * The migration from v0.8 as a list of steps for the shared runner, and its
 * plan: what will go where, with this project's real counts and destinations,
 * shown before anything is created (section 5.9).
 *
 * Making the plan writes nothing, on disk or on GitHub: the source is read
 * with `readV08Project`, the target folder and the desk's ledger are read, and
 * GitHub is only asked (the signed-in account, a repository or a Project of
 * the Space's name, issues by their markers). Each step's `isDone` asks the
 * real state, so the plan of a half-done migration says which steps are done.
 *
 * `runMigration` runs the same list with the same runner, so progress, stop
 * and resume behave as setup's do.
 */

import { lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createGitPort } from '../exec/git-port.js';
import { isPathInside } from '../fs/paths.js';
import { DEFAULT_STAGES } from '../github/types.js';
import { readV08Project, V08_ARCHIVE_TOP_FILES } from '../legacy/v08-reader.js';
import type { V08Description, V08Problem } from '../legacy/v08-types.js';
import { readSpaceManifest } from '../manifest/space-manifest.js';
import { type Result, err, errorMessage, ok } from '../result.js';
import { corpusEntryFileName, templateCorpusEntryNamed } from '../setup/lore-writes.js';
import { parseGitHubAddress, validateCreateSpaceInput } from '../setup/names.js';
import { inspectSetupTarget } from '../setup/scaffold.js';
import {
  type CreateSpaceContext,
  FOREIGN_MATCH_KINDS,
  refuseForeignMatches,
} from '../setup/steps.js';
import type { SetupTargetState } from '../setup/types.js';
import { planSteps, runSteps } from '../steps/run-steps.js';
import type { RunStepsOptions, StepsFailure } from '../steps/types.js';
import type {
  MigrationContext,
  MigrationDeps,
  MigrationSettings,
  MigrationStep,
} from './context.js';
import { readMigrationLedger } from './ledger.js';
import { recordSourceStep } from './steps/01-record-source.js';
import { createSpaceStep } from './steps/02-create-space.js';
import { clonePayloadStep } from './steps/03-clone-payload.js';
import { archiveStep } from './steps/04-archive.js';
import { pointerStep } from './steps/05-pointer.js';
import { contractsStep } from './steps/06-contracts.js';
import { mirrorStep } from './steps/07-mirror.js';
import { workbenchStep } from './steps/08-workbench.js';
import { corpusEntryStep } from './steps/09-corpus-entry.js';
import { commitAndPushStep } from './steps/10-commit-and-push.js';
import { MANY_ISSUES, issuesStep } from './steps/11-issues.js';
import { installStep } from './steps/12-install.js';
import { verifyStep } from './steps/13-verify.js';
import {
  ARCHIVE_DIR,
  inProgressFocuses,
  loreRelative,
  migrationIssues,
  migrationTargets,
  pausedFocuses,
} from './targets.js';
import {
  MIGRATION_DEFAULT_FOCUS_STAGE,
  type MigrationFailure,
  type MigrationField,
  type MigrationFieldId,
  type MigrationForm,
  type MigrationInput,
  type MigrationMappingRow,
  type MigrationNotCarried,
  type MigrationPlan,
  type MigrationPlannedStep,
  type MigrationRefusal,
  type MigrationReport,
  type MigrationSourceRepository,
  type MigrationWarning,
} from './types.js';

/** The thirteen steps of section 5.9, in order. */
export function migrationSteps(): MigrationStep[] {
  return [
    recordSourceStep(),
    createSpaceStep(),
    clonePayloadStep(),
    archiveStep(),
    pointerStep(),
    contractsStep(),
    mirrorStep(),
    workbenchStep(),
    corpusEntryStep(),
    commitAndPushStep(),
    issuesStep(),
    installStep(),
    verifyStep(),
  ];
}

/** A migration made ready to plan or to run. */
export type PreparedMigration = {
  ctx: MigrationContext;
  steps: MigrationStep[];
  fields: MigrationField[];
  refusals: MigrationRefusal[];
  /** What the target folder holds, or `null` when a field's problem kept it from being looked at. */
  target: SetupTargetState | null;
};

function failure(
  kind: MigrationFailure['kind'],
  message: string,
  extra: Partial<MigrationFailure> = {},
): { ok: false; error: MigrationFailure } {
  return err({
    kind,
    message,
    refusal: null,
    problems: [],
    stepId: null,
    completed: [],
    skipped: [],
    ...extra,
  });
}

function refused(refusal: MigrationRefusal): { ok: false; error: MigrationFailure } {
  return failure('refused', refusal.message, { refusal });
}

/** Read the source with hashes; a project that is not v0.8 is refused. */
async function readSource(
  sourceRoot: string,
  deps: MigrationDeps,
): Promise<Result<V08Description, MigrationFailure>> {
  const read = await readV08Project(resolve(sourceRoot), { runner: deps.runner }, { hashes: true });
  if (read.ok) return read;
  switch (read.error.kind) {
    case 'older-than-v0.8':
      return refused({ kind: 'older-than-v0.8', message: read.error.message });
    case 'read-failed':
      return failure('read-failed', read.error.message);
    default:
      return refused({ kind: 'not-a-v0.8-project', message: read.error.message });
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() === true;
}

const FIELD_LABELS: Record<MigrationFieldId, string> = {
  parentDir: "The folder the new Space's folder is made in",
  name: "The new Space's name",
  owner: 'The GitHub owner of the Space repository and Project',
  description: 'What the Space is about',
  focusStage: 'The Stage of the in-progress focus',
  payloadGitHub: 'The payload repository on GitHub',
};

function isFieldId(field: string): field is MigrationFieldId {
  return Object.hasOwn(FIELD_LABELS, field);
}

/** Fill the form: the Human Lead's values, else the proposed ones; and say what is wrong with each. */
async function resolveFields(
  source: V08Description,
  form: MigrationForm,
  deps: MigrationDeps,
): Promise<{ settings: MigrationSettings; fields: MigrationField[] }> {
  let owner = form.owner;
  if (owner === undefined) {
    const account = await deps.github.auth();
    owner = account.ok ? account.value.account : '';
  }
  const origin = source.payloadRepository.originUrl;
  const settings: MigrationSettings = {
    parentDir: form.parentDir ?? dirname(source.root),
    name: form.name ?? `${source.project.name}-space`,
    owner,
    description: form.description ?? '',
    focusStage: form.focusStage ?? MIGRATION_DEFAULT_FOCUS_STAGE,
    private: form.private ?? true,
    payloadGitHub:
      form.payloadGitHub ?? (origin === null ? '' : (parseGitHubAddress(origin)?.fullName ?? '')),
  };

  const problems = new Map<MigrationFieldId, string>();
  const add = (field: MigrationFieldId, message: string): void => {
    if (!problems.has(field)) problems.set(field, message);
  };
  const payloadName = basename(settings.payloadGitHub);
  for (const problem of validateCreateSpaceInput({
    name: settings.name,
    description: settings.description,
    owner: settings.owner,
    parentDir: settings.parentDir,
    repositories: [
      {
        name: payloadName,
        github: settings.payloadGitHub,
        ...(origin === null ? {} : { cloneAddress: origin }),
      },
    ],
  })) {
    const field = problem.field.startsWith('repositories[') ? 'payloadGitHub' : problem.field;
    if (isFieldId(field)) add(field, problem.message);
  }
  if (settings.description.trim() === '') {
    add('description', 'Write what the Space is about. The v0.8 manifest holds no description.');
  }
  if (settings.payloadGitHub === '') {
    add(
      'payloadGitHub',
      "The payload repository's origin is not a GitHub address. Give the repository as owner/name.",
    );
  }
  if (origin === null) {
    add(
      'payloadGitHub',
      'The payload repository has no remote named origin. It is cloned fresh from its origin, so push it to GitHub first.',
    );
  }
  if (!DEFAULT_STAGES.includes(settings.focusStage)) {
    add('focusStage', `Choose one of ${DEFAULT_STAGES.join(', ')}.`);
  }
  if (!problems.has('parentDir') && !(await isDirectory(settings.parentDir))) {
    add('parentDir', `${settings.parentDir} is not a folder.`);
  }
  if (!problems.has('name')) {
    const taken = await templateCorpusEntryNamed(deps.templateDir, settings.name);
    if (taken !== null) {
      add(
        'name',
        `The Space's own corpus entry would be the file ${corpusEntryFileName(settings.name)}, and AI-Lore already has an entry of that name at ${taken}. Choose another name for the Space.`,
      );
    }
    const repository = `${settings.owner}/${settings.name}`.toLowerCase();
    if (repository === settings.payloadGitHub.toLowerCase()) {
      add(
        'name',
        `${settings.payloadGitHub} is the payload repository, and the Space repository would have the same name. Choose another name for the Space.`,
      );
    }
  }
  if (!problems.has('parentDir') && !problems.has('name')) {
    const spaceRoot = resolve(settings.parentDir, settings.name);
    const inside = isPathInside(source.root, spaceRoot);
    const holds = isPathInside(spaceRoot, source.root);
    if (!inside.ok || !holds.ok || inside.value || holds.value) {
      add(
        'parentDir',
        `The Space's folder ${spaceRoot} and the v0.8 project's folder ${source.root} may not hold one another, because the v0.8 folder is left exactly as it is.`,
      );
    }
  }

  const value: Record<MigrationFieldId, string> = {
    parentDir: settings.parentDir,
    name: settings.name,
    owner: settings.owner,
    description: settings.description,
    focusStage: settings.focusStage,
    payloadGitHub: settings.payloadGitHub,
  };
  const ids: MigrationFieldId[] = [
    'parentDir',
    'name',
    'owner',
    'description',
    'focusStage',
    'payloadGitHub',
  ];
  const fields = ids.map((id) => ({
    id,
    label: FIELD_LABELS[id],
    value: value[id],
    proposed: form[id] === undefined,
    options: id === 'focusStage' ? [...DEFAULT_STAGES] : [],
    suggestions:
      id === 'description' ? source.project.descriptionCandidates.map((c) => c.text) : [],
    problem: problems.get(id) ?? null,
  }));
  return { settings, fields };
}

function makeContext(
  source: V08Description,
  settings: MigrationSettings,
  deps: MigrationDeps,
): MigrationContext {
  const git = createGitPort(deps.runner);
  const spaceRoot = resolve(settings.parentDir, settings.name);
  const repositoryName = `${settings.owner}/${settings.name}`;
  const payload = {
    name: basename(settings.payloadGitHub),
    github: settings.payloadGitHub,
    cloneAddress: source.payloadRepository.originUrl ?? '',
  };
  const setup: CreateSpaceContext = {
    flow: 'create',
    deps,
    git,
    spaceRoot,
    repositoryName,
    found: { repository: null, project: null },
    byHand: [],
    lookups: {},
    viewSettings: [],
    name: settings.name,
    description: settings.description,
    owner: settings.owner,
    private: settings.private,
    repositories: [{ ...payload }],
  };
  return {
    deps,
    git,
    source,
    settings,
    spaceRoot,
    repositoryName,
    payload,
    setup,
    targets: migrationTargets(source, settings),
    issues: migrationIssues(source, settings),
    ledger: readMigrationLedger(deps.userDataDir, spaceRoot, source.root),
  };
}

/**
 * Whether the target folder may take this migration: absent, empty, or a
 * Space of this name and repository that is this migration half-done, which
 * the ledger records or whose manifest lists the payload repository.
 */
async function inspectTarget(
  ctx: MigrationContext,
): Promise<{ target: SetupTargetState | null; refusal: MigrationRefusal | null }> {
  const target = await inspectSetupTarget(ctx.spaceRoot, {
    name: ctx.settings.name,
    repository: ctx.repositoryName,
  });
  if (!target.ok) {
    // The ledger names this source: whatever the folder holds, it is this migration's own work.
    if (ctx.ledger.length > 0) return { target: 'half-made', refusal: null };
    return { target: null, refusal: { kind: 'target-not-empty', message: target.error.message } };
  }
  if (target.value !== 'half-made' || ctx.ledger.length > 0) {
    return { target: target.value, refusal: null };
  }
  const manifest = await readSpaceManifest(ctx.spaceRoot);
  const listsPayload =
    manifest.ok &&
    manifest.value.repositories.some(
      (repository) => repository.github.toLowerCase() === ctx.payload.github.toLowerCase(),
    );
  if (listsPayload) return { target: 'half-made', refusal: null };
  return {
    target: null,
    refusal: {
      kind: 'target-not-empty',
      message: `${ctx.spaceRoot} holds a Space named "${ctx.settings.name}" that is not a migration of ${ctx.source.root}: its manifest does not list ${ctx.payload.github}, and no migration of this project was recorded for it. Nothing is written there. Choose another name or folder.`,
    },
  };
}

/**
 * Read the source, fill the form, look at the target folder and ask GitHub
 * whether the Space's repository or Project belongs to something else. Writes
 * nothing. Fails only when the source cannot be migrated at all (older than
 * v0.8, not a v0.8 project, unreadable).
 */
export async function prepareMigration(
  input: MigrationInput,
  deps: MigrationDeps,
): Promise<Result<PreparedMigration, MigrationFailure>> {
  const source = await readSource(input.sourceRoot, deps);
  if (!source.ok) return source;
  const { settings, fields } = await resolveFields(source.value, input.form ?? {}, deps);
  const ctx = makeContext(source.value, settings, deps);
  const steps = migrationSteps();
  const refusals: MigrationRefusal[] = [];
  let target: SetupTargetState | null = null;
  if (fields.every((field) => field.problem === null || field.id === 'description')) {
    const inspected = await inspectTarget(ctx);
    target = inspected.target;
    if (inspected.refusal !== null) refusals.push(inspected.refusal);
    else {
      const foreign = await refuseForeignMatches(ctx.setup);
      if (!foreign.ok && FOREIGN_MATCH_KINDS.includes(foreign.error.kind)) {
        refusals.push({
          kind: foreign.error.kind === 'project-taken' ? 'project-taken' : 'repository-taken',
          message: foreign.error.message,
        });
      }
    }
  }
  return ok({ ctx, steps, fields, refusals, target });
}

function repositorySummary(
  repository: V08Description['payloadRepository'],
): MigrationSourceRepository {
  const { path, present, originUrl, branch, head, hasUncommittedChanges, changedCount } =
    repository;
  return { path, present, originUrl, branch, head, hasUncommittedChanges, changedCount };
}

function problemPaths(problems: V08Problem[], kinds: readonly string[]): string[] {
  return problems.filter((problem) => kinds.includes(problem.kind)).map((p) => p.path);
}

function underArchive(source: V08Description, path: string): boolean {
  const rel = loreRelative(source, path);
  return (
    rel.startsWith('memory/') ||
    rel.startsWith('references/') ||
    (V08_ARCHIVE_TOP_FILES as readonly string[]).includes(rel)
  );
}

/** What is copied to the archive and carried nowhere else, kind by kind. */
function notCarried(ctx: MigrationContext): MigrationNotCarried[] {
  const { source } = ctx;
  const handover = source.journal.newestHandover?.path ?? null;
  const focusNames = new Set([
    ...inProgressFocuses(source).map((f) => f.name),
    ...pausedFocuses(source).map((f) => f.name),
  ]);
  const byCategory = (category: string): string[] =>
    source.files.filter((file) => file.category === category).map((file) => file.path);
  const groups: [string, string[]][] = [
    ['Other notes', source.notepad.notes.filter((note) => note.role === 'note').map((n) => n.path)],
    [
      'Other journal entries',
      [
        ...source.journal.entries.map((entry) => entry.path).filter((path) => path !== handover),
        ...byCategory('journal-archive'),
      ],
    ],
    ['Project processes', source.processes.map((d) => d.path)],
    ['Tooling cards', source.toolingCards.map((d) => d.path)],
    ['Save-points', source.savePoints.map((d) => d.path)],
    ['Tracks', source.tracks.map((d) => d.path)],
    ['The stack', source.stackPath === null ? [] : [source.stackPath]],
    [
      'Finished focuses',
      source.finishedFocuses.flatMap((f) => [f.bodyPath ?? f.folderPath ?? f.name]),
    ],
    [
      'Focuses neither in progress nor paused',
      source.focuses
        .filter((focus) => !focusNames.has(focus.name))
        .map((focus) => focus.bodyPath ?? focus.folderPath ?? focus.name),
    ],
    ['References', source.references.map((d) => d.path)],
    ['Project verbs (no verb is carried)', source.projectVerbs.map((d) => d.path)],
    ['Other files', source.unmatched.filter((path) => underArchive(source, path))],
  ];
  return groups
    .filter(([, paths]) => paths.length > 0)
    .map(([what, paths]) => ({ what, count: paths.length, paths }));
}

function mapping(ctx: MigrationContext, left: MigrationNotCarried[]): MigrationMappingRow[] {
  const { source, targets, issues, repositoryName, settings } = ctx;
  const inProgress = issues.filter((issue) => issue.kind === 'focus' || issue.kind === 'stage');
  const paused = issues.filter((issue) => issue.kind === 'paused-focus');
  const backlog = issues.filter((issue) => issue.kind === 'backlog');
  const issueItem = (issue: (typeof issues)[number], words: string) => ({
    from: issue.key,
    to: `${repositoryName}: ${words}, linking to ${issue.archived}`,
  });
  return [
    {
      id: 'archive',
      source: 'The whole memory/ tree, references/ and ai_readme.md',
      destination: `${ARCHIVE_DIR}/, copied as it is`,
      count: targets.archived.length,
      items: [],
    },
    {
      id: 'contracts',
      source: "The project's contracts",
      destination: 'lore/contracts/ as own files, rule only, with frontmatter',
      count: targets.contracts.length,
      items: targets.contracts.map((card) => ({ from: card.from, to: card.to })),
    },
    {
      id: 'mirror',
      source: 'The mirror',
      destination: `${targets.mirror.to}, prose carried, skeleton generated fresh`,
      count: targets.mirror.from.length,
      items: targets.mirror.from.map((from) => ({ from, to: targets.mirror.to })),
    },
    {
      id: 'in-progress-focus',
      source: 'The in-progress focus',
      destination: `A focus issue at the Stage ${settings.focusStage} in ${repositoryName}; its stages become sub-issues linking to their archived files`,
      count: inProgress.filter((issue) => issue.kind === 'focus').length,
      items: inProgress.map((issue) =>
        issueItem(
          issue,
          issue.kind === 'focus' ? `focus issue at ${settings.focusStage}` : 'sub-issue',
        ),
      ),
    },
    {
      id: 'paused-focuses',
      source: 'Paused focuses',
      destination: `One standalone issue each in ${repositoryName}, labelled paused, linking to the archived subtree`,
      count: paused.length,
      items: paused.map((issue) => issueItem(issue, 'issue labelled paused')),
    },
    {
      id: 'backlog',
      source: 'Backlog items',
      destination: `One standalone issue per backlog item in ${repositoryName}, linking to the archived file`,
      count: backlog.length,
      items: backlog.map((issue) => issueItem(issue, 'issue')),
    },
    {
      id: 'handover',
      source: 'The newest journal handover',
      destination: 'The first entry of workbench/journal/',
      count: targets.handover === null ? 0 : 1,
      items:
        targets.handover === null ? [] : [{ from: targets.handover.from, to: targets.handover.to }],
    },
    {
      id: 'drafts',
      source: 'The product document, its images, the critique note',
      destination: 'workbench/drafts/, the draft spec of the in-progress focus',
      count: targets.drafts.length,
      items: targets.drafts.map((draft) => ({ from: draft.from, to: draft.to })),
    },
    {
      id: 'archive-only',
      source:
        'Other notes, other journal entries, project processes, tooling cards, save-points, tracks, the stack, finished focuses, references',
      destination: `${ARCHIVE_DIR}/ only`,
      count: left.reduce((sum, group) => sum + group.count, 0),
      items: [],
    },
    {
      id: 'name-and-description',
      source: 'Project name and description',
      destination: `The Space's corpus entry, ${targets.corpusEntry}`,
      count: 1,
      items: [
        {
          from: `The project's name "${source.project.name}" (${source.project.namePath}) and the description written on this screen`,
          to: targets.corpusEntry,
        },
      ],
    },
  ];
}

function warnings(ctx: MigrationContext): MigrationWarning[] {
  const { source, targets, issues } = ctx;
  const found: MigrationWarning[] = [];
  for (const [words, repository] of [
    ['payload repository', source.payloadRepository],
    ['Lore repository', source.loreRepository],
  ] as const) {
    if (repository.hasUncommittedChanges) {
      found.push({
        kind: 'uncommitted-changes',
        message: `The ${words} (${repository.path}) has ${repository.changedCount} uncommitted change${repository.changedCount === 1 ? '' : 's'}. The files as they are on disk are what is copied; you may continue.`,
        paths: [repository.path],
      });
    }
  }
  const unreadable = problemPaths(source.problems, ['unreadable', 'too-large']);
  if (unreadable.length > 0) {
    found.push({
      kind: 'unreadable-files',
      message: `${unreadable.length} file${unreadable.length === 1 ? '' : 's'} could not be read as text. They are still copied to the archive when they can be copied.`,
      paths: unreadable,
    });
  }
  const lineByLine = problemPaths(source.problems, ['bad-frontmatter']);
  if (lineByLine.length > 0) {
    found.push({
      kind: 'frontmatter-line-by-line',
      message: `The frontmatter of ${lineByLine.length} file${lineByLine.length === 1 ? '' : 's'} is not valid YAML and was read line by line, so a title or a status may be missing from the plan.`,
      paths: lineByLine,
    });
  }
  if (issues.length > MANY_ISSUES) {
    found.push({
      kind: 'many-issues',
      message: `The migration creates ${issues.length} issues. GitHub allows about 500 an hour, so the issues step waits between them and may take more than an hour.`,
      paths: [],
    });
  }
  if (targets.refusedLinks.length > 0) {
    found.push({
      kind: 'links-not-copied',
      message: `${targets.refusedLinks.length} link${targets.refusedLinks.length === 1 ? '' : 's'} point outside their folder, at a folder or at nothing, and are not copied to the archive.`,
      paths: targets.refusedLinks,
    });
  }
  const outside = source.unmatched.filter((path) => !underArchive(source, path));
  if (outside.length > 0) {
    found.push({
      kind: 'not-copied',
      message: `${outside.length} file${outside.length === 1 ? ' is' : 's are'} in the Lore folder outside memory/, references/ and ai_readme.md, and ${outside.length === 1 ? 'is' : 'are'} not carried.`,
      paths: outside,
    });
  }
  const inProgress = inProgressFocuses(source);
  if (inProgress.length > 1) {
    found.push({
      kind: 'several-in-progress',
      message: `${inProgress.length} focuses are in progress. Each becomes a focus issue at the chosen Stage.`,
      paths: inProgress.map((focus) => focus.bodyPath ?? focus.name),
    });
  }
  if (inProgress.length === 0) {
    found.push({
      kind: 'no-in-progress-focus',
      message:
        'No focus is in progress, so no focus issue is created and the drafts belong to no focus.',
      paths: [],
    });
  }
  if (!source.complete) {
    found.push({
      kind: 'incomplete-read',
      message: 'The v0.8 project was not read in full; the counts may be low.',
      paths: problemPaths(source.problems, ['limit-reached']),
    });
  }
  return found;
}

function stepsFailure(failed: StepsFailure): { ok: false; error: MigrationFailure } {
  const { kind, message, stepId, completed, skipped } = failed;
  return failure(kind, message, { stepId, completed, skipped });
}

/**
 * The plan of migrating the v0.8 project at `input.sourceRoot`. Nothing is
 * written, on disk or on GitHub. When a field has a problem or the migration
 * is refused, each step is described and not asked whether it is done.
 */
export async function planMigration(
  input: MigrationInput,
  deps: MigrationDeps,
): Promise<Result<MigrationPlan, MigrationFailure>> {
  const prepared = await prepareMigration(input, deps);
  if (!prepared.ok) return prepared;
  const { ctx, steps, fields, refusals, target } = prepared.value;
  const blocked = refusals.length > 0 || fields.some((field) => field.problem !== null);

  let planned: MigrationPlannedStep[];
  if (blocked) {
    planned = [];
    for (const step of steps) {
      try {
        const lines = await step.describe(ctx);
        planned.push({
          stepId: step.id,
          number: step.number,
          title: step.title,
          done: false,
          lines,
        });
      } catch (caught) {
        return failure(
          'step-threw',
          `The step "${step.title}" could not be described: ${errorMessage(caught)}`,
          {
            stepId: step.id,
          },
        );
      }
    }
  } else {
    const asked = await planSteps(steps, ctx);
    if (!asked.ok) return stepsFailure(asked.error);
    planned = asked.value.map((one, index) => {
      const step = steps[index];
      return { ...one, stepId: step?.id ?? 'verify', number: step?.number ?? index + 1 };
    });
  }

  const left = notCarried(ctx);
  const { source } = ctx;
  const fieldsGiveRoot = !fields.some(
    (f) => ['parentDir', 'name', 'owner'].includes(f.id) && f.problem !== null,
  );
  return ok({
    source: {
      root: source.root,
      projectName: source.project.name,
      coreVersion: source.core.version,
      loreFolder: source.loreFolder,
      payloadRepository: repositorySummary(source.payloadRepository),
      loreRepository: repositorySummary(source.loreRepository),
      complete: source.complete,
    },
    spaceRoot: fieldsGiveRoot ? ctx.spaceRoot : null,
    repository: fieldsGiveRoot ? ctx.repositoryName : null,
    target,
    fields,
    steps: planned,
    mapping: mapping(ctx, left),
    notCarried: left,
    issues: ctx.issues,
    warnings: warnings(ctx),
    refusals,
    ready: !blocked,
  });
}

/**
 * Run the migration: the thirteen steps with the shared runner, skipping each
 * that is done. A migration that stopped is continued by calling this again
 * with the same input. Refused, or stopped before the first step, when the
 * plan would not be ready.
 */
export async function runMigration(
  input: MigrationInput,
  deps: MigrationDeps,
  options: RunStepsOptions = {},
): Promise<Result<MigrationReport, MigrationFailure>> {
  const prepared = await prepareMigration(input, deps);
  if (!prepared.ok) return prepared;
  const { ctx, steps, fields, refusals } = prepared.value;
  const [refusal] = refusals;
  if (refusal !== undefined) return refused(refusal);
  const problems = fields.flatMap((field) =>
    field.problem === null ? [] : [{ field: field.id, message: field.problem }],
  );
  if (problems.length > 0) {
    return failure(
      'invalid-input',
      `Nothing was done. ${problems.map((p) => p.message).join(' ')}`,
      { problems },
    );
  }
  const done = await runSteps(steps, ctx, options);
  if (!done.ok) return stepsFailure(done.error);
  return ok({
    spaceRoot: ctx.spaceRoot,
    repository: ctx.repositoryName,
    completed: done.value.completed,
    skipped: done.value.skipped,
  });
}
