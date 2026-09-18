import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  type Desk,
  type EngineEntry,
  type ProjectInfo,
  SESSION_LABEL,
  execFileRunner,
  getSession,
  installClaudeCode,
  listClaims,
  listGateAnswers,
  readLore,
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
import type { RegisterModule } from '../../../src/main/ipc/types.js';
import type { PtyService } from '../../../src/main/pty.js';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { spaceGitHub } from '../../../src/main/space/github-service.js';
import { registerSpaceDialogs } from '../../../src/main/space/ipc/dialogs.js';
import { createSpaceSessionsRegister } from '../../../src/main/space/ipc/sessions.js';
import { configureSessionServer } from '../../../src/main/space/session-server/index.js';
import { type SessionFilePaths, sessionFilePaths } from '../../../src/main/space/sessions/files.js';
import type { SpaceSessionHeaderResult, SpaceSessionStartResult } from '../../../src/shared/ipc.js';
import { SPACE_DIALOGS_CONTRACT } from '../../../src/shared/ipc/space/dialogs.contract.js';
import type {
  PendingDialogsPayload,
  SpaceDialogsResult,
  WritingDialogView,
} from '../../../src/shared/ipc/space/dialogs.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M4.8: one test per line of the M4 stage gate, through the whole path a guarded
// session takes in the app. The session is started by the sessions IPC, which writes its
// settings, hooks and MCP configuration; the "engine" is a real MCP client that reads the
// generated mcp.json, and the generated hook command is run through a shell with the JSON
// Claude Code gives a hook, from a folder that is not the Space. The Human Lead's answers
// go through the dialogs IPC from the Space window. GitHub is the fake. The real engine is
// not started here; see the phase file of M4.8 for the run with it.

const OWNER = 'fake-human';
const NAME = 'guards-space';
const SPACE_REPOSITORY = `${OWNER}/${NAME}`;
const APP_MAIN = { kind: 'repository', name: 'app', branch: 'main' } as const;
const ENGINES: EngineEntry[] = [{ id: 'claude-code', name: 'Claude Code', binary: 'claude' }];

let space: SpaceFixture;
/** A working folder for hooks that is not the Space. */
let elsewhere: string;
let fake: FakeGitHub;
let project: ProjectInfo;
let mcp: McpHost;
let harness: SpaceHarness;
let spaceWindow: FakeSpaceWindow;
let context: SpaceContext;
let desk: Desk;
const clients: Client[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: NAME,
    owner: OWNER,
    project: 1,
    repositories: ['app', 'lib'],
  });
  elsewhere = mkdtempSync(join(tmpdir(), "m4-8 hook's cwd "));
});

after(() => {
  space.cleanup();
  rmSync(elsewhere, { recursive: true, force: true });
});

beforeEach(async () => {
  fake = createFakeGitHub();
  assert.ok((await fake.createRepository({ owner: OWNER, name: NAME, private: true })).ok);
  assert.ok((await fake.createRepository({ owner: OWNER, name: 'app', private: true })).ok);
  const made = await fake.createProject({ owner: OWNER, title: NAME });
  assert.ok(made.ok);
  project = made.value;
  assert.ok(
    (
      await fake.ensureSingleSelectField({
        project,
        name: AGENTS_FIELD,
        options: [...AGENTS_COLUMNS],
      })
    ).ok,
  );
  assert.ok(
    (
      await fake.ensureLabels({
        repository: SPACE_REPOSITORY,
        labels: [{ name: SESSION_LABEL, color: 'ededed', description: 'A session' }],
      })
    ).ok,
  );

  mcp = createMcpHost();
  await mcp.listen();
  configureSessionServer({ host: async () => mcp, awaitMs: 60, boardWaitMs: 400 });
  const sessions = createSpaceSessionsRegister(() => ({
    engines: () => ENGINES,
    loginPath: async () => null,
    runner: () => execFileRunner,
    newId: () => `s-gate-${Math.random().toString(16).slice(2, 8)}`,
  }));
  const both: RegisterModule = (reg, deps) => {
    sessions(reg, deps);
    registerSpaceDialogs(reg, deps);
  };
  harness = spaceHarnessFor(both);
  await harness.space.host.openFolder(undefined, space.root);
  const first = harness.space.created[0];
  assert.ok(first);
  spaceWindow = first;
  const found = harness.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(found);
  context = found;
  context.service(spaceGitHub).use(fake);
  let spawned = 0;
  context.ptyService = {
    spawn: () => `pty-${++spawned}`,
    write: () => {},
    resize: () => {},
    kill: () => {},
    killAll: () => {},
    hasRunningTask: () => false,
  } as unknown as PtyService;
  const opened = context.service(spaceDesk).open();
  assert.ok(opened.ok);
  desk = opened.value;
  const lore = await readLore(space.root);
  assert.ok(lore.ok);
  assert.ok((await installClaudeCode(lore.value, context.desk.install)).ok);
  // The dialog's list of pending requests, as the renderer asks for it when the window loads.
  await dialogs('spaceDialogsPending', {});
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const window of harness.space.created) await harness.space.host.windowClosed(window.id);
  configureSessionServer(null);
  await mcp.close();
  harness.cleanup();
  await fake.dispose();
  git('app', 'checkout', '-q', 'main');
});

