import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseGhAuthStatus } from '@ai-lore-companion/core';
import {
  createFakeGitHub,
  createScriptedRunner,
  makeTempDir,
} from '@ai-lore-companion/core/testing';
import {
  checkMachineOfApp,
  ghAuthStatusText,
  isFakeMachineRun,
  probeEngineOfApp,
  readGitHubOwnersOfApp,
} from '../../../src/main/space/e2e-machine.js';
import {
  createAppGitHubPort,
  fakeUnreachableSwitch,
} from '../../../src/main/space/github-service.js';

// The machine check of an end-to-end run with the fake GitHub (phase M3.9): `gh` is
// answered from the fake's state and the engine is the run's own fake, only when both
// `COCKPIT_E2E=1` and `AI_LORE_FAKE_GITHUB` are set. `git` and `python3` are asked of
// the runner given; here that is a scripted runner, so no command is started.

const REAL_ENGINE = { id: 'default.claude', name: 'Claude', binary: 'claude' };

// The app's registry, catalog engines first, as `main/engines.ts` gives it.
const CLAUDE = { id: 'default.claude', name: 'Claude Code', binary: 'claude' };
const CODEX = { id: 'default.codex', name: 'Codex CLI', binary: 'codex' };
const ANTIGRAVITY = { id: 'default.antigravity', name: 'Antigravity CLI', binary: 'agy' };
const OPENCODE = { id: 'default.opencode', name: 'OpenCode', binary: 'opencode' };
const CATALOG_ENGINES = [CLAUDE, CODEX, ANTIGRAVITY, OPENCODE];

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

test('the fake of an end-to-end run answers unreachable while its switch file exists', async () => {
  const temp = makeTempDir('ai-lore-e2e-switch-');
  try {
    const stateFile = join(temp.dir, 'fake-github.json');
    const fake = createFakeGitHub({ stateFile, reposDir: join(temp.dir, 'remotes') });
    fake.save(stateFile);
    const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: stateFile };
    const refuseAll = createScriptedRunner([]);
    const port = await createAppGitHubPort({ runner: refuseAll, env, packaged: false });
    assert.equal((await port.auth()).ok, true);
    writeFileSync(fakeUnreachableSwitch(stateFile), '');
    const off = await port.auth();
    assert.equal(off.ok ? 'signed-in' : off.error.kind, 'unreachable');
    rmSync(fakeUnreachableSwitch(stateFile));
    assert.equal((await port.auth()).ok, true);
    assert.equal(refuseAll.calls.length, 0);
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

test('in the fake machine run the catalog engines are answered from the fake, Claude Code installed and signed in, the others not installed, tools and the account answered, git and python3 asked of the runner given (phase M9.4)', async () => {
  const temp = makeTempDir('ai-lore-e2e-machine-');
  try {
    const stateFile = join(temp.dir, 'fake-github.json');
    const fake = createFakeGitHub({ stateFile, reposDir: join(temp.dir, 'remotes') });
    fake.save(stateFile);
    const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: stateFile };

    const runner = toolsRunner();
    const ready = await checkMachineOfApp(runner, CATALOG_ENGINES, { platform: 'linux' }, env);
    assert.equal(ready.ready, true, JSON.stringify(ready.requirements));
    assert.deepEqual(
      ready.engines.map((engine) => engine.engineId),
      CATALOG_ENGINES.map((engine) => engine.id),
    );
    const claude = ready.engines.find((engine) => engine.engineId === CLAUDE.id);
    assert.equal(claude?.installed.kind, 'installed');
    assert.equal(claude?.signIn.kind, 'signed-in');
    for (const other of [CODEX, ANTIGRAVITY, OPENCODE]) {
      const engine = ready.engines.find((candidate) => candidate.engineId === other.id);
      assert.equal(engine?.installed.kind, 'missing', `${other.id} is not installed`);
      assert.equal(engine?.signIn.kind, 'not-checked');
    }
    assert.equal(ready.tools.brew, true);
    assert.equal(ready.tools.npm, false);
    assert.equal(ready.github.account, 'fake-human');
    assert.deepEqual(ready.github.organisations, []);
    // Only git and python3 reach the runner given: the catalog engines,
    // brew, npm, gh --version, gh auth status and gh api user/orgs are all
    // answered by the fake first.
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

test('probeEngineOfApp in a fake run answers installed and signed in without calling the runner (phase M9.4)', async () => {
  const refuseAll = createScriptedRunner([]);
  const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: '/tmp/does-not-matter.json' };
  const check = await probeEngineOfApp(refuseAll, CLAUDE, { platform: 'linux' }, env);
  assert.deepEqual(check.installed, { kind: 'installed', version: '1.0.0' });
  assert.deepEqual(check.signIn, { kind: 'signed-in' });
  assert.equal(check.catalogId, 'claude-code');
  assert.equal(check.engineId, CLAUDE.id);
  assert.equal(refuseAll.calls.length, 0);

  // Outside the fake machine run, the real probe is asked of the runner given.
  const real = toolsRunner().on({
    bin: 'claude',
    args: ['--version'],
    reply: { stdout: 'claude 1.0.0\n' },
  });
  const outside = await probeEngineOfApp(real, CLAUDE, { platform: 'linux' }, {});
  assert.ok(real.calls.some((call) => call.bin === 'claude'));
  assert.equal(outside.engineId, CLAUDE.id);
});

test('readGitHubOwnersOfApp answers the fake account in a fake machine run, and the runner given otherwise', async () => {
  const temp = makeTempDir('ai-lore-e2e-owners-');
  try {
    const stateFile = join(temp.dir, 'fake-github.json');
    const fake = createFakeGitHub({ stateFile, reposDir: join(temp.dir, 'remotes') });
    fake.save(stateFile);
    const env = { COCKPIT_E2E: '1', AI_LORE_FAKE_GITHUB: stateFile };
    const refuseAll = createScriptedRunner([]);
    const owners = await readGitHubOwnersOfApp(refuseAll, { platform: 'linux' }, env);
    assert.equal(owners.account, 'fake-human');
    assert.deepEqual(owners.organisations, []);
    assert.equal(refuseAll.calls.length, 0);
    fake.dispose();
  } finally {
    temp.cleanup();
  }
});
