/**
 * `FakeGitHub`: a `GitHubPort` that keeps GitHub in memory, for tests.
 *
 * It keeps repositories with their labels, issues with sub-issue links and
 * comments, Projects with their fields, views and items, linked branches and
 * merged pull requests. It keeps the port's contract (see `port.ts`): what was
 * created is found by the next call, `create…` always creates, `ensure…` can
 * run again. `createRepository` makes a bare git repository in a temporary
 * folder and gives its path as the clone address, so clone and push work with
 * no network. It can be told to answer `unreachable`, `rate-limited` or any
 * other error, to be signed out, or to lack a scope. Its state can be saved to
 * and loaded from one JSON file, which is how an end-to-end test and the app
 * it starts share one GitHub.
 *
 * This file is reached only through the package entry
 * `@ai-lore-companion/core/testing`; the library's main barrel does not
 * export it, so production code does not load it.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IssueRef } from '../desk/types.js';
import { execFileRunner } from '../exec/exec-file-runner.js';
import type { CommandRunner } from '../exec/runner.js';
import { commandFailure, runSucceeded } from '../exec/runner.js';
import { writeFileAtomicSync } from '../fs/atomic-write.js';
import { err, ok } from '../result.js';
import { makeTempDir } from '../testing/temp.js';
import {
  type GitHubError,
  failed,
  missingScope,
  notFound,
  notSignedIn,
  rateLimited,
  unreachable,
} from './errors.js';
import { bodyHasMarker } from './marker.js';
import type { GitHubPort, GitHubResult } from './port.js';
import { buildProjectSnapshot } from './snapshot.js';
import {
  type EnsuredProjectView,
  type FieldInfo,
  type LabelSpec,
  type MergedPullRequest,
  type OpenPullRequest,
  PROJECT_SCOPE,
  type ProjectInfo,
  type ProjectViewInfo,
  type RawProjectIssue,
  type RepositoryInfo,
  STAGE_FIELD,
  STATUS_FIELD,
} from './types.js';
import {
  isBranchName,
  issueTextError,
  labelError,
  markersError,
  splitRepositoryName,
} from './validate.js';
import { describeViewByHand, viewStepsByHand } from './views.js';

/** An issue as the fake keeps it. */
export type FakeIssue = {
  id: string;
  ref: IssueRef;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  /** The `id` of the parent issue, or `null`. */
  parentId: string | null;
  comments: string[];
  /** Branches made by `developBranch`. */
  branches: { repository: string; name: string }[];
  createdAt: string;
  updatedAt: string;
};

/** A repository as the fake keeps it. */
export type FakeRepository = { info: RepositoryInfo; labels: LabelSpec[]; nextNumber: number };

/** A Project as the fake keeps it. `values` maps a field's id to an option's id. */
export type FakeProject = {
  info: ProjectInfo;
  closed: boolean;
  fields: FieldInfo[];
  views: ProjectViewInfo[];
  /** The `fullName` of each linked repository. */
  linked: string[];
  items: {
    id: string;
    issueId: string;
    values: Record<string, string>;
    valuesAt?: Record<string, string>;
  }[];
};

/** Everything the fake keeps. Plain data: this is what the state file holds. */
export type FakeGitHubState = {
  version: 1;
  /** The signed-in account, or `null` when signed out. */
  account: string | null;
  scopes: string[];
  /** The logins the account may create repositories and Projects for. */
  owners: string[];
  nextId: number;
  /** The folder of the bare repositories, once one was created. */
  reposDir: string | null;
  repositories: FakeRepository[];
  issues: FakeIssue[];
  projects: FakeProject[];
  pullRequests: { repository: string; pull: MergedPullRequest }[];
  openPullRequests: { repository: string; pull: OpenPullRequest }[];
};

/** One operation the fake was asked for, and whether it succeeded. */
export type FakeGitHubCall = { operation: keyof GitHubPort; ok: boolean };

