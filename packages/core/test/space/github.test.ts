import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  DEFAULT_STAGES,
  FOCUS_LEVEL,
  type FieldInfo,
  GRAPHQL_ARGS,
  type GitHubPort,
  type GitHubResult,
  ISSUE_BODY_MAX,
  ISSUE_TITLE_MAX,
  type IssueRef,
  KIND_LABELS,
  LEVEL_FIELD,
  PAUSED_LABEL,
  PROJECT_SCOPE,
  type ProjectInfo,
  type RawProjectIssue,
  type RunResult,
  SESSION_LABEL,
  STAGE_FIELD,
  STATUS_FIELD,
  bodyHasMarker,
  buildProjectSnapshot,
  classifyGhFailure,
  createGhCliGitHub,
  describeViewByHand,
  formatIssueMarker,
  formatSessionBlock,
  formatSpecLink,
  gitHubFailed,
  gitHubMissingScope,
  gitHubNotFound,
  gitHubNotSignedIn,
  gitHubRateLimited,
  gitHubUnreachable,
  graphQlErrors,
  graphqlOperationName,
  isBranchName,
  isIssueMarker,
  isRepositoryName,
  isSchemaAbsence,
  issueTextError,
  labelError,
  markersError,
  parseGhApiResponse,
  parseSessionBlock,
  parseSpecLink,
  retryAfterSeconds,
  splitRepositoryName,
  viewStepsByHand,
} from '../../src/index.js';
import * as Q from '../../src/space/github/queries.js';
import {
  type ScriptedCall,
  type ScriptedRunner,
  createScriptedRunner,
} from '../../src/space/testing/index.js';
import * as S from './github-samples.js';

/** The NUL character, written by its code so that this file holds none. */
const NUL = String.fromCharCode(0);

const REPOSITORY = 'octo-human/my-space';
const PROJECT: ProjectInfo = { ...S.PROJECT_NODE, owner: 'octo-human' };
const ISSUE: IssueRef = {
  repository: REPOSITORY,
  number: 12,
  url: `https://github.com/${REPOSITORY}/issues/12`,
};
const STAGE: FieldInfo = {
  id: 'PVTSSF_stage',
  name: 'Stage',
  options: [
    { id: 'opt-spec', name: 'Spec' },
    { id: 'opt-plan', name: 'Plan' },
  ],
};

/** Queue one GraphQL answer. `code: 1` is how `gh` exits when the answer has errors. */
function gql(
  runner: ScriptedRunner,
  body: unknown,
  options: {
    code?: number;
    status?: string;
    headers?: Record<string, string>;
    stderr?: string;
  } = {},
): void {
  runner.on({
    bin: 'gh',
    args: GRAPHQL_ARGS,
    times: 1,
    reply: {
      code: options.code ?? 0,
      stdout: S.apiResponse(body, options),
      stderr: options.stderr ?? '',
    },
  });
}

/** The GraphQL request a call carried on standard input. */
function request(call: ScriptedCall | undefined): {
  query: string;
  variables: Record<string, unknown>;
} {
  assert.ok(call !== undefined, 'the call exists');
  assert.deepEqual(call.args, GRAPHQL_ARGS);
  return JSON.parse(call.opts.input ?? '') as { query: string; variables: Record<string, unknown> };
}

function setup(): { runner: ScriptedRunner; port: GitHubPort } {
  const runner = createScriptedRunner();
  const port = createGhCliGitHub(runner, { now: () => new Date('2026-09-18T12:00:00Z') });
  return { runner, port };
}

/** The error of a result that must have failed. */
function errorOf<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): unknown {
  assert.equal(result.ok, false);
  return result.ok ? null : result.error;
}

// ---------- auth ----------

test('auth asks gh for the active account of the host and reads its scopes', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', reply: { stdout: JSON.stringify(S.AUTH_SIGNED_IN) } });
  const result = await port.auth();
  assert.deepEqual(runner.calls[0]?.args, [
    'auth',
    'status',
    '--active',
    '--hostname',
    'github.com',
    '--json',
    'hosts',
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: { account: 'octo-human', scopes: ['gist', 'project', 'read:org', 'repo', 'workflow'] },
  });
});

test('auth answers not-signed-in when gh knows no account or the token is not accepted', async () => {
  const expired = structuredClone(S.AUTH_SIGNED_IN);
  const entry = expired.hosts['github.com'][0];
  if (entry !== undefined) entry.state = 'error';
  for (const hosts of [S.AUTH_SIGNED_OUT, expired]) {
    const { runner, port } = setup();
    runner.on({ bin: 'gh', reply: { stdout: JSON.stringify(hosts) } });
    assert.deepEqual(errorOf(await port.auth()), gitHubNotSignedIn());
  }
});

// ---------- repositories ----------

test('findRepository sends the names as variables on standard input and parses the repository', async () => {
  const { runner, port } = setup();
  gql(runner, S.REPOSITORY_BODY);
  const result = await port.findRepository(REPOSITORY);
  assert.deepEqual(request(runner.calls[0]), {
    query: Q.REPOSITORY_QUERY,
    variables: { owner: 'octo-human', name: 'my-space' },
  });
  assert.equal(runner.calls[0]?.opts.timeoutMs, 60_000);
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: 'R_kgDOAAAAAA',
      fullName: REPOSITORY,
      url: `https://github.com/${REPOSITORY}`,
      cloneUrl: `https://github.com/${REPOSITORY}.git`,
      private: true,
    },
  });
});

test('findRepository answers null for a repository that does not exist', async () => {
  const { runner, port } = setup();
  gql(runner, S.REPOSITORY_NOT_FOUND_BODY, { code: 1 });
  assert.deepEqual(await port.findRepository('octo-human/no-such-space'), {
    ok: true,
    value: null,
  });
});

test('a name that is not owner/name fails before gh is started', async () => {
  const { runner, port } = setup();
  for (const name of ['my-space', '-x/y', 'a/b/c', 'a/b c', '']) {
    const error = errorOf(await port.findRepository(name)) as { kind: string };
    assert.equal(error.kind, 'failed', name);
  }
  assert.equal(runner.calls.length, 0);
});

test('createRepository looks the owner up, then creates with its id', async () => {
  const { runner, port } = setup();
  gql(runner, S.OWNER_BODY);
  gql(runner, S.CREATE_REPOSITORY_BODY);
  const result = await port.createRepository({
    owner: 'octo-human',
    name: 'my-space',
    private: true,
  });
  assert.deepEqual(request(runner.calls[0]).variables, { login: 'octo-human' });
  assert.deepEqual(request(runner.calls[1]), {
    query: Q.CREATE_REPOSITORY_MUTATION,
    variables: { input: { ownerId: 'U_kgDOAAAAAA', name: 'my-space', visibility: 'PRIVATE' } },
  });
  assert.equal(result.ok && result.value.fullName, REPOSITORY);
});

test('createRepository answers not-found for an account that does not exist', async () => {
  const { runner, port } = setup();
  gql(runner, { data: { repositoryOwner: null } });
  const error = errorOf(await port.createRepository({ owner: 'ghost', name: 'x', private: false }));
  assert.deepEqual(error, gitHubNotFound('the account ghost'));
  assert.equal(runner.calls.length, 1);
});

// ---------- the Project ----------

test('findProject gives the open Project with exactly the title, reading page after page', async () => {
  const { runner, port } = setup();
  const firstPage = structuredClone(S.OWNER_PROJECTS_BODY);
  firstPage.data.repositoryOwner.projectsV2.nodes.pop();
  firstPage.data.repositoryOwner.projectsV2.pageInfo = { hasNextPage: true, endCursor: 'Mg' };
  gql(runner, firstPage);
  gql(runner, S.OWNER_PROJECTS_BODY);
  const result = await port.findProject({ owner: 'octo-human', title: 'My Space' });
  assert.deepEqual(result, { ok: true, value: PROJECT });
  assert.deepEqual(request(runner.calls[0]).variables, { login: 'octo-human', after: null });
  assert.deepEqual(request(runner.calls[1]).variables, { login: 'octo-human', after: 'Mg' });
});

