import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { type MachineCheck, execFileRunner } from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type V08Fixture,
  createFakeGitHub,
  makeTempDir,
  makeV08Fixture,
} from '@ai-lore-companion/core/testing';
import { createSpaceMigrationRegister } from '../../../src/main/space/ipc/migration.js';
import type {
  SpaceMigrationChooseFolderResult,
  SpaceMigrationForm,
  SpaceMigrationPlanResult,
  SpaceMigrationRunResult,
  SpaceMigrationStateResult,
  SpaceMigrationStopResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../src/shared/ipc.js';
import { SPACE_MIGRATION_CONTRACT } from '../../../src/shared/ipc/space/migration.contract.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The IPC of migration from v0.8, on `makeV08Fixture` and core's FakeGitHub. No test reads
// the real project or reaches live GitHub: the GitHub port is the fake, given as a part.

const OWNER = 'fake-human';
const PROGRESS = SPACE_MIGRATION_CONTRACT.onSpaceMigrationProgress.channel;
const FORM: SpaceMigrationForm = {
  private: true,
  payloadGitHub: `${OWNER}/fixture-project`,
  description: 'The migrated fixture.',
};

const fine = { kind: 'fine', version: '1.0' } as const;
const READY_MACHINE: MachineCheck = {
  ready: true,
  engines: [],
  requirements: (['git', 'gh', 'engine', 'python3'] as const).map((id) => ({
    id,
    binary: id === 'engine' ? 'claude' : id,
    state: fine,
    guidance: null,
    command: null,
  })),
};

let fake: FakeGitHub;
let temp: { dir: string; cleanup: () => void };
let v08: V08Fixture;
let older: V08Fixture;
let picked: string | null = null;
/** Called when a plan or a run takes the GitHub port; a test sets it to act as a run starts. */
let onGitHub: () => void = () => {};
/** Called by the machine check of step 2; a test sets it to act in the middle of a run. */
let onMachineCheck: () => void | Promise<void> = () => {};
let h: SpaceHarness;

before(async () => {
  temp = makeTempDir('ai-lore-migration-ipc-');
  fake = createFakeGitHub({ account: OWNER });
  v08 = await makeV08Fixture();
  older = await makeV08Fixture({ coreVersion: '0.7', name: 'older-project' });
  h = spaceHarnessFor(
    createSpaceMigrationRegister({
      templateDir: () => ({ ok: true, value: LORE_TEMPLATE_DIR }),
      pickFolder: async () => picked,
      runner: async (deps) => deps.space.runner,
      github: () => {
        onGitHub();
        return fake;
      },
      checkMachine: async () => {
        await onMachineCheck();
        return READY_MACHINE;
      },
      gitConfig: {
        'user.name': 'AI-Lore Test',
        'user.email': 'test@ai-lore.invalid',
        'commit.gpgsign': 'false',
      },
      pause: async () => {},
    }),
  );
});

after(() => {
  h.cleanup();
  fake.dispose();
  v08.cleanup();
  older.cleanup();
  temp.cleanup();
});

function folder(name: string): string {
  const path = join(temp.dir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

/** The window each folder is open in; the host keeps one window per folder. */
const openIn = new Map<string, FakeSpaceWindow>();

/**
 * A window of the welcome screen that opens `root`, which detection sends to
 * the migration screen. A window already open on `root` is closed first, as
 * the Human Lead would close it before opening the folder again.
 */
async function migrationWindow(root: string): Promise<FakeSpaceWindow> {
  const previous = openIn.get(root);
  if (previous !== undefined) {
    previous.destroy();
    await h.space.host.windowClosed(previous.id);
  }
  h.space.host.openWelcome();
  const window = h.space.created.at(-1);
  assert.ok(window);
  window.finishLoad();
  const opened = await h.space.host.openFolder(window, root);
  assert.ok(opened.ok, opened.ok ? '' : opened.error.message);
  assert.equal(opened.value.mode, 'migration');
  window.finishLoad();
  const record = h.space.host.windowFor({ sender: { id: window.webContents.id } });
  assert.equal(record?.init.mode, 'migration');
  openIn.set(root, window);
  return window;
}

async function choose(window: FakeSpaceWindow, path: string): Promise<void> {
  picked = path;
  const chosen = (await h.invoke(
    'spaceMigrationChooseFolder',
    window,
    {},
  )) as SpaceMigrationChooseFolderResult;
  assert.ok(chosen.ok, chosen.ok ? '' : chosen.error.message);
}

async function plan(window: FakeSpaceWindow, form: SpaceMigrationForm = FORM) {
  const result = (await h.invoke('spaceMigrationPlan', window, form)) as SpaceMigrationPlanResult;
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  return result.value;
}

function run(window: FakeSpaceWindow | { webContentsId: number }, arg: unknown) {
  return h.invoke('spaceMigrationRun', window, arg) as Promise<SpaceMigrationRunResult>;
}

/** The head and status of both source repositories: what the migration must leave as it was. */
async function sourceState(fixture: V08Fixture): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [fixture.root, fixture.memoryPath]) {
    for (const args of [
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain'],
    ]) {
      const result = await execFileRunner.run('git', ['--no-optional-locks', ...args], {
        cwd: dir,
      });
      out.push(`${dir} ${args[0]} ${result.stdout}`);
    }
  }
  return out;
}

test('the channels refuse a stranger, a window that is not the migration screen and a folder in the form', async () => {
  const stranger = (await h.invoke(
    'spaceMigrationState',
    { webContentsId: 424242 },
    {},
  )) as SpaceMigrationStateResult;
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.error.kind, 'not-a-space-window');

  h.space.host.openWelcome();
  const welcome = h.space.created.at(-1);
  assert.ok(welcome);
  const notHere = (await h.invoke('spaceMigrationPlan', welcome, FORM)) as SpaceMigrationPlanResult;
  assert.equal(notHere.ok, false);
  if (!notHere.ok) assert.equal(notHere.error.kind, 'not-allowed-here');

  const window = await migrationWindow(v08.root);
  const state = (await h.invoke('spaceMigrationState', window, {})) as SpaceMigrationStateResult;
  assert.ok(state.ok);
  assert.equal(state.value.sourceRoot, v08.root);
  assert.equal(state.value.running, false);
  assert.equal(state.value.interrupted, null);

  const withFolder = (await h.invoke('spaceMigrationPlan', window, {
    ...FORM,
    parentDir: '/etc',
  })) as SpaceMigrationPlanResult;
  assert.equal(withFolder.ok, false, 'a folder in the form is refused');
  if (!withFolder.ok) assert.equal(withFolder.error.kind, 'invalid-argument');

  picked = null;
  const cancelled = (await h.invoke(
    'spaceMigrationChooseFolder',
    window,
    {},
  )) as SpaceMigrationChooseFolderResult;
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.error.kind, 'cancelled');

  const noSpace = (await h.invoke('spaceMigrationOpenSpace', window, {})) as SpaceWindowResult;
  assert.equal(noSpace.ok, false);
});

