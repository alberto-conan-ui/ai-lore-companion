/**
 * The Antigravity CLI adapter (phase M10.6, `m10-architecture.md` section 5,
 * M10.6): `antigravityAdapter.launch` and the `--dialect antigravity` blocks
 * of the two Python hook adapters, run as child processes with the JSON
 * Antigravity's plugin hooks are documented to give (2.3). The real engine is
 * never started here; the real-engine checks are manual (M10.6's own report).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  type DeskPaths,
  claudeCodeInstallPaths,
  deskPaths,
  execFileRunner,
  installClaudeCode,
  readLore,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import { antigravityAdapter } from '../../../src/main/space/sessions/engines/antigravity.js';
import { sessionInstructions } from '../../../src/main/space/sessions/engines/instructions.js';
import { readInstalledSkills } from '../../../src/main/space/sessions/engines/skills.js';
import { sessionFilePaths, writeSessionFiles } from '../../../src/main/space/sessions/files.js';
import { findPython3, verifyInstall } from '../../../src/main/space/sessions/preflight.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

const CONNECTION: SessionConnection = {
  sessionId: 'unused',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-agy',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

let space: SpaceFixture;
let base: string;
let hookCwd: string;
let paths: DeskPaths;
let python: string;
let before_: string[];
let after_: string[];

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'agy-space' });
  base = mkdtempSync(join(tmpdir(), 'm10-6-agy-'));
  hookCwd = join(base, 'not the space');
  mkdirSync(hookCwd);
  paths = deskPaths(base, space.root);
  mkdirSync(paths.desk, { recursive: true });
  mkdirSync(paths.sessions, { recursive: true });
  const lore = await readLore(space.root);
  assert.ok(lore.ok);
  const installed = await installClaudeCode(lore.value, paths.install);
  assert.ok(installed.ok, installed.ok ? '' : installed.error.message);
  const found = await findPython3(execFileRunner, null, space.root);
  assert.ok(found.ok, 'python3 is needed by these tests');
  python = found.value;
  const verified = await verifyInstall(paths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);
  before_ = verified.value.beforeChecks;
  after_ = verified.value.afterChecks;
});

after(() => {
  space.cleanup();
  rmSync(base, { recursive: true, force: true });
});

/** Build the Antigravity launch (and its session files) for a fresh session id. */
async function agySession(sessionId: string, paramArgv: string[] = []) {
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const skills = await readInstalledSkills(paths.install, space.root);
  const instructions = sessionInstructions({
    spaceRoot: space.root,
    skills,
    adapter: antigravityAdapter,
  });
  const launch = antigravityAdapter.launch({
    sessionId,
    spaceRoot: space.root,
    deskDir: paths.desk,
    paths: filePaths,
    python,
    install: {
      pluginDir: claudeCodeInstallPaths(paths.install).plugin,
      beforeChecks: before_,
      afterChecks: after_,
    },
    skills,
    connection: { ...CONNECTION, sessionId },
    repositories: ['app'],
    instructions,
    paramArgv,
  });
  const written = await writeSessionFiles(paths.sessions, { sessionId }, launch);
  return { launch, filePaths: written, instructions };
}

function fileByPath(launch: Awaited<ReturnType<typeof agySession>>['launch'], path: string) {
  const file = launch.files.find((entry) => entry.path === path);
  assert.ok(file, `no launch file at ${path}`);
  return file as { path: string; content: string };
}

/** Register a session record on the desk, so session_mode() in the adapter reads it. */
function writeSessionRecord(sessionId: string, mode: 'read-only' | 'writing'): void {
  writeFileSync(
    join(paths.desk, 'sessions.json'),
    JSON.stringify({
      version: 1,
      records: [
        {
          id: sessionId,
          engine: 'agy',
          attended: true,
          mode,
          startedAt: new Date().toISOString(),
        },
      ],
    }),
  );
}

