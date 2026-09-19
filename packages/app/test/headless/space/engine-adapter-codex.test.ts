/**
 * The Codex CLI adapter (phase M10.7, `m10-architecture.md` 5 M10.7): its
 * `launch` (the command line, the `-c` hook values, the environment, no
 * files), and the before-write adapter run as a child process with
 * `--dialect codex`, fed the JSON Codex's `PreToolUse` hook gives.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  type Desk,
  type DeskPaths,
  deskPaths,
  execFileRunner,
  installClaudeCode,
  openDesk,
  readLore,
  startSession,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import { shellCommandLine } from '../../../src/main/space/sessions/command-line.js';
import { codexAdapter } from '../../../src/main/space/sessions/engines/codex.js';
import { sessionInstructions } from '../../../src/main/space/sessions/engines/instructions.js';
import { readInstalledSkills } from '../../../src/main/space/sessions/engines/skills.js';
import {
  type SessionFilePaths,
  removeSessionFiles,
  sessionFilePaths,
  writeSessionFiles,
} from '../../../src/main/space/sessions/files.js';
import { findPython3, verifyInstall } from '../../../src/main/space/sessions/preflight.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

const CONNECTION: SessionConnection = {
  sessionId: 'unused',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-codex',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

/** A fixture install, for the tests that do not need a real installed Lore. */
const FAKE_INSTALL = {
  pluginDir: '/install/claude-code/plugin',
  beforeChecks: ['/install/checks/write-guard.py'],
  afterChecks: [],
};

function preToolUseValue(args: readonly string[]): string {
  const arg = args.find((a) => a.startsWith('hooks.PreToolUse='));
  assert.ok(arg, 'hooks.PreToolUse is on the command line');
  return (arg as string).slice('hooks.PreToolUse='.length);
}

function postToolUseValue(args: readonly string[]): string {
  const arg = args.find((a) => a.startsWith('hooks.PostToolUse='));
  assert.ok(arg, 'hooks.PostToolUse is on the command line');
  return (arg as string).slice('hooks.PostToolUse='.length);
}

/**
 * The shell command line of a `-c hooks.<Event>=…` TOML value built by
 * `codexAdapter.launch` (`[{matcher="…",hooks=[{type="command",command=<json>,timeout=N}]}]`).
 */
