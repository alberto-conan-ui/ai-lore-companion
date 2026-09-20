import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  type Desk,
  endSession,
  getSession,
  listClaims,
  listGateAnswers,
  listSessionCloses,
  startSession,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type McpHost, createMcpHost } from '../../../src/main/helper/mcp-host.js';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceDashboardReport } from '../../../src/main/space/dashboard-report.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import type { SpaceLog, SpaceLogFields } from '../../../src/main/space/log.js';
import { createDialogBroker } from '../../../src/main/space/session-server/broker.js';
import { MAX_BODY_BYTES } from '../../../src/main/space/session-server/constants.js';
import {
  DASHBOARD_REPORT_TOOL_NAME,
  SESSION_TOOL_NAMES,
  type SessionConnection,
  type SessionServer,
  configureSessionServer,
  createSessionServer,
  sessionServer,
} from '../../../src/main/space/session-server/index.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The session server with a real MCP client over HTTP, on a Space fixture in a temporary
// folder. The test's calls to `server.broker` stand in for the two dialogs of phase M4.5.

const LORE = { kind: 'lore' } as const;

let space: SpaceFixture;
let harness: SpaceHarness;
let host: McpHost;
let port: number;
let context: SpaceContext;
let server: SessionServer;
let desk: Desk;
let windows: FakeSpaceWindow[];
const clients: Client[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'session-server-space',
    repositories: ['app'],
  });
});

after(() => space.cleanup());

beforeEach(async () => {
  host = createMcpHost();
  port = await host.listen();
  configureSessionServer({
    host: async () => host,
    awaitMs: 60,
    limits: { maxPendingPerSession: 2 },
  });
  harness = spaceHarnessFor(() => {});
  await harness.space.host.openFolder(undefined, space.root);
  windows = harness.space.created;
  const spaceWindow = windows[0];
  assert.ok(spaceWindow);
  const found = harness.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(found);
  context = found;
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
});

/** What phase M4.4 does when it starts a session: the desk's record, then the registration. */
async function start(sessionId: string): Promise<SessionConnection> {
  assert.ok(startSession(desk, { id: sessionId, engine: 'claude-code' }).ok);
  const connection = await server.registerSession(sessionId);
  assert.ok(connection.ok);
  return connection.value;
}

/** A PM starts as the same Read-only session, with one report-only MCP tool. */
async function startPm(sessionId: string): Promise<SessionConnection> {
  assert.ok(startSession(desk, { id: sessionId, engine: 'claude-code' }).ok);
  const connection = await server.registerSession(sessionId, { purpose: 'pm' });
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

type ToolAnswer = { isError: boolean; value: Record<string, unknown> };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    value = { text };
  }
  return { isError: result.isError === true, value } satisfies ToolAnswer;
}

async function ticketOf(answer: Promise<ToolAnswer>): Promise<string> {
  const { isError, value } = await answer;
  assert.equal(isError, false, JSON.stringify(value));
  assert.equal(typeof value.ticket, 'string');
  return value.ticket as string;
}

/** One raw HTTP request, so that `Host` and `Origin` can be set as a browser or a stranger would. */
function raw(options: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  chunked?: boolean;
}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(options.body !== undefined && !options.chunked
            ? { 'content-length': String(Buffer.byteLength(options.body)) }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const LIST_TOOLS = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

test('a session has the four tools of the cards, and no other', async () => {
  const connection = await start('s-tools');
  assert.equal(connection.serverName, 'ailore');
  assert.deepEqual([...connection.tools], [...SESSION_TOOL_NAMES]);
  assert.match(connection.header.value, /^Bearer [A-Za-z0-9_-]{43}$/);
  const client = await connect(connection);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...SESSION_TOOL_NAMES].sort());
});

