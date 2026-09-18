import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseGhAuthStatus } from '@ai-lore-companion/core';
import {
  createFakeGitHub,
  createScriptedRunner,
  makeTempDir,
} from '@ai-lore-companion/core/testing';
import {
  FAKE_MACHINE_ENGINE,
  checkMachineOfApp,
  ghAuthStatusText,
  isFakeMachineRun,
} from '../../../src/main/space/e2e-machine.js';
import { createAppGitHubPort } from '../../../src/main/space/github-service.js';

// The machine check of an end-to-end run with the fake GitHub (phase M3.9): `gh` is
// answered from the fake's state and the engine is the run's own fake, only when both
// `COCKPIT_E2E=1` and `AI_LORE_FAKE_GITHUB` are set. `git` and `python3` are asked of
// the runner given; here that is a scripted runner, so no command is started.

const REAL_ENGINE = { id: 'default.claude', name: 'Claude', binary: 'claude' };

function toolsRunner() {
  return createScriptedRunner([
    { bin: 'git', args: ['--version'], reply: { code: 0, stdout: 'git version 2.44.0\n' } },
    { bin: 'python3', args: ['--version'], reply: { code: 0, stdout: 'Python 3.12.1\n' } },
  ]);
}

test('the fake machine run is on only with COCKPIT_E2E=1 and a fake GitHub state file', () => {
  assert.equal(isFakeMachineRun({}), false);
  assert.equal(isFakeMachineRun({ COCKPIT_E2E: '1' }), false);
  assert.equal(isFakeMachineRun({ COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: '' }), false);
  assert.equal(isFakeMachineRun({ AI_LORE_FAKE_GITHUB: '/tmp/state.json' }), false);
  assert.equal(
    isFakeMachineRun({ COCKPIT_E2E: 'true', AI_LORE_FAKE_GITHUB: '/tmp/s.json' }),
    false,
  );
  assert.equal(isFakeMachineRun({ COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: '/tmp/s.json' }), true);
});

test('a packaged app never gets the fakes, even started with both variables and a signed-in fake', async () => {
  const temp = makeTempDir('ai-lore-e2e-packaged-');
  try {
    const stateFile = join(temp.dir, 'fake-github.json');
    const fake = createFakeGitHub({ stateFile, reposDir: join(temp.dir, 'remotes') });
    fake.save(stateFile);
    const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: stateFile };
    assert.equal(isFakeMachineRun(env, true), false);
    assert.equal(isFakeMachineRun(env, false), true);

    // Unpackaged, the port is the signed-in fake; packaged, it is the unreachable port,
    // since COCKPIT_E2E=1 still refuses live GitHub.
    const refuseAll = createScriptedRunner([]);
    const dev = await createAppGitHubPort({ runner: refuseAll, env, packaged: false });
    assert.equal((await dev.auth()).ok, true);
    const packaged = await createAppGitHubPort({ runner: refuseAll, env, packaged: true });
    const auth = await packaged.auth();
    assert.equal(auth.ok ? 'signed-in' : auth.error.kind, 'unreachable');
    assert.equal(refuseAll.calls.length, 0);

    // The machine check is core's: gh and the registry's engine are asked of the runner.
    const runner = toolsRunner();
    const check = await checkMachineOfApp(runner, [REAL_ENGINE], { platform: 'linux' }, env, true);
    assert.equal(check.ready, false);
    assert.deepEqual(
      check.engines.map((engine) => engine.engineId),
      [REAL_ENGINE.id],
    );
    assert.ok(runner.calls.some((call) => call.bin === 'gh'));
    fake.dispose();
  } finally {
    temp.cleanup();
  }
});

test('the text given for gh auth status is read by core as the fake says', () => {
  const signedIn = ghAuthStatusText({
    kind: 'signed-in',
    account: 'fake-human',
    scopes: ['repo', 'project'],
  });
  assert.deepEqual(parseGhAuthStatus(`${signedIn.stdout}\n${signedIn.stderr}`), {
    kind: 'signed-in',
    account: 'fake-human',
    scopes: ['repo', 'project'],
  });
  const out = ghAuthStatusText({ kind: 'not-signed-in' });
  assert.equal(parseGhAuthStatus(`${out.stdout}\n${out.stderr}`).kind, 'not-signed-in');
});

test('outside the fake machine run the check is core’s: gh and the registry’s engine are asked of the runner', async () => {
  const runner = toolsRunner();
  const check = await checkMachineOfApp(
    runner,
    [REAL_ENGINE],
    { platform: 'linux' },
    {
      COCKPIT_E2E: '1',
    },
  );
  assert.equal(check.ready, false);
  assert.deepEqual(
    check.engines.map((engine) => engine.engineId),
    [REAL_ENGINE.id],
  );
  assert.ok(runner.calls.some((call) => call.bin === 'gh'));
  assert.ok(runner.calls.some((call) => call.bin === 'claude'));
});

test('in the fake machine run gh is answered from the fake, the engine is the fake one, git and python3 are asked', async () => {
  const temp = makeTempDir('ai-lore-e2e-machine-');
  try {
    const stateFile = join(temp.dir, 'fake-github.json');
    const fake = createFakeGitHub({ stateFile, reposDir: join(temp.dir, 'remotes') });
    fake.save(stateFile);
    const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: stateFile };

    const runner = toolsRunner();
    const ready = await checkMachineOfApp(runner, [REAL_ENGINE], { platform: 'linux' }, env);
    assert.equal(ready.ready, true, JSON.stringify(ready.requirements));
    assert.deepEqual(
      ready.engines.map((engine) => engine.engineId),
      [FAKE_MACHINE_ENGINE.id],
    );
    // Only git and python3 reach the runner given.
    assert.deepEqual([...new Set(runner.calls.map((call) => call.bin))].sort(), ['git', 'python3']);

    // A fake without the project scope, then a signed-out fake, are seen at the next check.
    fake.signIn('fake-human', ['repo']);
    fake.save(stateFile);
    const scoped = await checkMachineOfApp(toolsRunner(), [], { platform: 'linux' }, env);
    assert.equal(scoped.requirements.find((r) => r.id === 'gh')?.state.kind, 'missing-scope');
    fake.signOut();
    fake.save(stateFile);
    const out = await checkMachineOfApp(toolsRunner(), [], { platform: 'linux' }, env);
    assert.equal(out.requirements.find((r) => r.id === 'gh')?.state.kind, 'not-signed-in');
    assert.equal(out.ready, false);
    fake.dispose();
  } finally {
    temp.cleanup();
  }
});