function hookCommandOf(tomlValue: string): string {
  const match = tomlValue.match(
    /^\[\{matcher="[^"]*",hooks=\[\{type="command",command=(.*),timeout=\d+\}\]\}\]$/,
  );
  assert.ok(match, tomlValue);
  return JSON.parse((match as RegExpMatchArray)[1] as string) as string;
}

test('launch: the args after the parameters, in the order of section 5 M10.7 item 1; no token in any argument; AI_LORE_MCP_HEADER in env; no files', () => {
  const filePaths = sessionFilePaths('/sessions', 's-codex');
  const launch = codexAdapter.launch({
    sessionId: 's-codex',
    spaceRoot: '/space',
    deskDir: '/desk',
    paths: filePaths,
    python: '/usr/bin/python3',
    install: FAKE_INSTALL,
    skills: [],
    connection: CONNECTION,
    repositories: [],
    instructions: 'Session instructions, for the test.\n',
    paramArgv: ['--model', 'opus'],
  });

  assert.deepEqual(launch.args.slice(0, 2), ['--model', 'opus']);
  const rest = launch.args.slice(2);
  assert.deepEqual(rest.slice(0, 4), [
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'on-request',
  ]);
  assert.equal(rest[4], '--dangerously-bypass-hook-trust');
  const pairs: [string, RegExp][] = [
    ['-c', /^developer_instructions=/],
    ['-c', /^mcp_servers\.ailore\.url=/],
    ['-c', /^mcp_servers\.ailore\.env_http_headers=/],
    ['-c', /^mcp_servers\.ailore\.tool_timeout_sec=120$/],
    ['-c', /^hooks\.PreToolUse=/],
    ['-c', /^hooks\.PostToolUse=/],
  ];
  let index = 5;
  for (const [flag, pattern] of pairs) {
    assert.equal(rest[index], flag, `argument ${index}`);
    assert.match(rest[index + 1] as string, pattern, `argument ${index + 1}`);
    index += 2;
  }
  assert.equal(rest.length, index, 'no argument after the last -c value');

  assert.ok(!launch.args.join(' ').includes('secret-token'), 'no token in any argument');
  assert.deepEqual(launch.env, { AI_LORE_MCP_HEADER: 'Bearer secret-token-for-the-test' });
  assert.deepEqual(launch.files, []);
});

test('launch: the -c values quote the instructions and the connection fields as TOML basic strings (JSON.stringify)', () => {
  const instructions = 'A line with a "quote", a \\ backslash and a\nnewline.\n';
  const connection: SessionConnection = {
    ...CONNECTION,
    url: 'http://127.0.0.1:4242/mcp/s-toml?x=1&y=2',
  };
  const filePaths = sessionFilePaths('/sessions', 's-toml');
  const launch = codexAdapter.launch({
    sessionId: 's-toml',
    spaceRoot: '/space',
    deskDir: '/desk',
    paths: filePaths,
    python: '/usr/bin/python3',
    install: FAKE_INSTALL,
    skills: [],
    connection,
    repositories: [],
    instructions,
    paramArgv: [],
  });

  const developer = launch.args.find((a) => a.startsWith('developer_instructions='));
  assert.equal(developer, `developer_instructions=${JSON.stringify(instructions)}`);
  const url = launch.args.find((a) => a.startsWith('mcp_servers.ailore.url='));
  assert.equal(url, `mcp_servers.ailore.url=${JSON.stringify(connection.url)}`);
  const headers = launch.args.find((a) => a.startsWith('mcp_servers.ailore.env_http_headers='));
  assert.equal(headers, 'mcp_servers.ailore.env_http_headers={authorization="AI_LORE_MCP_HEADER"}');
});

test('launch: a header name that is not a bare TOML key is quoted', () => {
  const connection: SessionConnection = {
    ...CONNECTION,
    header: { name: 'X Custom Header', value: 'secret' },
  };
  const filePaths = sessionFilePaths('/sessions', 's-header');
  const launch = codexAdapter.launch({
    sessionId: 's-header',
    spaceRoot: '/space',
    deskDir: '/desk',
    paths: filePaths,
    python: '/usr/bin/python3',
    install: FAKE_INSTALL,
    skills: [],
    connection,
    repositories: [],
    instructions: 'x\n',
    paramArgv: [],
  });
  const headers = launch.args.find((a) => a.startsWith('mcp_servers.ailore.env_http_headers='));
  assert.equal(
    headers,
    `mcp_servers.ailore.env_http_headers={${JSON.stringify('X Custom Header')}="AI_LORE_MCP_HEADER"}`,
  );
});

test('launch: the -c hooks values carry --dialect codex and the timeouts of PRE/POST_WRITE_TIMEOUTS', () => {
  const filePaths = sessionFilePaths('/sessions', 's-timeouts');
  const launch = codexAdapter.launch({
    sessionId: 's-timeouts',
    spaceRoot: '/space',
    deskDir: '/desk',
    paths: filePaths,
    python: '/usr/bin/python3',
    install: FAKE_INSTALL,
    skills: [],
    connection: CONNECTION,
    repositories: [],
    instructions: 'x\n',
    paramArgv: [],
  });
  const preValue = preToolUseValue(launch.args);
  const postValue = postToolUseValue(launch.args);
  assert.match(preValue, /^\[\{matcher="\^\(apply_patch\|Edit\|Write\)\$"/);
  assert.match(preValue, /,timeout=60\}\]\}\]$/);
  assert.match(postValue, /,timeout=90\}\]\}\]$/);
  const preCommand = hookCommandOf(preValue);
  const postCommand = hookCommandOf(postValue);
  assert.match(preCommand, /'--dialect' 'codex'/);
  assert.match(postCommand, /'--dialect' 'codex'/);
  assert.match(preCommand, /'--request-tool' 'mcp__ailore__request_writing'/);
  assert.ok(!postCommand.includes('--request-tool'), 'the after-write hook asks for no target');
  assert.equal(shellCommandLine(['--dialect', 'codex']), "'--dialect' 'codex'");
});

