import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  type Desk,
  type DeskPaths,
  type EngineCheck,
  type EngineEntry,
  claudeCodeInstallPaths,
  deskPaths,
  enterWriting,
  execFileRunner,
  getSession,
  installClaudeCode,
  openDesk,
  readLore,
  startSession,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { loadEngines } from '../../../src/main/engines.js';
import { type McpHost, createMcpHost } from '../../../src/main/helper/mcp-host.js';
import {
  type PtyService,
  type PtySpawnEngine,
  type PtySpawnOpts,
  quoteForShell,
} from '../../../src/main/pty.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { createSpaceSessionsRegister } from '../../../src/main/space/ipc/sessions.js';
import {
  type SessionConnection,
  configureSessionServer,
} from '../../../src/main/space/session-server/index.js';
import {
  engineArgv,
  hookArgv,
  shellCommandLine,
} from '../../../src/main/space/sessions/command-line.js';
import { PRE_WRITE_TIMEOUTS, SESSION_ID_ENV } from '../../../src/main/space/sessions/constants.js';
import { claudeCodeAdapter } from '../../../src/main/space/sessions/engines/claude-code.js';
import {
  type SessionFilePaths,
  removeSessionFiles,
  sessionFilePaths,
  writeSessionFiles,
} from '../../../src/main/space/sessions/files.js';
import {
  checkStartParams,
  findPython3,
  verifyInstall,
} from '../../../src/main/space/sessions/preflight.js';
import { UI_FILES, spaceUi } from '../../../src/main/space/ui-store.js';
import { LORE_TEMPLATE_DIR, spaceHarnessFor } from './space-harness.js';

// Phase M4.4: the files of a guarded session, its command lines, and the two adapters run
// by python3 as child processes with the JSON Claude Code gives a hook. The real engine is
// never started here (phase M4.8 does that).

let space: SpaceFixture;
/** A temporary folder whose `userData` holds a space and a single quote, as section 5.14 asks. */
let base: string;
let userData: string;
/** The working directory hooks run from here: not the Space, with a space and a single quote. */
let hookCwd: string;
let paths: DeskPaths;
let desk: Desk;
let python: string;
let before_: string[];
let after_: string[];

const CONNECTION: SessionConnection = {
  sessionId: 'unused',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-ro',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

/** An `EngineCheck` for `engine`, installed and signed in unless `overrides` says otherwise (M9.7). */
function fineEngineCheck(engine: EngineEntry, overrides: Partial<EngineCheck> = {}): EngineCheck {
  return {
    engineId: engine.id,
    name: engine.name,
    binary: engine.binary,
    state: { kind: 'fine', version: null },
    guidance: null,
    command: null,
    catalogId: null,
    maker: null,
    required: false,
    guardedSessions: true,
    installed: { kind: 'installed', version: null },
    signIn: { kind: 'signed-in' },
    installCommand: null,
    installNeeds: null,
    signInCommand: null,
    note: null,
    page: null,
    ...overrides,
  };
}

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'sessions-space',
    repositories: ['app'],
  });
  base = mkdtempSync(join(tmpdir(), 'm4-4 '));
  userData = join(base, "user data's folder");
  mkdirSync(userData);
  hookCwd = join(base, "the hook's cwd");
  mkdirSync(hookCwd);
  paths = deskPaths(userData, space.root);
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
  const verified = await verifyInstall(paths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);
  before_ = verified.value.beforeChecks;
  after_ = verified.value.afterChecks;
});

after(() => {
  space.cleanup();
  rmSync(base, { recursive: true, force: true });
});

