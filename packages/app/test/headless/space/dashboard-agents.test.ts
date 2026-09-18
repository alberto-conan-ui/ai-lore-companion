import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  DEFAULT_STAGES,
  type Desk,
  SESSION_LABEL,
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
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { spaceGitHub } from '../../../src/main/space/github-service.js';
import { registerSpaceDialogs } from '../../../src/main/space/ipc/dialogs.js';
import { registerSpaceProject } from '../../../src/main/space/ipc/project.js';
import { configureProjectRefresh } from '../../../src/main/space/project-refresh.js';
import {
  type SessionServer,
  configureSessionServer,
  sessionServer,
} from '../../../src/main/space/session-server/index.js';
import type { SpaceProjectState, SpaceProjectStateResult } from '../../../src/shared/ipc.js';
import { SPACE_DIALOGS_CONTRACT } from '../../../src/shared/ipc/space/dialogs.contract.js';
import type { PendingDialogsPayload } from '../../../src/shared/ipc/space/dialogs.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M7.4: what the Dashboard's Agents board and Needs you receive, on the real Space host with
// the real session server (driven by a real MCP client), the refresh service and the fake GitHub.
// No test reaches GitHub.

const OWNER = 'fake-human';
const NAME = 'agents-space';
const SPACE_REPOSITORY = `${OWNER}/${NAME}`;
const PROJECT_PUSH = 'space:on-project-state';

let space: SpaceFixture;
let harness: SpaceHarness;
let host: McpHost;
let server: SessionServer;
let desk: Desk;
let window: FakeSpaceWindow;
let fake: FakeGitHub;
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
  // What setup leaves on GitHub: the repositories, the Project with its Stage and Agents fields, the label.
  fake = createFakeGitHub();
  assert.ok((await fake.createRepository({ owner: OWNER, name: NAME, private: true })).ok);
  assert.ok((await fake.createRepository({ owner: OWNER, name: 'app', private: true })).ok);
  const made = await fake.createProject({ owner: OWNER, title: NAME });
  assert.ok(made.ok);
  const project = made.value;
  for (const [name, options] of [
    ['Stage', DEFAULT_STAGES],
    [AGENTS_FIELD, AGENTS_COLUMNS],
  ] as const) {
    assert.ok((await fake.ensureSingleSelectField({ project, name, options: [...options] })).ok);
  }
  assert.ok(
    (
      await fake.ensureLabels({
        repository: SPACE_REPOSITORY,
        labels: [{ name: SESSION_LABEL, color: 'ededed', description: 'A session' }],
      })
    ).ok,
  );

  host = createMcpHost();
  await host.listen();
  configureSessionServer({ host: async () => host, awaitMs: 60, boardWaitMs: 400 });
  configureProjectRefresh({ intervalMs: 0 });
  harness = spaceHarnessFor((registrar, deps) => {
    registerSpaceDialogs(registrar, deps);
    registerSpaceProject(registrar, deps);
  });
  await harness.space.host.openFolder(undefined, space.root);
  const first = harness.space.created[0];
  assert.ok(first);
  window = first;
  const context = harness.space.host.contextFor({ sender: { id: window.webContents.id } });
  assert.ok(context);
  context.service(spaceGitHub).use(fake);
  server = context.service(sessionServer);
  const opened = context.service(spaceDesk).open();
  assert.ok(opened.ok);
  desk = opened.value;
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const created of harness.space.created) await harness.space.host.windowClosed(created.id);
  configureSessionServer(null);
  configureProjectRefresh(null);
  await host.close();
  harness.cleanup();
  await fake.dispose();
});

async function connect(sessionId: string): Promise<Client> {
  assert.ok(startSession(desk, { id: sessionId, engine: 'claude-code' }).ok);
  const connection = await server.registerSession(sessionId);
  assert.ok(connection.ok);
  const client = new Client({ name: 'test-engine', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(connection.value.url), {
    requestInit: { headers: { [connection.value.header.name]: connection.value.header.value } },
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

async function refresh(): Promise<SpaceProjectState> {
  const answer = (await harness.invoke(
    'spaceProjectRefresh',
    window,
    {},
  )) as SpaceProjectStateResult;
  if (!answer.ok) assert.fail(answer.error.message);
  return answer.value;
}

function lastProjectPush(): SpaceProjectState | undefined {
  return window.sent.filter((m) => m.channel === PROJECT_PUSH).at(-1)?.payload as
    | SpaceProjectState
    | undefined;
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail('the condition was not met in time');
    await delay(10);
  }
}

test('a pending gate is first in Needs you, with the ticket the gate dialog opens', async () => {
  await refresh();
  const client = await connect('s-gate');
  const asked = await call(client, 'request_gate', {
    process: 'specify',
    step: 'confirm',
    question: 'Is the draft agreed?',
    bearsOn: 'workbench/spec.md',
  });
  assert.equal(asked.isError, false, JSON.stringify(asked.value));
  const ticket = asked.value.ticket as string;

  // The Dashboard is told at once, without a refresh of GitHub.
  await until(() => lastProjectPush()?.model?.needsYou[0]?.kind === 'gate');
  const entry = lastProjectPush()?.model?.needsYou[0];
  assert.equal(entry?.kind === 'gate' ? entry.ticket : '', ticket);
  assert.equal(entry?.kind === 'gate' ? entry.question : '', 'Is the draft agreed?');

  // The ticket is a pending gate of the dialogs' list: Needs you's action opens its dialog.
  const pending = (await harness.invoke('spaceDialogsPending', window, {})) as {
    ok: boolean;
    value: PendingDialogsPayload;
  };
  assert.ok(pending.ok);
  const request = pending.value.requests.find((r) => r.ticket === ticket);
  assert.equal(request?.kind, 'gate');

  // Answered in the dialog, it leaves Needs you.
  const answered = (await harness.invoke('spaceDialogAnswerGate', window, {
    ticket,
    answer: 'yes',
  })) as { ok: boolean };
  assert.ok(answered.ok);
  await until(() => lastProjectPush()?.model?.needsYou.every((e) => e.kind !== 'gate') === true);
  const dialogPushes = window.sent.filter(
    (m) => m.channel === SPACE_DIALOGS_CONTRACT.onSpaceDialogsPending.channel,
  );
  assert.equal((dialogPushes.at(-1)?.payload as PendingDialogsPayload).requests.length, 0);
});

test('a session that enters Writing is on the Agents board after the next refresh', async () => {
  const item = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'An item',
    body: 'The criteria.',
    labels: [],
  });
  assert.ok(item.ok);
  const before = await refresh();
  assert.deepEqual(before.model?.board, []);

  const client = await connect('s-write');
  const asked = await call(client, 'request_writing', {
    targets: [{ kind: 'lore' }],
    item: item.value.number,
    reason: 'Build the item.',
  });
  assert.equal(asked.isError, false, JSON.stringify(asked.value));
  const ticket = asked.value.ticket as string;
  const confirmed = server.broker.answerWriting(ticket, { confirm: true });
  assert.ok(confirmed.ok && confirmed.value.granted);
  const granted = (await call(client, 'await_answer', { ticket })).value;
  assert.equal((granted.board as { updated: boolean }).updated, true, JSON.stringify(granted));

  const after = await refresh();
  const rows = after.model?.board ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.column, 'Writing');
  assert.match(rows[0]?.title ?? '', /^The claude-code session that started at /);
  assert.equal(rows[0]?.stale, false);
  assert.equal(rows[0]?.local?.sessionId, 's-write');
  assert.equal(rows[0]?.local?.item?.number, item.value.number);
  assert.equal(rows[0]?.gateTicket, null);
});
