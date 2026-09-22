import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  type Desk,
  type ProjectInfo,
  SESSION_LABEL,
  endSession,
  getSession,
  listClaims,
  startSession,
} from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
} from '@ai-lore-companion/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type McpHost, createMcpHost } from '../../../src/main/helper/mcp-host.js';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { spaceGitHub } from '../../../src/main/space/github-service.js';
import { boardWithin, sessionBoard } from '../../../src/main/space/session-server/board.js';
import {
  type SessionConnection,
  type SessionServer,
  configureSessionServer,
  sessionServer,
} from '../../../src/main/space/session-server/index.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M4.7: the Agents board on the fake GitHub, through the session server and a real MCP client.
// No test reaches GitHub.

const OWNER = 'fake-human';
const NAME = 'board-space';
const SPACE_REPOSITORY = `${OWNER}/${NAME}`;
const LORE = { kind: 'lore' } as const;
const APP = { kind: 'repository', name: 'app', branch: 'feature/1-thing' } as const;

let space: SpaceFixture;
let harness: SpaceHarness;
let host: McpHost;
let context: SpaceContext;
let server: SessionServer;
let desk: Desk;
let windows: FakeSpaceWindow[];
let fake: FakeGitHub;
let project: ProjectInfo;
const clients: Client[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: NAME,
    owner: OWNER,
    project: 1,
    repositories: ['app'],
  });
});

after(() => space.cleanup());

beforeEach(async () => {
  // What setup leaves on GitHub: the two repositories, the Project with the Agents field, the label.
  fake = createFakeGitHub();
  assert.ok((await fake.createRepository({ owner: OWNER, name: NAME, private: true })).ok);
  assert.ok((await fake.createRepository({ owner: OWNER, name: 'app', private: true })).ok);
  const made = await fake.createProject({ owner: OWNER, title: NAME });
  assert.ok(made.ok);
  project = made.value;
  assert.equal(project.number, 1);
  const field = await fake.ensureSingleSelectField({
    project,
    name: AGENTS_FIELD,
    options: [...AGENTS_COLUMNS],
  });
  assert.ok(field.ok);
  const labels = await fake.ensureLabels({
    repository: SPACE_REPOSITORY,
    labels: [{ name: SESSION_LABEL, color: 'ededed', description: 'A session' }],
  });
  assert.ok(labels.ok);

  host = createMcpHost();
  await host.listen();
  configureSessionServer({ host: async () => host, awaitMs: 60, boardWaitMs: 400 });
  harness = spaceHarnessFor(() => {});
  await harness.space.host.openFolder(undefined, space.root);
  windows = harness.space.created;
  const spaceWindow = windows[0];
  assert.ok(spaceWindow);
  const found = harness.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(found);
  context = found;
  context.service(spaceGitHub).use(fake);
  server = context.service(sessionServer);
  const opened = context.service(spaceDesk).open();
  assert.ok(opened.ok);
  desk = opened.value;
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const window of windows) await harness.space.host.windowClosed(window.id);
  configureSessionServer(null);
  await host.close();
  harness.cleanup();
  fake.setDelay(0);
  await fake.dispose();
});

async function start(sessionId: string): Promise<SessionConnection> {
  assert.ok(startSession(desk, { id: sessionId, engine: 'claude-code' }).ok);
  const connection = await server.registerSession(sessionId);
  assert.ok(connection.ok);
  return connection.value;
}