test('findProject answers null when no open Project has the title', async () => {
  const { runner, port } = setup();
  gql(runner, S.OWNER_PROJECTS_BODY);
  assert.deepEqual(await port.findProject({ owner: 'octo-human', title: 'my space' }), {
    ok: true,
    value: null,
  });
});

test('createProject creates under the owner id', async () => {
  const { runner, port } = setup();
  gql(runner, S.OWNER_BODY);
  gql(runner, S.CREATE_PROJECT_BODY);
  const result = await port.createProject({ owner: 'octo-human', title: 'My Space' });
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: { ownerId: 'U_kgDOAAAAAA', title: 'My Space' },
  });
  assert.deepEqual(result, { ok: true, value: PROJECT });
});

test('ensureSingleSelectField creates a field that GitHub reports as NOT_FOUND with exit 1', async () => {
  const { runner, port } = setup();
  gql(runner, S.FIELD_MISSING_BODY, { code: 1 });
  gql(runner, { data: { createProjectV2Field: { projectV2Field: S.STAGE_FIELD_NODE } } });
  const result = await port.ensureSingleSelectField({
    project: PROJECT,
    name: 'Stage',
    options: ['Spec', 'Plan'],
  });
  assert.deepEqual(request(runner.calls[0]).variables, { project: PROJECT.id, name: 'Stage' });
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: {
      projectId: PROJECT.id,
      dataType: 'SINGLE_SELECT',
      name: 'Stage',
      singleSelectOptions: [
        { name: 'Spec', color: 'GRAY', description: '' },
        { name: 'Plan', color: 'GRAY', description: '' },
      ],
    },
  });
  assert.deepEqual(result, { ok: true, value: STAGE });
});

test('ensureSingleSelectField leaves a complete field alone and adds what is missing after what exists', async () => {
  const { runner, port } = setup();
  gql(runner, S.FIELD_BODY);
  const complete = await port.ensureSingleSelectField({
    project: PROJECT,
    name: 'Stage',
    options: ['Plan'],
  });
  assert.deepEqual(complete, { ok: true, value: STAGE });
  assert.equal(runner.calls.length, 1);

  gql(runner, S.FIELD_BODY);
  const grown = {
    ...S.STAGE_FIELD_NODE,
    options: [
      ...S.STAGE_FIELD_NODE.options,
      { id: 'opt-build', name: 'Build', color: 'GRAY', description: '' },
    ],
  };
  gql(runner, { data: { updateProjectV2Field: { projectV2Field: grown } } });
  const result = await port.ensureSingleSelectField({
    project: PROJECT,
    name: 'Stage',
    options: ['Spec', 'Plan', 'Build'],
  });
  assert.deepEqual(request(runner.calls[2]).variables, {
    input: {
      fieldId: 'PVTSSF_stage',
      singleSelectOptions: [
        ...S.STAGE_FIELD_NODE.options,
        { name: 'Build', color: 'GRAY', description: '' },
      ],
    },
  });
  assert.deepEqual(result.ok && result.value.options.map((option) => option.name), [
    'Spec',
    'Plan',
    'Build',
  ]);
});

test('ensureSingleSelectField fails when the name belongs to a field of another type', async () => {
  const { runner, port } = setup();
  gql(runner, S.FIELD_NOT_SINGLE_SELECT_BODY);
  const error = errorOf(
    await port.ensureSingleSelectField({ project: PROJECT, name: 'Title', options: ['a'] }),
  );
  assert.deepEqual(error, gitHubFailed("The Project's field Title is not a single-select field"));
});

test('ensureProjectView creates a missing view, sets its filter, and says what is left by hand', async () => {
  const { runner, port } = setup();
  gql(runner, S.VIEWS_BODY);
  gql(runner, { data: { createProjectV2View: { projectV2View: S.CREATED_VIEW_NODE } } });
  gql(runner, {
    data: {
      updateProjectV2View: { projectV2View: { ...S.CREATED_VIEW_NODE, filter: 'label:session' } },
    },
  });
  const spec = {
    name: 'Agents',
    layout: 'board',
    filter: 'label:session',
    columnField: 'Agents',
  } as const;
  const result = await port.ensureProjectView({ project: PROJECT, spec });
  assert.deepEqual(request(runner.calls[1]), {
    query: Q.CREATE_VIEW_MUTATION,
    variables: { input: { projectId: PROJECT.id, name: 'Agents', layout: 'BOARD_LAYOUT' } },
  });
  assert.deepEqual(request(runner.calls[2]).variables, {
    input: { viewId: 'PVTV_2', filter: 'label:session' },
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value.view, {
    id: 'PVTV_2',
    number: 2,
    name: 'Agents',
    layout: 'board',
    filter: 'label:session',
  });
  assert.equal(result.value.created, true);
  assert.equal(result.value.byHand.length, 1);
  assert.match(result.value.byHand[0] ?? '', /"Column by" to the field "Agents"/);
});

test('ensureProjectView changes nothing when the view exists with its filter', async () => {
  const { runner, port } = setup();
  gql(runner, S.VIEWS_BODY);
  const result = await port.ensureProjectView({
    project: PROJECT,
    spec: { name: 'View 1', layout: 'table', filter: '' },
  });
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(result.ok && [result.value.created, result.value.byHand], [false, []]);
});

test('linkProjectToRepository links once, and not again when the link exists', async () => {
  const { runner, port } = setup();
  gql(runner, S.LINK_QUERY_BODY);
  gql(runner, { data: { linkProjectV2ToRepository: { repository: { id: 'R_kgDOAAAAAA' } } } });
  assert.deepEqual(
    await port.linkProjectToRepository({ project: PROJECT, repository: REPOSITORY }),
    {
      ok: true,
      value: undefined,
    },
  );
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: { projectId: PROJECT.id, repositoryId: 'R_kgDOAAAAAA' },
  });

  const linked = structuredClone(S.LINK_QUERY_BODY);
  linked.data.node.repositories.nodes.push({ id: 'R_kgDOAAAAAA' });
  gql(runner, linked);
  const again = await port.linkProjectToRepository({ project: PROJECT, repository: REPOSITORY });
  assert.equal(again.ok, true);
  assert.equal(runner.calls.length, 3);
});

