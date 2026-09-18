import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineEntry, RunResult } from '@ai-lore-companion/core';
import {
  type ScriptedRule,
  type ScriptedRunner,
  createScriptedRunner,
} from '@ai-lore-companion/core/testing';
import {
  LOGIN_SHELL_ARGS,
  LOGIN_SHELL_PATH_COMMAND,
  createSpaceMachineRegister,
  parseLoginShellPath,
  validLoginShell,
} from '../../../src/main/space/ipc/machine.js';
import { CONTRACT } from '../../../src/shared/ipc/contract.js';
import {
  MACHINE_REQUIREMENT_ORDER,
  type SpaceMachineCheckResult,
} from '../../../src/shared/ipc/space/machine.types.js';
import { type SpaceHarness, spaceHarnessFor } from './space-harness.js';

// The machine check channel, driven with a scripted runner: no command of the machine is
// started, and `gh` in particular is never reached.

const SHELL = '/bin/test-shell';
const LOGIN_PATH = '/opt/homebrew/bin:/Users/lead/.local/bin:/usr/bin:/bin';
const CLAUDE: EngineEntry = { id: 'default.claude', name: 'Claude', binary: 'claude' };
const NOT_FOUND: Partial<RunResult> = { code: -1, stderr: 'not found', failure: 'not-found' };

const GH_STATUS = [
  'github.com',
  '  ✓ Logged in to github.com account lead (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  '  - Token: gho_************************************',
  "  - Token scopes: 'gist', 'project', 'read:org', 'repo'",
  '',
].join('\n');

/** A shell profile that prints a line of its own before the command runs. */
const SHELL_REPLY = {
  stdout: `welcome back\n__AI_LORE_PATH_START__${LOGIN_PATH}__AI_LORE_PATH_END__`,
};

function fineRules(): ScriptedRule[] {
  return [
    { bin: 'git', args: ['--version'], reply: { stdout: 'git version 2.43.0\n' } },
    { bin: 'gh', args: ['--version'], reply: { stdout: 'gh version 2.92.0 (2026-04-28)\n' } },
    { bin: 'gh', args: ['auth', 'status'], reply: { stdout: GH_STATUS } },
    { bin: 'python3', args: ['--version'], reply: { stdout: 'Python 3.12.4\n' } },
    { bin: 'claude', args: ['--version'], reply: { stdout: '2.1.276 (Claude Code)\n' } },
    {
      bin: 'claude',
      args: ['auth', 'status', '--json'],
      reply: { stdout: '{"loggedIn": true, "authMethod": "claude.ai"}\n' },
    },
  ];
}

function harnessWith(runner: ScriptedRunner, clock: { now: number } = { now: 1000 }): SpaceHarness {
  return spaceHarnessFor(
    createSpaceMachineRegister({
      engines: () => [CLAUDE],
      runner: () => runner,
      shell: SHELL,
      isFile: () => true,
      platform: 'linux',
      now: () => clock.now,
    }),
  );
}

async function check(h: SpaceHarness, sender: Parameters<SpaceHarness['invoke']>[1], arg: unknown) {
  return (await h.invoke('spaceMachineCheck', sender, arg)) as SpaceMachineCheckResult;
}

test('the channel is in the contract under the rules of a 1.0 channel', () => {
  assert.equal(CONTRACT.spaceMachineCheck.kind, 'invoke');
  assert.equal(CONTRACT.spaceMachineCheck.channel, 'space:machine-check');
});

test('the login shell is started interactive and login, with a fixed command', () => {
  assert.deepEqual([...LOGIN_SHELL_ARGS], ['-i', '-l', '-c', LOGIN_SHELL_PATH_COMMAND]);
  assert.equal(parseLoginShellPath(SHELL_REPLY.stdout), LOGIN_PATH);
  assert.equal(parseLoginShellPath('no markers here'), null);
  assert.equal(parseLoginShellPath('__AI_LORE_PATH_START____AI_LORE_PATH_END__'), null);
});