async function connect(connection: SessionConnection): Promise<Client> {
  const client = new Client({ name: 'test-engine', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { [connection.header.name]: connection.header.value } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
  return { isError: result.isError === true, value: JSON.parse(text) as Record<string, unknown> };
}

/** Ask for Writing, have the Human Lead confirm, and read the answer as the session does. */
async function enter(client: Client, args: Record<string, unknown>) {
  const asked = await call(client, 'request_writing', args);
  assert.equal(asked.isError, false, JSON.stringify(asked.value));
  const ticket = asked.value.ticket as string;
  const confirmed = server.broker.answerWriting(ticket, { confirm: true });
  assert.ok(confirmed.ok && confirmed.value.granted);
  return (await call(client, 'await_answer', { ticket })).value;
}

async function rows() {
  const read = await fake.readProject({ project });
  assert.ok(read.ok);
  return read.value.sessions;
}

test('a session that writes has its issue on the board, with its targets, and ends in Done', async () => {
  const item = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'An item',
    body: 'The criteria.',
    labels: [],
  });
  assert.ok(item.ok);
  const client = await connect(await start('s-board'));

  const granted = await enter(client, {
    targets: [LORE, APP],
    item: item.value.number,
    reason: 'Build the item.',
  });
  assert.equal(granted.granted, true);
  const board = granted.board as { updated: boolean; issue?: string };
  assert.equal(board.updated, true, JSON.stringify(board));

  let on = await rows();
  assert.equal(on.length, 1);
  assert.equal(on[0]?.column, 'Writing');
  assert.deepEqual(on[0]?.targets, [LORE, APP]);
  assert.equal(on[0]?.issue.url, board.issue);
  const record = getSession(desk, 's-board');
  assert.ok(record.ok);
  assert.equal(record.value?.issue?.number, on[0]?.issue.number);
  assert.equal(record.value?.item?.number, item.value.number);
  // The item branch, linked to the item's issue, in the payload's repository.
  const itemIssue = fake.state().issues.find((i) => i.ref.number === item.value.number);
  assert.deepEqual(itemIssue?.branches, [{ repository: `${OWNER}/app`, name: APP.branch }]);

  // Leaving Writing moves the issue to Read only.
  const left = await call(client, 'leave_writing');
  assert.equal((left.value.board as { updated: boolean }).updated, true);
  on = await rows();
  assert.equal(on[0]?.column, 'Read only');

  // A second Writing in the same session moves the same issue; none is created. The branch exists: taken.
  const again = await enter(client, { targets: [APP], item: item.value.number, reason: 'Again.' });
  assert.equal((again.board as { updated: boolean }).updated, true);
  on = await rows();
  assert.equal(on.length, 1);
  assert.equal(on[0]?.column, 'Writing');
  assert.deepEqual(on[0]?.targets, [APP]);

  // The session closes: the whole journal entry goes on the issue and the issue moves to Done.
  const journal = context.paths.journal;
  mkdirSync(journal, { recursive: true });
  const entry = join(journal, '2026-09-18-1200-board-s-board.md');
  writeFileSync(
    entry,
    `# Board\n\nDid it.\n\n## Handover\n\nDone: the item.\nNext: review ${space.root}/lore/a.md.\n`,
  );
  try {
    assert.ok(endSession(desk, 's-board').ok);
    const done = await boardWithin(context.service(sessionBoard).closed('s-board'), 2000);
    assert.equal(done?.updated, true, JSON.stringify(done));
  } finally {
    rmSync(entry);
  }
  on = await rows();
  assert.equal(on[0]?.column, 'Done');
  const sessionIssue = fake.state().issues.find((i) => i.ref.number === on[0]?.issue.number);
  // The whole entry, with the Space folder replaced; the issue stays open. It
  // used to be the `## Handover` section alone, so what a session learned and
  // what it corrected never left the desk. The handover now goes to the ticket
  // of the work it concerns, which is the verb's job, so it is not repeated
  // here under its own heading.
  const comment = sessionIssue?.comments.at(-1) ?? '';
  assert.match(comment, /^## The session's journal entry\n/);
  assert.ok(comment.includes('# Board'), 'the whole entry, not only the handover');
  assert.ok(comment.includes('Did it.'));
  assert.ok(
    comment.includes('Next: review <Space>/lore/a.md.'),
    'no folder of this machine reaches GitHub',
  );
  assert.ok(!comment.includes(space.root), 'no folder of this machine reaches GitHub');
  assert.equal(sessionIssue?.state, 'open');
});

/**
 * A session in Read only can restructure the whole plan — one created 38
 * issues and closed 37 that way, with nothing on the board to say who had done
 * it, and its issue had to be written by hand afterwards. So the issue exists
 * from the start, in Read only, before anything is written.
 */
test('a session that only reads is on the board from the moment it starts', async () => {
  await connect(await start('s-reads'));
  const board = context.service(sessionBoard);
  const note = await boardWithin(board.started('s-reads'), 2000);
  assert.equal(note?.updated, true, JSON.stringify(note));

  const on = await rows();
  assert.equal(on.length, 1);
  assert.equal(on[0]?.column, 'Read only', 'it is on the board without ever having written');
  assert.deepEqual(on[0]?.targets, [], 'it holds nothing');
  const record = getSession(desk, 's-reads');
  assert.ok(record.ok);
  assert.equal(record.value?.issue?.number, on[0]?.issue.number);

  const issue = fake.state().issues.find((i) => i.ref.number === on[0]?.issue.number);
  assert.match(issue?.body ?? '', /Tickets this session touched:\n- none yet/);
});

test('the tickets a session touched are listed on its issue, and each gets one back-link', async () => {
  const first = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'One ticket',
    body: '',
    labels: [],
  });
  const second = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'Another ticket',
    body: '',
    labels: [],
  });
  assert.ok(first.ok && second.ok);
  await connect(await start('s-touch'));
  const board = context.service(sessionBoard);
  assert.equal((await boardWithin(board.started('s-touch'), 2000))?.updated, true);

  assert.equal(
    (await boardWithin(board.touched('s-touch', [first.value.number]), 2000))?.updated,
    true,
  );
  // Said twice, with one new: the one already there is not commented on again.
  assert.equal(
    (await boardWithin(board.touched('s-touch', [first.value.number, second.value.number]), 2000))
      ?.updated,
    true,
  );

  const on = await rows();
  const sessionIssue = fake.state().issues.find((i) => i.ref.number === on[0]?.issue.number);
  const body = sessionIssue?.body ?? '';
  assert.ok(body.includes(`/issues/${first.value.number}`), 'the first ticket is listed');
  assert.ok(body.includes(`/issues/${second.value.number}`), 'the second ticket is listed');

  const record = getSession(desk, 's-touch');
  assert.ok(record.ok);
  assert.deepEqual(
    record.value?.tickets?.map((ticket) => ticket.number),
    [first.value.number, second.value.number],
    'the desk keeps them in the order they were first touched',
  );

  // One back-link per ticket, however often the ticket is named.
  for (const number of [first.value.number, second.value.number]) {
    const ticket = fake.state().issues.find((i) => i.ref.number === number);
    const links = (ticket?.comments ?? []).filter((text) => text.startsWith('Worked on by'));
    assert.equal(links.length, 1, `ticket ${number} has exactly one back-link`);
    assert.ok(links[0]?.includes(`/issues/${on[0]?.issue.number}`), 'it names the session issue');
  }
});