test('ensureLabels runs one forced label create per label, the name after --', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', args: ['label', 'create'] });
  const result = await port.ensureLabels({
    repository: REPOSITORY,
    labels: [
      { name: 'session', color: '#0e8a16', description: 'A session issue' },
      { name: '--web', color: 'ededed', description: '' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      [
        'label',
        'create',
        '--repo',
        REPOSITORY,
        '--color',
        '0e8a16',
        '--description=A session issue',
        '--force',
        '--',
        'session',
      ],
      [
        'label',
        'create',
        '--repo',
        REPOSITORY,
        '--color',
        'ededed',
        '--description=',
        '--force',
        '--',
        '--web',
      ],
    ],
  );
});

test('ensureLabels refuses a colour that is not six hexadecimal digits', async () => {
  const { runner, port } = setup();
  const error = errorOf(
    await port.ensureLabels({
      repository: REPOSITORY,
      labels: [{ name: 'x', color: 'red', description: '' }],
    }),
  ) as { kind: string };
  assert.equal(error.kind, 'failed');
  assert.equal(runner.calls.length, 0);
});

// ---------- issues ----------

test('findIssuesByMarkers reads the issues oldest first, keeps the oldest match, and stops when all are found', async () => {
  const { runner, port } = setup();
  const a = formatIssueMarker('migrated', 'status/a.md');
  const b = formatIssueMarker('migrated', 'status/b.md');
  gql(runner, S.issueBodiesPage([{ number: 1, body: `From v0.8.\n\n${a}\n` }], 'c1'));
  gql(
    runner,
    S.issueBodiesPage(
      [
        { number: 2, body: `${a}\nagain` },
        { number: 3, body: b },
      ],
      'c2',
    ),
  );
  const result = await port.findIssuesByMarkers({ repository: REPOSITORY, markers: [a, b] });
  assert.ok(result.ok);
  assert.equal(result.value[a]?.number, 1);
  assert.equal(result.value[b]?.number, 3);
  assert.equal(runner.calls.length, 2, 'the third page is not read');
  assert.deepEqual(request(runner.calls[1]).variables, {
    owner: 'octo-human',
    name: 'my-space',
    after: 'c1',
  });
});

test('findIssueByMarker answers null when no body has the marker', async () => {
  const { runner, port } = setup();
  gql(runner, S.issueBodiesPage([{ number: 1, body: 'nothing' }], null));
  assert.deepEqual(
    await port.findIssueByMarker({
      repository: REPOSITORY,
      marker: formatIssueMarker('migrated', 'z'),
    }),
    {
      ok: true,
      value: null,
    },
  );
});

test('findIssueByMarker reads past 1,000 issues, closed ones too, and asks for both states oldest first', async () => {
  const { runner, port } = setup();
  const marker = formatIssueMarker('migrated', 'status/late.md');
  // Twelve pages of 100 issues; the marker is on the last issue of the last page.
  for (let page = 0; page < 12; page += 1) {
    const bodies = Array.from({ length: 100 }, (_, index) => ({
      number: page * 100 + index + 1,
      body: page === 11 && index === 99 ? marker : `issue ${page * 100 + index + 1}`,
    }));
    gql(runner, S.issueBodiesPage(bodies, page === 11 ? null : `cursor-${page}`));
  }
  const found = await port.findIssueByMarker({ repository: REPOSITORY, marker });
  assert.ok(found.ok);
  assert.equal(found.value?.number, 1200);
  assert.equal(runner.calls.length, 12);
  assert.equal(request(runner.calls[11]).variables.after, 'cursor-10');
  assert.match(Q.ISSUE_BODIES_QUERY, /states: \[OPEN, CLOSED\]/);
  assert.match(Q.ISSUE_BODIES_QUERY, /orderBy: \{ field: CREATED_AT, direction: ASC \}/);
});

test('a marker is a whole line outside a code block: a longer marker, a quotation and a code block do not match', async () => {
  const { runner, port } = setup();
  const marker = formatIssueMarker('migrated', 'status/a.md');
  const longer = formatIssueMarker('migrated', 'status/a.md.bak');
  const bodies = [
    { number: 1, body: longer },
    { number: 2, body: `The migration wrote \`${marker}\` into the body.` },
    { number: 3, body: `> ${marker}` },
    { number: 4, body: `Example:\n\n\`\`\`html\n${marker}\n\`\`\`\n` },
    { number: 5, body: `Example:\n\n~~~~\n${marker}\n~~~\nstill inside\n${marker}\n~~~~\n` },
    { number: 6, body: `    ${marker}` },
    { number: 7, body: `Text.\r\n\r\n${marker}  \r\nMore text.` },
  ];
  gql(runner, S.issueBodiesPage(bodies, null));
  const found = await port.findIssueByMarker({ repository: REPOSITORY, marker });
  assert.ok(found.ok);
  assert.equal(found.value?.number, 7);
});

test('text that formatIssueMarker could not have made is refused before gh is started', async () => {
  const { runner, port } = setup();
  for (const marker of ['', ' ', 'status/a.md', '<!-- m: a -->', '<!-- ai-lore-x: a b -->']) {
    const error = errorOf(await port.findIssueByMarker({ repository: REPOSITORY, marker })) as {
      kind: string;
      message: string;
    };
    assert.equal(error.kind, 'failed', marker);
    assert.match(error.message, /is not an issue marker/);
  }
  assert.equal(runner.calls.length, 0);
});

test('formatIssueMarker encodes the key so that the marker stays one hidden comment', () => {
  assert.equal(
    formatIssueMarker('migrated', 'status/a.md'),
    '<!-- ai-lore-migrated: status/a.md -->',
  );
  const odd = formatIssueMarker('migrated', 'a b/--> <!-- c---d\n`$(x)`');
  assert.equal(isIssueMarker(odd), true);
  assert.doesNotMatch(odd.slice(5, -4), /--|>|<|`|\$/);
  assert.equal(odd.slice(5, -4).split(/\s/).length, 2, 'the only space is the one after the name');
  assert.equal(odd.split('\n').length, 1);
  assert.notEqual(formatIssueMarker('migrated', 'a b'), formatIssueMarker('migrated', 'a%20b'));
  assert.equal(isIssueMarker(formatIssueMarker('session', 'S-1')), true);
  assert.equal(isIssueMarker('<!-- ai-lore-migrated: a--b -->'), false);
  assert.throws(() => formatIssueMarker('Migrated', 'a'), TypeError);
  assert.throws(() => formatIssueMarker('migrated', ''), TypeError);
  assert.equal(bodyHasMarker(`x\n${odd}\ny`, odd), true);
  assert.equal(bodyHasMarker(`x ${odd}`, odd), false);
});

test('createIssue resolves the labels, then creates; title and body never reach the command line', async () => {
  const { runner, port } = setup();
  const found = structuredClone(S.LABELS_BODY);
  found.data.repository.l1 = { id: 'LA_feature' } as never;
  gql(runner, found);
  gql(runner, S.CREATE_ISSUE_BODY);
  const body = 'Line one\n--repo other/repo\n<!-- ai-lore-migrated: status/x.md -->';
  const result = await port.createIssue({
    repository: REPOSITORY,
    title: '--title injected',
    body,
    labels: ['focus', 'feature'],
  });
  assert.deepEqual(request(runner.calls[0]), {
    query: Q.repositoryAndLabelsQuery(2),
    variables: { owner: 'octo-human', name: 'my-space', l0: 'focus', l1: 'feature' },
  });
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: {
      repositoryId: 'R_kgDOAAAAAA',
      title: '--title injected',
      body,
      labelIds: ['LA_focus', 'LA_feature'],
    },
  });
  for (const call of runner.calls) assert.deepEqual(call.args, GRAPHQL_ARGS);
  assert.deepEqual(result, { ok: true, value: ISSUE });
});

test('createIssue answers not-found for a label the repository lacks, and creates nothing', async () => {
  const { runner, port } = setup();
  gql(runner, S.LABELS_BODY);
  const error = errorOf(
    await port.createIssue({
      repository: REPOSITORY,
      title: 't',
      body: '',
      labels: ['focus', 'nope'],
    }),
  );
  assert.deepEqual(error, gitHubNotFound(`the label nope in ${REPOSITORY}`));
  assert.equal(runner.calls.length, 1);
});

test('updateIssue, comment and addIssueToProject resolve the issue id first', async () => {
  const { runner, port } = setup();
  gql(runner, S.ISSUE_BODY);
  gql(runner, { data: { updateIssue: { issue: { id: 'I_kwDOAAAAAA' } } } });
  assert.equal((await port.updateIssue({ issue: ISSUE, body: 'new' })).ok, true);
  assert.deepEqual(request(runner.calls[0]).variables, {
    owner: 'octo-human',
    name: 'my-space',
    number: 12,
  });
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: { id: 'I_kwDOAAAAAA', body: 'new' },
  });

  gql(runner, S.ISSUE_BODY);
  gql(runner, { data: { addComment: { clientMutationId: null } } });
  assert.equal((await port.comment({ issue: ISSUE, body: 'Handover' })).ok, true);
  assert.deepEqual(request(runner.calls[3]).variables, {
    input: { subjectId: 'I_kwDOAAAAAA', body: 'Handover' },
  });

  gql(runner, S.ISSUE_BODY);
  gql(runner, { data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } });
  assert.deepEqual(await port.addIssueToProject({ project: PROJECT, issue: ISSUE }), {
    ok: true,
    value: 'PVTI_new',
  });
  assert.deepEqual(request(runner.calls[5]).variables, {
    input: { projectId: PROJECT.id, contentId: 'I_kwDOAAAAAA' },
  });
});

test('an issue that does not exist is not-found', async () => {
  const { runner, port } = setup();
  gql(runner, S.ISSUE_NOT_FOUND_BODY, { code: 1 });
  const error = errorOf(await port.comment({ issue: { ...ISSUE, number: 99 }, body: 'x' }));
  assert.deepEqual(error, gitHubNotFound(`the issue ${REPOSITORY}#99`));
});

test('closeIssue closes an open issue and leaves a closed one', async () => {
  const { runner, port } = setup();
  gql(runner, S.ISSUE_BODY);
  gql(runner, { data: { closeIssue: { issue: { id: 'I_kwDOAAAAAA' } } } });
  assert.equal((await port.closeIssue({ issue: ISSUE })).ok, true);
  assert.deepEqual(request(runner.calls[1]).variables, { input: { issueId: 'I_kwDOAAAAAA' } });

  const closed = structuredClone(S.ISSUE_BODY);
  closed.data.repository.issue.state = 'CLOSED';
  gql(runner, closed);
  assert.equal((await port.closeIssue({ issue: ISSUE })).ok, true);
  assert.equal(runner.calls.length, 3);
});

test('addSubIssue links once, accepts the link that exists, and refuses another parent', async () => {
  const pair = (parent: string | null): unknown => ({
    data: {
      parent: { issue: { id: 'I_parent' } },
      child: { issue: { id: 'I_child', parent: parent === null ? null : { id: parent } } },
    },
  });
  const parent: IssueRef = { ...ISSUE, number: 1 };
  const { runner, port } = setup();
  gql(runner, pair(null));
  gql(runner, { data: { addSubIssue: { subIssue: { id: 'I_child' } } } });
  assert.equal((await port.addSubIssue({ parent, child: ISSUE })).ok, true);
  assert.deepEqual(request(runner.calls[0]).variables, {
    parentOwner: 'octo-human',
    parentName: 'my-space',
    parentNumber: 1,
    childOwner: 'octo-human',
    childName: 'my-space',
    childNumber: 12,
  });
  assert.deepEqual(request(runner.calls[1]).variables, {
    input: { issueId: 'I_parent', subIssueId: 'I_child' },
  });

  gql(runner, pair('I_parent'));
  assert.equal((await port.addSubIssue({ parent, child: ISSUE })).ok, true);
  gql(runner, pair('I_someone_else'));
  const error = errorOf(await port.addSubIssue({ parent, child: ISSUE })) as { kind: string };
  assert.equal(error.kind, 'failed');
  assert.equal(runner.calls.length, 4, 'no mutation after the first');
});

test('setSingleSelect sends the option id, and an unknown option is not-found without a call', async () => {
  const { runner, port } = setup();
  gql(runner, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } } });
  const arg = { project: PROJECT, item: 'PVTI_1', field: STAGE };
  assert.equal((await port.setSingleSelect({ ...arg, option: 'Plan' })).ok, true);
  assert.deepEqual(request(runner.calls[0]).variables, {
    input: {
      projectId: PROJECT.id,
      itemId: 'PVTI_1',
      fieldId: 'PVTSSF_stage',
      value: { singleSelectOptionId: 'opt-plan' },
    },
  });
  const error = errorOf(await port.setSingleSelect({ ...arg, option: 'Shipping' }));
  assert.deepEqual(error, gitHubNotFound('the option Shipping of the field Stage'));
  assert.equal(runner.calls.length, 1);
});

