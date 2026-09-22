/**
 * The steps of setup, as `Step`s for the step runner.
 *
 * Every step asks the real state before it acts: GitHub through the port, the
 * disk, git. None keeps a ledger, and none removes what an earlier run made,
 * so a setup that was killed is finished by running the same steps again.
 * GitHub writes are sequential.
 */

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Desk } from '../desk/desk.js';
import { closeDesk, openDesk } from '../desk/open.js';
import { currentDeskInstance } from '../desk/owner.js';
import { getFirstSeen, recordFirstSeen } from '../desk/root-commits.js';
import { type GitPort, runGit } from '../exec/git-port.js';
import { runSucceeded } from '../exec/runner.js';
import { realpathNearest } from '../fs/paths.js';
import type { GitHubError } from '../github/errors.js';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  DEFAULT_VIEWS,
  DEFAULT_STAGES,
  KIND_LABELS,
  LEVEL_FIELD,
  LEVEL_VALUES,
  type LabelSpec,
  type ProjectInfo,
  type ProjectViewSpec,
  type RepositoryInfo,
  SESSION_LABEL,
  STAGE_FIELD,
  STATUS_FIELD,
} from '../github/types.js';
import { installClaudeCode, planClaudeCodeInstall } from '../install/writer.js';
import { deskPaths } from '../layout/desk-paths.js';
import { SPACE_LAYOUT, spacePaths } from '../layout/space-paths.js';
import { readLore } from '../lore/reader.js';
import { GH_ADD_SCOPE_COMMAND, GH_SIGN_IN_COMMAND, GITHUB_HOST } from '../machine/guidance.js';
import { type SpaceManifestRepository, readSpaceManifest } from '../manifest/space-manifest.js';
import { type Result, err, fail, ok } from '../result.js';
import { resolveRoots } from '../roots/resolve-roots.js';
import type { Root } from '../roots/types.js';
import type { PlanLine, Step, StepError } from '../steps/types.js';
import {
  hasRepositoryMirror,
  hasSpaceCorpusEntry,
  writeRepositoryMirror,
  writeSpaceCorpusEntry,
} from './lore-writes.js';
import {
  type ScaffoldInput,
  ensureDeskFolders,
  hasDeskFolders,
  isScaffolded,
  listTemplateFiles,
  scaffoldSpace,
} from './scaffold.js';
import type {
  SetupCheckId,
  SetupCheckProgress,
  SetupDeps,
  SetupFlow,
  SetupRepositoryInput,
  SetupViewSetting,
} from './types.js';

/** The ids of the two steps run on every setup, whether or not there is anything left for them to do. */
export const ALWAYS_RUN_STEP_IDS: readonly string[] = ['machine-check', 'project-layout'];

/** The labels setup creates in the Space repository: the kinds of a focus, and the mark of a session issue. */
export const SETUP_LABELS: readonly LabelSpec[] = [
  ...KIND_LABELS.map((name) => ({
    name,
    color: '1d76db',
    description: `Work of the kind ${name}`,
  })),
  {
    name: SESSION_LABEL,
    color: 'bfd4f2',
    description: 'The issue of a session, shown on the Agents board',
  },
];

/**
 * The views of the default Project layout that exist from setup.
 *
 * Defined in the github layer beside the fields they filter on, because the
 * snapshot checks a Project against them and must not import setup to do it.
 */
export const SETUP_VIEWS = DEFAULT_VIEWS;

/** The message of the Space repository's first commit. */
export const FIRST_COMMIT_MESSAGE = 'Scaffold the Space';

/** What the steps of one setup share. The two lookups are kept so that GitHub is asked once for each. */
export type SetupContext = {
  flow: SetupFlow;
  deps: SetupDeps;
  git: GitPort;
  /** The Space's folder. */
  spaceRoot: string;
  /** The Space repository, as `owner/name`. */
  repositoryName: string;
  found: { repository: RepositoryInfo | null; project: ProjectInfo | null };
  /** The by-hand sentences gathered by the Project's layout step. */
  byHand: string[];
  /**
   * GitHub's whole answer for each lookup, `null` and failures included,
   * cached for the life of this context (one plan or one run).
   */
  lookups: {
    repository?: Result<RepositoryInfo | null, StepError>;
    project?: Result<ProjectInfo | null, StepError>;
  };
  /** Whether `refuseForeignMatches` already ran, cached for the life of this context. */
  foreign?: Result<void, StepError & { stepId: 'space-repository' | 'project' }>;
  /** The view settings gathered by the Project's layout step, with their links. */
  viewSettings: SetupViewSetting[];
  /** Called as each of the plan's own checks (not a step) runs. */
  onCheck?: (progress: SetupCheckProgress) => void;
};

/** The context of "create a Space" and of "adopt a repository". */
export type CreateSpaceContext = SetupContext & {
  name: string;
  description: string;
  owner: string;
  private: boolean;
  repositories: SetupRepositoryInput[];
};