function runHook(
  command: string,
  input: string,
): { status: number | null; stdout: string; stderr: string } {
  const done = spawnSync('/bin/sh', ['-c', command], {
    input,
    cwd: hookCwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

type Decision = { decision: string; reason?: string };

function decisionOf(result: { status: number | null; stdout: string; stderr: string }): Decision {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Decision;
}

function toolCallInput(
  name: string,
  args: Record<string, unknown>,
  workspacePaths: string[] = [space.root],
): string {
  return JSON.stringify({
    toolCall: { name, args },
    stepIdx: 1,
    conversationId: 'c-1',
    workspacePaths,
    transcriptPath: '/nowhere/transcript.jsonl',
    artifactDirectoryPath: '/nowhere/artifacts',
    modelName: 'test-model',
  });
}

test('launch: parameters first, the two --add-dir in order, the plugin files, and hooks.json with --dialect antigravity and --shell-rules', async () => {
  const sessionId = 's-launch-2';
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const skills = await readInstalledSkills(paths.install, space.root);
  const instructions = sessionInstructions({
    spaceRoot: space.root,
    skills,
    adapter: antigravityAdapter,
  });
  const launch = antigravityAdapter.launch({
    sessionId,
    spaceRoot: space.root,
    deskDir: paths.desk,
    paths: filePaths,
    python,
    install: {
      pluginDir: claudeCodeInstallPaths(paths.install).plugin,
      beforeChecks: before_,
      afterChecks: after_,
    },
    skills,
    connection: { ...CONNECTION, sessionId },
    repositories: ['app'],
    instructions,
    paramArgv: ['--model', 'opus'],
  });

  assert.deepEqual(launch.args, [
    '--model',
    'opus',
    '--add-dir',
    space.root,
    '--add-dir',
    filePaths.dir,
  ]);
  assert.deepEqual(launch.env, {});

  const plugin = fileByPath(launch, '.agents/plugins/lore/plugin.json');
  assert.equal(plugin.content, '{"name":"lore"}\n');

  const rules = fileByPath(launch, '.agents/plugins/lore/rules/AGENTS.md');
  assert.equal(rules.content, instructions);

  const mcp = JSON.parse(fileByPath(launch, '.agents/plugins/lore/mcp_config.json').content) as {
    mcpServers: Record<string, { serverUrl: string; headers: Record<string, string> }>;
  };
  assert.deepEqual(mcp.mcpServers.ailore, {
    serverUrl: CONNECTION.url,
    headers: { authorization: CONNECTION.header.value },
  });

  const hooks = JSON.parse(fileByPath(launch, '.agents/plugins/lore/hooks.json').content) as {
    'lore-guard': {
      PreToolUse: { matcher: string; hooks: { command: string; timeout: number }[] }[];
      PostToolUse: { matcher: string; hooks: { command: string; timeout: number }[] }[];
    };
  };
  const pre = hooks['lore-guard'].PreToolUse[0];
  const post = hooks['lore-guard'].PostToolUse[0];
  assert.ok(pre && post);
  assert.equal(pre?.matcher, '*');
  assert.match(pre?.hooks[0]?.command ?? '', /'--dialect' 'antigravity'/);
  assert.match(pre?.hooks[0]?.command ?? '', /'--shell-rules'/);
  assert.match(
    post?.matcher ?? '',
    /^write_to_file\|replace_file_content\|multi_replace_file_content\|edit_notebook\|create_file\|edit_file\|delete_file\|move_file$/,
  );
  assert.match(post?.hooks[0]?.command ?? '', /'--dialect' 'antigravity'/);

  const shellRules = JSON.parse(fileByPath(launch, 'shell-rules.json').content) as {
    allow: string[];
    deny: string[];
  };
  assert.ok(shellRules.allow.includes('Bash(git status:*)'));
  assert.ok(shellRules.deny.includes('Bash(git *--output*)'));
});

test('launch: an interactive initial prompt is refused until Antigravity has a verified form', async () => {
  const sessionId = 's-no-interactive-prompt';
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const skills = await readInstalledSkills(paths.install, space.root);
  assert.throws(
    () =>
      antigravityAdapter.launch({
        sessionId,
        spaceRoot: space.root,
        deskDir: paths.desk,
        paths: filePaths,
        python,
        install: {
          pluginDir: claudeCodeInstallPaths(paths.install).plugin,
          beforeChecks: before_,
          afterChecks: after_,
        },
        skills,
        connection: { ...CONNECTION, sessionId },
        repositories: ['app'],
        instructions: 'Session instructions.\n',
        paramArgv: [],
        initialPrompt: 'Update the dashboard.',
      }),
    /no verified interactive initial-prompt option/,
  );
});

test('before-write: write_to_file into lore/ in Read only is denied with the mode sentence; into workbench/ it is allowed; a relative TargetFile is resolved against workspacePaths[0]', async () => {
  const sessionId = 's-agy-write';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const command = readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8');
  const parsed = JSON.parse(command) as {
    'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] };
  };
  const preCommand = parsed['lore-guard'].PreToolUse[0]?.hooks[0]?.command;
  assert.ok(preCommand);

  const denied = decisionOf(
    runHook(
      preCommand as string,
      toolCallInput('write_to_file', {
        TargetFile: join(space.root, 'lore', 'agy-a.md'),
        CodeContent: 'x',
      }),
    ),
  );
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason ?? '', /Read only/);

  const allowed = decisionOf(
    runHook(
      preCommand as string,
      toolCallInput('write_to_file', {
        TargetFile: join(space.root, 'workbench', 'scratch', 'a.md'),
        CodeContent: 'x',
      }),
    ),
  );
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.reason, undefined);

  const relative = decisionOf(
    runHook(
      preCommand as string,
      toolCallInput('write_to_file', { TargetFile: 'workbench/scratch/b.md', CodeContent: 'x' }),
    ),
  );
  assert.equal(relative.decision, 'allow', relative.reason);
});

test('before-write: replace_file_content with no path key refuses with a fault', async () => {
  const sessionId = 's-agy-fault';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  const faulted = decisionOf(
    runHook(preCommand, toolCallInput('replace_file_content', { TargetContent: 'x' })),
  );
  assert.equal(faulted.decision, 'deny');
  assert.match(faulted.reason ?? '', /could not be made/);
});

test('before-write: run_command follows the shell rules (allow, force_ask, deny)', async () => {
  const sessionId = 's-agy-shell';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  const allowed = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git status', Cwd: space.root }),
    ),
  );
  assert.equal(allowed.decision, 'allow', allowed.reason);

  const forceAsk = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git status; rm -rf x', Cwd: space.root }),
    ),
  );
  assert.equal(forceAsk.decision, 'force_ask');
  assert.match(forceAsk.reason ?? '', /the Human Lead decides/);

  const denied = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git log --output=x', Cwd: space.root }),
    ),
  );
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason ?? '', /matches the rule/);

  const outsideCwd = decisionOf(
    runHook(preCommand, toolCallInput('run_command', { CommandLine: 'git status', Cwd: hookCwd })),
  );
  assert.equal(outsideCwd.decision, 'force_ask');
});