let space: SpaceFixture;
let base: string;
let hookCwd: string;
let paths: DeskPaths;
let desk: Desk;
let python: string;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'codex-space' });
  base = mkdtempSync(join(tmpdir(), 'm10-7-codex-'));
  hookCwd = join(base, 'hook-cwd');
  mkdirSync(hookCwd, { recursive: true });
  paths = deskPaths(base, space.root);
  const lore = await readLore(space.root);
  assert.ok(lore.ok);
  const installed = await installClaudeCode(lore.value, paths.install);
  assert.ok(installed.ok, installed.ok ? '' : installed.error.message);
  const opened = openDesk(paths);
  assert.ok(opened.ok);
  desk = opened.value;
  const found = await findPython3(execFileRunner, null, space.root);
  assert.ok(found.ok, 'python3 is needed by these tests');
  python = found.value;
});

after(() => {
  space.cleanup();
  rmSync(base, { recursive: true, force: true });
});

/** Build and write a Codex session's files, returning its pre-write hook's shell command. */
async function codexPreWriteCommand(sessionId: string): Promise<string> {
  await removeSessionFiles(paths.sessions, sessionId);
  const filePaths: SessionFilePaths = sessionFilePaths(paths.sessions, sessionId);
  const verified = await verifyInstall(paths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);
  const skills = await readInstalledSkills(paths.install, space.root);
  const instructions = sessionInstructions({
    spaceRoot: space.root,
    skills,
    adapter: codexAdapter,
  });
  const launch = codexAdapter.launch({
    sessionId,
    spaceRoot: space.root,
    deskDir: paths.desk,
    paths: filePaths,
    python,
    install: verified.value,
    skills,
    connection: { ...CONNECTION, sessionId },
    repositories: [],
    instructions,
    paramArgv: [],
  });
  await writeSessionFiles(paths.sessions, { sessionId }, launch);
  return hookCommandOf(preToolUseValue(launch.args));
}

function runHook(command: string, input: string): { status: number | null; stdout: string } {
  const done = spawnSync('/bin/sh', ['-c', command], {
    input,
    cwd: hookCwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: done.status, stdout: done.stdout };
}

function codexInput(command: string, cwd: string): string {
  return JSON.stringify({ tool_name: 'apply_patch', tool_input: { command }, cwd });
}

function preDecision(result: { status: number | null; stdout: string }): {
  decision: string;
  reason: string;
} {
  assert.equal(result.status, 0, 'the adapter always ends with exit code 0');
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return {
    decision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

test('the before-write adapter, --dialect codex: an Add File into lore/ of a Read only session is denied', async () => {
  assert.ok(startSession(desk, { id: 's-cx-ro', engine: 'default.codex' }).ok);
  const command = await codexPreWriteCommand('s-cx-ro');
  const patch = '*** Begin Patch\n*** Add File: lore/x.md\n+x\n*** End Patch';
  const result = runHook(command, codexInput(patch, space.root));
  const decision = preDecision(result);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /Read only/);
});

test('the before-write adapter, --dialect codex: an Add File into workbench/ prints nothing and exits 0', async () => {
  assert.ok(startSession(desk, { id: 's-cx-wb', engine: 'default.codex' }).ok);
  const command = await codexPreWriteCommand('s-cx-wb');
  const patch = '*** Begin Patch\n*** Add File: workbench/x.md\n+x\n*** End Patch';
  const result = runHook(command, codexInput(patch, space.root));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '', 'codex allow prints nothing');
});

test('the before-write adapter, --dialect codex: every path of a patch is checked; a Move to lore/ is denied even when the Update File path is in the Workbench', async () => {
  assert.ok(startSession(desk, { id: 's-cx-move', engine: 'default.codex' }).ok);
  const command = await codexPreWriteCommand('s-cx-move');
  const patch =
    '*** Begin Patch\n*** Update File: workbench/a.md\n*** Move to: lore/b.md\n-old\n+new\n*** End Patch';
  const result = runHook(command, codexInput(patch, space.root));
  const decision = preDecision(result);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /Read only/);
});

test('the before-write adapter, --dialect codex: a patch without a file line refuses with a fault', async () => {
  assert.ok(startSession(desk, { id: 's-cx-fault', engine: 'default.codex' }).ok);
  const command = await codexPreWriteCommand('s-cx-fault');
  const patch = '*** Begin Patch\n*** End Patch';
  const result = runHook(command, codexInput(patch, space.root));
  const decision = preDecision(result);
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason, /the patch names no file/);
});
