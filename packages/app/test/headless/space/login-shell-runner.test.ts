import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScriptedRunner } from '@ai-lore-companion/core/testing';
import { createLoginShellRunner } from '../../../src/main/space/login-shell-runner.js';

// The runner that backs an open Space, driven with a scripted runner: no command
// of the machine is started, and the login shell in particular is never reached.
//
// The defect these cover is the Space's issue #58. A Finder-launched app inherits
// a minimal PATH with no Homebrew prefix, so `gh` was not found by any GitHub call
// an open Space made, while the machine check — which does read the login shell's
// PATH — reported `gh` as present.

const SHELL = '/bin/test-shell';
const LOGIN_PATH = '/opt/homebrew/bin:/Users/lead/.local/bin:/usr/bin:/bin';

/** A shell profile that prints a line of its own before the command runs. */
const SHELL_REPLY = {
  stdout: `welcome back\n__AI_LORE_PATH_START__${LOGIN_PATH}__AI_LORE_PATH_END__`,
};

/** The options of a desk where the shell is real and the run is not a test run. */
const PARTS = {
  shell: SHELL,
  platform: 'darwin' as NodeJS.Platform,
  env: {},
  isFile: (path: string) => path === SHELL,
};

test('a command runs with the login shell PATH, so gh is found', async () => {
  const scripted = createScriptedRunner([
    { bin: SHELL, reply: SHELL_REPLY },
    { bin: 'gh', reply: { stdout: 'gh version 2.92.0\n' } },
  ]);
  const runner = createLoginShellRunner(scripted, PARTS);

  const result = await runner.run('gh', ['--version']);

  assert.equal(result.stdout, 'gh version 2.92.0\n');
  const gh = scripted.calls.find((call) => call.bin === 'gh');
  assert.equal(gh?.opts.env?.PATH, LOGIN_PATH, 'gh ran with the login shell PATH');
});

test('the login shell is asked once, however many commands run', async () => {
  const scripted = createScriptedRunner([
    { bin: SHELL, reply: SHELL_REPLY },
    { bin: 'gh', reply: { stdout: 'ok\n' } },
    { bin: 'git', reply: { stdout: 'ok\n' } },
  ]);
  const runner = createLoginShellRunner(scripted, PARTS);

  // Started together, so a second command cannot wait for the first to finish.
  await Promise.all([
    runner.run('gh', ['auth', 'status']),
    runner.run('git', ['--version']),
    runner.run('gh', ['--version']),
  ]);

  const shells = scripted.calls.filter((call) => call.bin === SHELL);
  assert.equal(shells.length, 1, 'the interactive login shell is started once per run');
  for (const call of scripted.calls.filter((entry) => entry.bin !== SHELL)) {
    assert.equal(call.opts.env?.PATH, LOGIN_PATH, `${call.bin} ran with the login shell PATH`);
  }
});

test('a caller PATH of its own is not overwritten', async () => {
  const scripted = createScriptedRunner([
    { bin: SHELL, reply: SHELL_REPLY },
    { bin: 'gh', reply: { stdout: 'ok\n' } },
  ]);
  const runner = createLoginShellRunner(scripted, PARTS);

  await runner.run('gh', ['--version'], { env: { PATH: '/only/this' } });

  assert.equal(scripted.calls.find((call) => call.bin === 'gh')?.opts.env?.PATH, '/only/this');
});

test('a shell that does not answer leaves the command as it was', async () => {
  const scripted = createScriptedRunner([
    { bin: SHELL, reply: { code: -1, stderr: 'not found', failure: 'not-found' } },
    { bin: 'gh', reply: { stdout: 'ok\n' } },
  ]);
  const runner = createLoginShellRunner(scripted, PARTS);

  const result = await runner.run('gh', ['--version']);

  assert.equal(result.stdout, 'ok\n', 'the command still runs');
  assert.equal(
    scripted.calls.find((call) => call.bin === 'gh')?.opts.env?.PATH,
    undefined,
    "the app's own PATH is used when the shell says nothing",
  );
});

test('no login shell is started where there is none to ask', async () => {
  for (const parts of [
    { ...PARTS, platform: 'win32' as NodeJS.Platform },
    { ...PARTS, shell: 'test-shell' }, // not an absolute path
    { ...PARTS, env: { AI_LORE_TEST: '1' } }, // a test run
  ]) {
    const scripted = createScriptedRunner([{ bin: 'gh', reply: { stdout: 'ok\n' } }]);

    await createLoginShellRunner(scripted, parts).run('gh', ['--version']);

    assert.equal(
      scripted.calls.filter((call) => call.bin === SHELL).length,
      0,
      `no shell is started for ${JSON.stringify(parts.platform)}/${parts.shell}`,
    );
  }
});