test('a ready machine: four requirements in fixed order, every command run with the PATH of the login shell', async () => {
  const runner = createScriptedRunner([{ bin: SHELL, reply: SHELL_REPLY }, ...fineRules()]);
  const h = harnessWith(runner);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const result = await check(h, welcome, { fresh: true });
    assert.ok(result.ok);
    assert.equal(result.value.check.ready, true);
    assert.equal(result.value.pathSource, 'login-shell');
    assert.equal(result.value.checkedAt, 1000);
    assert.deepEqual(
      result.value.check.requirements.map((requirement) => requirement.id),
      [...MACHINE_REQUIREMENT_ORDER],
    );
    assert.deepEqual(
      result.value.check.engines.map((engine) => engine.engineId),
      ['default.claude'],
    );

    const [first, ...rest] = runner.calls;
    assert.equal(first?.bin, SHELL);
    assert.deepEqual(first?.args, [...LOGIN_SHELL_ARGS]);
    assert.ok(rest.length >= 6);
    for (const call of rest) {
      assert.equal(call.opts.env?.PATH, LOGIN_PATH, `${call.bin} ran with the login shell's PATH`);
    }
  } finally {
    h.cleanup();
  }
});

test('a machine that is not ready: the state, the sentence and the literal command arrive as core wrote them', async () => {
  const runner = createScriptedRunner([
    { bin: SHELL, reply: SHELL_REPLY },
    {
      bin: 'gh',
      args: ['auth', 'status'],
      reply: {
        code: 1,
        stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
      },
    },
    { bin: 'claude', reply: NOT_FOUND },
    ...fineRules(),
  ]);
  const h = harnessWith(runner);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const result = await check(h, welcome, { fresh: true });
    assert.ok(result.ok);
    assert.equal(result.value.check.ready, false);
    const [git, gh, engine, python3] = result.value.check.requirements;
    assert.equal(git?.state.kind, 'fine');
    assert.equal(gh?.state.kind, 'not-signed-in');
    assert.equal(gh?.command, 'gh auth login --hostname github.com --scopes project');
    assert.match(gh?.guidance ?? '', /not signed in/);
    assert.equal(engine?.state.kind, 'missing');
    assert.equal(python3?.state.kind, 'fine');
  } finally {
    h.cleanup();
  }
});

test('the shell is started only when it is an absolute path to an existing file', async () => {
  const exists = (): boolean => true;
  assert.equal(validLoginShell('/bin/zsh', exists), '/bin/zsh');
  assert.equal(validLoginShell('zsh', exists), null);
  assert.equal(validLoginShell('./zsh', exists), null);
  assert.equal(validLoginShell('', exists), null);
  assert.equal(validLoginShell('/bin/zsh\0-x', exists), null);
  assert.equal(
    validLoginShell('/bin/no-such-shell', () => false),
    null,
  );
  assert.equal(validLoginShell('/no/such/folder/of/ai-lore/shell'), null);

  const runner = createScriptedRunner([{ bin: 'zsh', reply: SHELL_REPLY }, ...fineRules()]);
  const h = spaceHarnessFor(
    createSpaceMachineRegister({
      engines: () => [CLAUDE],
      runner: () => runner,
      shell: 'zsh',
      isFile: () => true,
      platform: 'linux',
    }),
  );
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const result = await check(h, welcome, { fresh: true });
    assert.ok(result.ok);
    assert.equal(result.value.pathSource, 'app-environment');
    assert.equal(
      runner.calls.some((call) => call.bin === 'zsh'),
      false,
    );
  } finally {
    h.cleanup();
  }
});

test('a PATH with a control character in it is not taken', () => {
  assert.equal(
    parseLoginShellPath('__AI_LORE_PATH_START__/usr/bin\n/bin__AI_LORE_PATH_END__'),
    null,
  );
  assert.equal(
    parseLoginShellPath(
      '__AI_LORE_PATH_START__/profile/noise\n__AI_LORE_PATH_START__/usr/bin:/bin__AI_LORE_PATH_END__\nlogout',
    ),
    '/usr/bin:/bin',
  );
});

test('the login shell gives no PATH: the check still runs, with the PATH of the app, and says so', async () => {
  const runner = createScriptedRunner([
    { bin: SHELL, reply: { code: -1, stderr: 'stopped', failure: 'timeout' } },
    ...fineRules(),
  ]);
  const h = harnessWith(runner);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const result = await check(h, welcome, { fresh: true });
    assert.ok(result.ok);
    assert.equal(result.value.pathSource, 'app-environment');
    assert.equal(result.value.check.ready, true);
    for (const call of runner.calls.slice(1)) assert.equal(call.opts.env?.PATH, undefined);
  } finally {
    h.cleanup();
  }
});