function git(repository: string, ...args: string[]): void {
  const done = spawnSync('git', ['-C', join(space.root, 'repos', repository), ...args], {
    encoding: 'utf8',
  });
  assert.equal(done.status, 0, done.stderr);
}

async function dialogs<T>(key: string, arg: unknown): Promise<SpaceDialogsResult<T>> {
  return (await harness.invoke(key, spaceWindow, arg)) as SpaceDialogsResult<T>;
}

type Session = { id: string; files: SessionFilePaths; client: Client };

/** Start a session as the AI tab does, and connect to the local server as the engine does: from mcp.json. */
async function startGuardedSession(): Promise<Session> {
  const started = (await harness.invoke('spaceSessionStart', spaceWindow, {
    engineId: 'claude-code',
  })) as SpaceSessionStartResult;
  assert.ok(started.ok, JSON.stringify(started));
  const id = started.value.sessionId;
  const files = sessionFilePaths(context.desk.sessions, id);
  const config = JSON.parse(readFileSync(files.mcp, 'utf8')) as {
    mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
  };
  const server = Object.values(config.mcpServers)[0];
  assert.ok(server);
  const client = new Client({ name: 'engine-stand-in', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    }),
  );
  clients.push(client);
  return { id, files, client };
}

async function tool(session: Session, name: string, args: Record<string, unknown> = {}) {
  const result = await session.client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
  return { isError: result.isError === true, value: JSON.parse(text) as Record<string, unknown> };
}

/** Read the answer as the session does: call `await_answer` again while it is pending. */
async function awaitAnswer(session: Session, ticket: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 50; i++) {
    const read = await tool(session, 'await_answer', { ticket });
    if (read.value.status !== 'pending') return read.value;
  }
  assert.fail('the answer never came');
}

/** The dialog's current list of pending requests, from the last push to the Space window. */
function pendingInWindow(): PendingDialogsPayload['requests'] {
  const channel = SPACE_DIALOGS_CONTRACT.onSpaceDialogsPending.channel;
  const last = spaceWindow.sent.filter((message) => message.channel === channel).at(-1);
  return (last?.payload as PendingDialogsPayload | undefined)?.requests ?? [];
}

/** The session asks for Writing; the Human Lead confirms `confirm` in the dialog; the session reads the answer. */
async function enterWritingThroughDialog(
  session: Session,
  asked: Record<string, unknown>,
  confirm: unknown[],
): Promise<Record<string, unknown>> {
  const request = await tool(session, 'request_writing', asked);
  assert.equal(request.isError, false, JSON.stringify(request.value));
  const ticket = request.value.ticket as string;
  assert.ok(
    pendingInWindow().some((entry) => entry.ticket === ticket && entry.kind === 'writing'),
    'the dialog is opened in the Space window',
  );
  const answered = await dialogs('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: confirm,
  });
  assert.ok(answered.ok, JSON.stringify(answered));
  return awaitAnswer(session, ticket);
}

type Decision = { decision: string; reason: string };