/** The arguments a POSIX shell gives a program for `command`, read back by python3. */
function argvThroughShell(command: string): string[] {
  const printer = shellCommandLine([
    python,
    '-c',
    'import sys, json; print(json.dumps(sys.argv[1:]))',
  ]);
  const done = spawnSync('/bin/sh', ['-c', `${printer} ${command}`], { encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  return JSON.parse(done.stdout) as string[];
}

async function sessionFiles(sessionId: string): Promise<SessionFilePaths> {
  await removeSessionFiles(paths.sessions, sessionId);
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const launch = claudeCodeAdapter.launch({
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
    skills: [],
    connection: { ...CONNECTION, sessionId },
    // A name that is not a manifest name is never put into a rule.
    repositories: ['app', '../x', 'a b*'],
    instructions: 'Session instructions, for the test.\n',
    paramArgv: [],
  });
  return writeSessionFiles(paths.sessions, { sessionId }, launch);
}

type Settings = {
  permissions: { defaultMode: string; allow: string[]; deny: string[]; ask?: string[] };
  hooks: Record<
    string,
    { matcher: string; hooks: { type: string; command: string; timeout: number }[] }[]
  >;
  env: Record<string, string>;
};

function readSettings(files: SessionFilePaths): Settings {
  return JSON.parse(readFileSync(files.settings, 'utf8')) as Settings;
}

/** Run a hook command as the engine does: through a shell, from a folder that is not the Space. */
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

type Decision = { decision: string; reason: string };

function preDecision(result: { status: number | null; stdout: string }): Decision {
  assert.equal(result.status, 0, 'the adapter always ends with exit code 0 and a decision');
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: {
      hookEventName: string;
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  return {
    decision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

function hookInput(tool: string, toolInput: Record<string, unknown>, cwd = space.root): string {
  return JSON.stringify({
    session_id: '1b7c9e2a-0000-4000-8000-000000000000',
    transcript_path: '/nowhere/transcript.jsonl',
    cwd,
    prompt_id: 'p',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: 'toolu_1',
  });
}

function preCommand(files: SessionFilePaths): string {
  const entry = readSettings(files).hooks.PreToolUse?.[0]?.hooks[0];
  assert.ok(entry);
  return entry.command;
}

test('the command lines survive a shell for a userData path with a space and a single quote', () => {
  const files = sessionFilePaths(paths.sessions, 's-quote');
  assert.match(files.settings, / /);
  assert.match(files.settings, /'/);
  const argv = hookArgv({
    python,
    adapter: files.preWrite,
    spaceRoot: space.root,
    deskDir: paths.desk,
    sessionId: 's-quote',
    checks: [join(userData, 'a "double" $HOME `tick` \\ back\nnew line.py')],
    childSeconds: 1,
    adapterSeconds: 2,
    dialect: 'claude',
  });
  assert.deepEqual(argvThroughShell(shellCommandLine(argv)), argv);

  // The engine's arguments, as the PTY service quotes them for `$SHELL -i -l -c`.
  const engine = engineArgv({
    engineArgs: ['--model', 'opus'],
    settingsFile: files.settings,
    mcpFile: files.mcp,
    pluginDir: join(paths.install, 'claude-code', 'plugin'),
    tools: ['mcp__ailore__request_writing', 'mcp__ailore__await_answer'],
    appendSystemPrompt: 'Session instructions.',
  });
  assert.deepEqual(
    engine.slice(0, 2),
    ['--model', 'opus'],
    "the registry entry's arguments come first",
  );
  assert.equal(engine[engine.indexOf('--settings') + 1], files.settings);
  assert.equal(engine[engine.indexOf('--mcp-config') + 1], files.mcp);
  assert.ok(engine.includes('--strict-mcp-config'));
  assert.equal(
    engine[engine.indexOf('--append-system-prompt') + 1],
    'Session instructions.',
    'the session instructions are appended',
  );
  assert.ok(
    engine.indexOf('--append-system-prompt') < engine.indexOf('--allowedTools'),
    '--append-system-prompt comes before --allowedTools',
  );
  assert.equal(engine[engine.length - 3], '--allowedTools', 'the variadic option is last');
  assert.deepEqual(argvThroughShell(engine.map(quoteForShell).join(' ')), engine);
  assert.ok(!engine.join(' ').includes('secret-token'), 'no token in the arguments');
  // No settings file of the user, the project or `.claude/settings.local.json` is loaded.
  assert.equal(engine[engine.indexOf('--setting-sources') + 1], '');

  // `quoteForShell` of the PTY service, one character of meaning at a time, in a userData path.
  for (const odd of [' ', "'", '"', '$HOME', '`id`', '\n', '\\', '!', '*']) {
    const path = join(userData, `settings${odd}file.json`);
    assert.deepEqual(argvThroughShell(quoteForShell(path)), [path], JSON.stringify(odd));
  }
  assert.deepEqual(argvThroughShell(quoteForShell('')), ['']);
});

test('M10.5: --dialect claude behaves as today, and an unknown --dialect refuses with a fault', async () => {
  const files = await sessionFiles('s-dialect');
  const command = preCommand(files);
  // The dialect the Claude Code adapter's launch used: unchanged behaviour.
  assert.match(command, /'--dialect' 'claude'/);
  const allowed = preDecision(
    runHook(
      command,
      hookInput('Edit', { file_path: join(space.root, 'workbench', 'scratch', 'a.md') }),
    ),
  );
  assert.equal(allowed.decision, 'allow', allowed.reason);

  const nonsense = shellCommandLine(
    hookArgv({
      python,
      adapter: files.preWrite,
      spaceRoot: space.root,
      deskDir: paths.desk,
      sessionId: 's-dialect',
      checks: before_,
      childSeconds: 5,
      adapterSeconds: 10,
      dialect: 'nonsense',
    }),
  );
  const refused = preDecision(
    runHook(nonsense, hookInput('Write', { file_path: join(space.root, 'workbench', 'a.md') })),
  );
  assert.equal(refused.decision, 'deny');
  assert.match(refused.reason, /could not be made/);
  assert.match(refused.reason, /--dialect nonsense is not known/);
});

test('M10.8: --dialect opencode refuses an apply_patch into lore/, in the flat decision form', async () => {
  const files = await sessionFiles('s-opencode-dialect');
  const command = shellCommandLine(
    hookArgv({
      python,
      adapter: files.preWrite,
      spaceRoot: space.root,
      deskDir: paths.desk,
      sessionId: 's-opencode-dialect',
      checks: before_,
      childSeconds: 5,
      adapterSeconds: 10,
      dialect: 'opencode',
    }),
  );
  // The shape OpenCode's guard plugin sends: {tool, args, cwd} (m10-architecture.md 5, M10.8 item 1),
  // not Claude Code's {tool_name, tool_input, cwd}.
  const input = JSON.stringify({
    tool: 'apply_patch',
    args: {
      patchText: [
        '*** Begin Patch',
        `*** Update File: ${join(space.root, 'lore', 'x.md')}`,
        '@@',
        '-old',
        '+new',
        '*** End Patch',
        '',
      ].join('\n'),
    },
    cwd: space.root,
  });
  const result = runHook(command, input);
  assert.equal(result.status, 0, 'the adapter always ends with exit code 0 and a decision');
  const decision = JSON.parse(result.stdout) as { decision: string; reason?: string };
  assert.equal(decision.decision, 'deny');
  assert.match(decision.reason ?? '', /Read only/);
});

test('checkStartParams: a ticked parameter is checked against the engine options of M10.3', () => {
  const engine: EngineEntry = {
    id: 'c',
    name: 'Claude Code',
    binary: 'claude',
    params: [
      { text: '--model opus', defaultOn: true },
      { text: '--dangerously-skip-permissions', defaultOn: false },
      { text: '--permission-mode=bypassPermissions', defaultOn: false },
      { text: '--settings /tmp/other.json', defaultOn: false },
      { text: '--bare', defaultOn: false },
    ],
  };

  const modelOnly = checkStartParams(engine, ['--model opus']);
  assert.equal(modelOnly.ok, true);
  if (modelOnly.ok) assert.deepEqual(modelOnly.value.unguarded, []);

  const skip = checkStartParams(engine, ['--dangerously-skip-permissions']);
  assert.equal(skip.ok, true);
  if (skip.ok) assert.deepEqual(skip.value.unguarded, ['--dangerously-skip-permissions']);

  const permissionMode = checkStartParams(engine, ['--permission-mode=bypassPermissions']);
  assert.equal(permissionMode.ok, true);
  if (permissionMode.ok) assert.deepEqual(permissionMode.value.unguarded, ['--permission-mode']);

  for (const text of ['--settings /tmp/other.json', '--bare']) {
    const refused = checkStartParams(engine, [text]);
    assert.equal(refused.ok ? '' : refused.error.kind, 'engine-not-supported', text);
  }

  const unknown = checkStartParams(engine, ['--not-a-parameter']);
  assert.equal(unknown.ok ? '' : unknown.error.kind, 'invalid-argument');
});

test('a session folder is 0700, every file 0600, and the settings hold the guard', async () => {
  const files = await sessionFiles('s-files');
  assert.equal(statSync(files.dir).mode & 0o777, 0o700);
  assert.equal(statSync(files.hooksDir).mode & 0o777, 0o700);
  for (const file of [files.settings, files.mcp, files.preWrite, files.postWrite]) {
    assert.equal(statSync(file).mode & 0o777, 0o600, file);
  }
  const settings = readSettings(files);
  assert.equal(settings.permissions.defaultMode, 'default');
  assert.equal(settings.permissions.ask, undefined, 'no ask rule: it would defeat the allow list');
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Bash(git branch:*)']) {
    assert.ok(!settings.permissions.allow.includes(tool), `${tool} is not allowed by a rule`);
  }
  // Observed: a `*` inside a rule matches text with spaces, so `Bash(git -C * log*)` let
  // `git -C repos/app commit -m log` run. No allow rule has a `*` before its end.
  for (const rule of settings.permissions.allow) {
    const inner = rule.replace(/:\*\)$/, ')');
    assert.ok(!inner.includes('*'), `${rule} has a wildcard inside`);
  }
  assert.ok(settings.permissions.allow.includes('Bash(git -C repos/app status:*)'));
  assert.ok(settings.permissions.allow.includes('Bash(git fetch)'));
  assert.ok(!settings.permissions.allow.some((rule) => rule.includes('../x')));
  assert.ok(!settings.permissions.allow.some((rule) => rule.includes('a b')));
  for (const rule of ['Bash(git fetch:*)', 'Bash(git symbolic-ref:*)']) {
    assert.ok(!settings.permissions.allow.includes(rule), `${rule} can write a reference`);
  }
  assert.ok(settings.permissions.allow.includes('mcp__ailore__request_writing'));
  assert.ok(settings.permissions.deny.includes('Bash(git *--output*)'));
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const entries = settings.hooks[event];
    assert.equal(entries?.length, 1);
    assert.equal(entries?.[0]?.matcher, 'Write|Edit|MultiEdit|NotebookEdit');
    const hook = entries?.[0]?.hooks[0];
    assert.equal(hook?.type, 'command');
    assert.ok((hook?.timeout ?? 0) > 0, 'every hook sets its timeout');
  }
  assert.equal(settings.hooks.PreToolUse?.[0]?.hooks[0]?.timeout, PRE_WRITE_TIMEOUTS.hookSeconds);
  assert.equal(settings.env[SESSION_ID_ENV], 's-files');
  const settingsText = readFileSync(files.settings, 'utf8');
  assert.ok(!settingsText.includes('secret-token'), 'the token is only in mcp.json');
  const mcp = JSON.parse(readFileSync(files.mcp, 'utf8')) as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  assert.deepEqual(mcp.mcpServers.ailore, {
    type: 'http',
    url: CONNECTION.url,
    headers: { authorization: CONNECTION.header.value },
  });
  await removeSessionFiles(paths.sessions, 's-files');
  assert.equal(existsSync(files.dir), false);
});

test('the before-write adapter decides with JSON, from a folder that is not the Space', async () => {
  assert.ok(startSession(desk, { id: 's-ro', engine: 'claude-code' }).ok);
  const files = await sessionFiles('s-ro');
  const command = preCommand(files);

  const lore = preDecision(
    runHook(
      command,
      hookInput('Write', { file_path: join(space.root, 'lore', 'x.md'), content: 'x' }),
    ),
  );
  assert.equal(lore.decision, 'deny');
  assert.match(lore.reason, /Read only/);
  assert.match(lore.reason, /mcp__ailore__request_writing/);
  assert.ok(!lore.reason.includes(userData), "the desk's path is not shown to the session");

  const workbench = preDecision(
    runHook(
      command,
      hookInput('Edit', { file_path: 'workbench/scratch/a.md', old_string: 'a', new_string: 'b' }),
    ),
  );
  assert.equal(workbench.decision, 'allow', workbench.reason);

  const notebook = preDecision(
    runHook(
      command,
      hookInput('NotebookEdit', {
        notebook_path: join(space.root, 'repos', 'app', 'n.ipynb'),
        new_source: '',
      }),
    ),
  );
  assert.equal(notebook.decision, 'deny');

  const outside = preDecision(
    runHook(command, hookInput('Write', { file_path: join(space.root, 'ai_readme.md') })),
  );
  assert.equal(outside.decision, 'deny');

  // The journal: another session's entry is refused by journal-append-forward.
  mkdirSync(join(space.root, 'workbench', 'journal'), { recursive: true });
  const other = join(space.root, 'workbench', 'journal', '2026-09-18-s-other.md');
  writeFileSync(other, 'x');
  const journal = preDecision(runHook(command, hookInput('Write', { file_path: other })));
  assert.equal(journal.decision, 'deny');
  assert.match(journal.reason, /journal-append-forward/);
  const own = preDecision(
    runHook(
      command,
      hookInput('Write', {
        file_path: join(space.root, 'workbench', 'journal', '2026-09-18-s-ro.md'),
      }),
    ),
  );
  assert.equal(own.decision, 'allow', own.reason);

  // What the adapter noted, for the companion's log.
  const noted = readFileSync(files.refusals, 'utf8').trim().split('\n');
  assert.ok(noted.length >= 3);
});

test('a refusal in Writing names Writing', async () => {
  assert.ok(startSession(desk, { id: 's-wr', engine: 'claude-code' }).ok);
  const entered = enterWriting(
    desk,
    { repositories: [], publishAreas: [] },
    { sessionId: 's-wr', targets: [{ kind: 'lore' }] },
  );
  assert.ok(entered.ok, entered.ok ? '' : entered.error.message);
  const files = await sessionFiles('s-wr');
  const refused = preDecision(
    runHook(
      preCommand(files),
      hookInput('Write', { file_path: join(space.root, 'repos', 'app', 'x.ts') }),
    ),
  );
  assert.equal(refused.decision, 'deny');
  assert.match(refused.reason, /The session is in Writing/);
});

test('the before-write adapter refuses on every fault', async () => {
  const files = await sessionFiles('s-ro');
  const command = preCommand(files);
  const cases: [string, string, RegExp][] = [
    ['not JSON', 'not json', /could not be made/],
    ['empty input', '', /could not be made/],
    ['no tool_input', JSON.stringify({ tool_name: 'Write', cwd: space.root }), /no tool_input/],
    ['no path', hookInput('Write', { content: 'x' }), /names no file/],
    [
      'relative path, no cwd',
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.md' } }),
      /relative/,
    ],
  ];
  /** Every refusal names the mode, says how to ask for Writing, and does not show the desk. */
  const assertTells = (decision: Decision, name: string) => {
    assert.match(decision.reason, /Read only/, name);
    assert.match(decision.reason, /request_writing/, name);
    assert.ok(!decision.reason.includes(userData), `${name}: the desk's path is not shown`);
  };
  for (const [name, input, reason] of cases) {
    const decision = preDecision(runHook(command, input));
    assert.equal(decision.decision, 'deny', name);
    assert.match(decision.reason, reason, name);
    assertTells(decision, name);
  }

  const scripts = join(base, 'fake checks');
  mkdirSync(scripts, { recursive: true });
  const exit1 = join(scripts, 'exit-one.py');
  writeFileSync(exit1, 'import sys\nsys.exit(1)\n');
  const exit3 = join(scripts, 'exit-three.py');
  writeFileSync(exit3, 'import sys\nsys.exit(3)\n');
  const slow = join(scripts, 'slow.py');
  writeFileSync(slow, 'import time\ntime.sleep(20)\n');
  const run = (checks: string[], childSeconds: number, adapterSeconds: number) =>
    preDecision(
      runHook(
        shellCommandLine(
          hookArgv({
            python,
            adapter: files.preWrite,
            spaceRoot: space.root,
            deskDir: paths.desk,
            sessionId: 's-ro',
            checks,
            childSeconds,
            adapterSeconds,
            dialect: 'claude',
          }),
        ),
        hookInput('Write', { file_path: join(space.root, 'workbench', 'a.md') }),
      ),
    );
  const missing = run([join(scripts, 'write-guard.py')], 5, 10);
  assert.equal(missing.decision, 'deny');
  assert.match(missing.reason, /write-guard\.py is missing/);
  assertTells(missing, 'missing');
  const odd = run([exit1], 5, 10);
  assert.equal(odd.decision, 'deny');
  assert.match(odd.reason, /exit code 1/);
  const three = run([exit3], 5, 10);
  assert.equal(three.decision, 'deny');
  assert.match(three.reason, /exit code 3/);
  assertTells(three, 'exit 3');
  const childLate = run([slow], 1, 10);
  assert.equal(childLate.decision, 'deny');
  assert.match(childLate.reason, /did not finish in 1 seconds/);
  const adapterLate = run([slow], 10, 1);
  assert.equal(adapterLate.decision, 'deny');
  assert.match(adapterLate.reason, /did not finish/);
  // The hook's input never arrives: the adapter's own alarm refuses.
  const stuck = preDecision(
    runHook(
      `sleep 5 | ${shellCommandLine(
        hookArgv({
          python,
          adapter: files.preWrite,
          spaceRoot: space.root,
          deskDir: paths.desk,
          sessionId: 's-ro',
          checks: before_,
          childSeconds: 5,
          adapterSeconds: 1,
          dialect: 'claude',
        }),
      )}`,
      '',
    ),
  );
  assert.equal(stuck.decision, 'deny');
  assert.match(stuck.reason, /did not finish in 1 seconds/);
  const wrongLine = preDecision(
    runHook(
      `${shellCommandLine([python, files.preWrite])}`,
      hookInput('Write', { file_path: '/x' }),
    ),
  );
  assert.equal(wrongLine.decision, 'deny');
  assertTells(wrongLine, 'wrong command line');

  // A write into the Lore in every form the engine gives it.
  const link = join(space.root, 'workbench', 'lore-link');
  symlinkSync(join(space.root, 'lore'), link);
  try {
    for (const [name, input] of [
      ['a link into the Lore', hookInput('Write', { file_path: join(link, 'x.md') })],
      ['MultiEdit', hookInput('MultiEdit', { file_path: join(space.root, 'lore', 'x.md') })],
      ['relative', hookInput('Write', { file_path: 'lore/x.md' })],
      ['notebook', hookInput('NotebookEdit', { notebook_path: 'lore/n.ipynb', new_source: '' })],
    ] as const) {
      const decision = preDecision(runHook(command, input));
      assert.equal(decision.decision, 'deny', name);
      assertTells(decision, name);
    }
  } finally {
    unlinkSync(link);
  }

  // A check script that names a desk record in its refusal: the desk's folder is replaced.
  const corrupt = join(base, "a corrupt desk's folder");
  mkdirSync(corrupt, { recursive: true });
  writeFileSync(join(corrupt, 'sessions.json'), 'not json');
  const scrubbed = preDecision(
    runHook(
      shellCommandLine(
        hookArgv({
          python,
          adapter: files.preWrite,
          spaceRoot: space.root,
          deskDir: corrupt,
          sessionId: 's-ro',
          checks: before_,
          childSeconds: 20,
          adapterSeconds: 25,
          dialect: 'claude',
        }),
      ),
      hookInput('Write', { file_path: join(space.root, 'workbench', 'a.md') }),
    ),
  );
  assert.equal(scrubbed.decision, 'deny');
  assert.ok(!scrubbed.reason.includes(corrupt), scrubbed.reason);
  assert.match(scrubbed.reason, /<the desk folder>/);
  assert.match(scrubbed.reason, /request_writing/);

  // python3 receives SIGTERM while a check runs: it still prints a refusal.
  const child = spawn(
    python,
    hookArgv({
      python,
      adapter: files.preWrite,
      spaceRoot: space.root,
      deskDir: paths.desk,
      sessionId: 's-ro',
      checks: [slow],
      childSeconds: 20,
      adapterSeconds: 25,
      dialect: 'claude',
    }).slice(1),
    { cwd: hookCwd, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  child.stdin.end(hookInput('Write', { file_path: join(space.root, 'workbench', 'a.md') }));
  await new Promise((resolve) => setTimeout(resolve, 700));
  child.kill('SIGTERM');
  const signalled = preDecision({ status: await exited, stdout: out });
  assert.equal(signalled.decision, 'deny');
  assert.match(signalled.reason, /SIGTERM/);
  assertTells(signalled, 'SIGTERM');
});

test('the after-write adapter reports a Lore that fails lore-integrity, and is silent outside the Lore', async () => {
  const files = await sessionFiles('s-wr');
  const entry = readSettings(files).hooks.PostToolUse?.[0]?.hooks[0];
  assert.ok(entry);
  const outside = runHook(
    entry.command,
    hookInput('Write', { file_path: join(space.root, 'workbench', 'a.md') }),
  );
  assert.equal(outside.status, 0);
  assert.equal(outside.stdout, '');

  const clean = runHook(
    entry.command,
    hookInput('Write', { file_path: join(space.root, 'lore', 'space.md') }),
  );
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, '', `a Lore that passes gives no report: ${clean.stdout}`);

  const broken = join(space.root, 'lore', 'verbs', 'broken-verb.md');
  writeFileSync(broken, '---\ntype: [unclosed\n---\nbody\n');
  try {
    const failed = runHook(entry.command, hookInput('Write', { file_path: broken }));
    assert.equal(failed.status, 0);
    const parsed = JSON.parse(failed.stdout) as { decision: string; reason: string };
    assert.equal(parsed.decision, 'block');
    assert.match(parsed.reason, /fails a check/);
    assert.match(parsed.reason, /lore-integrity/);
  } finally {
    unlinkSync(broken);
  }
});

test('a missing, altered or newer install, and a missing python3, refuse the start and name what', async () => {
  const copy = join(base, 'install copy');
  const fresh = () => {
    rmSync(copy, { recursive: true, force: true });
    cpSync(paths.install, copy, { recursive: true });
    return claudeCodeInstallPaths(copy);
  };
  let install = fresh();
  writeFileSync(join(install.checks, 'journal-append-forward.py'), '# altered\n', { flag: 'a' });
  let result = await verifyInstall(copy);
  assert.equal(result.ok ? '' : result.error.kind, 'check-altered');
  assert.match(result.ok ? '' : result.error.message, /journal-append-forward\.py/);

  install = fresh();
  unlinkSync(join(install.checks, 'write-guard.py'));
  result = await verifyInstall(copy);
  assert.equal(result.ok ? '' : result.error.kind, 'check-missing');
  assert.match(result.ok ? '' : result.error.message, /write-guard\.py/);

  install = fresh();
  unlinkSync(install.pluginManifest);
  result = await verifyInstall(copy);
  assert.equal(result.ok ? '' : result.error.kind, 'plugin-missing');

  install = fresh();
  const record = JSON.parse(readFileSync(install.record, 'utf8')) as { version: number };
  record.version = 99;
  writeFileSync(install.record, JSON.stringify(record));
  result = await verifyInstall(copy);
  assert.equal(result.ok ? '' : result.error.kind, 'install-record-newer');

  result = await verifyInstall(join(base, 'no install'));
  assert.equal(result.ok ? '' : result.error.kind, 'not-installed');

  const noPython = await findPython3(
    { run: async () => ({ code: -1, stdout: '', stderr: 'not found', failure: 'not-found' }) },
    null,
    space.root,
  );
  assert.equal(noPython.ok ? '' : noPython.error.kind, 'python3-missing');
});

test('the IPC starts a guarded session in the Space window and ends it', async () => {
  const mcp: McpHost = createMcpHost();
  await mcp.listen();
  configureSessionServer({ host: async () => mcp });
  const engines: EngineEntry[] = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      binary: '/opt/nowhere/claude',
      params: [
        { text: '--model opus', defaultOn: true },
        { text: '--dangerously-skip-permissions', defaultOn: false },
      ],
    },
    { id: 'gemini', name: 'Gemini', binary: 'gemini' },
  ];
  const h = spaceHarnessFor(
    createSpaceSessionsRegister(() => ({
      engines: () => engines,
      loginPath: async () => null,
      runner: () => execFileRunner,
      newId: () => `s-ipc-${Math.random().toString(16).slice(2, 8)}`,
      probeEngine: async (engine) => fineEngineCheck(engine),
    })),
  );
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    const spawned: { engine?: PtySpawnEngine; opts?: PtySpawnOpts }[] = [];
    const killed: string[] = [];
    context.ptyService = {
      spawn: (engine, opts) => {
        spawned.push({ engine, opts });
        return `pty-${spawned.length}`;
      },
      write: () => {},
      resize: () => {},
      kill: (id) => {
        killed.push(id);
        spawned[Number(id.slice(4)) - 1]?.opts?.onExit?.(0);
      },
      killAll: () => {},
      hasRunningTask: () => false,
    } as PtyService;

    // A folder left by a session of an earlier run of the app, there before the service is built.
    mkdirSync(join(context.desk.sessions, 's-stale'), { recursive: true });

    // Not installed yet: refused, and nothing is spawned.
    const refused = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--model opus'],
    })) as {
      ok: boolean;
      error?: { kind: string };
    };
    assert.equal(refused.error?.kind, 'not-installed');
    assert.equal(spawned.length, 0);
    const notClaude = (await h.invoke('spaceSessionReadiness', spaceWindow, {
      engineId: 'gemini',
    })) as {
      error?: { kind: string };
    };
    assert.equal(notClaude.error?.kind, 'engine-not-supported');

    const lore = await readLore(space.root);
    assert.ok(lore.ok);
    assert.ok((await installClaudeCode(lore.value, context.desk.install)).ok);

    const ready = (await h.invoke('spaceSessionReadiness', spaceWindow, {
      engineId: 'claude-code',
    })) as {
      ok: boolean;
    };
    assert.equal(ready.ok, true);

    const started = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--model opus'],
    })) as {
      ok: boolean;
      value: { sessionId: string; ptyId: string; unguarded: string[] };
    };
    assert.equal(started.ok, true, JSON.stringify(started));
    const { sessionId } = started.value;
    assert.deepEqual(started.value.unguarded, [], 'a guarded start answers no unguarded option');
    assert.equal(
      existsSync(join(context.desk.sessions, 's-stale')),
      false,
      'the stale folder is removed',
    );
    const call = spawned[0];
    assert.ok(call?.engine && call.opts);
    assert.equal(call.engine.binary, '/opt/nowhere/claude');
    const args = call.engine.args ?? [];
    assert.deepEqual(
      args.slice(0, 2),
      ['--model', 'opus'],
      "the ticked parameter's arguments come first",
    );
    const files = sessionFilePaths(context.desk.sessions, sessionId);
    assert.equal(args[args.indexOf('--settings') + 1], files.settings);
    assert.equal(
      args[args.indexOf('--plugin-dir') + 1],
      claudeCodeInstallPaths(context.desk.install).plugin,
    );
    // M10.5: the session instructions are appended.
    const appended = args[args.indexOf('--append-system-prompt') + 1];
    assert.match(appended ?? '', /Read .*\/ai_readme\.md first and follow it/);
    assert.match(appended ?? '', /session-orient/);
    assert.equal(call.opts.cwd, context.root);
    assert.deepEqual(call.opts.env, { [SESSION_ID_ENV]: sessionId });
    assert.equal(statSync(files.mcp).mode & 0o777, 0o600);
    const opened = context.service(spaceDesk).open();
    assert.ok(opened.ok);
    const record = getSession(opened.value, sessionId);
    assert.ok(record.ok);
    assert.equal(record.value?.mode, 'read-only');

    // The Files window may not start or end a session.
    h.space.host.openFilesWindow(context);
    const filesWindow = h.space.created[1];
    assert.ok(filesWindow);
    const stranger = (await h.invoke('spaceSessionEnd', filesWindow, { sessionId })) as {
      error?: { kind: string };
    };
    assert.equal(stranger.error?.kind, 'not-a-space-window');
    const invalid = (await h.invoke('spaceSessionEnd', spaceWindow, { sessionId: '../x' })) as {
      error?: { kind: string };
    };
    assert.equal(invalid.error?.kind, 'invalid-argument');

    const ended = (await h.invoke('spaceSessionEnd', spaceWindow, { sessionId })) as {
      ok: boolean;
    };
    assert.equal(ended.ok, true);
    assert.deepEqual(killed, [started.value.ptyId]);
    assert.equal(existsSync(files.dir), false, 'the session folder is removed');
    const closed = getSession(opened.value, sessionId);
    assert.ok(closed.ok);
    assert.ok(closed.value?.closedAt, 'the end is recorded');
    const again = (await h.invoke('spaceSessionEnd', spaceWindow, { sessionId })) as {
      error?: { kind: string };
    };
    assert.equal(again.error?.kind, 'unknown-session');

    /** Wait until the session's end is recorded and its folder is gone. */
    const endedOnItsOwn = async (id: string) => {
      const folder = sessionFilePaths(context.desk.sessions, id).dir;
      for (let i = 0; i < 100 && existsSync(folder); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(existsSync(folder), false, `the folder of ${id} is removed`);
      const record = getSession(opened.value, id);
      assert.ok(record.ok && record.value?.closedAt, `the end of ${id} is recorded`);
    };

    // The engine exits by itself: the session ends the same way.
    const second = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--model opus'],
    })) as { ok: boolean; value: { sessionId: string } };
    assert.equal(second.ok, true, JSON.stringify(second));
    spawned[1]?.opts?.onExit?.(0);
    await endedOnItsOwn(second.value.sessionId);
    // A session still running when its Space window closes (and at app quit) is ended too.
    const third = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--model opus'],
    })) as { ok: boolean; value: { sessionId: string } };
    assert.equal(third.ok, true, JSON.stringify(third));

    // M10.3: a start with a guard-changing parameter is allowed, and records `unguarded` on
    // the desk, in `SpaceSessionStarted` and in the header.
    const unguardedStart = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--dangerously-skip-permissions'],
    })) as { ok: boolean; value: { sessionId: string; unguarded: string[] } };
    assert.equal(unguardedStart.ok, true, JSON.stringify(unguardedStart));
    assert.deepEqual(unguardedStart.value.unguarded, ['--dangerously-skip-permissions']);
    const unguardedRecord = getSession(opened.value, unguardedStart.value.sessionId);
    assert.ok(unguardedRecord.ok);
    assert.deepEqual(unguardedRecord.value?.unguarded, ['--dangerously-skip-permissions']);
    const unguardedHeader = (await h.invoke('spaceSessionHeader', spaceWindow, {
      sessionId: unguardedStart.value.sessionId,
    })) as { ok: boolean; value: { unguarded: string[] } };
    assert.deepEqual(unguardedHeader.value.unguarded, ['--dangerously-skip-permissions']);
    await h.invoke('spaceSessionEnd', spaceWindow, { sessionId: unguardedStart.value.sessionId });

    // A start with `params` holding a text that is not one of the engine's parameters is refused.
    const unknownParam = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--not-a-parameter'],
    })) as { ok: boolean; error?: { kind: string } };
    assert.equal(unknownParam.error?.kind, 'invalid-argument');
    assert.equal(spawned.length, 4);

    // A check script altered after the install refuses the next start.
    const check = join(claudeCodeInstallPaths(context.desk.install).checks, 'lore-integrity.py');
    chmodSync(check, 0o644);
    writeFileSync(check, '# altered\n', { flag: 'a' });
    const altered = (await h.invoke('spaceSessionStart', spaceWindow, {
      engineId: 'claude-code',
      params: ['--model opus'],
    })) as {
      error?: { kind: string; message: string };
    };
    assert.equal(altered.error?.kind, 'check-altered');
    assert.match(altered.error?.message ?? '', /lore-integrity\.py/);
    assert.equal(spawned.length, 4);

    await h.space.host.windowClosed(filesWindow.id);
    await h.space.host.windowClosed(spaceWindow.id);
    await endedOnItsOwn(third.value.sessionId);
  } finally {
    configureSessionServer(null);
    await mcp.close();
    h.cleanup();
  }
});