test('fresh: false answers with the last check; fresh: true, which is check again, runs it again', async () => {
  const runner = createScriptedRunner([
    { bin: SHELL, reply: SHELL_REPLY },
    { bin: 'python3', reply: NOT_FOUND, times: 1 },
    ...fineRules(),
  ]);
  const clock = { now: 1000 };
  const h = harnessWith(runner, clock);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);

    // Nothing was checked yet, so `fresh: false` runs the check.
    const first = await check(h, welcome, { fresh: false });
    assert.ok(first.ok);
    assert.equal(first.value.check.ready, false);
    const callsAfterFirst = runner.calls.length;

    clock.now = 2000;
    const cached = await check(h, welcome, { fresh: false });
    assert.ok(cached.ok);
    assert.equal(cached.value.checkedAt, 1000);
    assert.equal(runner.calls.length, callsAfterFirst, 'no command was started');

    // python3 was installed in between; check again reads the PATH again and finds it.
    const again = await check(h, welcome, { fresh: true });
    assert.ok(again.ok);
    assert.equal(again.value.checkedAt, 2000);
    assert.equal(again.value.check.ready, true);
    assert.equal(runner.calls.filter((call) => call.bin === SHELL).length, 2);

    // The machine check screen, reached from the welcome screen, gets the same answer.
    await h.space.host.navigate(welcome, { to: 'machine-check' });
    const onScreen = await check(h, welcome, { fresh: false });
    assert.ok(onScreen.ok);
    assert.equal(onScreen.value.checkedAt, 2000);
  } finally {
    h.cleanup();
  }
});

test('two requests at the same time share one run', async () => {
  const runner = createScriptedRunner([{ bin: SHELL, reply: SHELL_REPLY }, ...fineRules()]);
  const h = harnessWith(runner);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const [a, b] = await Promise.all([
      check(h, welcome, { fresh: true }),
      check(h, welcome, { fresh: true }),
    ]);
    assert.ok(a.ok && b.ok);
    assert.equal(runner.calls.filter((call) => call.bin === SHELL).length, 1);
  } finally {
    h.cleanup();
  }
});

test('a caller that is not a 1.0 window, and an argument of another form, start no command', async () => {
  const runner = createScriptedRunner([{ bin: SHELL, reply: SHELL_REPLY }, ...fineRules()]);
  const h = harnessWith(runner);
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);

    const stranger = await check(h, { webContentsId: 987654 }, { fresh: true });
    assert.equal(stranger.ok, false);
    assert.equal(!stranger.ok && stranger.error.kind, 'not-a-space-window');

    const embedded = await check(
      h,
      { webContentsId: welcome.webContents.id, frame: 'inside-the-page' },
      { fresh: true },
    );
    assert.equal(embedded.ok, false);

    for (const arg of [undefined, {}, { fresh: 'yes' }, { fresh: true, shell: '/bin/sh' }]) {
      const invalid = await check(h, welcome, arg);
      assert.equal(!invalid.ok && invalid.error.kind, 'invalid-argument');
    }
    assert.equal(runner.calls.length, 0);
  } finally {
    h.cleanup();
  }
});

test('an engine registry that cannot be read is a failure with a sentence, not a rejection', async () => {
  const runner = createScriptedRunner([{ bin: SHELL, reply: SHELL_REPLY }, ...fineRules()]);
  const h = spaceHarnessFor(
    createSpaceMachineRegister({
      engines: () => {
        throw new Error('engines.json is not readable');
      },
      runner: () => runner,
      shell: SHELL,
      isFile: () => true,
      platform: 'linux',
    }),
  );
  try {
    h.space.host.openWelcome();
    const welcome = h.space.created[0];
    assert.ok(welcome);
    const result = await check(h, welcome, { fresh: true });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.kind, 'check-failed');
    assert.match(!result.ok ? result.error.message : '', /engines\.json is not readable/);
  } finally {
    h.cleanup();
  }
});