/** The context of "open a Space by address". */
export type OpenSpaceContext = SetupContext & {
  /** The names of the manifest's repositories confirmed for cloning. */
  confirmed: string[];
};

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The failure of a step that GitHub stopped: GitHub's own message, then the
 * sentence that says what the Human Lead does about it. The kind is
 * `github-<kind of the GitHub error>`.
 */
export function gitHubStepError(error: GitHubError): StepError {
  let guidance: string;
  switch (error.kind) {
    case 'unreachable':
      guidance =
        'Check the network connection and run setup again. What was done so far stays in place.';
      break;
    case 'not-signed-in':
      guidance = `Sign in with \`${GH_SIGN_IN_COMMAND}\` in a terminal, then run setup again.`;
      break;
    case 'missing-scope':
      guidance = `Add the scope with \`${
        error.scope === 'project'
          ? GH_ADD_SCOPE_COMMAND
          : `gh auth refresh --hostname ${GITHUB_HOST} --scopes ${error.scope}`
      }\` in a terminal, then run setup again.`;
      break;
    case 'rate-limited':
      guidance =
        error.retryAfterSeconds === null
          ? 'GitHub asked for a pause. Run setup again in a few minutes.'
          : `GitHub asked for a pause. Run setup again after ${error.retryAfterSeconds} seconds.`;
      break;
    default:
      guidance = 'Run setup again when the cause is removed. What was done so far stays in place.';
  }
  return { kind: `github-${error.kind}`, message: `${sentence(error.message)} ${guidance}` };
}

function stepFail(kind: string, message: string): Result<never, StepError> {
  return fail(kind, message);
}

function gitHubFail(error: GitHubError): Result<never, StepError> {
  return err(gitHubStepError(error));
}

/** Report one event of the plan's own checks. A caller that gave no `onCheck` hears nothing. */
function reportCheck(
  ctx: SetupContext,
  checkId: SetupCheckId,
  state: 'running' | 'done' | 'failed',
  text: string,
): void {
  ctx.onCheck?.({ checkId, state, text });
}

/**
 * The Space repository on GitHub, or `null`. GitHub is asked once per context
 * (one plan or one run): the whole answer, `null` and a failure included, is
 * cached in `ctx.lookups.repository`.
 */
async function lookupRepository(
  ctx: SetupContext,
): Promise<Result<RepositoryInfo | null, StepError>> {
  if (ctx.found.repository !== null) return ok(ctx.found.repository);
  if (ctx.lookups.repository !== undefined) return ctx.lookups.repository;
  const found = await ctx.deps.github.findRepository(ctx.repositoryName);
  const result: Result<RepositoryInfo | null, StepError> = found.ok
    ? ok(found.value)
    : gitHubFail(found.error);
  ctx.lookups.repository = result;
  if (result.ok && result.value !== null) ctx.found.repository = result.value;
  return result;
}

/** The Project named after the Space, or `null`. GitHub is asked once per context. */
async function lookupProject(
  ctx: CreateSpaceContext,
): Promise<Result<ProjectInfo | null, StepError>> {
  if (ctx.found.project !== null) return ok(ctx.found.project);
  if (ctx.lookups.project !== undefined) return ctx.lookups.project;
  const found = await ctx.deps.github.findProject({ owner: ctx.owner, title: ctx.name });
  const result: Result<ProjectInfo | null, StepError> = found.ok
    ? ok(found.value)
    : gitHubFail(found.error);
  ctx.lookups.project = result;
  if (result.ok && result.value !== null) ctx.found.project = result.value;
  return result;
}

/**
 * The kinds of failure for a match on GitHub that is not this Space's own.
 * `repository-taken`: a repository of the Space's name that holds other commits.
 * `project-taken`: an open Project of the Space's title that holds items.
 */
export const FOREIGN_MATCH_KINDS: readonly string[] = ['repository-taken', 'project-taken'];

/**
 * Whether the repository GitHub answered with is this Space's own. It is when
 * it has no commit, which is what a run that was killed leaves and holds
 * nothing to lose; or when the Space's folder is a git repository whose origin
 * is this repository and whose commit the repository has, or whose branch was
 * pushed to it before.
 */
async function repositoryIsOwn(
  ctx: CreateSpaceContext,
  repository: RepositoryInfo,
): Promise<Result<boolean, StepError>> {
  const heads = await ctx.deps.github.branchHeads(repository.fullName);
  if (!heads.ok) return gitHubFail(heads.error);
  const commits = heads.value ?? [];
  if (commits.length === 0) return ok(true);
  if (!(await isOwnWorkTree(ctx.git, ctx.spaceRoot))) return ok(false);
  const origin = await ctx.git.originUrl(ctx.spaceRoot);
  if (!origin.ok || origin.value !== repository.cloneUrl) return ok(false);
  const head = await ctx.git.head(ctx.spaceRoot);
  if (!head.ok) return ok(false);
  return ok(commits.includes(head.value) || (await isPushed(ctx)));
}

/**
 * Whether the Project GitHub answered with is this Space's own. It is when the
 * manifest in the Space's folder names its number, or when it holds no item,
 * which is what a run that was killed leaves.
 */
