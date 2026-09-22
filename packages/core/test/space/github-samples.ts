/**
 * Answers of `gh`, for the adapter's tests.
 *
 * How they were obtained (2026-09-18, gh 2.92.0). The samples marked RECORDED
 * are the output of read-only commands against public data (the repository
 * `cli/cli`, the schema, the signed-in account's own status), with names, ids,
 * logins and dates replaced. The account that was active had no `project`
 * scope, so every Project answer is marked BY HAND: it is written from
 * GitHub's GraphQL reference, and the queries that produce it were sent once
 * to check that GitHub accepts them as valid (the answer was the recorded
 * missing-scope error below). No mutation was ever sent; every mutation answer
 * is BY HAND, from the payload types of the schema.
 */

/** The output of `gh api -i`: a status line, headers, an empty line, the body. */
export function apiResponse(
  body: unknown,
  options: { status?: string; headers?: Record<string, string> } = {},
): string {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Date: 'Fri, 18 Sep 2026 15:00:00 GMT',
    'X-Ratelimit-Limit': '5000',
    'X-Ratelimit-Remaining': '4981',
    'X-Ratelimit-Reset': '1789748147',
    'X-Ratelimit-Resource': 'graphql',
    ...options.headers,
  };
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return `HTTP/2.0 ${options.status ?? '200 OK'}\r\n${lines.join('\r\n')}\r\n\r\n${text}`;
}

// ---------- gh auth status --active --hostname github.com --json hosts ----------

/** RECORDED. */
export const AUTH_SIGNED_IN = {
  hosts: {
    'github.com': [
      {
        state: 'success',
        active: true,
        host: 'github.com',
        login: 'octo-human',
        tokenSource: 'keyring',
        scopes: 'gist, project, read:org, repo, workflow',
        gitProtocol: 'https',
      },
    ],
  },
};

/** BY HAND: what the command prints when no account is known for the host. */
export const AUTH_SIGNED_OUT = { hosts: {} };

// ---------- errors ----------

/** RECORDED: a Project query with a token that lacks the scope. `gh` exits 1. */
export const MISSING_SCOPE_BODY = {
  errors: [
    {
      type: 'INSUFFICIENT_SCOPES',
      locations: [{ line: 1, column: 47 }],
      message:
        "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['gist', 'read:org', 'repo', 'workflow'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.",
    },
  ],
};
/** RECORDED. */
export const MISSING_SCOPE_STDERR =
  "gh: Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['gist', 'read:org', 'repo', 'workflow'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.\n";

/** RECORDED: a repository that does not exist. `gh` exits 1. */
export const REPOSITORY_NOT_FOUND_BODY = {
  data: { repository: null },
  errors: [
    {
      type: 'NOT_FOUND',
      path: ['repository'],
      locations: [{ line: 1, column: 9 }],
      message: "Could not resolve to a Repository with the name 'octo-human/no-such-space'.",
    },
  ],
};

/** RECORDED: no network (the request was sent through a proxy address nothing listens on). */
export const UNREACHABLE_STDERR =
  'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused\n';

/** BY HAND, from "Rate limits and node limits for the GraphQL API": the primary limit. */
export const RATE_LIMITED_BODY = {
  errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for user ID 1.' }],
};

/** BY HAND, from the same page: a secondary limit, answered with HTTP 403 and `Retry-After`. */
export const SECONDARY_LIMIT_BODY = {
  message:
    'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
  documentation_url:
    'https://docs.github.com/free-pro-team@latest/rest/overview/rate-limits-for-the-rest-api#about-secondary-rate-limits',
};

/** BY HAND: what GitHub answers when issues are created faster than the content limit allows. */
export const SUBMITTED_TOO_QUICKLY_BODY = {
  data: { createIssue: null },
  errors: [{ type: 'UNPROCESSABLE', path: ['createIssue'], message: 'was submitted too quickly' }],
};

/** BY HAND: `gh` with no account, from the text `gh` prints. */
export const NOT_SIGNED_IN_STDERR =
  'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n';

/** BY HAND: a `gh` subcommand that checks scopes itself, from `gh help project`. */
export const GH_MISSING_SCOPE_STDERR =
  'error: your authentication token is missing required scopes [project]\nTo request it, run:  gh auth refresh -s project\n';