/** Options of `createFakeGitHub`. */
export type FakeGitHubOptions = {
  /** The signed-in account. Default `fake-human`. */
  account?: string;
  /** The token's scopes. Default includes `project`. */
  scopes?: string[];
  /** Organisations the account may create in, besides itself. */
  organisations?: string[];
  /**
   * A JSON file to keep the state in. It is loaded when it exists, and written
   * after every operation that changes something.
   */
  stateFile?: string;
  /** Where bare repositories are created. Default: a new temporary folder, removed by `dispose`. */
  reposDir?: string;
  /** Runs `git init --bare`. Default: the real runner, which in test mode works only under the temporary folder. */
  runner?: CommandRunner;
  /** The clock of `createdAt`, `updatedAt` and `fetchedAt`. Default the machine's. */
  now?: () => Date;
};

/** The fake: the port, and what a test uses to steer and inspect it. */
export type FakeGitHub = GitHubPort & {
  /** Every operation asked for, in order. */
  readonly calls: FakeGitHubCall[];
  /** A copy of the state. */
  state(): FakeGitHubState;
  /** While on, every operation fails with `unreachable` and changes nothing. */
  setUnreachable(on: boolean): void;
  /** The next `count` operations fail with `rate-limited`. */
  rateLimitNext(count: number, retryAfterSeconds?: number | null): void;
  /** The next `count` operations (default one) fail with `error`. */
  failNext(error: GitHubError, count?: number): void;
  /**
   * The next operation that writes does its work and then answers `error`: the
   * case of an answer lost on the way back, where GitHub holds what the caller
   * believes it failed to create.
   */
  loseNextAnswer(error: GitHubError): void;
  /** Every operation waits this many milliseconds before it answers. `0` turns it off. */
  setDelay(milliseconds: number): void;
  /**
   * Whether the host's API can create views. When off, `ensureProjectView`
   * answers as the gh adapter does for such a host: `view: null` and the whole
   * view as a step by hand.
   */
  setViewsSupported(on: boolean): void;
  /** Sign out: every operation fails with `not-signed-in`. */
  signOut(): void;
  /** Sign in as `account` with `scopes`. */
  signIn(account: string, scopes: string[]): void;
  /** Add a merged pull request to a repository. */
  addMergedPullRequest(repository: string, pull: MergedPullRequest): void;
  /** Add an open pull request to a repository. */
  addOpenPullRequest(repository: string, pull: OpenPullRequest): void;
  /** The issue a reference names, or `null`. */
  issue(ref: IssueRef): FakeIssue | null;
  /** Write the state to `path`. */
  save(path: string): void;
  /** Remove the temporary folder of bare repositories, when the fake made it. */
  dispose(): void;
};

const DEFAULT_SCOPES = ['gist', PROJECT_SCOPE, 'read:org', 'repo', 'workflow'];
// GitHub's own three, as a new Project really arrives. `Paused` is not here:
// setup adds it, and a fixture that seeded it would hide a setup that did not.
const DEFAULT_STATUS_OPTIONS = ['Todo', 'In Progress', 'Done'];

/** The operations that need the `project` scope. */
const PROJECT_OPERATIONS: ReadonlySet<keyof GitHubPort> = new Set<keyof GitHubPort>([
  'findProject',
  'createProject',
  'ensureSingleSelectField',
  'ensureProjectView',
  'linkProjectToRepository',
  'addIssueToProject',
  'setSingleSelect',
  'readProject',
]);

function emptyState(options: FakeGitHubOptions): FakeGitHubState {
  const account = options.account ?? 'fake-human';
  return {
    version: 1,
    account,
    scopes: options.scopes ?? [...DEFAULT_SCOPES],
    owners: [account, ...(options.organisations ?? [])],
    nextId: 1,
    reposDir: options.reposDir ?? null,
    repositories: [],
    issues: [],
    projects: [],
    pullRequests: [],
    openPullRequests: [],
  };
}

function loadState(path: string): FakeGitHubState {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error(`FakeGitHub: ${path} is not a state file`);
  }
  if (parsed.version !== 1) throw new Error(`FakeGitHub: ${path} has an unknown version`);
  // The file is written by `save` of this module only; its shape is trusted past the version.
  // Keep v1 state files written before open pull requests were added usable.
  const state = parsed as FakeGitHubState;
  return { ...state, openPullRequests: state.openPullRequests ?? [] };
}