test('launch: --uncovered-shell deny is in the before-write command only when --dangerously-skip-permissions is ticked', async () => {
  const withFlag = await agySession('s-agy-uncovered-1', ['--dangerously-skip-permissions']);
  const hooksWith = JSON.parse(
    readFileSync(join(withFlag.filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const withCommand = hooksWith['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;
  assert.match(withCommand, /'--uncovered-shell' 'deny'/);

  const withValueFlag = await agySession('s-agy-uncovered-2', [
    '--dangerously-skip-permissions=true',
  ]);
  const hooksWithValue = JSON.parse(
    readFileSync(join(withValueFlag.filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const withValueCommand = hooksWithValue['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;
  assert.match(withValueCommand, /'--uncovered-shell' 'deny'/);

  const without = await agySession('s-agy-uncovered-3');
  const hooksWithout = JSON.parse(
    readFileSync(join(without.filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const withoutCommand = hooksWithout['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;
  assert.doesNotMatch(withoutCommand, /--uncovered-shell/);
});

test('before-write: with --uncovered-shell deny (--dangerously-skip-permissions ticked), an uncovered shell command is denied, not asked', async () => {
  const sessionId = 's-agy-uncovered-deny';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId, ['--dangerously-skip-permissions']);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  const echoDenied = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'echo x > lore/f.md', Cwd: space.root }),
    ),
  );
  assert.equal(echoDenied.decision, 'deny');
  assert.equal(
    echoDenied.reason,
    "This session skips Antigravity's own prompts, so a shell command outside the session's " +
      'rules is refused. Run it yourself, or start the session without ' +
      '--dangerously-skip-permissions.',
  );

  const semicolonDenied = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git status; rm -rf x', Cwd: space.root }),
    ),
  );
  assert.equal(semicolonDenied.decision, 'deny');
  assert.equal(semicolonDenied.reason, echoDenied.reason);

  const stillAllowed = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git status', Cwd: space.root }),
    ),
  );
  assert.equal(stillAllowed.decision, 'allow', stillAllowed.reason);

  const stillDeniedByRule = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'git log --output=x', Cwd: space.root }),
    ),
  );
  assert.equal(stillDeniedByRule.decision, 'deny');
  assert.match(stillDeniedByRule.reason ?? '', /matches the rule/);
});

test('before-write: without --dangerously-skip-permissions ticked, an uncovered shell command still force_asks', async () => {
  const sessionId = 's-agy-uncovered-ask';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  const asked = decisionOf(
    runHook(
      preCommand,
      toolCallInput('run_command', { CommandLine: 'echo x > lore/f.md', Cwd: space.root }),
    ),
  );
  assert.equal(asked.decision, 'force_ask');
  assert.match(asked.reason ?? '', /the Human Lead decides/);
});