test('older than v0.8: the migration screen is told so, and a plan is refused with the sentence to upgrade first', async () => {
  const window = await migrationWindow(older.root);
  const init = h.space.host.windowFor({ sender: { id: window.webContents.id } })?.init;
  assert.ok(init?.mode === 'migration');
  assert.equal(init.legacy.versionStanding, 'older');
  assert.equal(init.legacy.migratable, false);
  const refused = (await h.invoke('spaceMigrationPlan', window, FORM)) as SpaceMigrationPlanResult;
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.error.kind, 'refused');
    assert.equal(refused.error.refusal?.kind, 'older-than-v0.8');
    assert.match(refused.error.message, /upgrade the project to v0\.8 first/);
  }
});

test('the plan shows what will go where, writes nothing, and leaves the source as it was', async () => {
  const before = await sourceState(v08);
  const window = await migrationWindow(v08.root);
  const parent = folder('plan-parent');
  await choose(window, parent);
  const value = await plan(window);
  assert.equal(value.plan.ready, true, JSON.stringify(value.plan.fields));
  assert.ok(value.token !== null && value.token.length >= 32);
  assert.equal(value.plan.source.projectName, 'fixture-project');
  assert.equal(value.plan.source.coreVersion, '0.8');
  assert.equal(value.plan.spaceRoot, join(parent, 'fixture-project-space'));
  assert.equal(value.plan.repository, `${OWNER}/fixture-project-space`);
  assert.equal(value.plan.steps.length, 13);
  assert.ok(value.plan.mapping.some((row) => row.id === 'archive' && row.count > 0));
  assert.ok(value.plan.issues.length > 0);
  const stage = value.plan.fields.find((field) => field.id === 'focusStage');
  assert.equal(stage?.value, 'Build');
  assert.ok(!JSON.stringify(value.plan.source).includes('@'), 'no credentials in an origin');
  const found = await fake.findRepository(`${OWNER}/fixture-project-space`);
  assert.ok(found.ok && found.value === null, 'nothing was created on GitHub');
  assert.deepEqual(await sourceState(v08), before);
});