test('developBranch lists the linked branches, then creates with --branch-repo', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', args: ['issue', 'develop', '--list'], reply: { stdout: '' }, times: 1 });
  runner.on({
    bin: 'gh',
    args: ['issue', 'develop', '--repo'],
    reply: { stdout: 'github.com/octo-human/app/tree/12-fix-the-thing\n' },
  });
  const arg = { issue: ISSUE, branchRepository: 'octo-human/app', name: '12-fix-the-thing' };
  assert.deepEqual(await port.developBranch(arg), {
    ok: true,
    value: { branch: '12-fix-the-thing' },
  });
  assert.deepEqual(
    runner.calls.map((call) => call.args),
    [
      ['issue', 'develop', '--list', '--repo', REPOSITORY, '12'],
      [
        'issue',
        'develop',
        '--repo',
        REPOSITORY,
        '--branch-repo',
        'octo-human/app',
        '--name',
        '12-fix-the-thing',
        '12',
      ],
    ],
  );
});

test('developBranch gives the branch that exists and refuses a name that reads as an option', async () => {
  const { runner, port } = setup();
  runner.on({
    bin: 'gh',
    args: ['issue', 'develop', '--list'],
    reply: {
      stdout:
        'other\thttps://github.com/octo-human/app/tree/other\n12-fix\thttps://github.com/octo-human/app/tree/12-fix\n',
    },
  });
  const arg = { issue: ISSUE, branchRepository: 'octo-human/app', name: '12-fix' };
  assert.deepEqual(await port.developBranch(arg), { ok: true, value: { branch: '12-fix' } });
  assert.equal(runner.calls.length, 1);
  const error = errorOf(await port.developBranch({ ...arg, name: '--checkout' })) as {
    kind: string;
  };
  assert.equal(error.kind, 'failed');
  assert.equal(runner.calls.length, 1);
});

// ---------- reads ----------

test('readProject reads every page and sorts the issues into the snapshot', async () => {
  const { runner, port } = setup();
  const targets = [{ kind: 'repository', name: 'app', branch: '12-fix' }] as const;
  const block = formatSessionBlock({
    targets: [...targets],
    attended: true,
    person: 'octo-human',
    machine: 'desk-1',
  });
  gql(runner, S.READ_PROJECT_PAGE_1);
  gql(runner, S.readProjectPage2(`Session\n${block}`));
  const result = await port.readProject({ project: PROJECT });
  assert.deepEqual(request(runner.calls[0]).variables, {
    project: PROJECT.id,
    stage: 'Stage',
    after: null,
  });
  assert.deepEqual(request(runner.calls[1]).variables, {
    project: PROJECT.id,
    stage: 'Stage',
    after: 'cursor-1',
  });
  assert.ok(result.ok);
  const snapshot = result.value;
  assert.equal(snapshot.fetchedAt, '2026-09-18T12:00:00.000Z');
  assert.deepEqual(snapshot.project, {
    owner: 'octo-human',
    number: 3,
    title: 'My Space',
    url: PROJECT.url,
  });
  assert.deepEqual(snapshot.stageField, { id: 'PVTSSF_stage', options: STAGE.options });
  assert.equal(snapshot.focuses.length, 1);
  const focus = snapshot.focuses[0];
  assert.deepEqual(
    [focus?.title, focus?.stage, focus?.kind, focus?.status, focus?.specUrl],
    ['A focus', 'Plan', 'feature', 'Todo', 'https://example.test/spec.md'],
  );
  assert.deepEqual(
    focus?.items.map((item) => [item.issue.number, item.state, item.status, item.labels]),
    [
      [2, 'closed', 'Done', ['bug']],
      [3, 'open', null, []],
    ],
  );
  assert.deepEqual(
    snapshot.standalone.map((item) => [item.issue.number, item.labels]),
    [[4, ['paused']]],
  );
  assert.deepEqual(snapshot.sessions, [
    {
      issue: {
        repository: REPOSITORY,
        number: 5,
        url: `https://github.com/${REPOSITORY}/issues/5`,
      },
      title: 'Issue 5',
      column: 'Writing',
      targets: [...targets],
      attended: true,
      person: 'octo-human',
      machine: 'desk-1',
      updatedAt: '2026-09-18T11:30:00Z',
    },
  ]);
});

test('readProject reads a Project with no Stage field when GitHub reports NOT_FOUND with exit 1', async () => {
  const { runner, port } = setup();
  gql(
    runner,
    {
      data: {
        node: {
          stage: null,
          items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
        },
      },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['node', 'stage'],
          message: 'Could not resolve to a ProjectV2Field with the name Stage.',
        },
      ],
    },
    { code: 1 },
  );
  const result = await port.readProject({ project: PROJECT });
  assert.ok(result.ok);
  assert.deepEqual(result.value.stageField, { id: '', options: [] });
  assert.deepEqual(
    [result.value.focuses, result.value.standalone, result.value.sessions],
    [[], [], []],
  );
});