test('a session names the tickets it worked through the tool, and they reach its issue', async () => {
  const ticket = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'A ticket the session works',
    body: '',
    labels: [],
  });
  assert.ok(ticket.ok);
  const client = await connect(await start('s-tool'));
  const board = context.service(sessionBoard);
  assert.equal((await boardWithin(board.started('s-tool'), 2000))?.updated, true);

  // A session in Read only may say what it touched: this is the half of
  // traceability that used to be missing entirely.
  const named = await call(client, 'tickets_touched', { tickets: [ticket.value.number] });
  assert.deepEqual(named.value, { tickets: [ticket.value.number] });

  const record = getSession(desk, 's-tool');
  assert.ok(record.ok);
  assert.deepEqual(
    record.value?.tickets?.map((entry) => entry.number),
    [ticket.value.number],
  );
  const worked = fake.state().issues.find((i) => i.ref.number === ticket.value.number);
  assert.equal((worked?.comments ?? []).filter((text) => text.startsWith('Worked on by')).length, 1);
});

test('a session with a profile names it in the issue body; the marker and the title are unchanged (M14.4)', async () => {
  const item = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'An item',
    body: 'The criteria.',
    labels: [],
  });
  assert.ok(item.ok);
  assert.ok(
    startSession(desk, {
      id: 's-profile',
      engine: 'claude-code',
      profile: { id: 'default.claude', name: 'Claude Code', engine: 'claude-code', model: 'opus' },
    }).ok,
  );
  const connection = await server.registerSession('s-profile');
  assert.ok(connection.ok);
  const client = await connect(connection.value);

  const granted = await enter(client, {
    targets: [LORE],
    item: item.value.number,
    reason: 'Build the item.',
  });
  assert.equal(granted.granted, true);
  const board = granted.board as { updated: boolean; issue?: string };
  assert.equal(board.updated, true, JSON.stringify(board));

  const issue = fake.state().issues.find((i) => i.ref.url === board.issue);
  assert.ok(issue);
  // The body names the profile.
  assert.match(
    issue.body,
    /^Profile: Claude Code \(default\.claude\), engine claude-code, model opus$/m,
  );
  // The title is the string it is today: no profile in it, no id, no name.
  assert.match(issue.title, /^The claude-code session that started at \S+$/);
  assert.ok(!issue.title.includes('Profile') && !issue.title.includes('default.claude'));

  // The marker still finds this same issue: a second Writing updates it and creates no other.
  const again = await enter(client, { targets: [APP], reason: 'Again.' });
  assert.equal((again.board as { updated: boolean }).updated, true);
  const on = await rows();
  assert.equal(on.length, 1, 'no second issue was created: the hidden marker still finds this one');
  assert.equal(on[0]?.issue.url, board.issue);
  const updated = fake.state().issues.find((i) => i.ref.url === board.issue);
  assert.ok(updated);
  // The title on the update is byte-identical to the title at creation.
  assert.equal(updated.title, issue.title);
  // The body still names the profile after the update.
  assert.match(
    updated.body,
    /^Profile: Claude Code \(default\.claude\), engine claude-code, model opus$/m,
  );
});