test('a run needs the token of the window’s last plan: none, another, another window’s, or after another folder is refused', async () => {
  const window = await migrationWindow(v08.root);
  await choose(window, folder('bind-parent'));
  const none = await run(window, { token: 'x'.repeat(36) });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.error.kind, 'not-planned');

  const first = await plan(window);
  const second = await plan(window);
  assert.ok(first.token !== null && second.token !== null);
  const stale = await run(window, { token: first.token });
  assert.equal(stale.ok, false, 'the token of an older plan is refused');
  if (!stale.ok) assert.equal(stale.error.kind, 'not-planned');

  const other = await migrationWindow(older.root);
  const fromOther = await run(other, { token: second.token });
  assert.equal(fromOther.ok, false, "another window's token is refused");
  if (!fromOther.ok) assert.equal(fromOther.error.kind, 'not-planned');

  await choose(window, folder('bind-parent-2'));
  const afterFolder = await run(window, { token: second.token });
  assert.equal(afterFolder.ok, false, 'another folder drops the plan');
  if (!afterFolder.ok) assert.equal(afterFolder.error.kind, 'not-planned');

  const unready = await plan(window, { ...FORM, description: '' });
  assert.equal(unready.plan.ready, false);
  assert.equal(unready.token, null, 'a plan that is not ready has no token');
});

test('a refused run creates nothing: a forged token, a plan that was being made when another folder was chosen, a welcome window', async () => {
  const form: SpaceMigrationForm = { ...FORM, name: 'refused-space' };
  const window = await migrationWindow(v08.root);
  const parent = folder('refused-parent');
  await choose(window, parent);
  for (const arg of [{}, { token: 42 }, { token: 'x'.repeat(101) }, { token: 't', form }]) {
    const refused = await run(window, arg);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.kind, 'invalid-argument', JSON.stringify(arg));
  }
  const forged = await run(window, { token: '00000000-0000-4000-8000-000000000000' });
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.error.kind, 'not-planned');

  // Another folder is chosen while the plan is being made: that plan's token is not accepted.
  const planning = h.invoke(
    'spaceMigrationPlan',
    window,
    form,
  ) as Promise<SpaceMigrationPlanResult>;
  await choose(window, folder('refused-parent-2'));
  const raced = await planning;
  if (raced.ok && raced.value.token !== null) {
    const late = await run(window, { token: raced.value.token });
    assert.equal(late.ok, false, 'a plan made with the folder before is not run');
    if (!late.ok) assert.equal(late.error.kind, 'not-planned');
  }

  const { token } = await plan(window, form);
  assert.ok(token !== null);
  h.space.host.openWelcome();
  const welcome = h.space.created.at(-1);
  assert.ok(welcome);
  const fromWelcome = await run(welcome, { token });
  assert.equal(fromWelcome.ok, false);
  if (!fromWelcome.ok) assert.equal(fromWelcome.error.kind, 'not-allowed-here');

  const found = await fake.findRepository(`${OWNER}/refused-space`);
  assert.ok(found.ok && found.value === null, 'nothing was created on GitHub');
  assert.equal(existsSync(join(parent, 'refused-space')), false, 'nothing was created on disk');
  assert.equal(existsSync(join(temp.dir, 'refused-parent-2', 'refused-space')), false);
});