test('only a PM session can publish one bounded dashboard report without a claim', async () => {
  const ordinary = await connect(await start('s-ordinary-report'));
  const ordinaryTools = await ordinary.listTools();
  assert.equal(
    ordinaryTools.tools.some((tool) => tool.name === DASHBOARD_REPORT_TOOL_NAME),
    false,
  );

  const pmConnection = await startPm('s-pm-report');
  assert.deepEqual(pmConnection.tools, [...SESSION_TOOL_NAMES, DASHBOARD_REPORT_TOOL_NAME]);
  const pm = await connect(pmConnection);
  const pmTools = await pm.listTools();
  assert.equal(
    pmTools.tools.some((tool) => tool.name === DASHBOARD_REPORT_TOOL_NAME),
    true,
  );

  const published = await call(pm, DASHBOARD_REPORT_TOOL_NAME, {
    markdown: '# Today\n\nThe project is waiting for review.',
    basis: 'The PM read the current Lore and Project cache.',
  });
  assert.equal(published.isError, false, JSON.stringify(published.value));
  assert.deepEqual(published.value, { status: 'received' });
  const report = context.service(spaceDashboardReport).read().report;
  assert.ok(report);
  assert.deepEqual(report, {
    markdown: '# Today\n\nThe project is waiting for review.',
    basis: 'The PM read the current Lore and Project cache.',
    sessionId: 's-pm-report',
    receivedAt: report.receivedAt,
    stale: false,
    staleReason: null,
  });
  assert.match(report.receivedAt, /^\d{4}-\d{2}-\d{2}T/);

  const record = getSession(desk, 's-pm-report');
  assert.ok(record.ok);
  assert.equal(record.value?.mode, 'read-only');
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(claims.value, []);

  await server.unregisterSession('s-pm-report');
  assert.deepEqual(context.service(spaceDashboardReport).read().report, {
    ...report,
    stale: true,
    staleReason: 'session-ended',
  });
});

test('a PM report rejects invalid bounded text before it reaches the Dashboard', async () => {
  const pm = await connect(await startPm('s-pm-invalid-report'));
  const oversized = await call(pm, DASHBOARD_REPORT_TOOL_NAME, {
    markdown: 'x'.repeat(24 * 1024 + 1),
  });
  assert.equal(oversized.isError, true);
  const control = await call(pm, DASHBOARD_REPORT_TOOL_NAME, { markdown: 'bad\u0000report' });
  assert.equal(control.isError, true);
  assert.equal(context.service(spaceDashboardReport).read().report, null);
});

test('request, pending, grant: the claim is on the desk before the session reads granted', async () => {
  const client = await connect(await start('s-grant'));
  const ticket = await ticketOf(
    call(client, 'request_writing', { targets: [LORE], item: 12, reason: 'Write the mirror.' }),
  );

  assert.deepEqual((await call(client, 'await_answer', { ticket })).value, { status: 'pending' });
  const pending = server.broker.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.kind, 'writing');
  assert.equal(pending[0]?.sessionId, 's-grant');
  const view = server.broker.describeWriting(ticket);
  assert.ok(view.ok);
  assert.equal(view.value.refusal, null);
  assert.ok(view.value.claimable.some((row) => row.kind === 'lore' && row.holder === null));

  // What the desk holds at the moment the answer is released.
  let claimsWhenReleased = -1;
  const unsubscribe = server.broker.subscribe((event) => {
    if (event.kind !== 'settled') return;
    const claims = listClaims(desk);
    claimsWhenReleased = claims.ok ? claims.value.length : -2;
  });
  const waiting = call(client, 'await_answer', { ticket });
  const answered = server.broker.answerWriting(ticket, { confirm: true });
  unsubscribe();
  assert.ok(answered.ok);
  assert.equal(claimsWhenReleased, 1);

  const { value } = await waiting;
  assert.equal(value.status, 'answered');
  assert.equal(value.granted, true);
  const claims = value.claims as Array<{ sessionId: string; target: unknown }>;
  assert.deepEqual(
    claims.map((claim) => [claim.sessionId, claim.target]),
    [['s-grant', LORE]],
  );
  const session = getSession(desk, 's-grant');
  assert.ok(session.ok);
  assert.equal(session.value?.mode, 'writing');

  // A ticket is answered once, and the answer can be read again.
  const again = server.broker.answerWriting(ticket, { confirm: false });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.error.kind, 'already-answered');
  assert.equal((await call(client, 'await_answer', { ticket })).value.granted, true);

  // leave_writing releases the claim and returns the mode.
  const left = await call(client, 'leave_writing');
  assert.equal(left.value.mode, 'read-only');
  assert.deepEqual(left.value.released, [LORE]);
  const after = listClaims(desk);
  assert.ok(after.ok);
  assert.equal(after.value.length, 0);
  const sessionAfter = getSession(desk, 's-grant');
  assert.ok(sessionAfter.ok);
  assert.equal(sessionAfter.value?.mode, 'read-only');
});