/** RECORDED on 2026-09-18 with gh 2.92.0: `gh project list` with a token that lacks the scope. `gh` exits 1. */
export const GH_PROJECT_LIST_MISSING_SCOPE_STDERR =
  'error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project\n';

/**
 * RECORDED on 2026-09-18 from github.com: a query that names a field and an
 * input type the schema lacks. HTTP 200, `gh` exits 1. A GitHub Enterprise
 * Server without the view mutations answers a view mutation in this shape.
 */
export const SCHEMA_ABSENCE_BODY = {
  errors: [
    {
      path: ['query'],
      extensions: { code: 'variableRequiresValidType', typeName: 'NopeInput', variableName: 'i' },
      locations: [{ line: 1, column: 7 }],
      message: "NopeInput isn't a defined input type (on $i)",
    },
    {
      path: ['query', 'viewer', 'nopeField'],
      extensions: { code: 'undefinedField', typeName: 'User', fieldName: 'nopeField' },
      locations: [{ line: 1, column: 33 }],
      message: "Field 'nopeField' doesn't exist on type 'User'",
    },
    {
      path: ['query'],
      extensions: { code: 'variableNotUsed', variableName: 'i' },
      locations: [{ line: 1, column: 1 }],
      message: 'Variable $i is declared by anonymous query but not used',
    },
  ],
};
/** RECORDED with it. */
export const SCHEMA_ABSENCE_STDERR =
  "gh: NopeInput isn't a defined input type (on $i)\nField 'nopeField' doesn't exist on type 'User'\nVariable $i is declared by anonymous query but not used\n";

/** BY HAND, from GitHub's documentation of SAML single sign-on: HTTP 403 that is not a rate limit. */
export const SAML_FORBIDDEN_BODY = {
  message:
    'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
  documentation_url:
    'https://docs.github.com/articles/authenticating-to-a-github-organization-with-saml-single-sign-on/',
};

// ---------- repositories ----------

/** RECORDED (the query `REPOSITORY_QUERY` against `cli/cli`). */
export const REPOSITORY_BODY = {
  data: {
    repository: {
      id: 'R_kgDOAAAAAA',
      nameWithOwner: 'octo-human/my-space',
      url: 'https://github.com/octo-human/my-space',
      isPrivate: true,
    },
  },
};

/** RECORDED (`OWNER_QUERY`). */
export const OWNER_BODY = {
  data: { repositoryOwner: { id: 'U_kgDOAAAAAA', login: 'octo-human' } },
};

/** BY HAND. */
export const CREATE_REPOSITORY_BODY = {
  data: { createRepository: { repository: REPOSITORY_BODY.data.repository } },
};

/** BY HAND (`BRANCH_HEADS_QUERY`): a repository with one branch. */
export const BRANCH_HEADS_BODY = {
  data: {
    repository: {
      refs: { nodes: [{ target: { oid: '9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b' } }] },
    },
  },
};

/** BY HAND (`BRANCH_HEADS_QUERY`): a repository with no commit yet. */
export const BRANCH_HEADS_EMPTY_BODY = {
  data: { repository: { refs: { nodes: [] } } },
};

/** BY HAND (`OWNER_SPACE_REPOSITORIES_QUERY`): one repository with a Space manifest, one without. */
export const OWNER_SPACE_REPOSITORIES_BODY = {
  data: {
    repositoryOwner: {
      repositories: {
        nodes: [
          {
            id: 'R_kgDOAAAAAB',
            nameWithOwner: 'octo-human/my-space',
            url: 'https://github.com/octo-human/my-space',
            isPrivate: true,
            manifest: { id: 'B_kwDOAAAAAA' },
          },
          {
            id: 'R_kgDOAAAAAC',
            nameWithOwner: 'octo-human/plain-repo',
            url: 'https://github.com/octo-human/plain-repo',
            isPrivate: false,
            manifest: null,
          },
        ],
      },
    },
  },
};

// ---------- the Project (all BY HAND) ----------

export const PROJECT_NODE = {
  id: 'PVT_kwHOAAAAAA',
  number: 3,
  title: 'My Space',
  url: 'https://github.com/users/octo-human/projects/3',
};