test('before-write: an ailore MCP tool and a read tool are allowed; an unknown tool asks', async () => {
  const sessionId = 's-agy-tools';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  // Observed with the real engine (agy 1.2.7, 2026-09-19): a session-server call's toolCall.name
  // is the fixed "call_mcp_tool"; the server and tool are in args.ServerName / args.ToolName.
  const mcpTool = decisionOf(
    runHook(
      preCommand,
      toolCallInput('call_mcp_tool', {
        ServerName: 'lore_ailore',
        ToolName: 'await_answer',
        Arguments: { ticket: 't-1' },
      }),
    ),
  );
  assert.equal(mcpTool.decision, 'allow');

  const otherServerTool = decisionOf(
    runHook(
      preCommand,
      toolCallInput('call_mcp_tool', { ServerName: 'some_other_plugin', ToolName: 'x' }),
    ),
  );
  assert.equal(otherServerTool.decision, 'ask');

  const readTool = decisionOf(
    runHook(
      preCommand,
      toolCallInput('view_file', { AbsolutePath: join(space.root, 'lore', 'index.md') }),
    ),
  );
  assert.equal(readTool.decision, 'allow');

  const unknown = decisionOf(runHook(preCommand, toolCallInput('browser_click', {})));
  assert.equal(unknown.decision, 'ask');
  assert.equal(unknown.reason, undefined);
});

test('before-write: a session-server ServerName is matched exactly, not as a substring a spoofing server could match', async () => {
  const sessionId = 's-agy-spoof';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  // A server whose name merely contains the session server's name is not the session
  // server: only an exact match of "lore_ailore" is allowed (not a substring match).
  const spoofed = decisionOf(
    runHook(
      preCommand,
      toolCallInput('call_mcp_tool', { ServerName: 'evil_lore_ailore_hijack', ToolName: 'x' }),
    ),
  );
  assert.equal(spoofed.decision, 'ask');

  const spoofed2 = decisionOf(
    runHook(
      preCommand,
      toolCallInput('call_mcp_tool', { ServerName: 'not-lore_ailore', ToolName: 'x' }),
    ),
  );
  assert.equal(spoofed2.decision, 'ask');
});

test('before-write: a malformed toolCall fails closed with a deny, not an ask', async () => {
  const sessionId = 's-agy-malformed';
  writeSessionRecord(sessionId, 'read-only');
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PreToolUse: { hooks: { command: string }[] }[] } };
  const preCommand = hooks['lore-guard'].PreToolUse[0]?.hooks[0]?.command as string;

  const noToolCall = decisionOf(runHook(preCommand, JSON.stringify({ stepIdx: 1 })));
  assert.equal(noToolCall.decision, 'deny');
  assert.match(noToolCall.reason ?? '', /could not be made/);

  const notAnObject = decisionOf(
    runHook(preCommand, JSON.stringify({ toolCall: 'not an object' })),
  );
  assert.equal(notAnObject.decision, 'deny');
  assert.match(notAnObject.reason ?? '', /could not be made/);

  const noName = decisionOf(runHook(preCommand, JSON.stringify({ toolCall: { args: {} } })));
  assert.equal(noName.decision, 'deny');
  assert.match(noName.reason ?? '', /could not be made/);
});

test('after-write: emit_post always prints {} and notes a lore-integrity failure with kind after-write', async () => {
  const sessionId = 's-agy-post';
  const { filePaths } = await agySession(sessionId);
  const hooks = JSON.parse(
    readFileSync(join(filePaths.dir, '.agents/plugins/lore/hooks.json'), 'utf8'),
  ) as { 'lore-guard': { PostToolUse: { hooks: { command: string }[] }[] } };
  const postCommand = hooks['lore-guard'].PostToolUse[0]?.hooks[0]?.command as string;

  // A card whose frontmatter lore-integrity refuses: an unknown `kind`.
  const badCard = join(space.root, 'lore', 'corpus', 'core', 'agy-bad-card.md');
  writeFileSync(
    badCard,
    ['---', 'kind: not-a-real-kind', 'term: agy-bad', 'pointsAt: []', '---', '', 'Body.', ''].join(
      '\n',
    ),
  );

  const result = runHook(postCommand, toolCallInput('write_to_file', { TargetFile: badCard }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '{}');

  const refusalsText = readFileSync(filePaths.refusals, 'utf8');
  const lines = refusalsText
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { kind: string; tool: string; path: string });
  const afterWrite = lines.find((line) => line.kind === 'after-write');
  assert.ok(afterWrite, refusalsText);
  assert.equal(afterWrite?.tool, 'write_to_file');
  assert.equal(afterWrite?.path, badCard);
});