/** Run the session's generated before-write hook as Claude Code does: through a shell, from another folder. */
function hook(session: Session, tool_name: string, file: string): Decision {
  const settings = JSON.parse(readFileSync(session.files.settings, 'utf8')) as {
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };
  const command = settings.hooks.PreToolUse[0]?.hooks[0]?.command;
  assert.ok(command);
  const path = join(space.root, file);
  const toolInput =
    tool_name === 'Edit'
      ? { file_path: path, old_string: 'a', new_string: 'b', replace_all: false }
      : { file_path: path, content: 'x' };
  const done = spawnSync('/bin/sh', ['-c', command], {
    cwd: elsewhere,
    encoding: 'utf8',
    timeout: 30_000,
    input: JSON.stringify({
      session_id: '5a1b2c3d-0000-4000-8000-000000000000',
      transcript_path: '/nowhere/transcript.jsonl',
      cwd: space.root,
      prompt_id: 'p',
      permission_mode: 'default',
      hook_event_name: 'PreToolUse',
      tool_name,
      tool_input: toolInput,
      tool_use_id: 'toolu_1',
    }),
  });
  assert.equal(done.status, 0, done.stderr);
  const out = JSON.parse(done.stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    decision: out.hookSpecificOutput.permissionDecision,
    reason: out.hookSpecificOutput.permissionDecisionReason,
  };
}

async function header(session: Session) {
  const read = (await harness.invoke('spaceSessionHeader', spaceWindow, {
    sessionId: session.id,
  })) as SpaceSessionHeaderResult;
  assert.ok(read.ok);
  return read.value;
}

test('A session in Read only that tries to edit a file under repos/ or lore/ is refused, and the refusal names the mode', async () => {
  const session = await startGuardedSession();
  const record = getSession(desk, session.id);
  assert.equal(record.ok && record.value?.mode, 'read-only', 'a session starts in Read only');
  assert.equal((await header(session)).mode, 'read-only');

  for (const [tool_name, file] of [
    ['Edit', 'repos/app/README.md'],
    ['Write', 'repos/lib/src/new.ts'],
    ['Edit', 'lore/space.md'],
    ['Write', 'lore/verbs/new-verb.md'],
  ] as const) {
    const refused = hook(session, tool_name, file);
    assert.equal(refused.decision, 'deny', `${tool_name} ${file}`);
    assert.match(refused.reason, /Read only/, `${tool_name} ${file}: the refusal names the mode`);
  }
  // The Workbench is the one place a session in Read only writes.
  const workbench = hook(session, 'Write', 'workbench/scratch/note.md');
  assert.equal(workbench.decision, 'allow', workbench.reason);
});

test('After entering Writing on one repository and branch, an edit to another repository, to the Lore, or on another branch is refused; an edit inside the claim succeeds', async () => {
  const session = await startGuardedSession();
  const answer = await enterWritingThroughDialog(
    session,
    { targets: [APP_MAIN], reason: 'Change the app.' },
    [APP_MAIN],
  );
  assert.equal(answer.granted, true, JSON.stringify(answer));
  // The claim is recorded on the desk, and the header shows it.
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.filter((claim) => claim.sessionId === session.id).map((claim) => claim.target),
    [APP_MAIN],
  );
  const shown = await header(session);
  assert.equal(shown.mode, 'writing');
  assert.deepEqual(shown.targets, [APP_MAIN]);

  const inside = hook(session, 'Edit', 'repos/app/README.md');
  assert.equal(inside.decision, 'allow', inside.reason);
  for (const file of ['repos/lib/README.md', 'lore/space.md']) {
    const refused = hook(session, 'Edit', file);
    assert.equal(refused.decision, 'deny', file);
    assert.match(refused.reason, /Writing/, file);
  }
  // Another branch checked out in the claimed repository: the claim does not cover it.
  git('app', 'checkout', '-q', '-b', 'm4-8-other');
  const otherBranch = hook(session, 'Edit', 'repos/app/README.md');
  assert.equal(otherBranch.decision, 'deny');
  assert.match(otherBranch.reason, /"main"/);
  assert.match(otherBranch.reason, /m4-8-other/);
  git('app', 'checkout', '-q', 'main');
  git('app', 'branch', '-q', '-D', 'm4-8-other');

  // leave_writing gives the session Read only again, on the desk and in the header.
  const left = await tool(session, 'leave_writing');
  assert.equal(left.value.mode, 'read-only');
  assert.equal((await header(session)).mode, 'read-only');
  assert.equal(hook(session, 'Edit', 'repos/app/README.md').decision, 'deny');
});

