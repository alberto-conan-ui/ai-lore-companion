/**
 * A `CommandRunner` that answers as `gh` would, from a `FakeGitHub`.
 *
 * It exists so that the contract of `GitHubPort` (`github-contract.ts`) runs
 * against the gh adapter too, with no network: the adapter builds its argument
 * arrays and GraphQL requests, this runner reads them as `gh` and GitHub
 * would, keeps the state in a `FakeGitHub`, and prints answers in the shapes
 * of `github-samples.ts`. A request the adapter should never send (arguments
 * that are not the constant ones, a GraphQL text that is not one of the
 * documents of `queries.ts`) makes the run fail, and with it the test.
 *
 * The switches (`setUnreachable`, `rateLimitNext`, `loseNextAnswer`,
 * `setViewsSupported`) act on a run of `gh`, as the network would. The issues
 * of a repository are paged two at a time and the items of a Project three at
 * a time, so that the adapter's paging is used by every test.
 */

import {
  type CommandRunner,
  GRAPHQL_ARGS,
  type GitHubError,
  type GitHubResult,
  PROJECT_SCOPE,
  type ProjectInfo,
  type ProjectViewLayout,
  type RunOptions,
  type RunResult,
} from '../../src/index.js';
import type {
  FakeGitHub,
  FakeGitHubState,
  FakeIssue,
  FakeProject,
} from '../../src/space/github/fake.js';
import * as Q from '../../src/space/github/queries.js';
import * as S from './github-samples.js';

const ISSUES_PAGE = 2;
const ITEMS_PAGE = 3;

/** The runner, and the switches the contract suite uses. */
export type SimulatedGh = CommandRunner & {
  setUnreachable(on: boolean): void;
  rateLimitNext(count: number, retryAfterSeconds: number | null): void;
  loseNextAnswer(error: GitHubError): void;
  setViewsSupported(on: boolean): void;
};

type Variables = Record<string, unknown>;
type Answer = { body: unknown; status?: string; headers?: Record<string, string> };

const LAYOUTS: Record<string, ProjectViewLayout> = {
  TABLE_LAYOUT: 'table',
  BOARD_LAYOUT: 'board',
  ROADMAP_LAYOUT: 'roadmap',
};

function layoutName(layout: ProjectViewLayout): string {
  return Object.keys(LAYOUTS).find((name) => LAYOUTS[name] === layout) ?? 'TABLE_LAYOUT';
}

function str(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error(`simulated gh: expected text, got ${typeof value}`);
  return value;
}

function input(variables: Variables): Variables {
  const value = variables.input;
  if (typeof value !== 'object' || value === null) throw new Error('simulated gh: no input');
  return value as Variables;
}

/** The answer GitHub gives for an error, in the shapes the adapter sorts by kind. */
function answerFor(error: GitHubError): Answer {
  switch (error.kind) {
    case 'not-signed-in':
      return { status: '401 Unauthorized', body: { message: 'Bad credentials' } };
    case 'missing-scope':
      return { body: S.MISSING_SCOPE_BODY };
    case 'rate-limited':
      return {
        status: '403 Forbidden',
        headers:
          error.retryAfterSeconds === null
            ? {}
            : { 'Retry-After': String(error.retryAfterSeconds) },
        body: S.SECONDARY_LIMIT_BODY,
      };
    case 'not-found':
      return { body: { data: null, errors: [{ type: 'NOT_FOUND', message: error.message }] } };
    default:
      return { body: { errors: [{ type: 'UNPROCESSABLE', message: error.message }] } };
  }
}

function hasErrors(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'errors' in body;
}

function printed(answer: Answer): RunResult {
  const bad = answer.status !== undefined || hasErrors(answer.body);
  return {
    code: bad ? 1 : 0,
    stdout: S.apiResponse(answer.body, { status: answer.status, headers: answer.headers }),
    // What gh prints is left out on purpose: the adapter must sort the answer by what GitHub sent.
    stderr: bad ? 'gh: the request failed\n' : '',
  };
}

const UNREACHABLE: RunResult = {
  code: 1,
  stdout: '',
  stderr:
    'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n',
};

