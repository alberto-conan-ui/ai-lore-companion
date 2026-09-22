/**
 * The gh adapter of `GitHubPort`: every operation is one or a few runs of the
 * GitHub CLI through a `CommandRunner`.
 *
 * The adapter builds argument arrays and parses JSON; it holds no state and no
 * token (authentication stays inside `gh`). Most operations are GraphQL, sent
 * as `gh api graphql -i --input -`: the whole request, the document and its
 * variables, is JSON on standard input, so no value from outside (a title, a
 * body, a repository name) is on the command line, and `-i` gives the headers
 * that say how long a rate limit lasts. The commands that are not GraphQL
 * (`gh auth status`, `gh label create`, `gh issue develop`, `gh pr list`) take
 * each outside value as its own argument.
 *
 * The newest things the adapter asks of `gh`, which set the lowest version the
 * machine check accepts (`MIN_GH_VERSION` in `machine/versions.ts`):
 * `gh auth status --json` is in gh since 2.81.0 (cli/cli pull request 11544,
 * release notes of v2.81.0), its `--active` since 2.57.0 (pull request 9520),
 * and `gh issue develop --branch-repo` with `--repo` since 2.32.0 (pull
 * request 7656; v2.31.0 has `--issue-repo` and no `--branch-repo`).
 *
 * Nothing here is tested against live GitHub. The tests pass a scripted runner
 * with recorded answers; the real runner refuses `gh` in test mode.
 */

import type { IssueRef } from '../desk/types.js';
import type { CommandRunner, RunResult } from '../exec/runner.js';
import { runSucceeded } from '../exec/runner.js';
import { err, ok } from '../result.js';
import {
  type GitHubError,
  classifyGhFailure,
  failed,
  graphQlErrors,
  isSchemaAbsence,
  notFound,
  notSignedIn,
  parseGhApiResponse,
} from './errors.js';
import { bodyHasMarker } from './marker.js';
import type { GitHubPort, GitHubResult } from './port.js';
import * as Q from './queries.js';
import { buildProjectSnapshot } from './snapshot.js';
import {
  type FieldInfo,
  type MergedPullRequest,
  type OpenPullRequest,
  type PullRequestChecks,
  type PullRequestReview,
  type ProjectInfo,
  type ProjectViewInfo,
  type ProjectViewLayout,
  type RawProjectIssue,
  type RepositoryInfo,
  STAGE_FIELD,
} from './types.js';
import {
  isBranchName,
  issueTextError,
  labelError,
  markersError,
  splitRepositoryName,
} from './validate.js';
import { describeViewByHand, viewStepsByHand } from './views.js';

/** Options of `createGhCliGitHub`. */
export type GhCliOptions = {
  /** The binary. Default `gh`, found on the `PATH`. */
  bin?: string;
  /** The host `auth` asks about. Default `github.com`. */
  hostname?: string;
  /** How long one run of `gh` may take before it counts as unreachable. Default 60 seconds. */
  timeoutMs?: number;
  /** The clock of `readProject`'s `fetchedAt`. Default the machine's. */
  now?: () => Date;
};

/** The arguments of every GraphQL run. The request is on standard input. */
export const GRAPHQL_ARGS: readonly string[] = ['api', 'graphql', '-i', '--input', '-'];

/** Built once, on first use: the query text of every exported constant of `queries.ts`, keyed by its name. */
let queryNamesByText: Map<string, string> | null = null;

/**
 * The name of the exported constant of `queries.ts` (for example
 * `REPOSITORY_QUERY`) whose text is `input`'s `query`, for `input` a JSON
 * request as sent to `gh api graphql`. `null` when `input` is not such JSON or
 * names no known query.
 */
export function graphqlOperationName(input: string): string | null {
  queryNamesByText ??= new Map(
    Object.entries(Q).flatMap(([name, value]) =>
      typeof value === 'string' ? [[value, name] as const] : [],
    ),
  );
  const parsed = parseJson(input);
  const query = text(parsed, 'query');
  return query === null ? null : (queryNamesByText.get(query) ?? null);
}

/** The colour a new single-select option gets. */
const NEW_OPTION_COLOR = 'GRAY';

const LAYOUTS: Record<ProjectViewLayout, string> = {
  table: 'TABLE_LAYOUT',
  board: 'BOARD_LAYOUT',
  roadmap: 'ROADMAP_LAYOUT',
};

// ---------- reading JSON of unknown shape ----------