test('A second session asking for the same repository sees it held and cannot take it', async () => {
  const holder = await startGuardedSession();
  const asker = await startGuardedSession();
  const held = await enterWritingThroughDialog(
    holder,
    { targets: [APP_MAIN], reason: 'Change the app.' },
    [APP_MAIN],
  );
  assert.equal(held.granted, true);

  const request = await tool(asker, 'request_writing', {
    targets: [{ kind: 'repository', name: 'app', branch: 'feature/other' }],
    reason: 'Change the app too.',
  });
  assert.equal(request.isError, false, JSON.stringify(request.value));
  const ticket = request.value.ticket as string;
  // The dialog shows the repository held, by what the holder's header shows.
  const view = await dialogs<WritingDialogView>('spaceDialogWritingView', { ticket });
  assert.ok(view.ok);
  const row = view.value.targets.find((target) => target.name === 'app');
  assert.match(row?.heldBy ?? '', /^the claude-code session that started at /);
  // Confirming a held target is refused, and the request stays open.
  const confirmed = await dialogs('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'repository', name: 'app', branch: 'feature/other' }],
  });
  assert.equal(confirmed.ok ? '' : confirmed.error.kind, 'target-held');
  assert.equal((await tool(asker, 'await_answer', { ticket })).value.status, 'pending');
  // The Human Lead can only decline; the session reads that it was not granted.
  assert.ok((await dialogs('spaceDialogAnswerWriting', { ticket, confirm: false })).ok);
  const answer = await awaitAnswer(asker, ticket);
  assert.equal(answer.granted, false);

  const record = getSession(desk, asker.id);
  assert.equal(record.ok && record.value?.mode, 'read-only');
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.map((claim) => claim.sessionId),
    [holder.id],
  );
  assert.equal(hook(asker, 'Edit', 'repos/app/README.md').decision, 'deny');
});

test("A gate answered in the dialog is in the desk's record with the process, the step and the answer; the session receives it", async () => {
  const session = await startGuardedSession();
  for (const [step, answer] of [
    ['confirm', 'yes'],
    ['review', 'no'],
    ['merge', 'take-over'],
  ] as const) {
    const request = await tool(session, 'request_gate', {
      process: 'build',
      step,
      question: `Is the ${step} step agreed?`,
      bearsOn: 'workbench/plan.md',
    });
    assert.equal(request.isError, false, JSON.stringify(request.value));
    const ticket = request.value.ticket as string;
    assert.ok(pendingInWindow().some((entry) => entry.ticket === ticket && entry.kind === 'gate'));
    assert.ok((await dialogs('spaceDialogAnswerGate', { ticket, answer })).ok);

    // Recorded by the companion before the session reads it.
    const recorded = listGateAnswers(desk, session.id);
    assert.ok(recorded.ok);
    const entry = recorded.value.find((gate) => gate.step === step);
    assert.deepEqual([entry?.process, entry?.step, entry?.answer], ['build', step, answer]);

    const read = await awaitAnswer(session, ticket);
    assert.equal(read.status, 'answered');
    assert.equal(read.answer, answer);
    assert.equal(read.id, entry?.id);
  }
});

test("The session's issue exists on the Project with its targets and ends in Done at session-close", async () => {
  const item = await fake.createIssue({
    repository: SPACE_REPOSITORY,
    title: 'An item',
    body: 'The criteria.',
    labels: [],
  });
  assert.ok(item.ok);
  const session = await startGuardedSession();
  const target = { kind: 'repository', name: 'app', branch: 'feature/1-item' } as const;
  const answer = await enterWritingThroughDialog(
    session,
    { targets: [target], item: item.value.number, reason: 'Build the item.' },
    [target],
  );
  assert.equal(answer.granted, true);
  const rows = async () => {
    const read = await fake.readProject({ project });
    assert.ok(read.ok);
    return read.value.sessions;
  };
  let on = await rows();
  assert.equal(on.length, 1);
  assert.equal(on[0]?.column, 'Writing');
  assert.deepEqual(on[0]?.targets, [target]);

  // The session writes its journal entry, whose name ends with its id, then the tab ends it.
  const journal = context.paths.journal;
  mkdirSync(journal, { recursive: true });
  const entry = join(journal, `2026-09-18-1200-gate-${session.id}.md`);
  writeFileSync(entry, '# Gate\n\nDid it.\n\n## Handover\n\nDone: the item.\n');
  try {
    const ended = (await harness.invoke('spaceSessionEnd', spaceWindow, {
      sessionId: session.id,
    })) as { ok: boolean };
    assert.equal(ended.ok, true, JSON.stringify(ended));
  } finally {
    rmSync(entry);
  }
  on = await rows();
  assert.equal(on[0]?.column, 'Done');
  const issue = fake.state().issues.find((i) => i.ref.number === on[0]?.issue.number);
  assert.equal(issue?.comments.at(-1), '## Handover\n\nDone: the item.\n');
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0, 'the close released the claim');
});