test('a declined request and a refused one change nothing on the desk', async () => {
  const holder = await connect(await start('s-holder'));
  const asker = await connect(await start('s-asker'));

  const declined = await ticketOf(
    call(asker, 'request_writing', { targets: [LORE], reason: 'Add a verb.' }),
  );
  assert.ok(server.broker.answerWriting(declined, { confirm: false }).ok);
  const declinedAnswer = (await call(asker, 'await_answer', { ticket: declined })).value;
  assert.equal(declinedAnswer.granted, false);
  assert.equal(declinedAnswer.reason, 'declined');
  let claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);

  // The holder takes the Lore; the asker is then refused it, and is told who holds it.
  const held = await ticketOf(
    call(holder, 'request_writing', { targets: [LORE], reason: 'Write a card.' }),
  );
  assert.ok(server.broker.answerWriting(held, { confirm: true }).ok);
  const second = await ticketOf(
    call(asker, 'request_writing', { targets: [LORE], reason: 'Add a verb.' }),
  );
  const view = server.broker.describeWriting(second);
  assert.ok(view.ok);
  assert.equal(view.value.refusal?.kind, 'held');
  assert.ok(server.broker.answerWriting(second, { confirm: true }).ok);
  const refused = (await call(asker, 'await_answer', { ticket: second })).value;
  assert.equal(refused.granted, false);
  assert.equal(refused.reason, 'held');
  // The holder is named for the Human Lead by what its header shows, never by its id.
  assert.match(String(refused.heldBy), /^the claude-code session that started at \d{4}-/);
  assert.match(String(refused.message), /^The Lore is held by the claude-code session/);
  assert.equal(JSON.stringify(refused).includes('s-holder'), false);
  claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.map((claim) => claim.sessionId),
    ['s-holder'],
  );
  const askerRecord = getSession(desk, 's-asker');
  assert.ok(askerRecord.ok);
  assert.equal(askerRecord.value?.mode, 'read-only');

  // A request that is wrong in itself gets no ticket and no dialog.
  const before = server.broker.pending().length;
  const wrong = await call(asker, 'request_writing', {
    targets: [{ kind: 'repository', name: 'not-in-the-manifest', branch: 'main' }],
    reason: 'Change the code.',
  });
  assert.equal(wrong.isError, true);
  assert.equal(wrong.value.error, 'refused');
  assert.equal(server.broker.pending().length, before);

  // A repository is claimed on a branch.
  const repo = await ticketOf(
    call(asker, 'request_writing', {
      targets: [{ kind: 'repository', name: 'app', branch: 'feature/12-thing' }],
      reason: 'Change the code.',
    }),
  );
  const granted = server.broker.answerWriting(repo, { confirm: true });
  assert.ok(granted.ok);
  assert.equal(granted.value.granted, true);
});

test('a gate is answered by the companion, and the companion records it', async () => {
  const client = await connect(await start('s-gate'));
  const ticket = await ticketOf(
    call(client, 'request_gate', {
      process: 'plan',
      step: 'break-down',
      question: 'Is this breakdown confirmed?',
      bearsOn: 'workbench/plan.md',
    }),
  );
  assert.deepEqual((await call(client, 'await_answer', { ticket })).value, { status: 'pending' });
  const before = listGateAnswers(desk);
  assert.ok(before.ok);
  assert.equal(before.value.length, 0);

  // The wrong kind of answer does not settle it.
  assert.equal(server.broker.answerWriting(ticket, { confirm: true }).ok, false);
  const recorded = server.broker.answerGate(ticket, 'take-over');
  assert.ok(recorded.ok);

  const { value } = await call(client, 'await_answer', { ticket });
  assert.equal(value.status, 'answered');
  assert.equal(value.answer, 'take-over');
  assert.equal(value.id, recorded.value.id);
  const answers = listGateAnswers(desk, 's-gate');
  assert.ok(answers.ok);
  assert.deepEqual(
    answers.value.map((entry) => [entry.process, entry.step, entry.question, entry.answer]),
    [['plan', 'break-down', 'Is this breakdown confirmed?', 'take-over']],
  );
  assert.equal(server.broker.answerGate(ticket, 'yes').ok, false);
});