test('GitHub unreachable: the claim is granted, and the answer says the board was not updated', async () => {
  fake.setUnreachable(true);
  const client = await connect(await start('s-offline'));
  const granted = await enter(client, { targets: [LORE], reason: 'Write the mirror.' });
  assert.equal(granted.granted, true);
  const board = granted.board as { updated: boolean; message: string };
  assert.equal(board.updated, false);
  assert.match(
    board.message,
    /^The Agents board on GitHub was not updated because GitHub could not be reached .*, and nothing will retry it\.$/,
  );
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.filter((claim) => claim.sessionId === 's-offline').map((claim) => claim.target),
    [LORE],
  );
  // No issue was recorded, so leaving Writing has nothing to move and says nothing of the board.
  const left = await call(client, 'leave_writing');
  assert.equal(left.value.mode, 'read-only');
  assert.equal(left.value.board, undefined);
  fake.setUnreachable(false);
  assert.equal(fake.state().issues.length, 0);
});

test('a slow GitHub does not hold the grant beyond the limit', async () => {
  fake.setDelay(2000);
  const client = await connect(await start('s-slow'));
  const began = Date.now();
  const granted = await enter(client, { targets: [LORE], reason: 'Write.' });
  assert.ok(Date.now() - began < 1800, 'the answer came before GitHub did');
  assert.equal(granted.granted, true);
  const board = granted.board as { updated: boolean; message: string };
  assert.equal(board.updated, false);
  assert.match(board.message, /did not answer within/);
  const record = getSession(desk, 's-slow');
  assert.ok(record.ok);
  assert.equal(record.value?.mode, 'writing');
  // The update still in flight ends at its next call.
  fake.setUnreachable(true);
});

/** Wait until every board update already asked for has ended: a close of a session with no issue runs after them. */
async function drained(): Promise<void> {
  assert.equal(await context.service(sessionBoard).closed('no-such-session'), null);
}

test('a slow update of entering does not land after the later move to Read only', async () => {
  fake.setDelay(250);
  const client = await connect(await start('s-order'));
  const granted = await enter(client, { targets: [LORE], reason: 'Write.' });
  assert.equal((granted.board as { updated: boolean }).updated, false);
  // Leaving while the first update is still running.
  const left = await call(client, 'leave_writing');
  assert.equal(left.value.mode, 'read-only');
  await drained();
  fake.setDelay(0);
  const on = await rows();
  assert.equal(on.length, 1);
  assert.equal(on[0]?.column, 'Read only');
});

test('rate-limited, or an answer lost: the claim is granted, and a second Writing makes no second issue', async () => {
  const client = await connect(await start('s-limit'));
  fake.failNext({
    kind: 'rate-limited',
    retryAfterSeconds: 60,
    message: 'API rate limit exceeded',
  });
  const limited = await enter(client, { targets: [LORE], reason: 'Write.' });
  assert.equal(limited.granted, true);
  assert.match(
    (limited.board as { message: string }).message,
    /^The Agents board on GitHub was not updated because GitHub refused the request because of its rate limit; try again in 60 seconds, and nothing will retry it\.$/,
  );
  assert.equal((await call(client, 'leave_writing')).value.mode, 'read-only');

  // GitHub makes the issue and the answer is lost: nothing is recorded on the desk, and the next Writing finds the issue by its marker.
  fake.loseNextAnswer({ kind: 'unreachable', message: 'timed out' });
  const lost = await enter(client, { targets: [LORE], reason: 'Write.' });
  assert.equal(lost.granted, true);
  assert.equal((lost.board as { updated: boolean }).updated, false);
  assert.equal((await call(client, 'leave_writing')).value.mode, 'read-only');
  const again = await enter(client, { targets: [LORE], reason: 'Write.' });
  assert.equal((again.board as { updated: boolean }).updated, true);
  assert.equal(fake.state().issues.filter((i) => i.labels.includes(SESSION_LABEL)).length, 1);
});

test('two sessions at once have two issues, titled without their ids', async () => {
  const one = await connect(await start('s-one'));
  const two = await connect(await start('s-two'));
  await enter(one, { targets: [LORE], reason: 'One.' });
  await enter(two, { targets: [APP], reason: 'Two.' });
  const issues = fake.state().issues.filter((i) => i.labels.includes(SESSION_LABEL));
  assert.equal(issues.length, 2);
  for (const issue of issues) {
    assert.match(issue.title, /^The claude-code session that started at \S+$/);
    assert.ok(!issue.title.includes('s-one') && !issue.title.includes('s-two'));
    assert.ok(!issue.body.includes(space.root), 'no local path in the body');
  }
});