/** The value at `path` inside `value`, or `undefined` when a step is missing. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[step];
  }
  return current;
}

function text(value: unknown, ...path: (string | number)[]): string | null {
  const found = at(value, ...path);
  return typeof found === 'string' ? found : null;
}

function int(value: unknown, ...path: (string | number)[]): number | null {
  const found = at(value, ...path);
  return typeof found === 'number' && Number.isInteger(found) ? found : null;
}

function list(value: unknown, ...path: (string | number)[]): unknown[] {
  const found = at(value, ...path);
  return Array.isArray(found) ? found : [];
}

function issueState(value: unknown): 'open' | 'closed' {
  return value === 'CLOSED' || value === 'closed' ? 'closed' : 'open';
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

// ---------- parsing GitHub's objects ----------

function parseRepository(node: unknown): RepositoryInfo | null {
  const id = text(node, 'id');
  const fullName = text(node, 'nameWithOwner');
  const url = text(node, 'url');
  if (id === null || fullName === null || url === null) return null;
  return { id, fullName, url, cloneUrl: `${url}.git`, private: at(node, 'isPrivate') === true };
}

function parseProject(node: unknown, owner: string): ProjectInfo | null {
  const id = text(node, 'id');
  const number = int(node, 'number');
  const title = text(node, 'title');
  const url = text(node, 'url');
  if (id === null || number === null || title === null || url === null) return null;
  return { id, owner, number, title, url };
}

type FieldOptionDetail = { id: string; name: string; color: string; description: string };

function parseOptions(node: unknown): FieldOptionDetail[] {
  return list(node, 'options').flatMap((option) => {
    const id = text(option, 'id');
    const name = text(option, 'name');
    if (id === null || name === null) return [];
    return [
      {
        id,
        name,
        color: text(option, 'color') ?? NEW_OPTION_COLOR,
        description: text(option, 'description') ?? '',
      },
    ];
  });
}

function parseField(node: unknown): FieldInfo | null {
  const id = text(node, 'id');
  const name = text(node, 'name');
  if (id === null || name === null) return null;
  return {
    id,
    name,
    options: parseOptions(node).map((option) => ({ id: option.id, name: option.name })),
  };
}

function parseView(node: unknown): ProjectViewInfo | null {
  const id = text(node, 'id');
  const number = int(node, 'number');
  const name = text(node, 'name');
  const layout = (Object.keys(LAYOUTS) as ProjectViewLayout[]).find(
    (key) => LAYOUTS[key] === at(node, 'layout'),
  );
  if (id === null || number === null || name === null || layout === undefined) return null;
  return {
    id,
    number,
    name,
    layout,
    filter: text(node, 'filter') ?? '',
    columnField: groupingField(node, 'verticalGroupByFields'),
    groupField: groupingField(node, 'groupByFields'),
  };
}

/** The name of the one field a view groups by on `key`, or null when it groups by none. */
function groupingField(node: unknown, key: 'groupByFields' | 'verticalGroupByFields'): string | null {
  const first = list(node, key, 'nodes')[0];
  return first === undefined ? null : text(first, 'name');
}

function parseIssueRef(node: unknown, repository: string): IssueRef | null {
  const number = int(node, 'number');
  const url = text(node, 'url');
  if (number === null || url === null) return null;
  return { repository: text(node, 'repository', 'nameWithOwner') ?? repository, number, url };
}

function parseProjectItem(item: unknown): RawProjectIssue | null {
  const content = at(item, 'content');
  if (text(content, '__typename') !== 'Issue' || at(item, 'isArchived') === true) return null;
  const issue = parseIssueRef(content, '');
  if (issue === null) return null;
  const fieldValues: Record<string, string> = {};
  const fieldValuesAt: Record<string, string> = {};
  for (const value of list(item, 'fieldValues', 'nodes')) {
    const field = text(value, 'field', 'name');
    const name = text(value, 'name');
    if (field !== null && name !== null) {
      fieldValues[field] = name;
      const updatedAt = text(value, 'updatedAt');
      if (updatedAt !== null) fieldValuesAt[field] = updatedAt;
    }
  }
  const sameRepository =
    text(content, 'parent', 'repository', 'nameWithOwner') === issue.repository;
  return {
    issue,
    title: text(content, 'title') ?? '',
    body: text(content, 'body') ?? '',
    state: issueState(at(content, 'state')),
    labels: list(content, 'labels', 'nodes').flatMap((label) => text(label, 'name') ?? []),
    updatedAt: text(content, 'updatedAt') ?? '',
    parentNumber: sameRepository ? int(content, 'parent', 'number') : null,
    fieldValues,
    fieldValuesAt,
    subIssues: list(content, 'subIssues', 'nodes').flatMap((sub) => {
      const ref = parseIssueRef(sub, issue.repository);
      if (ref === null) return [];
      return [{ issue: ref, title: text(sub, 'title') ?? '', state: issueState(at(sub, 'state')) }];
    }),
  };
}