test('an answer with a NOT_FOUND error and another error kind is a failure', async () => {
  const { runner, port } = setup();
  gql(
    runner,
    {
      data: { repository: null },
      errors: [
        { type: 'NOT_FOUND', path: ['repository'], message: 'Could not resolve to a Repository.' },
        { type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' },
      ],
    },
    { code: 1 },
  );
  const result = await port.findRepository('octo-human/my-space');
  assert.equal(result.ok, false);
});

test('branchHeads builds its arguments and reads the commits, null for a missing repository', async () => {
  const { runner, port } = setup();
  gql(runner, S.BRANCH_HEADS_BODY);
  const result = await port.branchHeads('octo-human/my-space');
  assert.deepEqual(request(runner.calls[0]).variables, { owner: 'octo-human', name: 'my-space' });
  assert.deepEqual(result, {
    ok: true,
    value: ['9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b'],
  });

  gql(runner, S.BRANCH_HEADS_EMPTY_BODY);
  assert.deepEqual(await port.branchHeads('octo-human/my-space'), { ok: true, value: [] });

  gql(runner, { data: { repository: null } });
  assert.deepEqual(await port.branchHeads('octo-human/no-such-repo'), { ok: true, value: null });
});

test('listSpaceRepositories keeps only the nodes with a manifest', async () => {
  const { runner, port } = setup();
  gql(runner, S.OWNER_SPACE_REPOSITORIES_BODY);
  const result = await port.listSpaceRepositories('octo-human');
  assert.deepEqual(request(runner.calls[0]).variables, { login: 'octo-human' });
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.map((repository) => repository.fullName),
    ['octo-human/my-space'],
  );

  gql(runner, { data: { repositoryOwner: null } });
  const error = errorOf(await port.listSpaceRepositories('no-such-owner'));
  assert.deepEqual(error, gitHubNotFound('the account no-such-owner'));
});

test('graphqlOperationName names the query constant of queries.ts, or null', () => {
  const sent = JSON.stringify({ query: Q.REPOSITORY_QUERY, variables: { owner: 'a', name: 'b' } });
  assert.equal(graphqlOperationName(sent), 'REPOSITORY_QUERY');
  assert.equal(graphqlOperationName(JSON.stringify({ query: 'query { viewer { id } }' })), null);
  assert.equal(graphqlOperationName('not json'), null);
});

test('mergedPullRequests asks gh pr list for merged ones and orders them newest merge first', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', reply: { stdout: JSON.stringify(S.MERGED_PULL_REQUESTS) } });
  const result = await port.mergedPullRequests({ repository: 'octo-human/app', limit: 30 });
  assert.deepEqual(runner.calls[0]?.args, [
    'pr',
    'list',
    '--repo',
    'octo-human/app',
    '--state',
    'merged',
    '--limit',
    '30',
    '--json',
    'number,title,url,mergedAt,mergeCommit,headRefName,baseRefName',
  ]);
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.map((pull) => pull.number),
    [40, 41],
  );
  assert.deepEqual(result.value[0], {
    number: 40,
    title: 'Revert a change',
    url: 'https://github.com/octo-human/app/pull/40',
    mergedAt: '2026-09-15T14:11:21Z',
    mergeCommit: '0cf1092493af067646fc5f3db9421c6a6ec9c938',
    headBranch: 'newer-merge',
    baseBranch: 'main',
  });
});

// ---------- failures, through the adapter ----------

test('a token without the project scope is missing-scope, named as gh auth refresh takes it', async () => {
  const { runner, port } = setup();
  gql(runner, S.MISSING_SCOPE_BODY, { code: 1, stderr: S.MISSING_SCOPE_STDERR });
  const error = errorOf(await port.findProject({ owner: 'octo-human', title: 'My Space' }));
  assert.deepEqual(error, {
    kind: 'missing-scope',
    scope: 'project',
    message: 'The gh token lacks the project scope. Run: gh auth refresh -s project',
  });
});

test('the primary rate limit gives the seconds until the reset', async () => {
  const { runner, port } = setup();
  gql(runner, S.RATE_LIMITED_BODY, {
    code: 1,
    headers: {
      Date: 'Fri, 18 Sep 2026 15:00:00 GMT',
      'X-Ratelimit-Remaining': '0',
      'X-Ratelimit-Reset': String(Date.parse('2026-09-18T15:10:00Z') / 1000),
    },
  });
  assert.deepEqual(errorOf(await port.readProject({ project: PROJECT })), {
    kind: 'rate-limited',
    retryAfterSeconds: 600,
    message: 'GitHub limited the rate of requests. Try again in 600 seconds.',
  });
});

test('a secondary limit and content created too quickly are rate-limited', async () => {
  const { runner, port } = setup();
  gql(runner, S.SECONDARY_LIMIT_BODY, {
    code: 1,
    status: '403 Forbidden',
    headers: { 'Retry-After': '60' },
    stderr: 'gh: You have exceeded a secondary rate limit. (HTTP 403)\n',
  });
  assert.deepEqual(errorOf(await port.findRepository(REPOSITORY)), gitHubRateLimited(60));

  gql(runner, S.LABELS_BODY);
  gql(runner, S.SUBMITTED_TOO_QUICKLY_BODY, { code: 1, stderr: 'gh: was submitted too quickly\n' });
  const error = errorOf(
    await port.createIssue({ repository: REPOSITORY, title: 't', body: '', labels: [] }),
  );
  assert.deepEqual(error, gitHubRateLimited(null));
  assert.equal(
    gitHubRateLimited(null).message,
    'GitHub limited the rate of requests. Try again in a few minutes.',
  );
});

test('no network, a timeout and a gateway error are unreachable', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', times: 1, reply: { code: 1, stderr: S.UNREACHABLE_STDERR } });
  const offline = errorOf(await port.findRepository(REPOSITORY)) as {
    kind: string;
    message: string;
  };
  assert.equal(offline.kind, 'unreachable');
  assert.match(offline.message, /^GitHub could not be reached: .*connection refused/);

  runner.on({
    bin: 'gh',
    times: 1,
    reply: { code: -1, failure: 'timeout', stderr: 'gh was stopped' },
  });
  assert.deepEqual(
    errorOf(await port.findRepository(REPOSITORY)),
    gitHubUnreachable('gh did not finish in time'),
  );

  gql(runner, '<html>Bad Gateway</html>', {
    code: 1,
    status: '502 Bad Gateway',
    stderr: 'gh: HTTP 502\n',
  });
  assert.deepEqual(errorOf(await port.findRepository(REPOSITORY)), gitHubUnreachable('HTTP 502'));
});

test('gh without an account is not-signed-in, also for a command that is not GraphQL', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', reply: { code: 4, stderr: S.NOT_SIGNED_IN_STDERR } });
  assert.deepEqual(errorOf(await port.findRepository(REPOSITORY)), gitHubNotSignedIn());
  assert.deepEqual(
    errorOf(await port.mergedPullRequests({ repository: REPOSITORY, limit: 5 })),
    gitHubNotSignedIn(),
  );
});

test('a gh subcommand that reports a missing scope itself is missing-scope', async () => {
  const { runner, port } = setup();
  runner.on({ bin: 'gh', reply: { code: 1, stderr: S.GH_MISSING_SCOPE_STDERR } });
  const error = errorOf(
    await port.ensureLabels({
      repository: REPOSITORY,
      labels: [{ name: 'x', color: 'ededed', description: '' }],
    }),
  );
  assert.deepEqual(error, gitHubMissingScope('project'));
});

test('a missing gh, a refused run and any other error are failed, with what was said', async () => {
  const replies: [Partial<RunResult>, RegExp][] = [
    [
      { code: -1, failure: 'not-found', stderr: 'gh was not found' },
      /^gh was not found on this machine$/,
    ],
    [
      { code: -1, failure: 'refused', stderr: 'in test mode gh does not run' },
      /^gh did not run: in test mode/,
    ],
    [
      { code: 1, stderr: 'gh: Name already exists on this account\n' },
      /^Name already exists on this account$/,
    ],
    [{ code: 1, stderr: '' }, /^gh exited 1$/],
  ];
  for (const [reply, message] of replies) {
    const { runner, port } = setup();
    runner.on({ bin: 'gh', reply });
    const error = errorOf(await port.findRepository(REPOSITORY)) as {
      kind: string;
      message: string;
    };
    assert.equal(error.kind, 'failed');
    assert.match(error.message, message);
  }
});

test('an answer that is not JSON is failed', async () => {
  const { runner, port } = setup();
  gql(runner, 'not json');
  const error = errorOf(await port.findRepository(REPOSITORY)) as { kind: string };
  assert.equal(error.kind, 'failed');
  runner.on({ bin: 'gh', reply: { stdout: '{}' } });
  assert.equal(
    (
      errorOf(await port.mergedPullRequests({ repository: REPOSITORY, limit: 1 })) as {
        kind: string;
      }
    ).kind,
    'failed',
  );
});