async function projectIsOwn(
  ctx: CreateSpaceContext,
  project: ProjectInfo,
): Promise<Result<boolean, StepError>> {
  const manifest = await readSpaceManifest(ctx.spaceRoot);
  if (manifest.ok && manifest.value.github.project === project.number) return ok(true);
  const snapshot = await ctx.deps.github.readProject({ project });
  if (!snapshot.ok) return gitHubFail(snapshot.error);
  const { focuses, standalone, sessions } = snapshot.value;
  return ok(focuses.length + standalone.length + sessions.length === 0);
}

/**
 * Report the project check's outcome from a lookup that already settled,
 * without running `projectIsOwn` (no extra GitHub call). Used when the
 * repository check fails or refuses first: the project lookup ran at the same
 * time (`Promise.all`) and would otherwise never be reported, leaving a
 * progress screen's Project row stuck at "running".
 */
function reportProjectLookupOutcome(
  ctx: CreateSpaceContext,
  project: Result<ProjectInfo | null, StepError>,
): void {
  if (!project.ok) {
    reportCheck(ctx, 'project', 'failed', project.error.message);
    return;
  }
  reportCheck(
    ctx,
    'project',
    'done',
    project.value === null
      ? `No Project named ${ctx.name} yet`
      : `The Project ${ctx.name} exists and belongs to this Space`,
  );
}

/**
 * Refuse a repository or a Project of the Space's name that GitHub already has
 * and that is not this Space's own. GitHub finds a repository by `owner/name`
 * and a Project by its owner and its exact title among the open ones, so a
 * match says nothing about who made it. The answer is kept, so GitHub is asked
 * once per context. It reads only, and it is asked before the repository is
 * created, so a refusal leaves nothing on GitHub.
 *
 * The two lookups run at the same time; each is reported to `ctx.onCheck` as
 * it runs and as it finishes, with the texts of the architecture document's
 * table of check progress.
 */
export async function refuseForeignMatches(
  ctx: CreateSpaceContext,
): Promise<Result<void, StepError & { stepId: 'space-repository' | 'project' }>> {
  if (ctx.foreign !== undefined) return ctx.foreign;

  const stopAt = (
    stepId: 'space-repository' | 'project',
    error: StepError,
  ): Result<never, StepError & { stepId: 'space-repository' | 'project' }> => {
    const tagged = err({ ...error, stepId });
    ctx.foreign = tagged;
    return tagged;
  };

  reportCheck(
    ctx,
    'repository',
    'running',
    `Looking for the repository ${ctx.repositoryName} on GitHub`,
  );
  reportCheck(ctx, 'project', 'running', `Looking for a Project named ${ctx.name}`);
  const [repository, project] = await Promise.all([lookupRepository(ctx), lookupProject(ctx)]);

  if (!repository.ok) {
    reportCheck(ctx, 'repository', 'failed', repository.error.message);
    reportProjectLookupOutcome(ctx, project);
    return stopAt('space-repository', repository.error);
  }
  if (repository.value !== null) {
    const own = await repositoryIsOwn(ctx, repository.value);
    if (!own.ok) {
      reportCheck(ctx, 'repository', 'failed', own.error.message);
      reportProjectLookupOutcome(ctx, project);
      return stopAt('space-repository', own.error);
    }
    if (!own.value) {
      const error: StepError = {
        kind: 'repository-taken',
        message: `The repository ${ctx.repositoryName} already exists on GitHub and holds commits that are not those of ${ctx.spaceRoot}, so nothing was created and nothing was pushed to it. Choose another name for the Space, or, when that repository is this Space, open it from its GitHub address.`,
      };
      reportCheck(ctx, 'repository', 'failed', error.message);
      reportProjectLookupOutcome(ctx, project);
      return stopAt('space-repository', error);
    }
    reportCheck(
      ctx,
      'repository',
      'done',
      `The repository ${ctx.repositoryName} exists and belongs to this Space`,
    );
  } else {
    reportCheck(
      ctx,
      'repository',
      'done',
      `The repository ${ctx.repositoryName} does not exist yet`,
    );
  }

  if (!project.ok) {
    reportCheck(ctx, 'project', 'failed', project.error.message);
    return stopAt('project', project.error);
  }
  if (project.value !== null) {
    const own = await projectIsOwn(ctx, project.value);
    if (!own.ok) {
      reportCheck(ctx, 'project', 'failed', own.error.message);
      return stopAt('project', own.error);
    }
    if (!own.value) {
      const error: StepError = {
        kind: 'project-taken',
        message: `${ctx.owner} already has an open Project titled "${ctx.name}" (${project.value.url}) that holds items and is not named by a manifest in ${ctx.spaceRoot}, so nothing was created and the Project was left as it is. Choose another name for the Space, or rename or close that Project on GitHub.`,
      };
      reportCheck(ctx, 'project', 'failed', error.message);
      return stopAt('project', error);
    }
    reportCheck(ctx, 'project', 'done', `The Project ${ctx.name} exists and belongs to this Space`);
  } else {
    reportCheck(ctx, 'project', 'done', `No Project named ${ctx.name} yet`);
  }

  const settled = ok<void>(undefined);
  ctx.foreign = settled;
  return settled;
}