// Phase M9.7: the engine of a session is chosen by readiness (A.10), not the
// order of `engines.json`; a picked engine that can start is remembered.

test('readiness refuses engine-not-installed, refuses engine-not-signed-in, and passes on undetermined sign-in', async () => {
  const engine: EngineEntry = {
    id: 'claude-code',
    name: 'Claude Code',
    binary: '/opt/nowhere/claude',
  };
  let probed: EngineCheck = fineEngineCheck(engine, { installed: { kind: 'missing' } });
  const h = spaceHarnessFor(
    createSpaceSessionsRegister(() => ({
      engines: () => [engine],
      loginPath: async () => null,
      runner: () => execFileRunner,
      newId: () => `s-probe-${Math.random().toString(16).slice(2, 8)}`,
      probeEngine: async () => probed,
    })),
  );
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    const lore = await readLore(space.root);
    assert.ok(lore.ok);
    assert.ok((await installClaudeCode(lore.value, context.desk.install)).ok);

    const missing = (await h.invoke('spaceSessionReadiness', spaceWindow, {
      engineId: 'claude-code',
    })) as { error?: { kind: string } };
    assert.equal(missing.error?.kind, 'engine-not-installed');

    probed = fineEngineCheck(engine, { signIn: { kind: 'not-signed-in' } });
    const notSignedIn = (await h.invoke('spaceSessionReadiness', spaceWindow, {
      engineId: 'claude-code',
    })) as { error?: { kind: string } };
    assert.equal(notSignedIn.error?.kind, 'engine-not-signed-in');

    probed = fineEngineCheck(engine, {
      signIn: { kind: 'undetermined', reason: 'could not check' },
    });
    const passes = (await h.invoke('spaceSessionReadiness', spaceWindow, {
      engineId: 'claude-code',
    })) as { ok: boolean };
    assert.equal(passes.ok, true);
  } finally {
    h.cleanup();
  }
});