test('two sources cannot be migrated into the same new Space folder at once', async () => {
  const second = await makeV08Fixture({ name: 'second-project' });
  try {
    const parent = folder('shared-parent');
    const form: SpaceMigrationForm = { ...FORM, name: 'shared-space' };
    const first = await migrationWindow(v08.root);
    await choose(first, parent);
    const a = await plan(first, form);
    const other = await migrationWindow(second.root);
    await choose(other, parent);
    const b = await plan(other, { ...form, payloadGitHub: `${OWNER}/second-project` });
    assert.ok(a.token !== null && b.token !== null);
    assert.equal(a.plan.spaceRoot, b.plan.spaceRoot);
    let release: () => void = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    let started: () => void = () => {};
    const inStep = new Promise<void>((done) => {
      started = done;
    });
    // The first run waits in step 2's machine check while the second is asked.
    onMachineCheck = async () => {
      started();
      await held;
    };
    const running = run(first, { token: a.token });
    await inStep;
    const refused = await run(other, { token: b.token });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.error.kind, 'already-running');
      assert.match(refused.error.message, /shared-space/);
    }
    await h.invoke('spaceMigrationStop', first, {});
    release();
    const ended = await running;
    assert.equal(ended.ok, false);
    if (!ended.ok) assert.equal(ended.error.kind, 'stopped');
  } finally {
    onMachineCheck = () => {};
    second.cleanup();
  }
});

test('a run reports each step’s state in words, and a stop in the middle ends it before the next step', async () => {
  const window = await migrationWindow(v08.root);
  await choose(window, folder('progress-parent'));
  const { token } = await plan(window);
  assert.ok(token !== null);
  onMachineCheck = () => {
    void h.invoke('spaceMigrationStop', window, {});
  };
  const result = await run(window, { token }).finally(() => {
    onMachineCheck = () => {};
  });
  assert.equal(result.ok, false);
  const progress = window.sent
    .filter((m) => m.channel === PROGRESS)
    .map((m) => m.payload as StepProgress);
  assert.deepEqual(
    progress.slice(0, 2).map((p) => [p.stepId, p.state]),
    [
      ['record-source', 'checking'],
      ['record-source', 'running'],
    ],
  );
  assert.ok(progress.every((p) => p.total === 13 && typeof p.title === 'string'));
  assert.ok(
    progress.some((p) => p.stepId === 'create-space'),
    'step 2 started',
  );
  if (!result.ok && result.error.kind === 'stopped') {
    assert.notEqual(result.error.stepId, 'record-source');
  }
});

test('a run goes once per window, and can be stopped before its first step', async () => {
  const window = await migrationWindow(v08.root);
  await choose(window, folder('stop-parent'));
  const { token } = await plan(window);
  assert.ok(token !== null);
  const running = run(window, { token });
  const twice = await run(window, { token });
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.equal(twice.error.kind, 'already-running');
  const busyPlan = (await h.invoke('spaceMigrationPlan', window, FORM)) as SpaceMigrationPlanResult;
  assert.equal(busyPlan.ok, false);
  const stopped = (await h.invoke('spaceMigrationStop', window, {})) as SpaceMigrationStopResult;
  assert.deepEqual(stopped, { ok: true, value: { stopping: true } });
  const result = await running;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, 'stopped');
    assert.match(result.error.message, /stopped before the step/);
  }
  const state = (await h.invoke('spaceMigrationState', window, {})) as SpaceMigrationStateResult;
  assert.ok(state.ok && state.value.running === false);
});

test('closing the window mid-run stops it, and the folder opened again is told the run was interrupted', async () => {
  const before = await sourceState(v08);
  const window = await migrationWindow(v08.root);
  const parent = folder('closed-parent');
  await choose(window, parent);
  const { token } = await plan(window);
  assert.ok(token !== null);
  // The window closes as the run starts: the step that starts finishes, and the run stops before the next.
  onGitHub = () => window.destroy();
  const result = await run(window, { token }).finally(() => {
    onGitHub = () => {};
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'stopped');
  const progress = window.sent.filter((m) => m.channel === PROGRESS);
  assert.equal(progress.length, 0, 'nothing is sent to a closed window');

  const again = await migrationWindow(v08.root);
  const state = (await h.invoke('spaceMigrationState', again, {})) as SpaceMigrationStateResult;
  assert.ok(state.ok);
  assert.equal(state.value.interrupted?.spaceRoot, join(parent, 'fixture-project-space'));
  assert.deepEqual(await sourceState(v08), before);
});