/** Whether `dir` is the top folder of a git working tree of its own. */
async function isOwnWorkTree(git: GitPort, dir: string): Promise<boolean> {
  if ((await lstat(dir).catch(() => null))?.isDirectory() !== true) return false;
  const top = await git.topLevel(dir);
  if (!top.ok || top.value === null) return false;
  try {
    return realpathNearest(top.value) === realpathNearest(dir);
  } catch {
    return false;
  }
}

async function isEmptyOrAbsent(dir: string): Promise<boolean> {
  const info = await lstat(dir).catch(() => null);
  if (info === null) return true;
  if (!info.isDirectory()) return false;
  return (await readdir(dir)).length === 0;
}

// ---------- the machine ----------

/**
 * Check the machine. It is never skipped, because the state of the machine is
 * not something an earlier run leaves behind; the check only reads.
 */
export function machineCheckStep(): Step<SetupContext> {
  return {
    id: 'machine-check',
    title: 'Check the machine',
    describe: async () => [
      { what: 'Check that git, gh, an AI engine and python3 are on the machine and signed in.' },
    ],
    isDone: async () => false,
    run: async (ctx) => {
      const check = await ctx.deps.checkMachine();
      if (check.ready) return ok(undefined);
      const missing = check.requirements
        .filter((requirement) => requirement.state.kind !== 'fine')
        .map((requirement) => sentence(requirement.guidance ?? `${requirement.id} is not ready`));
      return stepFail(
        'machine-not-ready',
        `The machine is not ready for setup. ${missing.join(' ')} Nothing was created.`,
      );
    },
  };
}

// ---------- GitHub ----------

/** Create or find the Space repository. */
export function spaceRepositoryStep(): Step<CreateSpaceContext> {
  return {
    id: 'space-repository',
    title: 'Create the Space repository',
    describe: async (ctx) => [
      {
        what: `Create the ${ctx.private ? 'private' : 'public'} repository on GitHub, or use it when it exists.`,
        to: ctx.repositoryName,
      },
    ],
    isDone: async (ctx) => {
      // A match that is not this Space's own is not "done": the step runs and refuses it.
      if (!(await refuseForeignMatches(ctx)).ok) return false;
      const found = await lookupRepository(ctx);
      return found.ok && found.value !== null;
    },
    run: async (ctx) => {
      const foreign = await refuseForeignMatches(ctx);
      if (!foreign.ok) return foreign;
      const found = await lookupRepository(ctx);
      if (!found.ok) return found;
      if (found.value !== null) return ok(undefined);
      const created = await ctx.deps.github.createRepository({
        owner: ctx.owner,
        name: ctx.name,
        private: ctx.private,
      });
      if (!created.ok) return gitHubFail(created.error);
      ctx.found.repository = created.value;
      ctx.lookups.repository = ok(created.value);
      return ok(undefined);
    },
  };
}

/** Create or find the Project, titled with the Space's name. */
export function projectStep(): Step<CreateSpaceContext> {
  return {
    id: 'project',
    title: 'Create the Project',
    describe: async (ctx) => [
      {
        what: `Create the GitHub Project "${ctx.name}" of ${ctx.owner}, or use it when it exists.`,
      },
    ],
    isDone: async (ctx) => {
      if (!(await refuseForeignMatches(ctx)).ok) return false;
      const found = await lookupProject(ctx);
      return found.ok && found.value !== null;
    },
    run: async (ctx) => {
      const foreign = await refuseForeignMatches(ctx);
      if (!foreign.ok) return foreign;
      const found = await lookupProject(ctx);
      if (!found.ok) return found;
      if (found.value !== null) return ok(undefined);
      const created = await ctx.deps.github.createProject({ owner: ctx.owner, title: ctx.name });
      if (!created.ok) return gitHubFail(created.error);
      ctx.found.project = created.value;
      ctx.lookups.project = ok(created.value);
      return ok(undefined);
    },
  };
}

/**
 * The Project's layout: the Level field, the Stage field, the Agents field,
 * the labels, the link to the repository and the three views. The port has no read for the
 * labels, the link or the views, so this step is never skipped; each of the
 * port's `ensure…` operations checks before it acts, and a second run creates
 * nothing twice. What the API cannot set is gathered in `ctx.byHand`.
 */