test("an unknown ticket, and another session's ticket, read the same", async () => {
  const owner = await connect(await start('s-owner'));
  const other = await connect(await start('s-other'));
  const ticket = await ticketOf(
    call(owner, 'request_writing', { targets: [LORE], reason: 'Write.' }),
  );

  const unknown = await call(other, 'await_answer', { ticket: 'f'.repeat(32) });
  const foreign = await call(other, 'await_answer', { ticket });
  assert.equal(unknown.isError, true);
  assert.deepEqual(foreign, unknown);
  assert.equal(unknown.value.error, 'unknown-ticket');

  // Answered, it is still the owner's alone; and no tool takes a session id.
  assert.ok(server.broker.answerWriting(ticket, { confirm: true }).ok);
  assert.deepEqual(await call(other, 'await_answer', { ticket }), unknown);
  await call(other, 'leave_writing');
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.map((claim) => claim.sessionId),
    ['s-owner'],
  );
  const smuggled = await call(other, 'request_writing', {
    targets: [{ kind: 'repository', name: 'app', branch: 'main' }],
    reason: 'Write.',
    sessionId: 's-owner',
  });
  if (!smuggled.isError) {
    const asked = server.broker.pending().find((entry) => entry.ticket === smuggled.value.ticket);
    assert.equal(asked?.sessionId, 's-other');
  }
});

test('the refusals of the local server', async () => {
  const connection = await start('s-http');
  const other = await start('s-http-other');
  const path = new URL(connection.url).pathname;
  const auth = { [connection.header.name]: connection.header.value };

  const good = await raw({ path, headers: auth, body: LIST_TOOLS });
  assert.equal(good.status, 200);
  assert.equal(good.headers['access-control-allow-origin'], undefined);

  const wrongToken = await raw({
    path,
    headers: { authorization: `Bearer ${'A'.repeat(43)}` },
    body: LIST_TOOLS,
  });
  const othersToken = await raw({
    path,
    headers: { [other.header.name]: other.header.value },
    body: LIST_TOOLS,
  });
  const unknownSession = await raw({ path: '/mcp/s-nobody', headers: auth, body: LIST_TOOLS });
  assert.equal(unknownSession.status, 404);
  // Without the session's token a session that exists answers exactly as one that does not.
  for (const refusedRequest of [wrongToken, othersToken, await raw({ path, body: LIST_TOOLS })]) {
    assert.equal(refusedRequest.status, 404);
    assert.equal(refusedRequest.body, unknownSession.body);
  }
  const strangerWithWrongHost = await raw({
    path,
    headers: { host: 'evil.example' },
    body: LIST_TOOLS,
  });
  assert.equal(strangerWithWrongHost.status, 404);
  assert.equal(strangerWithWrongHost.body, unknownSession.body);

  for (const hostHeader of [
    `localhost:${port}`,
    'evil.example',
    `evil.example:${port}`,
    `127.0.0.1:${port + 1}`,
    `127.0.0.1:${port}.evil.example`,
  ]) {
    const wrongHost = await raw({ path, headers: { ...auth, host: hostHeader }, body: LIST_TOOLS });
    assert.equal(wrongHost.status, 403, hostHeader);
  }
  for (const origin of ['https://evil.example', `http://127.0.0.1:${port}`, 'null']) {
    const withOrigin = await raw({ path, headers: { ...auth, origin }, body: LIST_TOOLS });
    assert.equal(withOrigin.status, 403, origin);
  }
  const preflight = await raw({
    path,
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 404);
  const preflightWithToken = await raw({
    path,
    method: 'OPTIONS',
    headers: { ...auth, origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflightWithToken.status, 403);
  for (const answer of [preflight, preflightWithToken, wrongToken]) {
    const corsHeaders = Object.keys(answer.headers).filter((name) =>
      name.startsWith('access-control-'),
    );
    assert.deepEqual(corsHeaders, []);
  }

  // A body that is not JSON, a body of another type, and a method MCP does not have.
  assert.equal((await raw({ path, headers: auth, body: '{"jsonrpc": ' })).status, 400);
  const asText = await raw({
    path,
    headers: { ...auth, 'content-type': 'text/plain' },
    body: LIST_TOOLS,
  });
  assert.equal(asText.status, 415);
  // Claude Code's client asks `server/discover` first (the findings of phase M4.1): a JSON-RPC error, not a refusal.
  const discover = await raw({
    path,
    headers: auth,
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'server/discover', params: {} }),
  });
  assert.equal(discover.status, 200);
  assert.match(discover.body, /"error"/);
  assert.equal((await raw({ path, headers: auth, body: LIST_TOOLS })).status, 200);

  const big = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: { pad: 'x'.repeat(MAX_BODY_BYTES) },
  });
  assert.equal((await raw({ path, headers: auth, body: big })).status, 413);
  const chunked = await raw({
    path,
    headers: { ...auth, 'transfer-encoding': 'chunked' },
    body: big,
    chunked: true,
  });
  assert.equal(chunked.status, 413);
  // The server still answers after the two refusals.
  assert.equal((await raw({ path, headers: auth, body: LIST_TOOLS })).status, 200);

  assert.equal((await raw({ path, method: 'GET', headers: auth })).status, 405);

  // None of it opened a ticket.
  assert.equal(server.broker.pending().length, 0);
});