export const OWNER_PROJECTS_BODY = {
  data: {
    repositoryOwner: {
      id: 'U_kgDOAAAAAA',
      login: 'octo-human',
      projectsV2: {
        pageInfo: { hasNextPage: false, endCursor: 'Mw' },
        nodes: [
          { ...PROJECT_NODE, id: 'PVT_closed', number: 1, closed: true },
          { id: 'PVT_other', number: 2, title: 'Another', url: 'https://x/2', closed: false },
          { ...PROJECT_NODE, closed: false },
        ],
      },
    },
  },
};

export const CREATE_PROJECT_BODY = { data: { createProjectV2: { projectV2: PROJECT_NODE } } };

export const STAGE_FIELD_NODE = {
  __typename: 'ProjectV2SingleSelectField',
  id: 'PVTSSF_stage',
  name: 'Stage',
  options: [
    { id: 'opt-spec', name: 'Spec', color: 'BLUE', description: 'Being specified' },
    { id: 'opt-plan', name: 'Plan', color: 'GRAY', description: '' },
  ],
};

/** RECORDED shape: GitHub reports a missing Project field with `NOT_FOUND`, and `gh` exits 1 with it. */
export const FIELD_MISSING_BODY = {
  data: { node: { field: null } },
  errors: [
    {
      type: 'NOT_FOUND',
      path: ['node', 'field'],
      message: 'Could not resolve to a ProjectV2Field with the name Stage.',
    },
  ],
};
export const FIELD_BODY = { data: { node: { field: STAGE_FIELD_NODE } } };
export const FIELD_NOT_SINGLE_SELECT_BODY = {
  data: { node: { field: { __typename: 'ProjectV2Field' } } },
};

export const VIEWS_BODY = {
  data: {
    node: {
      views: {
        nodes: [{ id: 'PVTV_1', number: 1, name: 'View 1', layout: 'TABLE_LAYOUT', filter: '' }],
      },
    },
  },
};

export const CREATED_VIEW_NODE = {
  id: 'PVTV_2',
  number: 2,
  name: 'Agents',
  layout: 'BOARD_LAYOUT',
  filter: null,
};

export const LINK_QUERY_BODY = {
  data: {
    repository: { id: 'R_kgDOAAAAAA' },
    node: { repositories: { nodes: [{ id: 'R_other' }] } },
  },
};

// ---------- issues ----------

/** RECORDED shape (`ISSUE_BODIES_QUERY`), bodies written for the test. */
export function issueBodiesPage(
  issues: { number: number; body: string }[],
  next: string | null,
): unknown {
  return {
    data: {
      repository: {
        issues: {
          pageInfo: { hasNextPage: next !== null, endCursor: next },
          nodes: issues.map((issue) => ({
            number: issue.number,
            url: `https://github.com/octo-human/my-space/issues/${issue.number}`,
            body: issue.body,
          })),
        },
      },
    },
  };
}

/** RECORDED (`repositoryAndLabelsQuery(2)` against `cli/cli`): a label that does not exist is `null`, with no error. */
export const LABELS_BODY = {
  data: { repository: { id: 'R_kgDOAAAAAA', l0: { id: 'LA_focus' }, l1: null } },
};

/** BY HAND. */
export const CREATE_ISSUE_BODY = {
  data: {
    createIssue: {
      issue: { number: 12, url: 'https://github.com/octo-human/my-space/issues/12' },
    },
  },
};

/** RECORDED (`ISSUE_QUERY` against `cli/cli`). */
export const ISSUE_BODY = {
  data: { repository: { issue: { id: 'I_kwDOAAAAAA', state: 'OPEN', parent: null } } },
};

/** RECORDED: an issue number that does not exist. `gh` exits 1. */
export const ISSUE_NOT_FOUND_BODY = {
  data: { repository: { issue: null } },
  errors: [
    {
      type: 'NOT_FOUND',
      path: ['repository', 'issue'],
      message: 'Could not resolve to an Issue with the number of 99.',
    },
  ],
};