export function projectLayoutStep(): Step<CreateSpaceContext> {
  return {
    id: 'project-layout',
    title: 'Set up the Project',
    describe: async (ctx) => [
      { what: `Make sure the field ${LEVEL_FIELD} has the values ${LEVEL_VALUES.join(', ')}.` },
      { what: `Make sure the field ${STAGE_FIELD} has the values ${DEFAULT_STAGES.join(', ')}.` },
      { what: `Make sure the field ${AGENTS_FIELD} has the values ${AGENTS_COLUMNS.join(', ')}.` },
      {
        what: `Make sure the repository has the labels ${SETUP_LABELS.map((label) => label.name).join(', ')}.`,
        count: SETUP_LABELS.length,
      },
      { what: 'Link the Project to the repository.', to: ctx.repositoryName },
      {
        what: `Make sure the Project has the views ${SETUP_VIEWS.map((view) => view.name).join(', ')}.`,
        count: SETUP_VIEWS.length,
      },
    ],
    isDone: async () => false,
    run: async (ctx) => {
      const github = ctx.deps.github;
      const found = await lookupProject(ctx);
      if (!found.ok) return found;
      const project = found.value;
      if (project === null) {
        return stepFail(
          'project-missing',
          `The Project "${ctx.name}" of ${ctx.owner} was not found on GitHub.`,
        );
      }
      // The category is recorded and not derived, so that a GitHub filter can
      // select exactly what the Dashboard computes. Without this field every
      // issue reads as an item and the snapshot reports each one.
      const level = await github.ensureSingleSelectField({
        project,
        name: LEVEL_FIELD,
        options: [...LEVEL_VALUES],
      });
      if (!level.ok) return gitHubFail(level.error);
      const stage = await github.ensureSingleSelectField({
        project,
        name: STAGE_FIELD,
        options: [...DEFAULT_STAGES],
      });
      if (!stage.ok) return gitHubFail(stage.error);
      const agents = await github.ensureSingleSelectField({
        project,
        name: AGENTS_FIELD,
        options: [...AGENTS_COLUMNS],
      });
      if (!agents.ok) return gitHubFail(agents.error);
      const labels = await github.ensureLabels({
        repository: ctx.repositoryName,
        labels: SETUP_LABELS.map((label) => ({ ...label })),
      });
      if (!labels.ok) return gitHubFail(labels.error);
      const linked = await github.linkProjectToRepository({
        project,
        repository: ctx.repositoryName,
      });
      if (!linked.ok) return gitHubFail(linked.error);

      const byHand: string[] = [];
      const viewSettings: SetupViewSetting[] = [];
      for (const spec of SETUP_VIEWS) {
        const view = await github.ensureProjectView({ project, spec });
        if (!view.ok) return gitHubFail(view.error);
        byHand.push(...view.value.byHand);
        const url =
          view.value.view !== null ? `${project.url}/views/${view.value.view.number}` : null;
        // The grouping of "Items by focus" used to be a named special case
        // here, pushed whether or not it was already set. Both groupings are
        // spec fields now, and `ensureProjectView` reports only the ones a
        // reading of the view says are still outstanding.
        if (spec.columnField !== undefined) {
          viewSettings.push({
            view: spec.name,
            setting: `Set "Column by" to the field "${spec.columnField}".`,
            url,
          });
        }
        if (spec.groupField !== undefined) {
          viewSettings.push({
            view: spec.name,
            setting: `Set "Group by" to the field "${spec.groupField}".`,
            url,
          });
        }
      }
      ctx.byHand.splice(0, ctx.byHand.length, ...byHand);
      ctx.viewSettings.splice(0, ctx.viewSettings.length, ...viewSettings);
      return ok(undefined);
    },
  };
}

// ---------- the Space's folder ----------

function manifestRepositories(ctx: CreateSpaceContext): SpaceManifestRepository[] {
  return ctx.repositories.map((repository) => ({
    name: repository.name,
    github: repository.github,
  }));
}

function scaffoldInput(ctx: CreateSpaceContext, project: number): ScaffoldInput {
  return {
    templateDir: ctx.deps.templateDir,
    spaceRoot: ctx.spaceRoot,
    manifest: {
      name: ctx.name,
      repository: ctx.repositoryName,
      project,
      repositories: manifestRepositories(ctx),
    },
  };
}

/** Scaffold the Space's folder from the template, with the manifest filled in. */
export function scaffoldStep(): Step<CreateSpaceContext> {
  return {
    id: 'scaffold',
    title: "Make the Space's folder",
    describe: async (ctx) => [
      {
        what: 'Copy the Lore template. A file that is already there is kept.',
        from: ctx.deps.templateDir,
        to: ctx.spaceRoot,
        count: (await listTemplateFiles(ctx.deps.templateDir)).length,
      },
      {
        what: `Write ${SPACE_LAYOUT.manifest} with the Space's name, its repository, its Project and its repositories.`,
      },
      {
        what: 'Write .gitignore, and create workbench/ and repos/, which the Space repository ignores.',
      },
    ],
    isDone: async (ctx) => {
      const project = await lookupProject(ctx);
      if (!project.ok || project.value === null) return false;
      return isScaffolded(scaffoldInput(ctx, project.value.number));
    },
    run: async (ctx) => {
      const project = await lookupProject(ctx);
      if (!project.ok) return project;
      if (project.value === null) {
        return stepFail(
          'project-missing',
          `The Project "${ctx.name}" of ${ctx.owner} was not found on GitHub.`,
        );
      }
      const made = await scaffoldSpace(scaffoldInput(ctx, project.value.number));
      return made.ok ? ok(undefined) : made;
    },
  };
}