test('tickets are bounded per session, and calls are rate limited', async () => {
  const client = await connect(await start('s-bounds'));
  const ask = () =>
    call(client, 'request_gate', { process: 'work', step: 'report', question: '?' });
  await ticketOf(ask());
  await ticketOf(ask());
  const third = await ask();
  assert.equal(third.isError, true);
  assert.equal(third.value.error, 'too-many-tickets');
  assert.equal(server.broker.pending().length, 2);

  // A server with a small share of calls.
  const entries: Array<{ event: string; fields: SpaceLogFields }> = [];
  const record = (event: string, fields: SpaceLogFields = {}) => entries.push({ event, fields });
  const log: SpaceLog = { info: record, warn: record, error: record };
  const small = createSessionServer({
    host: async () => host,
    broker: { desk: () => ({ ok: true, value: desk }), manifest: () => context.manifest, log },
    awaitMs: 20,
    maxCallsPerWindow: 3,
  });
  try {
    const limited = await small.registerSession('s-limited');
    assert.ok(limited.ok);
    assert.ok(startSession(desk, { id: 's-limited', engine: 'claude-code' }).ok);
    const limitedClient = await connect(limited.value);
    const secretReason = 'A reason that must not reach the log.';
    const asked = await call(limitedClient, 'request_writing', {
      targets: [LORE],
      reason: secretReason,
    });
    assert.equal(asked.isError, false);
    await call(limitedClient, 'await_answer', { ticket: asked.value.ticket });
    await call(limitedClient, 'await_answer', { ticket: asked.value.ticket });
    const fourth = await call(limitedClient, 'await_answer', { ticket: asked.value.ticket });
    assert.equal(fourth.isError, true);
    assert.equal(fourth.value.error, 'rate-limited');

    // The log names the session and the tool, and holds no token, ticket, reason or body.
    const written = JSON.stringify(entries);
    assert.ok(entries.some((entry) => entry.event === 'writing-requested'));
    assert.ok(entries.some((entry) => entry.event === 'session-tool-rate-limited'));
    const token = limited.value.header.value.replace(/^Bearer /, '');
    assert.equal(written.includes(token), false);
    assert.equal(written.includes(String(asked.value.ticket)), false);
    assert.equal(written.includes(secretReason), false);
  } finally {
    await small.close();
  }
});