/** RECORDED (`gh pr list --state merged --json …` against `cli/cli`); listed by creation, not by merge. */
export const MERGED_PULL_REQUESTS = [
  {
    baseRefName: 'main',
    headRefName: 'older-merge',
    mergeCommit: { oid: '9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b' },
    mergedAt: '2026-09-15T13:30:23Z',
    number: 41,
    title: 'Bump a dependency',
    url: 'https://github.com/octo-human/app/pull/41',
  },
  {
    baseRefName: 'main',
    headRefName: 'newer-merge',
    mergeCommit: { oid: '0cf1092493af067646fc5f3db9421c6a6ec9c938' },
    mergedAt: '2026-09-15T14:11:21Z',
    number: 40,
    title: 'Revert a change',
    url: 'https://github.com/octo-human/app/pull/40',
  },
];

// ---------- reading the Project (BY HAND) ----------

function singleSelect(field: string, name: string): unknown {
  return { name, field: { name: field } };
}

function issueContent(number: number, extra: Record<string, unknown>): unknown {
  return {
    __typename: 'Issue',
    number,
    url: `https://github.com/octo-human/my-space/issues/${number}`,
    title: `Issue ${number}`,
    body: '',
    state: 'OPEN',
    updatedAt: '2026-09-18T10:00:00Z',
    repository: { nameWithOwner: 'octo-human/my-space' },
    labels: { nodes: [] },
    parent: null,
    subIssues: { nodes: [] },
    ...extra,
  };
}

/** Page one: a focus with two sub-issues (one on the Project), a draft issue, an archived item. */
export const READ_PROJECT_PAGE_1 = {
  data: {
    node: {
      stage: { id: 'PVTSSF_stage', name: 'Stage', options: STAGE_FIELD_NODE.options },
      items: {
        pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        nodes: [
          {
            id: 'PVTI_1',
            isArchived: false,
            fieldValues: {
              nodes: [
                {},
                singleSelect('Level', 'Focus'),
                singleSelect('Stage', 'Plan'),
                singleSelect('Status', 'Todo'),
              ],
            },
            content: issueContent(1, {
              title: 'A focus',
              body: 'Text\n<!-- ai-lore-spec: https://example.test/spec.md -->',
              labels: { nodes: [{ name: 'feature' }] },
              subIssues: {
                nodes: [2, 3].map((number) => ({
                  number,
                  url: `https://github.com/octo-human/my-space/issues/${number}`,
                  title: `Issue ${number}`,
                  state: number === 2 ? 'CLOSED' : 'OPEN',
                  repository: { nameWithOwner: 'octo-human/my-space' },
                })),
              },
            }),
          },
          {
            id: 'PVTI_2',
            isArchived: false,
            fieldValues: { nodes: [singleSelect('Status', 'Done')] },
            content: issueContent(2, {
              state: 'CLOSED',
              labels: { nodes: [{ name: 'bug' }] },
              parent: { number: 1, repository: { nameWithOwner: 'octo-human/my-space' } },
            }),
          },
          {
            id: 'PVTI_draft',
            isArchived: false,
            fieldValues: { nodes: [] },
            content: { __typename: 'DraftIssue' },
          },
          {
            id: 'PVTI_old',
            isArchived: true,
            fieldValues: { nodes: [] },
            content: issueContent(9, {}),
          },
        ],
      },
    },
  },
};

/** Page two: a standalone item and a session issue. */
export function readProjectPage2(sessionBody: string): unknown {
  return {
    data: {
      node: {
        stage: { id: 'PVTSSF_stage', name: 'Stage', options: STAGE_FIELD_NODE.options },
        items: {
          pageInfo: { hasNextPage: false, endCursor: 'cursor-2' },
          nodes: [
            {
              id: 'PVTI_4',
              isArchived: false,
              fieldValues: { nodes: [] },
              content: issueContent(4, { labels: { nodes: [{ name: 'paused' }] } }),
            },
            {
              id: 'PVTI_5',
              isArchived: false,
              fieldValues: { nodes: [singleSelect('Agents', 'Writing')] },
              content: issueContent(5, {
                body: sessionBody,
                labels: { nodes: [{ name: 'session' }] },
                updatedAt: '2026-09-18T11:30:00Z',
              }),
            },
          ],
        },
      },
    },
  };
}