test('spaceSessionEnginePick writes ui/session-engine.json when the engine can start', async () => {
  // `spaceSessionEnginePick` reads the app's live list with `loadEngines` (A.9 handlers), the
  // same list `sessions.readiness` must see, so `engines()` here mirrors it rather than a list
  // of its own: `default.claude`, the catalog's own id, is always in it.
  const h = spaceHarnessFor(
    createSpaceSessionsRegister((deps) => ({
      engines: () => loadEngines(deps.space.userDataDir()),
      loginPath: async () => null,
      runner: () => execFileRunner,
      newId: () => `s-pick-${Math.random().toString(16).slice(2, 8)}`,
      probeEngine: async (e) => fineEngineCheck(e),
    })),
  );
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    const lore = await readLore(space.root);
    assert.ok(lore.ok);
    assert.ok((await installClaudeCode(lore.value, context.desk.install)).ok);

    const picked = (await h.invoke('spaceSessionEnginePick', spaceWindow, {
      engineId: 'default.claude',
    })) as { ok: boolean; value: { engineId: string | null } };
    assert.equal(picked.ok, true);
    assert.equal(picked.value.engineId, 'default.claude');

    context.service(spaceUi).flush();
    const ui = deskPaths(h.space.userDataDir, space.root).ui;
    const saved = JSON.parse(readFileSync(join(ui, UI_FILES['session-engine']), 'utf8')) as {
      engineId: string;
    };
    assert.equal(saved.engineId, 'default.claude');
  } finally {
    h.cleanup();
  }
});

test('spaceSessionEngines from a Files window is refused', async () => {
  const engine: EngineEntry = {
    id: 'claude-code',
    name: 'Claude Code',
    binary: '/opt/nowhere/claude',
  };
  const h = spaceHarnessFor(
    createSpaceSessionsRegister(() => ({
      engines: () => [engine],
      loginPath: async () => null,
      runner: () => execFileRunner,
      newId: () => 's-files-window',
      probeEngine: async (e) => fineEngineCheck(e),
    })),
  );
  try {
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    h.space.host.openFilesWindow(context);
    const filesWindow = h.space.created[1];
    assert.ok(filesWindow);
    const refused = (await h.invoke('spaceSessionEngines', filesWindow, {})) as {
      error?: { kind: string };
    };
    assert.equal(refused.error?.kind, 'not-a-space-window');
  } finally {
    h.cleanup();
  }
});