// ---------- the pieces of the classifier ----------

test('parseGhApiResponse splits status, headers and body, and takes other output as body', () => {
  const parsed = parseGhApiResponse(
    S.apiResponse({ a: 1 }, { status: '403 Forbidden', headers: { 'Retry-After': '7' } }),
  );
  assert.equal(parsed.status, 403);
  assert.equal(parsed.headers['retry-after'], '7');
  assert.equal(parsed.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(parsed.body, '{"a":1}');
  assert.deepEqual(parseGhApiResponse('HTTP/2.0 204 No Content\nX-A: b\n'), {
    status: 204,
    headers: { 'x-a': 'b' },
    body: '',
  });
  assert.deepEqual(parseGhApiResponse('{"a":1}'), { status: null, headers: {}, body: '{"a":1}' });
});

test('graphQlErrors reads type, message and path, and gives none for other text', () => {
  assert.deepEqual(graphQlErrors(JSON.stringify(S.REPOSITORY_NOT_FOUND_BODY)), [
    {
      type: 'NOT_FOUND',
      code: null,
      message: "Could not resolve to a Repository with the name 'octo-human/no-such-space'.",
      path: ['repository'],
    },
  ]);
  assert.deepEqual(graphQlErrors('{"errors":[{"message":"x"},7]}'), [
    { type: null, code: null, message: 'x', path: [] },
  ]);
  assert.deepEqual(
    graphQlErrors('{"errors":[{"message":"y","extensions":{"code":"undefinedField"}}]}'),
    [{ type: null, code: 'undefinedField', message: 'y', path: [] }],
  );
  assert.deepEqual(graphQlErrors('<html>'), []);
  assert.deepEqual(graphQlErrors('{"data":{}}'), []);
});

test('retryAfterSeconds prefers Retry-After, then the reset when nothing is left', () => {
  assert.equal(retryAfterSeconds({ 'retry-after': '12' }), 12);
  const reset = String(Date.parse('2026-09-18T15:00:30Z') / 1000);
  const date = 'Fri, 18 Sep 2026 15:00:00 GMT';
  assert.equal(
    retryAfterSeconds({ date, 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
    30,
  );
  assert.equal(
    retryAfterSeconds({ date, 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': reset }),
    null,
  );
  assert.equal(retryAfterSeconds({}), null);
});

test('classifyGhFailure sorts a run without a parsed answer by what gh printed', () => {
  const run = (stderr: string): RunResult => ({ code: 1, stdout: '', stderr });
  assert.equal(classifyGhFailure(run('gh: Not Found (HTTP 404)')).kind, 'not-found');
  assert.equal(classifyGhFailure(run('gh: Bad credentials (HTTP 401)')).kind, 'not-signed-in');
  assert.equal(
    classifyGhFailure(run('dial tcp: lookup api.github.com: no such host')).kind,
    'unreachable',
  );
  assert.equal(classifyGhFailure(run('gh: API rate limit exceeded')).kind, 'rate-limited');
  assert.equal(
    classifyGhFailure(run('GraphQL: Could not resolve to a Repository')).kind,
    'not-found',
  );
});

test('every error says in a sentence what happened', () => {
  assert.equal(gitHubUnreachable('no route').message, 'GitHub could not be reached: no route');
  assert.equal(
    gitHubNotSignedIn().message,
    'gh is not signed in to github.com. Run: gh auth login',
  );
  assert.deepEqual(gitHubMissingScope(PROJECT_SCOPE), {
    kind: 'missing-scope',
    scope: 'project',
    message: 'The gh token lacks the project scope. Run: gh auth refresh -s project',
  });
  assert.equal(
    gitHubNotFound('the repository a/b').message,
    'GitHub has no such thing: the repository a/b',
  );
  assert.deepEqual(gitHubFailed('x'), { kind: 'failed', message: 'x' });
});

// ---------- the snapshot ----------

function raw(number: number, extra: Partial<RawProjectIssue> = {}): RawProjectIssue {
  return {
    issue: {
      repository: REPOSITORY,
      number,
      url: `https://github.com/${REPOSITORY}/issues/${number}`,
    },
    title: `Issue ${number}`,
    body: '',
    state: 'open',
    labels: [],
    updatedAt: '2026-09-18T10:00:00Z',
    parentNumber: null,
    fieldValues: {},
    fieldValuesAt: {},
    subIssues: [],
    ...extra,
  };
}

test('buildProjectSnapshot sorts focuses, items, standalone items and sessions', () => {
  const snapshot = buildProjectSnapshot({
    project: PROJECT,
    stageField: null,
    fetchedAt: '2026-09-18T12:00:00.000Z',
    issues: [
      raw(1, { fieldValues: { [LEVEL_FIELD]: FOCUS_LEVEL, [STAGE_FIELD]: 'Spec' } }),
      raw(2, { labels: ['document'], fieldValues: { [LEVEL_FIELD]: FOCUS_LEVEL } }),
      raw(3, {
        fieldValues: { [LEVEL_FIELD]: FOCUS_LEVEL },
        subIssues: [{ issue: raw(4).issue, title: 'Issue 4', state: 'open' }],
      }),
      raw(4, { parentNumber: 3, fieldValues: { [STATUS_FIELD]: 'Todo' } }),
      raw(5, { parentNumber: 77, fieldValues: { [LEVEL_FIELD]: 'Item' } }),
      raw(6, { labels: [PAUSED_LABEL], fieldValues: { [LEVEL_FIELD]: 'Item' } }),
      raw(7, { labels: [SESSION_LABEL], state: 'closed' }),
      raw(8, {
        labels: [SESSION_LABEL],
        fieldValues: { [AGENTS_FIELD]: 'Blocked' },
        body: 'no block',
      }),
    ],
  });
  assert.deepEqual(snapshot.stageField, { id: '', options: [] });
  assert.deepEqual(
    snapshot.focuses.map((focus) => [focus.issue.number, focus.stage, focus.kind]),
    [
      [1, 'Spec', null],
      [2, null, 'document'],
      [3, null, null],
    ],
  );
  assert.deepEqual(
    snapshot.focuses[2]?.items.map((item) => [item.issue.number, item.status]),
    [[4, 'Todo']],
  );
  assert.deepEqual(
    snapshot.standalone.map((item) => item.issue.number),
    [5, 6],
    'an issue whose parent is not on the Project stands alone',
  );
  assert.deepEqual(
    snapshot.sessions.map((session) => [
      session.issue.number,
      session.column,
      session.targets,
      session.attended,
    ]),
    [
      [7, 'Done', [], true],
      [8, 'Blocked', [], true],
    ],
  );
  assert.deepEqual(snapshot.problems, [], 'every issue has a Level, so nothing is reported');
});

test('the Level field alone decides a focus: not the Stage, the kind or the sub-issues', () => {
  const snapshot = buildProjectSnapshot({
    project: PROJECT,
    stageField: null,
    fetchedAt: '2026-09-18T12:00:00.000Z',
    issues: [
      // No Stage, no kind label, no sub-issues: the three signals the category
      // used to be derived from. It is a focus because the Project says so.
      raw(1, { fieldValues: { [LEVEL_FIELD]: FOCUS_LEVEL } }),
      // A kind label, which used to make an issue a focus by itself. `bug` was
      // read correctly only because it was missing from the list that decided
      // both questions; now the list decides neither.
      raw(2, { labels: ['bug'], fieldValues: { [LEVEL_FIELD]: 'Item' } }),
      // A Stage and sub-issues, and still an item, because the Project says so.
      raw(3, {
        fieldValues: { [LEVEL_FIELD]: 'Item', [STAGE_FIELD]: 'Build' },
        subIssues: [{ issue: raw(9).issue, title: 'Issue 9', state: 'open' }],
      }),
    ],
  });
  assert.deepEqual(
    snapshot.focuses.map((focus) => focus.issue.number),
    [1],
  );
  assert.deepEqual(
    snapshot.standalone.map((item) => item.issue.number),
    [2, 3],
  );
  assert.equal(snapshot.problems.length, 0);
});

test('an issue with no Level is read as an item and reported', () => {
  const snapshot = buildProjectSnapshot({
    project: PROJECT,
    stageField: null,
    fetchedAt: '2026-09-18T12:00:00.000Z',
    issues: [raw(1, { labels: ['feature'], fieldValues: { [STAGE_FIELD]: 'Build' } })],
  });
  assert.deepEqual(snapshot.focuses, [], 'nothing is guessed from the Stage or the kind');
  assert.deepEqual(
    snapshot.standalone.map((item) => item.issue.number),
    [1],
  );
  assert.equal(snapshot.problems.length, 1);
  assert.ok(
    snapshot.problems[0]?.includes(`${REPOSITORY}#1`),
    'the report names the issue it is about',
  );
  assert.ok(snapshot.problems[0]?.includes(LEVEL_FIELD), 'and the field that is missing');
});

test('the session block survives a round trip, also with --> in a name, and bad blocks give null', () => {
  const block = {
    targets: [
      { kind: 'lore' as const },
      { kind: 'publish-area' as const, name: 'specs' },
      { kind: 'repository' as const, name: 'app', branch: 'a-->b' },
    ],
    attended: false,
    person: 'octo-human',
    machine: 'desk --> 1',
  };
  const text = formatSessionBlock(block);
  assert.equal(text.indexOf('-->'), text.length - 3, 'the comment closes only at its end');
  assert.deepEqual(parseSessionBlock(`Before\n${text}\nAfter`), block);
  assert.equal(parseSessionBlock('no block here'), null);
  assert.equal(parseSessionBlock('<!-- ai-lore-session: {not json -->'), null);
  assert.deepEqual(
    parseSessionBlock('<!-- ai-lore-session: {"targets":[{"kind":"x"},{"kind":"lore"}]} -->'),
    {
      targets: [{ kind: 'lore' }],
      attended: true,
      person: '',
      machine: '',
    },
  );
});

test('the spec link is written and read back', () => {
  const line = formatSpecLink('https://example.test/specs/my spec.md');
  assert.equal(line, '<!-- ai-lore-spec: https://example.test/specs/my%20spec.md -->');
  assert.equal(parseSpecLink(`Body\n${line}`), 'https://example.test/specs/my%20spec.md');
  assert.equal(parseSpecLink('Body'), null);
});

test('the default layout names five stages, four Agents columns and five kinds', () => {
  assert.deepEqual(DEFAULT_STAGES, ['Spec', 'Plan', 'Build', 'Review', 'Done']);
  assert.deepEqual(AGENTS_COLUMNS, ['Read only', 'Writing', 'Blocked', 'Done']);
  assert.deepEqual(KIND_LABELS, ['feature', 'document', 'investigation', 'bug', 'maintenance']);
});

// ---------- views ----------

test('what the API cannot set on a view is a sentence for the Human Lead', () => {
  const view = {
    id: 'v',
    number: 2,
    name: 'Focuses by Stage',
    layout: 'board' as const,
    filter: '',
  };
  const board = {
    name: 'Focuses by Stage',
    layout: 'board' as const,
    filter: '-label:session',
    columnField: 'Stage',
  };
  assert.deepEqual(viewStepsByHand(board, view), [
    'On GitHub, open the view "Focuses by Stage" of the Project, open the view\'s menu, and set "Column by" to the field "Stage". The GitHub API cannot set it.',
  ]);
  assert.deepEqual(viewStepsByHand({ name: 'Items', layout: 'table' }, view), []);
  assert.equal(
    describeViewByHand(board),
    'On GitHub, add a view named "Focuses by Stage" with the board layout, the filter -label:session, "Column by" set to the field "Stage".',
  );
  assert.equal(
    describeViewByHand({ name: 'Items', layout: 'table' }),
    'On GitHub, add a view named "Items" with the table layout.',
  );
});

test('ensureProjectView on a host without the view mutations gives the whole view by hand, not a failure', async () => {
  const spec = { name: 'Agents', layout: 'board', filter: 'label:session' } as const;
  const absent = { code: 1, stderr: S.SCHEMA_ABSENCE_STDERR };

  // The host's schema has no `views` connection.
  const first = setup();
  gql(first.runner, S.SCHEMA_ABSENCE_BODY, absent);
  assert.deepEqual(await first.port.ensureProjectView({ project: PROJECT, spec }), {
    ok: true,
    value: { view: null, created: false, byHand: [describeViewByHand(spec)] },
  });
  assert.equal(first.runner.calls.length, 1);

  // Views can be read, and `createProjectV2View` does not exist.
  const second = setup();
  gql(second.runner, S.VIEWS_BODY);
  gql(second.runner, S.SCHEMA_ABSENCE_BODY, absent);
  const created = await second.port.ensureProjectView({ project: PROJECT, spec });
  assert.ok(created.ok);
  assert.equal(created.value.view, null);
  assert.match(created.value.byHand[0] ?? '', /add a view named "Agents" with the board layout/);

  // The view is created, and `updateProjectV2View` does not exist: the filter is the step by hand.
  const third = setup();
  gql(third.runner, S.VIEWS_BODY);
  gql(third.runner, { data: { createProjectV2View: { projectV2View: S.CREATED_VIEW_NODE } } });
  gql(third.runner, S.SCHEMA_ABSENCE_BODY, absent);
  const unfiltered = await third.port.ensureProjectView({ project: PROJECT, spec });
  assert.ok(unfiltered.ok);
  assert.equal(unfiltered.value.view?.id, 'PVTV_2');
  assert.equal(unfiltered.value.created, true);
  assert.match(unfiltered.value.byHand[0] ?? '', /set its filter to label:session/);

  // Any other error of a view mutation is still a failure.
  const fourth = setup();
  gql(fourth.runner, S.VIEWS_BODY);
  gql(fourth.runner, S.MISSING_SCOPE_BODY, { code: 1, stderr: S.MISSING_SCOPE_STDERR });
  const refused = errorOf(await fourth.port.ensureProjectView({ project: PROJECT, spec }));
  assert.deepEqual(refused, gitHubMissingScope(PROJECT_SCOPE));
});

test('isSchemaAbsence reads the codes GitHub gives for a document that does not fit the schema', () => {
  const errors = graphQlErrors(JSON.stringify(S.SCHEMA_ABSENCE_BODY));
  assert.deepEqual(
    errors.map((error) => error.code),
    ['variableRequiresValidType', 'undefinedField', 'variableNotUsed'],
  );
  assert.equal(isSchemaAbsence(errors), true);
  assert.equal(isSchemaAbsence([]), false);
  assert.equal(isSchemaAbsence(graphQlErrors(JSON.stringify(S.MISSING_SCOPE_BODY))), false);
  assert.equal(isSchemaAbsence(errors.slice(2)), false, 'an unused variable alone says nothing');
  // The same answer outside `ensureProjectView` is a failure with GitHub's own words.
  const result: RunResult = { code: 1, stdout: '', stderr: S.SCHEMA_ABSENCE_STDERR };
  assert.deepEqual(
    classifyGhFailure(result, parseGhApiResponse(S.apiResponse(S.SCHEMA_ABSENCE_BODY))),
    gitHubFailed(
      "NopeInput isn't a defined input type (on $i) Field 'nopeField' doesn't exist on type 'User' Variable $i is declared by anonymous query but not used",
    ),
  );
});

// ---------- values from outside ----------

test('no value from outside reaches the command line or the GraphQL text, whatever it holds', async () => {
  const { runner, port } = setup();
  gql(runner, S.LABELS_BODY);
  gql(runner, S.CREATE_ISSUE_BODY);
  gql(runner, S.ISSUE_BODY);
  gql(runner, { data: { addComment: { clientMutationId: null } } });
  const title = '--web -R other/repo "; rm -rf ~ #';
  const body = [
    '-F query=@/etc/passwd',
    '`id` $(id) $HOME \'single\' "double" \\ back',
    '") { viewer { login } } mutation { deleteIssue(input: {issueId: "x"',
    `ünïcödé 💥 ${String.fromCharCode(0x2028)} \t end`,
  ].join('\n');
  const created = await port.createIssue({
    repository: REPOSITORY,
    title,
    body,
    labels: ['--label; $(x)'],
  });
  assert.equal(created.ok, true);
  assert.equal((await port.comment({ issue: ISSUE, body })).ok, true);
  assert.equal(runner.calls.length, 4);
  const documents = [
    Q.repositoryAndLabelsQuery(1),
    Q.CREATE_ISSUE_MUTATION,
    Q.ISSUE_QUERY,
    Q.ADD_COMMENT_MUTATION,
  ];
  for (const [index, call] of runner.calls.entries()) {
    assert.equal(call.bin, 'gh');
    assert.deepEqual(call.args, GRAPHQL_ARGS, 'the arguments are the constant ones');
    const sent = request(call);
    assert.equal(sent.query, documents[index], 'the document is the constant text');
  }
  const input = request(runner.calls[1]).variables.input as { title: string; body: string };
  assert.equal(input.title, title);
  assert.equal(input.body, body);
  assert.equal(request(runner.calls[0]).variables.l0, '--label; $(x)');
});

test('a body over 65,536 characters, a long or empty title and a NUL are refused whole, before gh is started', async () => {
  const { runner, port } = setup();
  const seventyKb = 'x'.repeat(70 * 1024);
  const refusals: GitHubResult<unknown>[] = [
    await port.createIssue({ repository: REPOSITORY, title: 't', body: seventyKb, labels: [] }),
    await port.createIssue({ repository: REPOSITORY, title: '  ', body: '', labels: [] }),
    await port.createIssue({
      repository: REPOSITORY,
      title: 't'.repeat(ISSUE_TITLE_MAX + 1),
      body: '',
      labels: [],
    }),
    await port.createIssue({ repository: REPOSITORY, title: 't', body: `a${NUL}b`, labels: [] }),
    await port.updateIssue({ issue: ISSUE, body: seventyKb }),
    await port.updateIssue({ issue: ISSUE, title: `a${NUL}b` }),
    await port.comment({ issue: ISSUE, body: seventyKb }),
    await port.comment({ issue: ISSUE, body: ' \n' }),
  ];
  for (const refusal of refusals) {
    const error = errorOf(refusal) as { kind: string; message: string };
    assert.equal(error.kind, 'failed');
    assert.notEqual(error.message, '');
  }
  assert.match(
    (errorOf(refusals[0] ?? { ok: true, value: null }) as { message: string }).message,
    /The body has 71680 characters, and GitHub accepts at most 65536/,
  );
  assert.equal(runner.calls.length, 0, 'nothing was cut to fit and nothing was sent');

  assert.equal(issueTextError({ title: 't', body: 'x'.repeat(ISSUE_BODY_MAX) }), null);
  assert.equal(issueTextError({ title: 't'.repeat(ISSUE_TITLE_MAX) }), null);
  assert.equal(issueTextError({}), null);
  assert.equal(issueTextError({ body: 'x'.repeat(ISSUE_BODY_MAX + 1) })?.kind, 'failed');
});

test('repository names with .., extra slashes, spaces or a leading hyphen are refused before gh is started', async () => {
  const { runner, port } = setup();
  const bad = ['..', 'a/..', 'a/.', '../b', 'a/b/c', '-x/y', 'a/ b', 'a/b c', '/b', 'a/', 'a', ''];
  for (const name of bad) {
    assert.equal(splitRepositoryName(name).ok, false, name);
    assert.equal((errorOf(await port.findRepository(name)) as { kind: string }).kind, 'failed');
    const error = errorOf(await port.mergedPullRequests({ repository: name, limit: 5 }));
    assert.equal((error as { kind: string }).kind, 'failed');
  }
  const create = await port.createRepository({ owner: 'octo-human', name: '..', private: true });
  assert.equal((errorOf(create) as { kind: string }).kind, 'failed');
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(splitRepositoryName('octo-human/my.space_1'), {
    ok: true,
    value: { owner: 'octo-human', name: 'my.space_1' },
  });
  assert.equal(isRepositoryName('octo-human', '.github'), true);
  assert.equal(
    isRepositoryName('octo-human', '--help'),
    true,
    'a name is never an argument by itself',
  );
  assert.equal(isRepositoryName('-octo', 'x'), false);
});

test('developBranch refuses what git refuses as a branch name, before gh is started', async () => {
  const { runner, port } = setup();
  const bad = [
    '',
    '-b',
    '--checkout',
    'a..b',
    '../x',
    'a b',
    `a${NUL}b`,
    'a\nb',
    '/a',
    'a/',
    'a//b',
    'a.lock',
    'a/.hidden',
    'a.',
    '@',
    'a@{1}',
    'a~1',
    'a^',
    'a:b',
    'a?',
    'a*',
    'a[',
    'a\\b',
  ];
  for (const name of bad) {
    assert.equal(isBranchName(name), false, JSON.stringify(name));
    const result = await port.developBranch({
      issue: ISSUE,
      branchRepository: 'octo-human/app',
      name,
    });
    assert.equal((errorOf(result) as { kind: string }).kind, 'failed');
  }
  const noNumber = await port.developBranch({
    issue: { ...ISSUE, number: 1.5 },
    branchRepository: 'octo-human/app',
    name: 'ok',
  });
  assert.equal((errorOf(noNumber) as { kind: string }).kind, 'failed');
  assert.equal(runner.calls.length, 0);
  for (const name of ['12-fix', 'feature/12-fix', 'm3.1', 'a@b', 'UPPER_lower-1']) {
    assert.equal(isBranchName(name), true, name);
  }
});

test('a label whose name or description cannot be an argument is refused, and markersError names the text', async () => {
  const { runner, port } = setup();
  const result = await port.ensureLabels({
    repository: REPOSITORY,
    labels: [{ name: `a${NUL}b`, color: 'ededed', description: '' }],
  });
  assert.equal((errorOf(result) as { kind: string }).kind, 'failed');
  assert.equal(runner.calls.length, 0);
  assert.equal(labelError({ name: 'x', color: 'ededed', description: `a${NUL}` })?.kind, 'failed');
  assert.equal(labelError({ name: ' ', color: 'ededed', description: '' })?.kind, 'failed');
  assert.equal(labelError({ name: '--web', color: '#EDEDED', description: '-d' }), null);
  assert.equal(markersError([formatIssueMarker('migrated', 'a')]), null);
  assert.match(markersError(['plain'])?.message ?? '', /"plain" is not an issue marker/);
});

// ---------- error shapes recorded from gh 2.92.0 ----------

test('recorded and documented failures of gh are sorted by kind, and an unknown one keeps its words', () => {
  const run = (stderr: string, code = 1): RunResult => ({ code, stdout: '', stderr });
  assert.deepEqual(
    classifyGhFailure(run(S.GH_PROJECT_LIST_MISSING_SCOPE_STDERR)),
    gitHubMissingScope(PROJECT_SCOPE),
  );
  const saml = parseGhApiResponse(
    S.apiResponse(S.SAML_FORBIDDEN_BODY, { status: '403 Forbidden' }),
  );
  const samlStderr = 'gh: Resource protected by organization SAML enforcement. (HTTP 403)\n';
  assert.deepEqual(
    classifyGhFailure(run(samlStderr), saml),
    gitHubFailed('Resource protected by organization SAML enforcement. (HTTP 403)'),
    'HTTP 403 without a limit is not rate-limited',
  );
  const serverError = parseGhApiResponse(
    S.apiResponse('{"message":"Server Error"}', { status: '500 Internal Server Error' }),
  );
  assert.deepEqual(
    classifyGhFailure(run('gh: Server Error (HTTP 500)\n'), serverError),
    gitHubFailed('Server Error (HTTP 500)'),
  );
  assert.equal(
    classifyGhFailure(run('error connecting to api.github.com\ncheck your internet connection\n'))
      .kind,
    'unreachable',
  );
  assert.equal(
    classifyGhFailure(
      run('Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n'),
    ).kind,
    'unreachable',
  );
  assert.equal(classifyGhFailure(run('gh: Bad credentials (HTTP 401)\n')).kind, 'not-signed-in');
  assert.deepEqual(classifyGhFailure(run('something nobody has seen\n', 3)), {
    kind: 'failed',
    message: 'something nobody has seen',
  });
  assert.deepEqual(classifyGhFailure(run('', 7)), { kind: 'failed', message: 'gh exited 7' });
});