/** Write the Space's own corpus entry from the form. */
export function corpusEntryStep(): Step<CreateSpaceContext> {
  return {
    id: 'corpus-entry',
    title: "Write the Space's corpus entry",
    describe: async (ctx) => [
      {
        what: "Write the Space's own corpus entry, with its name and the description from the form, and its line in the corpus index.",
        to: `${SPACE_LAYOUT.lore}/corpus/${ctx.name.toLowerCase()}.md`,
      },
    ],
    isDone: (ctx) => hasSpaceCorpusEntry(ctx.spaceRoot, ctx.name),
    run: (ctx) =>
      writeSpaceCorpusEntry({
        spaceRoot: ctx.spaceRoot,
        name: ctx.name,
        description: ctx.description,
        repository: ctx.repositoryName,
      }),
  };
}

/**
 * Clone one repository into `repos/<name>`. A folder that is already the top
 * of a working tree with an origin counts as cloned; when a clone address was
 * given, the origin must be that address. A folder that holds anything else is
 * refused and left as it is.
 */
async function cloneInto(
  ctx: SetupContext,
  repository: SetupRepositoryInput,
): Promise<Result<void, StepError>> {
  const dir = join(spacePaths(ctx.spaceRoot).repos, repository.name);
  if (await isCloned(ctx, repository)) return ok(undefined);
  if (!(await isEmptyOrAbsent(dir))) {
    return stepFail(
      'repository-folder-taken',
      `${dir} holds something that is not a clone of ${repository.github}, so nothing was cloned into it. Move it away and run setup again.`,
    );
  }
  let address = repository.cloneAddress;
  if (address === undefined) {
    const found = await ctx.deps.github.findRepository(repository.github);
    if (!found.ok) return gitHubFail(found.error);
    if (found.value === null) {
      return stepFail(
        'repository-not-found',
        `The repository ${repository.github} was not found on GitHub, or the signed-in account cannot see it.`,
      );
    }
    address = found.value.cloneUrl;
  }
  const cloned = await ctx.git.clone(address, dir);
  return cloned.ok ? ok(undefined) : cloned;
}

async function isCloned(ctx: SetupContext, repository: SetupRepositoryInput): Promise<boolean> {
  const dir = join(spacePaths(ctx.spaceRoot).repos, repository.name);
  if (!(await isOwnWorkTree(ctx.git, dir))) return false;
  const origin = await ctx.git.originUrl(dir);
  if (!origin.ok || origin.value === null) return false;
  return repository.cloneAddress === undefined || origin.value === repository.cloneAddress;
}

/** Clone one repository of the form into `repos/<name>`. */
export function cloneRepositoryStep(repository: SetupRepositoryInput): Step<CreateSpaceContext> {
  return {
    id: `clone:${repository.name}`,
    title: `Clone ${repository.name}`,
    describe: async () => [
      {
        what: 'Clone the repository fresh. No other checkout of it is touched.',
        from: repository.cloneAddress ?? repository.github,
        to: `${SPACE_LAYOUT.repos}/${repository.name}`,
      },
    ],
    isDone: (ctx) => isCloned(ctx, repository),
    run: (ctx) => cloneInto(ctx, repository),
  };
}

/** Write one repository's mirror, with a skeleton from the Lore's generator. */
export function repositoryMirrorStep(repository: SetupRepositoryInput): Step<CreateSpaceContext> {
  return {
    id: `mirror:${repository.name}`,
    title: `Write the mirror of ${repository.name}`,
    describe: async () => [
      {
        what: "Generate the repository's skeleton with python3 and write its mirror, with its line in the mirrors' index.",
        to: `${SPACE_LAYOUT.lore}/mirrors/${repository.name}.md`,
      },
    ],
    isDone: (ctx) => hasRepositoryMirror(ctx.spaceRoot, repository.name),
    run: (ctx) =>
      writeRepositoryMirror({
        spaceRoot: ctx.spaceRoot,
        runner: ctx.deps.runner,
        name: repository.name,
        github: repository.github,
      }),
  };
}