/** Build the runner over `fake`. The fake's own switches are left alone. */
export function createSimulatedGh(fake: FakeGitHub): SimulatedGh {
  let offline = false;
  const limits: (number | null)[] = [];
  let lost: GitHubError | null = null;
  let viewsSupported = true;

  const state = (): FakeGitHubState => fake.state();

  function projectById(id: unknown): FakeProject | null {
    return state().projects.find((project) => project.info.id === id && !project.closed) ?? null;
  }

  function issueById(id: unknown): FakeIssue | null {
    return state().issues.find((issue) => issue.id === id) ?? null;
  }

  function issueByNumber(owner: unknown, name: unknown, number: unknown): FakeIssue | null {
    return (
      state().issues.find(
        (issue) => issue.ref.repository === `${owner}/${name}` && issue.ref.number === number,
      ) ?? null
    );
  }

  function repositoryNode(fullName: string): Record<string, unknown> | null {
    const found = state().repositories.find((repository) => repository.info.fullName === fullName);
    if (found === undefined) return null;
    const { id, url } = found.info;
    return { id, nameWithOwner: fullName, url, isPrivate: found.info.private };
  }

  function projectNode(info: ProjectInfo): Record<string, unknown> {
    return { id: info.id, number: info.number, title: info.title, url: info.url };
  }

  function fieldNode(field: FakeProject['fields'][number]): Record<string, unknown> {
    return {
      __typename: 'ProjectV2SingleSelectField',
      id: field.id,
      name: field.name,
      options: field.options.map((option) => ({ ...option, color: 'GRAY', description: '' })),
    };
  }

  function viewNode(view: FakeProject['views'][number]): Record<string, unknown> {
    return { ...view, layout: layoutName(view.layout) };
  }

  function notFound(what: string, path: string): Answer {
    return {
      body: {
        data: { [path]: null },
        errors: [{ type: 'NOT_FOUND', path: [path], message: `Could not resolve to ${what}.` }],
      },
    };
  }

  /** The answer for a write made through the fake: `data` from `onOk`, or the error's shape. */
  async function written<T>(
    result: Promise<GitHubResult<T>>,
    onOk: (value: T) => unknown,
  ): Promise<Answer> {
    const done = await result;
    return done.ok ? { body: { data: onOk(done.value) } } : answerFor(done.error);
  }

  function issueContent(issue: FakeIssue, all: FakeIssue[]): Record<string, unknown> {
    const parent = all.find((candidate) => candidate.id === issue.parentId);
    return {
      __typename: 'Issue',
      number: issue.ref.number,
      url: issue.ref.url,
      title: issue.title,
      body: issue.body,
      state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
      updatedAt: issue.updatedAt,
      repository: { nameWithOwner: issue.ref.repository },
      labels: { nodes: issue.labels.map((name) => ({ name })) },
      parent:
        parent === undefined
          ? null
          : { number: parent.ref.number, repository: { nameWithOwner: parent.ref.repository } },
      subIssues: {
        nodes: all
          .filter((candidate) => candidate.parentId === issue.id)
          .map((sub) => ({
            number: sub.ref.number,
            url: sub.ref.url,
            title: sub.title,
            state: sub.state === 'open' ? 'OPEN' : 'CLOSED',
            repository: { nameWithOwner: sub.ref.repository },
          })),
      },
    };
  }

  function page<T>(all: T[], after: unknown, size: number): { nodes: T[]; pageInfo: unknown } {
    const start = typeof after === 'string' ? Number(after) : 0;
    const end = start + size;
    return {
      nodes: all.slice(start, end),
      pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null },
    };
  }

  async function graphql(query: string, v: Variables): Promise<Answer> {
    const now = state();
    if (now.account === null) return answerFor({ kind: 'not-signed-in', message: '' });
    if (/ProjectV2|projectsV2/.test(query) && !now.scopes.includes(PROJECT_SCOPE)) {
      return answerFor({ kind: 'missing-scope', scope: PROJECT_SCOPE, message: '' });
    }
    const isViewDocument =
      query === Q.PROJECT_VIEWS_QUERY ||
      query === Q.CREATE_VIEW_MUTATION ||
      query === Q.UPDATE_VIEW_MUTATION;
    if (isViewDocument && !viewsSupported) return { body: S.SCHEMA_ABSENCE_BODY };

    switch (query) {
      case Q.REPOSITORY_QUERY: {
        const node = repositoryNode(`${v.owner}/${v.name}`);
        return node === null
          ? notFound(`a Repository with the name '${v.owner}/${v.name}'`, 'repository')
          : { body: { data: { repository: node } } };
      }
      case Q.OWNER_QUERY: {
        const login = str(v.login);
        const known = now.owners.includes(login);
        return {
          body: { data: { repositoryOwner: known ? { id: `O_${login}`, login } : null } },
        };
      }
      case Q.CREATE_REPOSITORY_MUTATION: {
        const { ownerId, name, visibility } = input(v);
        return written(
          fake.createRepository({
            owner: str(ownerId).slice(2),
            name: str(name),
            private: visibility === 'PRIVATE',
          }),
          (info) => ({ createRepository: { repository: repositoryNode(info.fullName) } }),
        );
      }
      case Q.OWNER_PROJECTS_QUERY: {
        const login = str(v.login);
        if (!now.owners.includes(login)) return { body: { data: { repositoryOwner: null } } };
        const nodes = now.projects
          .filter((project) => project.info.owner === login)
          .map((project) => ({ ...projectNode(project.info), closed: project.closed }));
        return {
          body: {
            data: {
              repositoryOwner: { id: `O_${login}`, login, projectsV2: page(nodes, v.after, 2) },
            },
          },
        };
      }
      case Q.CREATE_PROJECT_MUTATION: {
        const { ownerId, title } = input(v);
        return written(
          fake.createProject({ owner: str(ownerId).slice(2), title: str(title) }),
          (info) => ({ createProjectV2: { projectV2: projectNode(info) } }),
        );
      }
      case Q.PROJECT_FIELD_QUERY: {
        const project = projectById(v.project);
        if (project === null) return notFound('a node with the global id', 'node');
        const field = project.fields.find((candidate) => candidate.name === v.name);
        if (field === undefined) {
          return {
            body: {
              data: { node: { field: null } },
              errors: [
                {
                  type: 'NOT_FOUND',
                  path: ['node', 'field'],
                  message: `Could not resolve to a ProjectV2Field with the name ${str(v.name)}.`,
                },
              ],
            },
          };
        }
        return { body: { data: { node: { field: fieldNode(field) } } } };
      }
      case Q.CREATE_FIELD_MUTATION:
      case Q.UPDATE_FIELD_MUTATION: {
        const given = input(v);
        const project =
          query === Q.CREATE_FIELD_MUTATION
            ? projectById(given.projectId)
            : (now.projects.find((candidate) =>
                candidate.fields.some((field) => field.id === given.fieldId),
              ) ?? null);
        if (project === null) return notFound('a node with the global id', 'node');
        const name =
          query === Q.CREATE_FIELD_MUTATION
            ? str(given.name)
            : str(project.fields.find((field) => field.id === given.fieldId)?.name);
        const options = (given.singleSelectOptions as { name: string }[]).map(
          (option) => option.name,
        );
        const key =
          query === Q.CREATE_FIELD_MUTATION ? 'createProjectV2Field' : 'updateProjectV2Field';
        return written(
          fake.ensureSingleSelectField({ project: project.info, name, options }),
          (field) => ({ [key]: { projectV2Field: fieldNode(field) } }),
        );
      }
      case Q.PROJECT_VIEWS_QUERY: {
        const project = projectById(v.project);
        if (project === null) return notFound('a node with the global id', 'node');
        return { body: { data: { node: { views: { nodes: project.views.map(viewNode) } } } } };
      }
      case Q.CREATE_VIEW_MUTATION: {
        const given = input(v);
        const project = projectById(given.projectId);
        if (project === null) return notFound('a node with the global id', 'node');
        const layout = LAYOUTS[str(given.layout)] ?? 'table';
        return written(
          fake.ensureProjectView({
            project: project.info,
            spec: { name: str(given.name), layout },
          }),
          (ensured) => ({
            createProjectV2View: {
              projectV2View: ensured.view === null ? null : viewNode(ensured.view),
            },
          }),
        );
      }
      case Q.UPDATE_VIEW_MUTATION: {
        const given = input(v);
        const project = now.projects.find((candidate) =>
          candidate.views.some((view) => view.id === given.viewId),
        );
        const view = project?.views.find((candidate) => candidate.id === given.viewId);
        if (project === undefined || view === undefined) {
          return notFound('a node with the global id', 'node');
        }
        const spec = { name: view.name, layout: view.layout, filter: str(given.filter) };
        return written(fake.ensureProjectView({ project: project.info, spec }), (ensured) => ({
          updateProjectV2View: {
            projectV2View: ensured.view === null ? null : viewNode(ensured.view),
          },
        }));
      }
      case Q.PROJECT_LINK_QUERY: {
        const project = projectById(v.project);
        const repository = repositoryNode(`${v.owner}/${v.name}`);
        if (repository === null) {
          return notFound(`a Repository with the name '${v.owner}/${v.name}'`, 'repository');
        }
        const linked = (project?.linked ?? []).flatMap((fullName) => {
          const node = repositoryNode(fullName);
          return node === null ? [] : [{ id: node.id }];
        });
        return {
          body: {
            data: {
              repository: { id: repository.id },
              node: project === null ? null : { repositories: { nodes: linked } },
            },
          },
        };
      }
      case Q.LINK_PROJECT_MUTATION: {
        const given = input(v);
        const project = projectById(given.projectId);
        const repository = now.repositories.find(
          (candidate) => candidate.info.id === given.repositoryId,
        );
        if (project === null || repository === undefined) {
          return notFound('a node with the global id', 'node');
        }
        return written(
          fake.linkProjectToRepository({
            project: project.info,
            repository: repository.info.fullName,
          }),
          () => ({ linkProjectV2ToRepository: { repository: { id: repository.info.id } } }),
        );
      }
      case Q.ISSUE_BODIES_QUERY: {
        const fullName = `${v.owner}/${v.name}`;
        if (repositoryNode(fullName) === null) {
          return notFound(`a Repository with the name '${fullName}'`, 'repository');
        }
        const nodes = now.issues
          .filter((issue) => issue.ref.repository === fullName)
          .map((issue) => ({ number: issue.ref.number, url: issue.ref.url, body: issue.body }));
        return { body: { data: { repository: { issues: page(nodes, v.after, ISSUES_PAGE) } } } };
      }
      case Q.CREATE_ISSUE_MUTATION: {
        const given = input(v);
        const repository = now.repositories.find(
          (candidate) => candidate.info.id === given.repositoryId,
        );
        if (repository === undefined) return notFound('a node with the global id', 'node');
        const labels = (given.labelIds as string[]).map((id) => id.slice(3));
        return written(
          fake.createIssue({
            repository: repository.info.fullName,
            title: str(given.title),
            body: str(given.body),
            labels,
          }),
          (issue) => ({ createIssue: { issue: { number: issue.number, url: issue.url } } }),
        );
      }
      case Q.ISSUE_QUERY: {
        const issue = issueByNumber(v.owner, v.name, v.number);
        if (issue === null) {
          return {
            body: {
              data: { repository: { issue: null } },
              errors: [
                {
                  type: 'NOT_FOUND',
                  path: ['repository', 'issue'],
                  message: `Could not resolve to an Issue with the number of ${v.number}.`,
                },
              ],
            },
          };
        }
        const node = {
          id: issue.id,
          state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
          parent: issue.parentId === null ? null : { id: issue.parentId },
        };
        return { body: { data: { repository: { issue: node } } } };
      }
      case Q.ISSUE_PAIR_QUERY: {
        const parent = issueByNumber(v.parentOwner, v.parentName, v.parentNumber);
        const child = issueByNumber(v.childOwner, v.childName, v.childNumber);
        const data = {
          parent: { issue: parent === null ? null : { id: parent.id } },
          child: {
            issue:
              child === null
                ? null
                : {
                    id: child.id,
                    parent: child.parentId === null ? null : { id: child.parentId },
                  },
          },
        };
        const missing = parent === null || child === null;
        return {
          body: missing
            ? { data, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Issue.' }] }
            : { data },
        };
      }
      case Q.UPDATE_ISSUE_MUTATION: {
        const given = input(v);
        const issue = issueById(given.id);
        if (issue === null) return notFound('a node with the global id', 'node');
        return written(
          fake.updateIssue({
            issue: issue.ref,
            title: given.title === undefined ? undefined : str(given.title),
            body: given.body === undefined ? undefined : str(given.body),
          }),
          () => ({ updateIssue: { issue: { id: issue.id } } }),
        );
      }
      case Q.ADD_SUB_ISSUE_MUTATION: {
        const given = input(v);
        const parent = issueById(given.issueId);
        const child = issueById(given.subIssueId);
        if (parent === null || child === null) return notFound('a node with the global id', 'node');
        return written(fake.addSubIssue({ parent: parent.ref, child: child.ref }), () => ({
          addSubIssue: { subIssue: { id: child.id } },
        }));
      }
      case Q.ADD_ITEM_MUTATION: {
        const given = input(v);
        const project = projectById(given.projectId);
        const issue = issueById(given.contentId);
        if (project === null || issue === null)
          return notFound('a node with the global id', 'node');
        return written(
          fake.addIssueToProject({ project: project.info, issue: issue.ref }),
          (item) => ({ addProjectV2ItemById: { item: { id: item } } }),
        );
      }
      case Q.SET_FIELD_VALUE_MUTATION: {
        const given = input(v);
        const project = projectById(given.projectId);
        const field = project?.fields.find((candidate) => candidate.id === given.fieldId);
        const optionId = (given.value as { singleSelectOptionId?: unknown }).singleSelectOptionId;
        const option = field?.options.find((candidate) => candidate.id === optionId);
        if (project === null || field === undefined || option === undefined) {
          return notFound('a node with the global id', 'node');
        }
        return written(
          fake.setSingleSelect({
            project: project.info,
            item: str(given.itemId),
            field,
            option: option.name,
          }),
          () => ({ updateProjectV2ItemFieldValue: { projectV2Item: { id: given.itemId } } }),
        );
      }
      case Q.ADD_COMMENT_MUTATION: {
        const given = input(v);
        const issue = issueById(given.subjectId);
        if (issue === null) return notFound('a node with the global id', 'node');
        return written(fake.comment({ issue: issue.ref, body: str(given.body) }), () => ({
          addComment: { clientMutationId: null },
        }));
      }
      case Q.CLOSE_ISSUE_MUTATION: {
        const issue = issueById(input(v).issueId);
        if (issue === null) return notFound('a node with the global id', 'node');
        return written(fake.closeIssue({ issue: issue.ref }), () => ({
          closeIssue: { issue: { id: issue.id } },
        }));
      }
      case Q.READ_PROJECT_QUERY: {
        const project = projectById(v.project);
        if (project === null) return { body: { data: { node: null } } };
        const stage = project.fields.find((field) => field.name === v.stage);
        const nodes = project.items.flatMap((item) => {
          const issue = now.issues.find((candidate) => candidate.id === item.issueId);
          if (issue === undefined) return [];
          const values = project.fields.flatMap((field) => {
            const option = field.options.find(
              (candidate) => candidate.id === item.values[field.id],
            );
            if (option === undefined) return [];
            const at = item.valuesAt?.[field.id];
            return [{ name: option.name, updatedAt: at, field: { name: field.name } }];
          });
          return [
            {
              id: item.id,
              isArchived: false,
              // An empty object is what GitHub gives for a value of another type.
              fieldValues: { nodes: [{}, ...values] },
              content: issueContent(issue, now.issues),
            },
          ];
        });
        return {
          body: {
            data: {
              node: {
                stage:
                  stage === undefined
                    ? null
                    : { id: stage.id, name: stage.name, options: stage.options },
                items: page(nodes, v.after, ITEMS_PAGE),
              },
            },
            ...(stage === undefined
              ? {
                  errors: [
                    {
                      type: 'NOT_FOUND',
                      path: ['node', 'stage'],
                      message: `Could not resolve to a ProjectV2Field with the name ${str(v.stage)}.`,
                    },
                  ],
                }
              : {}),
          },
        };
      }
      case Q.BRANCH_HEADS_QUERY: {
        const fullName = `${v.owner}/${v.name}`;
        const repository = now.repositories.find(
          (candidate) => candidate.info.fullName === fullName,
        );
        if (repository === undefined) {
          return notFound(`a Repository with the name '${fullName}'`, 'repository');
        }
        const heads = await fake.branchHeads(fullName);
        const commits = heads.ok ? (heads.value ?? []) : [];
        return {
          body: {
            data: {
              repository: { refs: { nodes: commits.map((oid) => ({ target: { oid } })) } },
            },
          },
        };
      }
      case Q.OWNER_SPACE_REPOSITORIES_QUERY: {
        const login = str(v.login);
        if (!now.owners.includes(login)) {
          return { body: { data: { repositoryOwner: null } } };
        }
        const listed = await fake.listSpaceRepositories(login);
        const withManifest = new Set((listed.ok ? listed.value : []).map((repo) => repo.fullName));
        const nodes = [...now.repositories]
          .reverse()
          .filter((repository) => repository.info.fullName.startsWith(`${login}/`))
          .map((repository) => ({
            ...repositoryNode(repository.info.fullName),
            manifest: withManifest.has(repository.info.fullName) ? { id: 'manifest' } : null,
          }));
        return { body: { data: { repositoryOwner: { repositories: { nodes } } } } };
      }
    }

    const labelCount = Object.keys(v).filter((key) => /^l\d+$/.test(key)).length;
    if (query === Q.repositoryAndLabelsQuery(labelCount)) {
      const fullName = `${v.owner}/${v.name}`;
      const repository = now.repositories.find((candidate) => candidate.info.fullName === fullName);
      if (repository === undefined) {
        return notFound(`a Repository with the name '${fullName}'`, 'repository');
      }
      const node: Record<string, unknown> = { id: repository.info.id };
      for (let index = 0; index < labelCount; index += 1) {
        const name = str(v[`l${index}`]);
        const has = repository.labels.some((label) => label.name === name);
        node[`l${index}`] = has ? { id: `LA_${name}` } : null;
      }
      return { body: { data: { repository: node } } };
    }
    throw new Error(`simulated gh: a GraphQL document that is not one of queries.ts:\n${query}`);
  }

  function flag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    if (value === undefined) throw new Error(`simulated gh: no ${name} in ${args.join(' ')}`);
    return value;
  }

  function plain<T>(result: GitHubResult<T>, stdout: (value: T) => string): RunResult {
    if (result.ok) return { code: 0, stdout: stdout(result.value), stderr: '' };
    const { error } = result;
    const stderr =
      error.kind === 'not-found'
        ? `GraphQL: Could not resolve to a node (${error.message})\n`
        : `${error.message}\n`;
    return { code: 1, stdout: '', stderr };
  }

  async function command(args: readonly string[], opts: RunOptions): Promise<RunResult> {
    const [first, second] = args;
    if (first === 'api') {
      if (JSON.stringify(args) !== JSON.stringify(GRAPHQL_ARGS)) {
        throw new Error(`simulated gh: unexpected arguments ${args.join(' ')}`);
      }
      const request = JSON.parse(opts.input ?? '') as { query: string; variables: Variables };
      return printed(await graphql(request.query, request.variables));
    }
    if (first === 'auth' && second === 'status') {
      const now = state();
      const entries =
        now.account === null
          ? []
          : [
              {
                state: 'success',
                active: true,
                host: 'github.com',
                login: now.account,
                tokenSource: 'keyring',
                scopes: now.scopes.join(', '),
                gitProtocol: 'https',
              },
            ];
      const hosts = entries.length === 0 ? {} : { 'github.com': entries };
      return { code: 0, stdout: JSON.stringify({ hosts }), stderr: '' };
    }
    if (first === 'label' && second === 'create') {
      const separator = args.indexOf('--');
      const description = args.find((arg) => arg.startsWith('--description='));
      if (separator !== args.length - 2 || description === undefined || !args.includes('--force')) {
        throw new Error(`simulated gh: unexpected arguments ${args.join(' ')}`);
      }
      const label = {
        name: str(args[separator + 1]),
        color: flag(args, '--color'),
        description: description.slice('--description='.length),
      };
      const result = await fake.ensureLabels({ repository: flag(args, '--repo'), labels: [label] });
      return plain(result, () => '');
    }
    if (first === 'issue' && second === 'develop') {
      const repository = flag(args, '--repo');
      const number = Number(args[args.length - 1]);
      const issue = fake.issue({ repository, number, url: '' });
      if (issue === null) {
        return plain({ ok: false, error: { kind: 'not-found', message: 'the issue' } }, () => '');
      }
      if (args.includes('--list')) {
        const lines = issue.branches.map(
          (branch) => `${branch.name}\thttps://github.com/${branch.repository}/tree/${branch.name}`,
        );
        return { code: 0, stdout: lines.map((line) => `${line}\n`).join(''), stderr: '' };
      }
      const branchRepository = flag(args, '--branch-repo');
      const result = await fake.developBranch({
        issue: issue.ref,
        branchRepository,
        name: flag(args, '--name'),
      });
      return plain(result, (made) => `github.com/${branchRepository}/tree/${made.branch}\n`);
    }
    if (first === 'pr' && second === 'list') {
      if (flag(args, '--state') === 'open') {
        const result = await fake.openPullRequests({
          repository: flag(args, '--repo'),
          limit: Number(flag(args, '--limit')),
        });
        return plain(result, (pulls) =>
          JSON.stringify(
            pulls.map((pull) => ({
              number: pull.number,
              title: pull.title,
              url: pull.url,
              headRefName: pull.headBranch,
              baseRefName: pull.baseBranch,
              isDraft: pull.draft,
              createdAt: pull.createdAt,
              updatedAt: pull.updatedAt,
              statusCheckRollup:
                pull.checks === 'none'
                  ? []
                  : [
                      {
                        __typename: 'CheckRun',
                        conclusion:
                          pull.checks === 'failing'
                            ? 'FAILURE'
                            : pull.checks === 'passing'
                              ? 'SUCCESS'
                              : '',
                        status: pull.checks === 'pending' ? 'IN_PROGRESS' : 'COMPLETED',
                      },
                    ],
              reviewDecision:
                pull.review === 'approved'
                  ? 'APPROVED'
                  : pull.review === 'changes-requested'
                    ? 'CHANGES_REQUESTED'
                    : pull.review === 'review-required'
                      ? 'REVIEW_REQUIRED'
                      : '',
              mergeable:
                pull.mergeable === 'mergeable'
                  ? 'MERGEABLE'
                  : pull.mergeable === 'conflicting'
                    ? 'CONFLICTING'
                    : 'UNKNOWN',
            })),
          ),
        );
      }
      const result = await fake.mergedPullRequests({
        repository: flag(args, '--repo'),
        limit: Number(flag(args, '--limit')),
      });
      return plain(result, (pulls) =>
        JSON.stringify(
          pulls.map((pull) => ({
            number: pull.number,
            title: pull.title,
            url: pull.url,
            mergedAt: pull.mergedAt,
            mergeCommit: pull.mergeCommit === null ? null : { oid: pull.mergeCommit },
            headRefName: pull.headBranch,
            baseRefName: pull.baseBranch,
          })),
        ),
      );
    }
    throw new Error(
      `simulated gh: a command the adapter is not expected to run: ${args.join(' ')}`,
    );
  }

  /** Whether the run changes GitHub: a GraphQL mutation, or a command that creates. */
  function writes(args: readonly string[], opts: RunOptions): boolean {
    if (args[0] === 'api') {
      const request = JSON.parse(opts.input ?? '{}') as { query?: string };
      return (request.query ?? '').trimStart().startsWith('mutation');
    }
    return args[0] === 'label' || (args[0] === 'issue' && !args.includes('--list'));
  }

  return {
    setUnreachable(on) {
      offline = on;
    },
    rateLimitNext(count, retryAfterSeconds) {
      for (let index = 0; index < count; index += 1) limits.push(retryAfterSeconds);
    },
    loseNextAnswer(error) {
      lost = error;
    },
    setViewsSupported(on) {
      viewsSupported = on;
    },
    async run(bin, args, opts = {}) {
      if (bin !== 'gh') throw new Error(`simulated gh: asked to run ${bin}`);
      if (offline) return UNREACHABLE;
      const limited = limits.shift();
      if (limited !== undefined) {
        return printed(
          answerFor({ kind: 'rate-limited', retryAfterSeconds: limited, message: '' }),
        );
      }
      const result = await command(args, opts);
      if (result.code === 0 && lost !== null && writes(args, opts)) {
        const error = lost;
        lost = null;
        return printed(answerFor(error));
      }
      return result;
    },
  };
}