test('a ticket nobody answers expires, and an old answer is forgotten', async () => {
  assert.ok(startSession(desk, { id: 's-expiry', engine: 'claude-code' }).ok);
  let time = 1_000_000;
  const broker = createDialogBroker({
    desk: () => ({ ok: true, value: desk }),
    manifest: () => context.manifest,
    log: context.log,
    now: () => time,
    limits: { pendingTicketTtlMs: 1_000, answeredTicketTtlMs: 5_000 },
  });
  const own = broker.forSession('s-expiry');
  const asked = own.requestWriting({ targets: [LORE], reason: 'Write.' });
  assert.ok(asked.ok);
  time += 1_500;
  const expired = await own.awaitAnswer(asked.value.ticket, { waitMs: 0 });
  assert.ok(expired.ok);
  assert.deepEqual(
    [expired.value.status, 'reason' in expired.value && expired.value.reason],
    ['cancelled', 'expired'],
  );
  assert.equal(broker.answerWriting(asked.value.ticket, { confirm: true }).ok, false);
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);
  time += 6_000;
  const forgotten = await own.awaitAnswer(asked.value.ticket, { waitMs: 0 });
  assert.equal(!forgotten.ok && forgotten.error.kind, 'unknown-ticket');

  // A session the desk does not know gets no ticket.
  const stranger = broker.forSession('s-not-on-the-desk');
  assert.equal(stranger.requestWriting({ targets: [LORE], reason: 'Write.' }).ok, false);
  assert.equal(stranger.requestGate({ process: 'p', step: 's', question: 'q' }).ok, false);
});

test('closing the Space cancels what waits and takes the sessions off the server', async () => {
  // A long wait, so the call is open when the server closes: this test builds its own server.
  const own = createSessionServer({
    host: async () => host,
    broker: {
      desk: () => ({ ok: true, value: desk }),
      manifest: () => context.manifest,
      log: context.log,
    },
    awaitMs: 5_000,
  });
  assert.ok(startSession(desk, { id: 's-closing', engine: 'claude-code' }).ok);
  const connection = await own.registerSession('s-closing');
  assert.ok(connection.ok);
  const client = await connect(connection.value);
  const ticket = await ticketOf(
    call(client, 'request_gate', { process: 'work', step: 'report', question: 'Republish?' }),
  );
  const waiting = call(client, 'await_answer', { ticket });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await own.close();
  const { value } = await waiting;
  assert.equal(value.status, 'cancelled');
  assert.equal(value.reason, 'companion-closed');
  const answers = listGateAnswers(desk, 's-closing');
  assert.ok(answers.ok);
  assert.equal(answers.value.length, 0);
  await assert.rejects(call(client, 'await_answer', { ticket }));
  const gone = await raw({
    path: new URL(connection.value.url).pathname,
    headers: { [connection.value.header.name]: connection.value.header.value },
    body: LIST_TOOLS,
  });
  assert.equal(gone.status, 404);
});

test('the service ends with the last window of the Space', async () => {
  const client = await connect(await start('s-window'));
  const ticket = await ticketOf(
    call(client, 'request_writing', { targets: [LORE], reason: 'Write.' }),
  );
  for (const window of windows) await harness.space.host.windowClosed(window.id);
  assert.equal(server.broker.pending().length, 0);
  assert.equal(server.broker.answerWriting(ticket, { confirm: true }).ok, false);
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);
  await assert.rejects(call(client, 'await_answer', { ticket }));
  const late = await server.registerSession('s-late');
  assert.equal(!late.ok && late.error.kind, 'closed');
});