/** Whether the Space repository has a commit and its branch is on `origin`. Reads only. */
async function isPushed(ctx: SetupContext): Promise<boolean> {
  if (!(await isOwnWorkTree(ctx.git, ctx.spaceRoot))) return false;
  if (!(await ctx.git.head(ctx.spaceRoot)).ok) return false;
  const branch = await ctx.git.currentBranch(ctx.spaceRoot);
  if (!branch.ok || branch.value.detached) return false;
  const remote = await runGit(
    ctx.deps.runner,
    ctx.spaceRoot,
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch.value.branch}`],
    { readOnly: true },
  );
  return runSucceeded(remote);
}

/**
 * The first commit and its push. The commit is made only when the repository
 * has none, so running setup again on a Space that is in use commits nothing
 * of the Human Lead's work. The push is never forced.
 */
export function firstCommitStep(): Step<CreateSpaceContext> {
  return {
    id: 'first-commit',
    title: 'Commit and push the Space',
    describe: async (ctx) => [
      {
        what: `Make ${ctx.spaceRoot} a git repository on the branch main, with the first commit "${FIRST_COMMIT_MESSAGE}".`,
      },
      { what: 'Push the branch to the Space repository, without force.', to: ctx.repositoryName },
    ],
    isDone: (ctx) => isPushed(ctx),
    run: async (ctx) => {
      const { git, spaceRoot } = ctx;
      const repository = await lookupRepository(ctx);
      if (!repository.ok) return repository;
      if (repository.value === null) {
        return stepFail(
          'repository-not-found',
          `The repository ${ctx.repositoryName} was not found on GitHub.`,
        );
      }
      const address = repository.value.cloneUrl;

      if (!(await isOwnWorkTree(git, spaceRoot))) {
        const made = await git.init(spaceRoot, { initialBranch: 'main' });
        if (!made.ok) return made;
      }
      const origin = await git.originUrl(spaceRoot);
      if (!origin.ok) return origin;
      if (origin.value === null) {
        const added = await git.addRemote(spaceRoot, 'origin', address);
        if (!added.ok) return added;
      } else if (origin.value !== address) {
        return stepFail(
          'origin-differs',
          `The origin of ${spaceRoot} is ${origin.value} and not ${address}, so nothing was pushed.`,
        );
      }
      for (const [key, value] of Object.entries(ctx.deps.gitConfig ?? {})) {
        const set = await git.setConfig(spaceRoot, key, value);
        if (!set.ok) return set;
      }
      const head = await git.head(spaceRoot);
      if (!head.ok) {
        if (head.error.kind !== 'no-commits') return head;
        const staged = await git.addAll(spaceRoot);
        if (!staged.ok) return staged;
        const committed = await git.commit(spaceRoot, `${FIRST_COMMIT_MESSAGE} ${ctx.name}\n`);
        if (!committed.ok) return committed;
      }
      const pushed = await git.push(spaceRoot, { setUpstream: true });
      return pushed.ok ? ok(undefined) : pushed;
    },
  };
}

// ---------- the desk ----------

/** Install the Space's Lore into Claude Code, in the desk's install folder. */
export function installStep(): Step<SetupContext> {
  const installDir = (ctx: SetupContext): string =>
    deskPaths(ctx.deps.userDataDir, ctx.spaceRoot).install;
  return {
    id: 'install',
    title: 'Install into Claude Code',
    describe: async (ctx) => [
      {
        what: "Write one skill per verb and per process of the Lore, and a copy of each contract's check script.",
        to: installDir(ctx),
      },
    ],
    isDone: async (ctx) => {
      const lore = await readLore(ctx.spaceRoot);
      if (!lore.ok) return false;
      const plan = await planClaudeCodeInstall(lore.value, installDir(ctx));
      if (!plan.ok || plan.value.recordChanges) return false;
      return plan.value.actions.every(
        (action) =>
          action.action !== 'write' && action.action !== 'remove' && action.action !== 'forget',
      );
    },
    run: async (ctx) => {
      const lore = await readLore(ctx.spaceRoot);
      if (!lore.ok) return lore;
      const installed = await installClaudeCode(lore.value, installDir(ctx));
      return installed.ok ? ok(undefined) : installed;
    },
  };
}

/** The roots whose changes git reads, with the commit each is at now. A root with no commit is left out. */
async function rootHeads(
  ctx: SetupContext,
): Promise<Result<{ root: Root; commit: string }[], StepError>> {
  const roots = await resolveRoots({ spaceRoot: ctx.spaceRoot, runner: ctx.deps.runner });
  if (!roots.ok) return roots;
  const heads: { root: Root; commit: string }[] = [];
  for (const root of roots.value) {
    if (!root.tracking.tracked) continue;
    const head = await ctx.git.head(root.tracking.workTree);
    if (head.ok) heads.push({ root, commit: head.value });
    else if (head.error.kind !== 'no-commits') return head;
  }
  return ok(heads);
}

/** A desk that only reads: no owner file is written and nothing is set aside. */
function readOnlyDesk(ctx: SetupContext): Desk {
  const instance = currentDeskInstance();
  return {
    paths: deskPaths(ctx.deps.userDataDir, ctx.spaceRoot),
    writable: false,
    instance,
    owner: { ...instance, openedAt: new Date(0).toISOString() },
    now: () => new Date(),
    notices: [],
  };
}

/** Record, for every root git tracks, the commit it has when the companion first sees it. */
export function firstSeenStep(): Step<SetupContext> {
  return {
    id: 'first-seen',
    title: 'Record where every root starts',
    describe: async () => [
      {
        what: "Record the commit each root has now in the desk's records, as the first baseline of the Files window.",
      },
    ],
    isDone: async (ctx) => {
      const heads = await rootHeads(ctx);
      // A Space with no commit yet has no root to record, so nothing can be said to be done.
      if (!heads.ok || heads.value.length === 0) return false;
      const desk = readOnlyDesk(ctx);
      return heads.value.every(({ root }) => {
        const seen = getFirstSeen(desk, root.id);
        return seen.ok && seen.value !== null;
      });
    },
    run: async (ctx) => {
      const heads = await rootHeads(ctx);
      if (!heads.ok) return heads;
      const desk = openDesk(deskPaths(ctx.deps.userDataDir, ctx.spaceRoot));
      if (!desk.ok) return desk;
      try {
        if (!desk.value.writable) {
          return stepFail(
            'desk-held',
            'Another running companion holds the desk of this Space, so the first-seen commits were not recorded. Close it and run setup again.',
          );
        }
        for (const { root, commit } of heads.value) {
          const recorded = recordFirstSeen(desk.value, root.id, commit);
          if (!recorded.ok) return recorded;
        }
        return ok(undefined);
      } finally {
        closeDesk(desk.value);
      }
    },
  };
}

// ---------- open by address ----------

/** Clone the Space repository into the Space's folder. */
export function cloneSpaceStep(): Step<OpenSpaceContext> {
  const isThere = async (ctx: OpenSpaceContext): Promise<boolean> =>
    (await isOwnWorkTree(ctx.git, ctx.spaceRoot)) && (await readSpaceManifest(ctx.spaceRoot)).ok;
  return {
    id: 'clone-space',
    title: 'Clone the Space',
    describe: async (ctx) => [
      { what: 'Clone the Space repository.', from: ctx.repositoryName, to: ctx.spaceRoot },
    ],
    isDone: isThere,
    run: async (ctx) => {
      if (await isThere(ctx)) return ok(undefined);
      const found = await lookupRepository(ctx);
      if (!found.ok) return found;
      if (found.value === null) {
        return stepFail(
          'repository-not-found',
          `The repository ${ctx.repositoryName} was not found on GitHub, or the signed-in account cannot see it.`,
        );
      }
      const cloned = await ctx.git.clone(found.value.cloneUrl, ctx.spaceRoot);
      if (!cloned.ok) return cloned;
      const manifest = await readSpaceManifest(ctx.spaceRoot);
      if (!manifest.ok) {
        return stepFail(
          'not-a-space',
          `${ctx.repositoryName} was cloned into ${ctx.spaceRoot} and is not a Space of AI-Lore 1.0: ${manifest.error.message}`,
        );
      }
      return ok(undefined);
    },
  };
}

/** Create the Workbench folders and `repos/`, which a clone does not carry. */
export function workbenchStep(): Step<SetupContext> {
  return {
    id: 'workbench',
    title: 'Create the Workbench',
    describe: async () => [
      { what: 'Create workbench/ and repos/, which the Space repository ignores.' },
    ],
    isDone: (ctx) => hasDeskFolders(ctx.spaceRoot),
    run: (ctx) => ensureDeskFolders(ctx.spaceRoot),
  };
}

/** The confirmed repositories of the manifest, or the failure that names one the manifest does not have. */
async function confirmedRepositories(
  ctx: OpenSpaceContext,
): Promise<Result<SpaceManifestRepository[], StepError>> {
  if (ctx.confirmed.length === 0) return ok([]);
  const manifest = await readSpaceManifest(ctx.spaceRoot);
  if (!manifest.ok) return manifest;
  const wanted: SpaceManifestRepository[] = [];
  for (const name of ctx.confirmed) {
    const entry = manifest.value.repositories.find((repository) => repository.name === name);
    if (entry === undefined) {
      return stepFail(
        'repository-not-in-manifest',
        `The Space's manifest has no repository named "${name}".`,
      );
    }
    wanted.push(entry);
  }
  return ok(wanted);
}

/** Clone the repositories of the manifest that the Human Lead confirmed. */
export function cloneConfirmedStep(): Step<OpenSpaceContext> {
  return {
    id: 'clone-repositories',
    title: 'Clone the confirmed repositories',
    describe: async (ctx): Promise<PlanLine[]> =>
      ctx.confirmed.length === 0
        ? [
            {
              what: "List the repositories of the Space's manifest for confirmation. None is cloned yet.",
            },
          ]
        : ctx.confirmed.map((name) => ({
            what: 'Clone the repository fresh.',
            to: `${SPACE_LAYOUT.repos}/${name}`,
          })),
    isDone: async (ctx) => {
      const wanted = await confirmedRepositories(ctx);
      if (!wanted.ok) return false;
      for (const repository of wanted.value) {
        if (!(await isCloned(ctx, repository))) return false;
      }
      return true;
    },
    run: async (ctx) => {
      const wanted = await confirmedRepositories(ctx);
      if (!wanted.ok) return wanted;
      for (const repository of wanted.value) {
        const cloned = await cloneInto(ctx, repository);
        if (!cloned.ok) return cloned;
      }
      return ok(undefined);
    },
  };
}