function parseMergedPullRequest(node: unknown): MergedPullRequest | null {
  const number = int(node, 'number');
  const url = text(node, 'url');
  const mergedAt = text(node, 'mergedAt');
  if (number === null || url === null || mergedAt === null) return null;
  return {
    number,
    title: text(node, 'title') ?? '',
    url,
    mergedAt,
    mergeCommit: text(node, 'mergeCommit', 'oid'),
    headBranch: text(node, 'headRefName') ?? '',
    baseBranch: text(node, 'baseRefName') ?? '',
  };
}

/** Build the gh adapter over a command runner. */
export function createGhCliGitHub(runner: CommandRunner, options: GhCliOptions = {}): GitHubPort {
  const bin = options.bin ?? 'gh';
  const hostname = options.hostname ?? 'github.com';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const now = options.now ?? ((): Date => new Date());

  function run(args: readonly string[], input?: string): Promise<RunResult> {
    return runner.run(bin, args, { input, timeoutMs });
  }

  /**
   * Send one GraphQL request and give its `data`. With `missingIsNull`, an
   * answer whose only errors are `NOT_FOUND` succeeds, and the caller reads
   * the `null` in the data. With `absentIsNull`, an answer that says the
   * host's schema lacks what the document names succeeds with `null`.
   */
  async function graphql(
    query: string,
    variables: Record<string, unknown>,
    opts: { missingIsNull?: boolean; absentIsNull?: boolean } = {},
  ): Promise<GitHubResult<unknown>> {
    const result = await run(GRAPHQL_ARGS, JSON.stringify({ query, variables }));
    const response = parseGhApiResponse(result.stdout);
    const errors = graphQlErrors(response.body);
    if (opts.absentIsNull === true && result.failure === undefined && isSchemaAbsence(errors)) {
      return ok(null);
    }
    const onlyMissing = errors.length > 0 && errors.every((error) => error.type === 'NOT_FOUND');
    const tolerated = opts.missingIsNull === true && onlyMissing && result.failure === undefined;
    if ((!runSucceeded(result) || errors.length > 0) && !tolerated) {
      return err(classifyGhFailure(result, response));
    }
    const data = at(parseJson(response.body), 'data');
    if (data === undefined) return err(failed('gh api graphql gave an answer that is not JSON'));
    return ok(data);
  }

  function unexpected(what: string): { ok: false; error: GitHubError } {
    return err(failed(`GitHub's answer has no ${what}`));
  }

  async function ownerId(login: string): Promise<GitHubResult<string>> {
    const data = await graphql(Q.OWNER_QUERY, { login }, { missingIsNull: true });
    if (!data.ok) return data;
    const id = text(data.value, 'repositoryOwner', 'id');
    return id === null ? err(notFound(`the account ${login}`)) : ok(id);
  }

  async function issueNode(
    issue: IssueRef,
  ): Promise<GitHubResult<{ id: string; state: 'open' | 'closed' }>> {
    const parts = splitRepositoryName(issue.repository);
    if (!parts.ok) return parts;
    const data = await graphql(
      Q.ISSUE_QUERY,
      { ...parts.value, number: issue.number },
      { missingIsNull: true },
    );
    if (!data.ok) return data;
    const node = at(data.value, 'repository', 'issue');
    const id = text(node, 'id');
    if (id === null) return err(notFound(`the issue ${issue.repository}#${issue.number}`));
    return ok({ id, state: issueState(at(node, 'state')) });
  }

  async function singleSelectField(
    project: ProjectInfo,
    name: string,
  ): Promise<GitHubResult<{ field: FieldInfo; details: FieldOptionDetail[] } | null>> {
    const data = await graphql(
      Q.PROJECT_FIELD_QUERY,
      { project: project.id, name },
      { missingIsNull: true },
    );
    if (!data.ok) return data;
    const node = at(data.value, 'node', 'field');
    if (node === null || node === undefined) return ok(null);
    const field = parseField(node);
    if (text(node, '__typename') !== 'ProjectV2SingleSelectField' || field === null) {
      return err(failed(`The Project's field ${name} is not a single-select field`));
    }
    return ok({ field, details: parseOptions(node) });
  }

  const port: GitHubPort = {
    async auth() {
      const args = ['auth', 'status', '--active', '--hostname', hostname, '--json', 'hosts'];
      const result = await run(args);
      if (!runSucceeded(result)) return err(classifyGhFailure(result));
      const entries = list(parseJson(result.stdout), 'hosts', hostname);
      const active = entries.find((entry) => at(entry, 'active') === true) ?? entries[0];
      const account = text(active, 'login');
      if (account === null || text(active, 'state') !== 'success') return err(notSignedIn());
      const scopes = (text(active, 'scopes') ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '');
      return ok({ account, scopes });
    },

    async findRepository(fullName) {
      const parts = splitRepositoryName(fullName);
      if (!parts.ok) return parts;
      const data = await graphql(Q.REPOSITORY_QUERY, parts.value, { missingIsNull: true });
      if (!data.ok) return data;
      return ok(parseRepository(at(data.value, 'repository')));
    },

    async branchHeads(fullName) {
      const parts = splitRepositoryName(fullName);
      if (!parts.ok) return parts;
      const data = await graphql(Q.BRANCH_HEADS_QUERY, parts.value, { missingIsNull: true });
      if (!data.ok) return data;
      const repository = at(data.value, 'repository');
      if (repository === null || repository === undefined) return ok(null);
      return ok(
        list(repository, 'refs', 'nodes').flatMap((node) => text(node, 'target', 'oid') ?? []),
      );
    },

    async listSpaceRepositories(owner) {
      const data = await graphql(
        Q.OWNER_SPACE_REPOSITORIES_QUERY,
        { login: owner },
        {
          missingIsNull: true,
        },
      );
      if (!data.ok) return data;
      const repositoryOwner = at(data.value, 'repositoryOwner');
      if (repositoryOwner === null || repositoryOwner === undefined) {
        return err(notFound(`the account ${owner}`));
      }
      return ok(
        list(repositoryOwner, 'repositories', 'nodes').flatMap((node) => {
          if (at(node, 'manifest') === null || at(node, 'manifest') === undefined) return [];
          const repository = parseRepository(node);
          return repository === null ? [] : [repository];
        }),
      );
    },

    async createRepository(arg) {
      const parts = splitRepositoryName(`${arg.owner}/${arg.name}`);
      if (!parts.ok) return parts;
      const owner = await ownerId(arg.owner);
      if (!owner.ok) return owner;
      const input = {
        ownerId: owner.value,
        name: arg.name,
        visibility: arg.private ? 'PRIVATE' : 'PUBLIC',
      };
      const data = await graphql(Q.CREATE_REPOSITORY_MUTATION, { input });
      if (!data.ok) return data;
      const repository = parseRepository(at(data.value, 'createRepository', 'repository'));
      return repository === null ? unexpected('repository') : ok(repository);
    },

    async findProject(arg) {
      let after: string | null = null;
      for (;;) {
        const data = await graphql(
          Q.OWNER_PROJECTS_QUERY,
          { login: arg.owner, after },
          { missingIsNull: true },
        );
        if (!data.ok) return data;
        const owner = at(data.value, 'repositoryOwner');
        if (owner === null || owner === undefined) return ok(null);
        for (const node of list(owner, 'projectsV2', 'nodes')) {
          if (text(node, 'title') !== arg.title || at(node, 'closed') === true) continue;
          const project = parseProject(node, arg.owner);
          if (project !== null) return ok(project);
        }
        after = text(owner, 'projectsV2', 'pageInfo', 'endCursor');
        if (at(owner, 'projectsV2', 'pageInfo', 'hasNextPage') !== true || after === null) {
          return ok(null);
        }
      }
    },

    async createProject(arg) {
      const owner = await ownerId(arg.owner);
      if (!owner.ok) return owner;
      const input = { ownerId: owner.value, title: arg.title };
      const data = await graphql(Q.CREATE_PROJECT_MUTATION, { input });
      if (!data.ok) return data;
      const project = parseProject(at(data.value, 'createProjectV2', 'projectV2'), arg.owner);
      return project === null ? unexpected('Project') : ok(project);
    },

    async ensureSingleSelectField(arg) {
      const existing = await singleSelectField(arg.project, arg.name);
      if (!existing.ok) return existing;
      const fresh = (name: string): Record<string, string> => ({
        name,
        color: NEW_OPTION_COLOR,
        description: '',
      });
      if (existing.value === null) {
        const input = {
          projectId: arg.project.id,
          dataType: 'SINGLE_SELECT',
          name: arg.name,
          singleSelectOptions: arg.options.map(fresh),
        };
        const data = await graphql(Q.CREATE_FIELD_MUTATION, { input });
        if (!data.ok) return data;
        const field = parseField(at(data.value, 'createProjectV2Field', 'projectV2Field'));
        return field === null ? unexpected('field') : ok(field);
      }
      const have = new Set(existing.value.field.options.map((option) => option.name));
      const missing = arg.options.filter((option) => !have.has(option));
      if (missing.length === 0) return ok(existing.value.field);
      const input = {
        fieldId: existing.value.field.id,
        singleSelectOptions: [...existing.value.details, ...missing.map(fresh)],
      };
      const data = await graphql(Q.UPDATE_FIELD_MUTATION, { input });
      if (!data.ok) return data;
      const field = parseField(at(data.value, 'updateProjectV2Field', 'projectV2Field'));
      return field === null ? unexpected('field') : ok(field);
    },

    async ensureProjectView(arg) {
      const { project, spec } = arg;
      // A host whose schema has no view mutations (a GitHub Enterprise Server
      // older than them) is not a failure: the whole view is a step by hand.
      const wholeViewByHand = ok({
        view: null,
        created: false,
        byHand: [describeViewByHand(spec)],
      });
      const views = await graphql(
        Q.PROJECT_VIEWS_QUERY,
        { project: project.id },
        { absentIsNull: true },
      );
      if (!views.ok) return views;
      if (views.value === null) return wholeViewByHand;
      let view =
        list(views.value, 'node', 'views', 'nodes')
          .map(parseView)
          .find((candidate) => candidate?.name === spec.name) ?? null;
      const created = view === null;
      if (view === null) {
        const input = { projectId: project.id, name: spec.name, layout: LAYOUTS[spec.layout] };
        const data = await graphql(Q.CREATE_VIEW_MUTATION, { input }, { absentIsNull: true });
        if (!data.ok) return data;
        if (data.value === null) return wholeViewByHand;
        view = parseView(at(data.value, 'createProjectV2View', 'projectV2View'));
        if (view === null) return unexpected('view');
      }
      const byHand = viewStepsByHand(spec, view);
      if (spec.filter !== undefined && spec.filter !== view.filter) {
        const input = { viewId: view.id, filter: spec.filter };
        const data = await graphql(Q.UPDATE_VIEW_MUTATION, { input }, { absentIsNull: true });
        if (!data.ok) return data;
        if (data.value === null) {
          byHand.unshift(
            `On GitHub, open the view "${view.name}" of the Project and set its filter to ${spec.filter}. This GitHub host's API cannot set it.`,
          );
        } else {
          view = parseView(at(data.value, 'updateProjectV2View', 'projectV2View')) ?? {
            ...view,
            filter: spec.filter,
          };
        }
      }
      return ok({ view, created, byHand });
    },

    async linkProjectToRepository(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const data = await graphql(
        Q.PROJECT_LINK_QUERY,
        { ...parts.value, project: arg.project.id },
        { missingIsNull: true },
      );
      if (!data.ok) return data;
      const repositoryId = text(data.value, 'repository', 'id');
      if (repositoryId === null) return err(notFound(`the repository ${arg.repository}`));
      const linked = list(data.value, 'node', 'repositories', 'nodes');
      if (linked.some((node) => text(node, 'id') === repositoryId)) return ok(undefined);
      const input = { projectId: arg.project.id, repositoryId };
      const linkedNow = await graphql(Q.LINK_PROJECT_MUTATION, { input });
      return linkedNow.ok ? ok(undefined) : linkedNow;
    },

    async ensureLabels(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      for (const label of arg.labels) {
        const unusable = labelError(label);
        if (unusable !== null) return err(unusable);
        const color = label.color.replace(/^#/, '');
        const result = await run([
          'label',
          'create',
          '--repo',
          arg.repository,
          '--color',
          color,
          // One argument, so that a description that begins with `-` is never read as an option.
          `--description=${label.description}`,
          '--force',
          '--',
          label.name,
        ]);
        if (!runSucceeded(result)) return err(classifyGhFailure(result));
      }
      return ok(undefined);
    },

    async findIssueByMarker(arg) {
      const found = await port.findIssuesByMarkers({
        repository: arg.repository,
        markers: [arg.marker],
      });
      return found.ok ? ok(found.value[arg.marker] ?? null) : found;
    },

    async findIssuesByMarkers(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const malformed = markersError(arg.markers);
      if (malformed !== null) return err(malformed);
      const found: Record<string, IssueRef | null> = {};
      for (const marker of arg.markers) found[marker] = null;
      let left = [...new Set(arg.markers)];
      let after: string | null = null;
      while (left.length > 0) {
        const data = await graphql(Q.ISSUE_BODIES_QUERY, { ...parts.value, after });
        if (!data.ok) return data;
        const issues = at(data.value, 'repository', 'issues');
        for (const node of list(issues, 'nodes')) {
          const body = text(node, 'body') ?? '';
          const ref = parseIssueRef(node, arg.repository);
          if (ref === null) continue;
          for (const marker of left) if (bodyHasMarker(body, marker)) found[marker] = ref;
          left = left.filter((marker) => found[marker] === null);
          if (left.length === 0) break;
        }
        after = text(issues, 'pageInfo', 'endCursor');
        if (at(issues, 'pageInfo', 'hasNextPage') !== true || after === null) break;
      }
      return ok(found);
    },

    async findAllIssuesByMarkers(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const malformed = markersError(arg.markers);
      if (malformed !== null) return err(malformed);
      const found: Record<string, IssueRef[]> = {};
      for (const marker of arg.markers) found[marker] = [];
      let after: string | null = null;
      for (;;) {
        const data = await graphql(Q.ISSUE_BODIES_QUERY, { ...parts.value, after });
        if (!data.ok) return data;
        const issues = at(data.value, 'repository', 'issues');
        for (const node of list(issues, 'nodes')) {
          const body = text(node, 'body') ?? '';
          const ref = parseIssueRef(node, arg.repository);
          if (ref === null) continue;
          for (const marker of arg.markers) {
            if (bodyHasMarker(body, marker)) found[marker]?.push(ref);
          }
        }
        after = text(issues, 'pageInfo', 'endCursor');
        if (at(issues, 'pageInfo', 'hasNextPage') !== true || after === null) break;
      }
      return ok(found);
    },

    async createIssue(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const unusable = issueTextError({ title: arg.title, body: arg.body });
      if (unusable !== null) return err(unusable);
      const variables: Record<string, unknown> = { ...parts.value };
      arg.labels.forEach((label, index) => {
        variables[`l${index}`] = label;
      });
      const looked = await graphql(Q.repositoryAndLabelsQuery(arg.labels.length), variables, {
        missingIsNull: true,
      });
      if (!looked.ok) return looked;
      const repositoryId = text(looked.value, 'repository', 'id');
      if (repositoryId === null) return err(notFound(`the repository ${arg.repository}`));
      const labelIds: string[] = [];
      for (const [index, label] of arg.labels.entries()) {
        const id = text(looked.value, 'repository', `l${index}`, 'id');
        if (id === null) return err(notFound(`the label ${label} in ${arg.repository}`));
        labelIds.push(id);
      }
      const input = { repositoryId, title: arg.title, body: arg.body, labelIds };
      const data = await graphql(Q.CREATE_ISSUE_MUTATION, { input });
      if (!data.ok) return data;
      const issue = parseIssueRef(at(data.value, 'createIssue', 'issue'), arg.repository);
      return issue === null ? unexpected('issue') : ok(issue);
    },

    async updateIssue(arg) {
      const unusable = issueTextError({ title: arg.title, body: arg.body });
      if (unusable !== null) return err(unusable);
      const node = await issueNode(arg.issue);
      if (!node.ok) return node;
      const input: Record<string, string> = { id: node.value.id };
      if (arg.title !== undefined) input.title = arg.title;
      if (arg.body !== undefined) input.body = arg.body;
      const data = await graphql(Q.UPDATE_ISSUE_MUTATION, { input });
      return data.ok ? ok(undefined) : data;
    },

    async addSubIssue(arg) {
      const parent = splitRepositoryName(arg.parent.repository);
      if (!parent.ok) return parent;
      const child = splitRepositoryName(arg.child.repository);
      if (!child.ok) return child;
      const data = await graphql(
        Q.ISSUE_PAIR_QUERY,
        {
          parentOwner: parent.value.owner,
          parentName: parent.value.name,
          parentNumber: arg.parent.number,
          childOwner: child.value.owner,
          childName: child.value.name,
          childNumber: arg.child.number,
        },
        { missingIsNull: true },
      );
      if (!data.ok) return data;
      const parentId = text(data.value, 'parent', 'issue', 'id');
      const childId = text(data.value, 'child', 'issue', 'id');
      if (parentId === null) {
        return err(notFound(`the issue ${arg.parent.repository}#${arg.parent.number}`));
      }
      if (childId === null) {
        return err(notFound(`the issue ${arg.child.repository}#${arg.child.number}`));
      }
      const presentParent = text(data.value, 'child', 'issue', 'parent', 'id');
      if (presentParent === parentId) return ok(undefined);
      if (presentParent !== null) {
        return err(
          failed(
            `The issue ${arg.child.repository}#${arg.child.number} already has another parent`,
          ),
        );
      }
      const added = await graphql(Q.ADD_SUB_ISSUE_MUTATION, {
        input: { issueId: parentId, subIssueId: childId },
      });
      return added.ok ? ok(undefined) : added;
    },

    async addIssueToProject(arg) {
      const node = await issueNode(arg.issue);
      if (!node.ok) return node;
      const input = { projectId: arg.project.id, contentId: node.value.id };
      const data = await graphql(Q.ADD_ITEM_MUTATION, { input });
      if (!data.ok) return data;
      const item = text(data.value, 'addProjectV2ItemById', 'item', 'id');
      return item === null ? unexpected('Project item') : ok(item);
    },

    async setSingleSelect(arg) {
      const option = arg.field.options.find((candidate) => candidate.name === arg.option);
      if (option === undefined) {
        return err(notFound(`the option ${arg.option} of the field ${arg.field.name}`));
      }
      const input = {
        projectId: arg.project.id,
        itemId: arg.item,
        fieldId: arg.field.id,
        value: { singleSelectOptionId: option.id },
      };
      const data = await graphql(Q.SET_FIELD_VALUE_MUTATION, { input });
      return data.ok ? ok(undefined) : data;
    },

    async comment(arg) {
      if (arg.body.trim() === '') return err(failed('A comment cannot be empty'));
      const unusable = issueTextError({ body: arg.body });
      if (unusable !== null) return err(unusable);
      const node = await issueNode(arg.issue);
      if (!node.ok) return node;
      const input = { subjectId: node.value.id, body: arg.body };
      const data = await graphql(Q.ADD_COMMENT_MUTATION, { input });
      return data.ok ? ok(undefined) : data;
    },

    async closeIssue(arg) {
      const node = await issueNode(arg.issue);
      if (!node.ok) return node;
      if (node.value.state === 'closed') return ok(undefined);
      const data = await graphql(Q.CLOSE_ISSUE_MUTATION, { input: { issueId: node.value.id } });
      return data.ok ? ok(undefined) : data;
    },

    async developBranch(arg) {
      for (const repository of [arg.issue.repository, arg.branchRepository]) {
        const parts = splitRepositoryName(repository);
        if (!parts.ok) return parts;
      }
      if (!isBranchName(arg.name)) {
        return err(failed(`${JSON.stringify(arg.name)} is not a branch name`));
      }
      if (!Number.isInteger(arg.issue.number) || arg.issue.number < 1) {
        return err(failed(`${arg.issue.number} is not the number of an issue`));
      }
      const number = String(arg.issue.number);
      const listed = await run([
        'issue',
        'develop',
        '--list',
        '--repo',
        arg.issue.repository,
        number,
      ]);
      if (!runSucceeded(listed)) return err(classifyGhFailure(listed));
      const suffix = `/${arg.branchRepository}/tree/${arg.name}`;
      const has = listed.stdout.split('\n').some((line) => {
        const [branch, url] = line.split('\t');
        return branch === arg.name && (url ?? '').trim().endsWith(suffix);
      });
      if (has) return ok({ branch: arg.name });
      const result = await run([
        'issue',
        'develop',
        '--repo',
        arg.issue.repository,
        '--branch-repo',
        arg.branchRepository,
        '--name',
        arg.name,
        number,
      ]);
      if (!runSucceeded(result)) return err(classifyGhFailure(result));
      const branch = /\/tree\/(\S+)\s*$/.exec(result.stdout.trim())?.[1] ?? arg.name;
      return ok({ branch });
    },

    async readProject(arg) {
      const issues: RawProjectIssue[] = [];
      let stageField: FieldInfo | null = null;
      // The views do not paginate with the items; the first page carries them.
      let views: ProjectViewInfo[] | null = null;
      let after: string | null = null;
      for (;;) {
        const data = await graphql(
          Q.READ_PROJECT_QUERY,
          {
            project: arg.project.id,
            stage: STAGE_FIELD,
            after,
          },
          { missingIsNull: true },
        );
        if (!data.ok) return data;
        const node = at(data.value, 'node');
        if (node === null || node === undefined) {
          return err(notFound(`the Project ${arg.project.owner}/${arg.project.number}`));
        }
        stageField ??= parseField(at(node, 'stage'));
        views ??= list(node, 'views', 'nodes')
          .map(parseView)
          .filter((view): view is ProjectViewInfo => view !== null);
        for (const item of list(node, 'items', 'nodes')) {
          const raw = parseProjectItem(item);
          if (raw !== null) issues.push(raw);
        }
        after = text(node, 'items', 'pageInfo', 'endCursor');
        if (at(node, 'items', 'pageInfo', 'hasNextPage') !== true || after === null) break;
      }
      return ok(
        buildProjectSnapshot({
          project: arg.project,
          stageField,
          issues,
          views: views ?? [],
          fetchedAt: now().toISOString(),
        }),
      );
    },

    async mergedPullRequests(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const limit = Math.max(1, Math.floor(arg.limit));
      const result = await run([
        'pr',
        'list',
        '--repo',
        arg.repository,
        '--state',
        'merged',
        '--limit',
        String(limit),
        '--json',
        'number,title,url,mergedAt,mergeCommit,headRefName,baseRefName',
      ]);
      if (!runSucceeded(result)) return err(classifyGhFailure(result));
      const parsed = parseJson(result.stdout);
      if (!Array.isArray(parsed)) return err(failed('gh pr list gave an answer that is not JSON'));
      const pulls = parsed.flatMap((node) => parseMergedPullRequest(node) ?? []);
      pulls.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
      return ok(pulls);
    },

    async openPullRequests(arg) {
      const parts = splitRepositoryName(arg.repository);
      if (!parts.ok) return parts;
      const limit = Math.max(1, Math.floor(arg.limit));
      const result = await run([
        'pr',
        'list',
        '--repo',
        arg.repository,
        '--state',
        'open',
        '--limit',
        String(limit),
        '--json',
        'number,title,url,headRefName,baseRefName,isDraft,createdAt,updatedAt,statusCheckRollup,reviewDecision,mergeable',
      ]);
      if (!runSucceeded(result)) return err(classifyGhFailure(result));
      const parsed = parseJson(result.stdout);
      if (!Array.isArray(parsed)) return err(failed('gh pr list gave an answer that is not JSON'));
      const pulls = parsed.flatMap((node) => {
        const number = int(node, 'number');
        const title = text(node, 'title');
        const url = text(node, 'url');
        const headBranch = text(node, 'headRefName');
        const baseBranch = text(node, 'baseRefName');
        const draft = at(node, 'isDraft') === true;
        const createdAt = text(node, 'createdAt');
        const updatedAt = text(node, 'updatedAt');
        
        if (number === null || title === null || url === null || headBranch === null || baseBranch === null || createdAt === null || updatedAt === null) {
          return [];
        }

        let checks: PullRequestChecks = 'none';
        const rollup = list(node, 'statusCheckRollup');
        if (rollup.length > 0) {
          checks = 'passing';
          for (const check of rollup) {
            const typename = text(check, '__typename');
            if (typename === 'CheckRun') {
              const conclusion = text(check, 'conclusion');
              const status = text(check, 'status');
              if (conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'CANCELLED' || conclusion === 'ACTION_REQUIRED') {
                checks = 'failing';
                break;
              }
              if (status !== 'COMPLETED') {
                checks = 'pending';
              }
            } else if (typename === 'StatusContext') {
              const state = text(check, 'state');
              if (state === 'ERROR' || state === 'FAILURE') {
                checks = 'failing';
                break;
              }
              if (state === 'EXPECTED' || state === 'PENDING') {
                checks = 'pending';
              }
            }
          }
        }

        const reviewMapping: Record<string, OpenPullRequest['review']> = {
          APPROVED: 'approved',
          CHANGES_REQUESTED: 'changes-requested',
          REVIEW_REQUIRED: 'review-required',
        };
        const reviewDecision = text(node, 'reviewDecision');
        const review = reviewDecision !== null ? (reviewMapping[reviewDecision] ?? 'none') : 'none';
        
        const mergeableMapping: Record<string, OpenPullRequest['mergeable']> = {
          MERGEABLE: 'mergeable',
          CONFLICTING: 'conflicting',
        };
        const mergeableStr = text(node, 'mergeable');
        const mergeable = mergeableStr !== null ? (mergeableMapping[mergeableStr] ?? 'unknown') : 'unknown';

        const pr: OpenPullRequest = {
          repository: arg.repository,
          number,
          title,
          url,
          headBranch,
          baseBranch,
          draft,
          createdAt,
          updatedAt,
          checks,
          review,
          mergeable,
        };
        return [pr];
      });

      pulls.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      return ok(pulls);
    },
  };
  return port;
}