/** Whether a TCP connection to `address` on the server's port is accepted. */
function accepts(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectSocket({ host: address, port });
    const done = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(500, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

test('the server listens on 127.0.0.1 only, and a body that comes too slowly is refused', async () => {
  assert.equal(await accepts('127.0.0.1'), true);
  const others = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.address !== '127.0.0.1')
    .map((entry) => entry.address.split('%')[0] ?? entry.address);
  const addresses = ['::1', ...others];
  const accepted = await Promise.all(addresses.map(accepts));
  assert.deepEqual(
    addresses.filter((_, index) => accepted[index]),
    [],
  );

  const own = createSessionServer({
    host: async () => host,
    broker: {
      desk: () => ({ ok: true, value: desk }),
      manifest: () => context.manifest,
      log: context.log,
    },
    bodyTimeoutMs: 100,
  });
  try {
    const connection = await own.registerSession('s-slow');
    assert.ok(connection.ok);
    const path = new URL(connection.value.url).pathname;
    // The headers promise 200 bytes; ten arrive, and then nothing.
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connectSocket({ host: '127.0.0.1', port });
      let received = '';
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('utf8');
      });
      socket.on('close', () => resolve(received));
      socket.on('error', reject);
      socket.setTimeout(5_000, () => socket.destroy());
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n${connection.value.header.name}: ${connection.value.header.value}\r\nContent-Length: 200\r\n\r\n{"jsonrpc"`,
      );
    });
    assert.match(answer, /^HTTP\/1\.1 408 /);
    // The server still answers.
    const auth = { [connection.value.header.name]: connection.value.header.value };
    assert.equal((await raw({ path, headers: auth, body: LIST_TOOLS })).status, 200);
  } finally {
    await own.close();
  }
});

test('a token dies with its registration, and one id is one session', async () => {
  const first = await start('s-token');
  const path = new URL(first.url).pathname;
  const firstAuth = { [first.header.name]: first.header.value };
  assert.equal((await raw({ path, headers: firstAuth, body: LIST_TOOLS })).status, 200);
  const twice = await server.registerSession('s-token');
  assert.equal(!twice.ok && twice.error.kind, 'already-registered');

  await server.unregisterSession('s-token');
  assert.equal((await raw({ path, headers: firstAuth, body: LIST_TOOLS })).status, 404);
  const second = await server.registerSession('s-token');
  assert.ok(second.ok);
  assert.notEqual(second.value.header.value, first.header.value);
  assert.equal((await raw({ path, headers: firstAuth, body: LIST_TOOLS })).status, 404);
  const secondAuth = { [second.value.header.name]: second.value.header.value };
  assert.equal((await raw({ path, headers: secondAuth, body: LIST_TOOLS })).status, 200);

  for (const id of ['', '../s', 's/../t', 'a b', `s${'x'.repeat(200)}`]) {
    const refused = await server.registerSession(id);
    assert.equal(!refused.ok && refused.error.kind, 'invalid-session-id', id);
  }

  // The read-only helper's session keeps its path, its token and its three tools.
  await host.register({ sessionId: 's-helper', token: 'helper-token', onReport: () => {} });
  const taken = await server.registerSession('s-helper');
  assert.equal(!taken.ok && taken.error.kind, 'server-unavailable');
  await server.unregisterSession('s-helper');
  const helperAuth = { authorization: 'Bearer helper-token' };
  const helperTools = await raw({ path: '/mcp/s-helper', headers: helperAuth, body: LIST_TOOLS });
  assert.equal(helperTools.status, 200);
  assert.match(helperTools.body, /report_dashboard/);
  for (const name of SESSION_TOOL_NAMES) assert.equal(helperTools.body.includes(name), false);
  const sessionTools = await raw({ path, headers: secondAuth, body: LIST_TOOLS });
  assert.equal(sessionTools.body.includes('report_'), false);
  // Neither token opens the other's path.
  assert.equal((await raw({ path, headers: helperAuth, body: LIST_TOOLS })).status, 404);
  const crossed = await raw({ path: '/mcp/s-helper', headers: secondAuth, body: LIST_TOOLS });
  assert.equal(crossed.status, 401);
});

test('the Human Lead confirms what was asked or less, once, and only while the session lives', async () => {
  const client = await connect(await start('s-subset'));
  const app = { kind: 'repository', name: 'app', branch: 'feature/3-thing' } as const;
  const ticket = await ticketOf(
    call(client, 'request_writing', { targets: [app], reason: 'Change the code.' }),
  );
  // More than was asked, another target, and nothing at all: not accepted, and the ticket still waits.
  for (const targets of [[app, LORE], [LORE], []]) {
    const widened = server.broker.answerWriting(ticket, { confirm: true, targets });
    assert.equal(!widened.ok && widened.error.kind, 'invalid-request');
  }
  assert.equal(server.broker.pending().length, 1);
  let claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);

  // The asked repository on another branch is the Human Lead's to choose.
  const granted = server.broker.answerWriting(ticket, {
    confirm: true,
    targets: [{ ...app, branch: 'feature/3-other' }],
  });
  assert.ok(granted.ok);
  assert.equal(granted.value.granted, true);
  const again = server.broker.answerWriting(ticket, { confirm: false });
  assert.equal(!again.ok && again.error.kind, 'already-answered');
  assert.equal(server.broker.cancel(ticket).ok, false);
  const read = (await call(client, 'await_answer', { ticket })).value;
  assert.equal(read.granted, true);
  assert.deepEqual(
    (read.claims as Array<{ target: unknown }>).map((claim) => claim.target),
    [{ ...app, branch: 'feature/3-other' }],
  );

  // A session whose record on the desk ended: the claim is refused when it is applied, and the answer says so.
  const ended = await connect(await start('s-ended'));
  const late = await ticketOf(
    call(ended, 'request_writing', { targets: [LORE], reason: 'Write.' }),
  );
  assert.ok(endSession(desk, 's-ended').ok);
  const refused = server.broker.answerWriting(late, { confirm: true });
  assert.ok(refused.ok);
  assert.equal(refused.value.granted, false);
  assert.equal('reason' in refused.value && refused.value.reason, 'refused');

  // A session that is gone: its ticket is gone with it.
  const leaving = await connect(await start('s-leaving'));
  const orphan = await ticketOf(
    call(leaving, 'request_writing', { targets: [LORE], reason: 'Write.' }),
  );
  await server.unregisterSession('s-leaving');
  const afterEnd = server.broker.answerWriting(orphan, { confirm: true });
  assert.equal(!afterEnd.ok && afterEnd.error.kind, 'unknown-ticket');
  claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.map((claim) => claim.sessionId),
    ['s-subset'],
  );
});

test('leaving Writing records a session close for each held root', async () => {
  const client = await connect(await start('s-closes'));
  const app = { kind: 'repository', name: 'app', branch: 'feature/4-thing' } as const;
  const ticket = await ticketOf(
    call(client, 'request_writing', { targets: [LORE, app], reason: 'Write both.' }),
  );
  assert.ok(server.broker.answerWriting(ticket, { confirm: true }).ok);

  const left = await call(client, 'leave_writing');
  assert.equal(left.isError, false, JSON.stringify(left.value));
  assert.equal(left.value.mode, 'read-only');
  const closes = listSessionCloses(desk);
  assert.ok(closes.ok);
  assert.deepEqual(
    closes.value.map(({ rootId, commit, sessionId }) => ({ rootId, commit, sessionId })),
    [
      { rootId: 'lore', commit: space.head, sessionId: 's-closes' },
      { rootId: 'repo:app', commit: space.repositories[0]?.headCommit, sessionId: 's-closes' },
    ],
  );
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);
  const record = getSession(desk, 's-closes');
  assert.ok(record.ok);
  assert.equal(record.value?.mode, 'read-only');

  // A session in Read only leaves nothing behind: no second close.
  assert.equal((await call(client, 'leave_writing')).isError, false);
  // The header's Leave Writing action takes the same step.
  const second = await ticketOf(
    call(client, 'request_writing', { targets: [LORE], reason: 'Write again.' }),
  );
  assert.ok(server.broker.answerWriting(second, { confirm: true }).ok);
  const fromHeader = await server.broker.leaveWriting('s-closes');
  assert.ok(fromHeader.ok);
  const after = listSessionCloses(desk);
  assert.ok(after.ok);
  assert.equal(after.value.length, 3);
});