/** Build a fake GitHub. With `stateFile`, continue from the file when it exists. */
export function createFakeGitHub(options: FakeGitHubOptions = {}): FakeGitHub {
  const runner = options.runner ?? execFileRunner;
  const now = options.now ?? ((): Date => new Date());
  const state: FakeGitHubState =
    options.stateFile !== undefined && existsSync(options.stateFile)
      ? loadState(options.stateFile)
      : emptyState(options);
  const calls: FakeGitHubCall[] = [];
  const planned: GitHubError[] = [];
  let offline = false;
  let lostAnswer: GitHubError | null = null;
  let delayMs = 0;
  let viewsSupported = true;
  let removeReposDir: (() => void) | null = null;

  function nextId(prefix: string): string {
    const id = `${prefix}_fake${state.nextId}`;
    state.nextId += 1;
    return id;
  }

  function save(path: string): void {
    const written = writeFileAtomicSync(path, `${JSON.stringify(state, null, 2)}\n`);
    if (!written.ok) throw new Error(`FakeGitHub: ${written.error.message}`);
  }

  /** The error an operation meets before it does anything, or `null`. */
  function barrier(operation: keyof GitHubPort): GitHubError | null {
    if (offline) return unreachable('FakeGitHub was told to be unreachable');
    const next = planned.shift();
    if (next !== undefined) return next;
    if (state.account === null) return notSignedIn();
    if (PROJECT_OPERATIONS.has(operation) && !state.scopes.includes(PROJECT_SCOPE)) {
      return missingScope(PROJECT_SCOPE);
    }
    return null;
  }

  /** Run one operation behind the barrier, record it, and save the state after a write. */
  async function operate<T>(
    operation: keyof GitHubPort,
    writes: boolean,
    body: () => GitHubResult<T> | Promise<GitHubResult<T>>,
  ): Promise<GitHubResult<T>> {
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    const blocked = barrier(operation);
    let result = blocked === null ? await body() : err(blocked);
    if (result.ok && writes && options.stateFile !== undefined) save(options.stateFile);
    if (result.ok && writes && lostAnswer !== null) {
      result = err(lostAnswer);
      lostAnswer = null;
    }
    calls.push({ operation, ok: result.ok });
    return result;
  }

  function repositoryNamed(fullName: string): FakeRepository | null {
    return state.repositories.find((repository) => repository.info.fullName === fullName) ?? null;
  }

  /** The repository `fullName`: `failed` for text that is not a name, `not-found` for one the fake lacks. */
  function repositoryFor(fullName: string): GitHubResult<FakeRepository> {
    const parts = splitRepositoryName(fullName);
    if (!parts.ok) return parts;
    const repository = repositoryNamed(fullName);
    return repository === null ? err(notFound(`the repository ${fullName}`)) : ok(repository);
  }

  function projectOf(info: ProjectInfo): FakeProject | null {
    return state.projects.find((project) => project.info.id === info.id && !project.closed) ?? null;
  }

  function issueOf(ref: IssueRef): FakeIssue | null {
    return (
      state.issues.find(
        (issue) => issue.ref.repository === ref.repository && issue.ref.number === ref.number,
      ) ?? null
    );
  }

  /** The oldest issue of `repository`, open or closed, whose body has `marker`. Issues are kept oldest first. */
  function oldestWithMarker(repository: string, marker: string): IssueRef | null {
    const found = state.issues.find(
      (issue) => issue.ref.repository === repository && bodyHasMarker(issue.body, marker),
    );
    return found === undefined ? null : { ...found.ref };
  }

  function missingIssue(ref: IssueRef): { ok: false; error: GitHubError } {
    return err(notFound(`the issue ${ref.repository}#${ref.number}`));
  }

  function missingProject(info: ProjectInfo): { ok: false; error: GitHubError } {
    return err(notFound(`the Project ${info.owner}/${info.number}`));
  }

  async function makeBareRepository(owner: string, name: string): Promise<GitHubResult<string>> {
    if (state.reposDir === null) {
      const temp = makeTempDir('ai-lore-fake-github-');
      state.reposDir = temp.dir;
      removeReposDir = temp.cleanup;
    }
    const path = join(state.reposDir, owner, `${name}.git`);
    mkdirSync(dirname(path), { recursive: true });
    const args = ['init', '--bare', '--initial-branch=main', path];
    const result = await runner.run('git', args, { cwd: state.reposDir });
    if (!runSucceeded(result)) return err(failed(commandFailure('git', args, result).message));
    return ok(path);
  }

  function rawIssue(
    project: FakeProject,
    issue: FakeIssue,
    values: Record<string, string>,
    valuesAt?: Record<string, string>,
  ): RawProjectIssue {
    const fieldValues: Record<string, string> = {};
    const fieldValuesAt: Record<string, string> = {};
    const itemValuesAt = valuesAt ?? {};
    for (const field of project.fields) {
      const option = field.options.find((candidate) => candidate.id === values[field.id]);
      if (option !== undefined) {
        fieldValues[field.name] = option.name;
        const at = itemValuesAt[field.id];
        if (at !== undefined) {
          fieldValuesAt[field.name] = at;
        }
      }
    }
    const parent = state.issues.find((candidate) => candidate.id === issue.parentId);
    return {
      issue: issue.ref,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: [...issue.labels],
      updatedAt: issue.updatedAt,
      parentNumber:
        parent !== undefined && parent.ref.repository === issue.ref.repository
          ? parent.ref.number
          : null,
      fieldValues,
      fieldValuesAt,
      subIssues: state.issues
        .filter((candidate) => candidate.parentId === issue.id)
        .map((sub) => ({ issue: sub.ref, title: sub.title, state: sub.state })),
    };
  }

  const fake: FakeGitHub = {
    calls,

    state: () => structuredClone(state),
    setUnreachable(on) {
      offline = on;
    },
    rateLimitNext(count, retryAfterSeconds = 60) {
      for (let index = 0; index < count; index += 1) planned.push(rateLimited(retryAfterSeconds));
    },
    failNext(error, count = 1) {
      for (let index = 0; index < count; index += 1) planned.push(error);
    },
    loseNextAnswer(error) {
      lostAnswer = error;
    },
    setDelay(milliseconds) {
      delayMs = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
    },
    setViewsSupported(on) {
      viewsSupported = on;
    },
    signOut() {
      state.account = null;
    },
    signIn(account, scopes) {
      state.account = account;
      state.scopes = [...scopes];
      if (!state.owners.includes(account)) state.owners.push(account);
    },
    addMergedPullRequest(repository, pull) {
      state.pullRequests.push({ repository, pull });
      if (options.stateFile !== undefined) save(options.stateFile);
    },
    addOpenPullRequest(repository, pull) {
      state.openPullRequests.push({ repository, pull });
      if (options.stateFile !== undefined) save(options.stateFile);
    },
    issue: (ref) => {
      const found = issueOf(ref);
      return found === null ? null : structuredClone(found);
    },
    save,
    dispose() {
      removeReposDir?.();
      removeReposDir = null;
    },

    auth: () =>
      operate('auth', false, () => ok({ account: state.account ?? '', scopes: [...state.scopes] })),

    findRepository: (fullName) =>
      operate('findRepository', false, () => {
        const parts = splitRepositoryName(fullName);
        return parts.ok ? ok(repositoryNamed(fullName)?.info ?? null) : parts;
      }),

    createRepository: (arg) =>
      operate('createRepository', true, async () => {
        // `.` and `..` are refused here, so the bare repository's path stays under `reposDir`.
        const parts = splitRepositoryName(`${arg.owner}/${arg.name}`);
        if (!parts.ok) return parts;
        if (!state.owners.includes(arg.owner)) return err(notFound(`the account ${arg.owner}`));
        const fullName = `${arg.owner}/${arg.name}`;
        if (repositoryNamed(fullName) !== null) {
          return err(failed(`Name already exists on this account: ${fullName}`));
        }
        const bare = await makeBareRepository(arg.owner, arg.name);
        if (!bare.ok) return bare;
        const info: RepositoryInfo = {
          id: nextId('R'),
          fullName,
          url: `https://github.com/${fullName}`,
          cloneUrl: bare.value,
          private: arg.private,
        };
        state.repositories.push({ info, labels: [], nextNumber: 1 });
        return ok(info);
      }),

    branchHeads: (fullName) =>
      operate('branchHeads', false, async () => {
        const repository = repositoryNamed(fullName);
        if (repository === null) return ok(null);
        const args = [
          '--git-dir',
          repository.info.cloneUrl,
          'for-each-ref',
          '--format=%(objectname)',
          'refs/heads',
        ];
        const result = await runner.run('git', args, { cwd: state.reposDir ?? undefined });
        if (!runSucceeded(result)) return err(failed(commandFailure('git', args, result).message));
        return ok(
          result.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        );
      }),

    listSpaceRepositories: (owner) =>
      operate('listSpaceRepositories', false, async () => {
        const prefix = `${owner}/`;
        const candidates = [...state.repositories]
          .reverse()
          .filter((repository) => repository.info.fullName.startsWith(prefix));
        const found: RepositoryInfo[] = [];
        for (const repository of candidates) {
          const args = [
            '--git-dir',
            repository.info.cloneUrl,
            'cat-file',
            '-e',
            'HEAD:lore/space.md',
          ];
          const result = await runner.run('git', args, { cwd: state.reposDir ?? undefined });
          if (runSucceeded(result)) found.push({ ...repository.info });
        }
        return ok(found);
      }),

    findProject: (arg) =>
      operate('findProject', false, () => {
        const found = state.projects.find(
          (project) =>
            project.info.owner === arg.owner && project.info.title === arg.title && !project.closed,
        );
        return ok(found?.info ?? null);
      }),

    createProject: (arg) =>
      operate('createProject', true, () => {
        if (!state.owners.includes(arg.owner)) return err(notFound(`the account ${arg.owner}`));
        const number =
          state.projects.filter((project) => project.info.owner === arg.owner).length + 1;
        const info: ProjectInfo = {
          id: nextId('PVT'),
          owner: arg.owner,
          number,
          title: arg.title,
          url: `https://github.com/users/${arg.owner}/projects/${number}`,
        };
        const status: FieldInfo = {
          id: nextId('PVTSSF'),
          name: STATUS_FIELD,
          options: DEFAULT_STATUS_OPTIONS.map((name) => ({ id: nextId('OPT'), name })),
        };
        // GitHub gives a new Project this unfiltered, ungrouped table.
        const view: ProjectViewInfo = {
          id: nextId('PVTV'),
          number: 1,
          name: 'View 1',
          layout: 'table',
          filter: '',
          columnField: null,
          groupField: null,
        };
        state.projects.push({
          info,
          closed: false,
          fields: [status],
          views: [view],
          linked: [],
          items: [],
        });
        return ok(info);
      }),

    ensureSingleSelectField: (arg) =>
      operate('ensureSingleSelectField', true, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        let field = project.fields.find((candidate) => candidate.name === arg.name);
        if (field === undefined) {
          field = { id: nextId('PVTSSF'), name: arg.name, options: [] };
          project.fields.push(field);
        }
        for (const name of arg.options) {
          if (!field.options.some((option) => option.name === name)) {
            field.options.push({ id: nextId('OPT'), name });
          }
        }
        return ok(structuredClone(field));
      }),

    ensureProjectView: (arg) =>
      operate<EnsuredProjectView>('ensureProjectView', true, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        if (!viewsSupported) {
          return ok({ view: null, created: false, byHand: [describeViewByHand(arg.spec)] });
        }
        let view = project.views.find((candidate) => candidate.name === arg.spec.name);
        const created = view === undefined;
        if (view === undefined) {
          view = {
            id: nextId('PVTV'),
            number: project.views.length + 1,
            name: arg.spec.name,
            layout: arg.spec.layout,
            filter: '',
            // A view the API creates has no grouping: that is the by-hand step.
            columnField: null,
            groupField: null,
          };
          project.views.push(view);
        }
        if (arg.spec.filter !== undefined) view.filter = arg.spec.filter;
        return ok({ view: { ...view }, created, byHand: viewStepsByHand(arg.spec, view) });
      }),

    linkProjectToRepository: (arg) =>
      operate('linkProjectToRepository', true, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        if (!project.linked.includes(arg.repository)) project.linked.push(arg.repository);
        return ok(undefined);
      }),

    ensureLabels: (arg) =>
      operate('ensureLabels', true, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const repository = known.value;
        // As with gh, the labels before a refused one are made and the rest are not.
        for (const label of arg.labels) {
          const unusable = labelError(label);
          if (unusable !== null) return err(unusable);
          const kept = { ...label, color: label.color.replace(/^#/, '') };
          const existing = repository.labels.find((candidate) => candidate.name === label.name);
          if (existing === undefined) repository.labels.push(kept);
          else Object.assign(existing, kept);
        }
        return ok(undefined);
      }),

    findIssueByMarker: (arg) =>
      operate('findIssueByMarker', false, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const malformed = markersError([arg.marker]);
        if (malformed !== null) return err(malformed);
        return ok(oldestWithMarker(arg.repository, arg.marker));
      }),

    findIssuesByMarkers: (arg) =>
      operate('findIssuesByMarkers', false, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const malformed = markersError(arg.markers);
        if (malformed !== null) return err(malformed);
        const found: Record<string, IssueRef | null> = {};
        for (const marker of arg.markers) found[marker] = oldestWithMarker(arg.repository, marker);
        return ok(found);
      }),

    findAllIssuesByMarkers: (arg) =>
      operate('findAllIssuesByMarkers', false, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const malformed = markersError(arg.markers);
        if (malformed !== null) return err(malformed);
        const found: Record<string, IssueRef[]> = {};
        for (const marker of arg.markers) {
          found[marker] = state.issues
            .filter(
              (issue) =>
                issue.ref.repository === arg.repository && bodyHasMarker(issue.body, marker),
            )
            .map((issue) => ({ ...issue.ref }));
        }
        return ok(found);
      }),

    createIssue: (arg) =>
      operate('createIssue', true, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const repository = known.value;
        const unusable = issueTextError({ title: arg.title, body: arg.body });
        if (unusable !== null) return err(unusable);
        for (const label of arg.labels) {
          if (!repository.labels.some((candidate) => candidate.name === label)) {
            return err(notFound(`the label ${label} in ${arg.repository}`));
          }
        }
        const number = repository.nextNumber;
        repository.nextNumber += 1;
        const at = now().toISOString();
        const issue: FakeIssue = {
          id: nextId('I'),
          ref: {
            repository: arg.repository,
            number,
            url: `${repository.info.url}/issues/${number}`,
          },
          title: arg.title,
          body: arg.body,
          labels: [...arg.labels],
          state: 'open',
          parentId: null,
          comments: [],
          branches: [],
          createdAt: at,
          updatedAt: at,
        };
        state.issues.push(issue);
        return ok({ ...issue.ref });
      }),

    updateIssue: (arg) =>
      operate('updateIssue', true, () => {
        const unusable = issueTextError({ title: arg.title, body: arg.body });
        if (unusable !== null) return err(unusable);
        const issue = issueOf(arg.issue);
        if (issue === null) return missingIssue(arg.issue);
        if (arg.title !== undefined) issue.title = arg.title;
        if (arg.body !== undefined) issue.body = arg.body;
        issue.updatedAt = now().toISOString();
        return ok(undefined);
      }),

    addSubIssue: (arg) =>
      operate('addSubIssue', true, () => {
        const parent = issueOf(arg.parent);
        if (parent === null) return missingIssue(arg.parent);
        const child = issueOf(arg.child);
        if (child === null) return missingIssue(arg.child);
        if (child.parentId === parent.id) return ok(undefined);
        if (child.parentId !== null || child.id === parent.id) {
          return err(
            failed(
              `The issue ${arg.child.repository}#${arg.child.number} already has another parent`,
            ),
          );
        }
        child.parentId = parent.id;
        return ok(undefined);
      }),

    addIssueToProject: (arg) =>
      operate('addIssueToProject', true, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        const issue = issueOf(arg.issue);
        if (issue === null) return missingIssue(arg.issue);
        const existing = project.items.find((item) => item.issueId === issue.id);
        if (existing !== undefined) return ok(existing.id);
        const item = { id: nextId('PVTI'), issueId: issue.id, values: {} };
        project.items.push(item);
        return ok(item.id);
      }),

    setSingleSelect: (arg) =>
      operate('setSingleSelect', true, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        const item = project.items.find((candidate) => candidate.id === arg.item);
        if (item === undefined) return err(notFound(`the Project item ${arg.item}`));
        const field = project.fields.find((candidate) => candidate.id === arg.field.id);
        const option = field?.options.find((candidate) => candidate.name === arg.option);
        if (field === undefined || option === undefined) {
          return err(notFound(`the option ${arg.option} of the field ${arg.field.name}`));
        }
        item.values[field.id] = option.id;
        item.valuesAt ??= {};
        item.valuesAt[field.id] = now().toISOString();
        const issue = state.issues.find((candidate) => candidate.id === item.issueId);
        if (issue !== undefined) issue.updatedAt = now().toISOString();
        return ok(undefined);
      }),

    comment: (arg) =>
      operate('comment', true, () => {
        if (arg.body.trim() === '') return err(failed('A comment cannot be empty'));
        const unusable = issueTextError({ body: arg.body });
        if (unusable !== null) return err(unusable);
        const issue = issueOf(arg.issue);
        if (issue === null) return missingIssue(arg.issue);
        issue.comments.push(arg.body);
        issue.updatedAt = now().toISOString();
        return ok(undefined);
      }),

    closeIssue: (arg) =>
      operate('closeIssue', true, () => {
        const issue = issueOf(arg.issue);
        if (issue === null) return missingIssue(arg.issue);
        if (issue.state === 'open') {
          issue.state = 'closed';
          issue.updatedAt = now().toISOString();
        }
        return ok(undefined);
      }),

    developBranch: (arg) =>
      operate('developBranch', true, () => {
        if (!isBranchName(arg.name)) {
          return err(failed(`${JSON.stringify(arg.name)} is not a branch name`));
        }
        const issue = issueOf(arg.issue);
        if (issue === null) return missingIssue(arg.issue);
        const branchRepository = repositoryFor(arg.branchRepository);
        if (!branchRepository.ok) return branchRepository;
        const has = issue.branches.some(
          (branch) => branch.repository === arg.branchRepository && branch.name === arg.name,
        );
        if (!has) issue.branches.push({ repository: arg.branchRepository, name: arg.name });
        return ok({ branch: arg.name });
      }),

    readProject: (arg) =>
      operate('readProject', false, () => {
        const project = projectOf(arg.project);
        if (project === null) return missingProject(arg.project);
        const issues = project.items.flatMap((item) => {
          const issue = state.issues.find((candidate) => candidate.id === item.issueId);
          return issue === undefined ? [] : [rawIssue(project, issue, item.values, item.valuesAt)];
        });
        const stageField = project.fields.find((field) => field.name === STAGE_FIELD) ?? null;
        return ok(
          buildProjectSnapshot({
            project: project.info,
            stageField: stageField === null ? null : structuredClone(stageField),
            issues,
            // The fake reports the same view drift as the gh adapter, so a
            // test cannot pass against one and fail against the other.
            views: structuredClone(project.views),
            fetchedAt: now().toISOString(),
          }),
        );
      }),

    mergedPullRequests: (arg) =>
      operate('mergedPullRequests', false, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const pulls = state.pullRequests
          .filter((entry) => entry.repository === arg.repository)
          .map((entry) => ({ ...entry.pull }))
          .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
        return ok(pulls.slice(0, Math.max(1, Math.floor(arg.limit))));
      }),

    openPullRequests: (arg) =>
      operate('openPullRequests', false, () => {
        const known = repositoryFor(arg.repository);
        if (!known.ok) return known;
        const pulls = state.openPullRequests
          .filter((entry) => entry.repository === arg.repository)
          .map((entry) => ({ ...entry.pull }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return ok(pulls.slice(0, Math.max(1, Math.floor(arg.limit))));
      }),
  };
  return fake;
}
