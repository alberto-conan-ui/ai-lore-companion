import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  type CommandRunner,
  type GitHubPort,
  type MachineCheck,
  type RunResult,
  execFileRunner,
} from '@ai-lore-companion/core';
import { type FakeGitHub, createFakeGitHub, makeTempDir } from '@ai-lore-companion/core/testing';
import { saveGlobalSetting } from '../../../src/main/settings.js';
import { createAppGitHubPort } from '../../../src/main/space/github-service.js';
import { createSpaceSetupRegister, runnerWithPath } from '../../../src/main/space/ipc/setup.js';
import { SPACES_FOLDER_KEY } from '../../../src/main/space/spaces-folder.js';
import { loreTemplateDir } from '../../../src/main/space/template-dir.js';
import type {
  SpaceSetupChooseFolderResult,
  SpaceSetupChooseSourceResult,
  SpaceSetupForm,
  SpaceSetupListSpacesResult,
  SpaceSetupPlanProgress,
  SpaceSetupPlanResult,
  SpaceSetupRunResult,
  SpaceSetupStateResult,
  SpaceSetupStopResult,
  SpaceSetupValidateResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../src/shared/ipc.js';
import { SPACE_SETUP_CONTRACT } from '../../../src/shared/ipc/space/setup.contract.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The IPC of creating a Space, against core's FakeGitHub, bare git remotes in
// temporary folders and real git. No test reaches live GitHub: the GitHub port
// is the fake, given to the module as one of its parts.

const OWNER = 'fake-human';
const GIT_CONFIG = {
  'user.name': 'AI-Lore Test',
  'user.email': 'test@ai-lore.invalid',
  'commit.gpgsign': 'false',
};
const PROGRESS = SPACE_SETUP_CONTRACT.onSpaceSetupProgress.channel;

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
  github: { account: null, organisations: [] },
  tools: { brew: true, npm: true },
};

let fake: FakeGitHub;
let temp: { dir: string; cleanup: () => void };
let picked: string | null = null;
/** Called by the machine-check step; a test sets it to act in the middle of a run. */
let onMachineCheck: () => void = () => {};
let h: SpaceHarness;

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await execFileRunner.run('git', args, { cwd });
  assert.equal(result.code, 0, `git ${args.join(' ')}: ${result.stderr}`);
}

/** A repository on the fake GitHub with one pushed commit, and its local checkout. */
async function seedRepository(name: string): Promise<{ fullName: string; checkout: string }> {
  const created = await fake.createRepository({ owner: OWNER, name, private: true });
  assert.ok(created.ok);
  const checkout = join(temp.dir, `seed-${name}`);
  mkdirSync(checkout);
  await git(checkout, 'init', '-b', 'main');
  writeFileSync(join(checkout, 'README.md'), `# ${name}\n`);
  await git(checkout, 'add', '-A');
  await git(
    checkout,
    '-c',
    'user.name=Seed',
    '-c',
    'user.email=seed@ai-lore.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'First commit',
  );
  await git(checkout, 'remote', 'add', 'origin', created.value.cloneUrl);
  await git(checkout, 'push', '-u', 'origin', 'main');
  return { fullName: created.value.fullName, checkout };
}

function folder(name: string): string {
  const path = join(temp.dir, name);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A window of the welcome screen, then the setup screen of `start`. */
async function setupWindow(start: 'new' | 'from-address'): Promise<FakeSpaceWindow> {
  h.space.host.openWelcome();
  const window = h.space.created.at(-1);
  assert.ok(window);
  window.finishLoad();
  const shown = await h.space.host.navigate(window, { to: 'setup', start });
  assert.ok(shown.ok);
  return window;
}

async function choose(window: FakeSpaceWindow, path: string): Promise<void> {
  picked = path;
  const chosen = (await h.invoke(
    'spaceSetupChooseFolder',
    window,
    {},
  )) as SpaceSetupChooseFolderResult;
  assert.ok(chosen.ok, chosen.ok ? '' : chosen.error.message);
}

/** Ask for the plan of `form` and return its token. */
async function planned(window: FakeSpaceWindow, form: SpaceSetupForm): Promise<string> {
  const plan = (await h.invoke('spaceSetupPlan', window, form)) as SpaceSetupPlanResult;
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.ok(plan.value.token.length >= 32);
  return plan.value.token;
}

function run(
  window: FakeSpaceWindow | { webContentsId: number },
  arg: unknown,
): Promise<SpaceSetupRunResult> {
  return h.invoke('spaceSetupRun', window, arg) as Promise<SpaceSetupRunResult>;
}

function progressOf(window: FakeSpaceWindow): StepProgress[] {
  return window.sent.filter((m) => m.channel === PROGRESS).map((m) => m.payload as StepProgress);
}

const PLAN_PROGRESS = SPACE_SETUP_CONTRACT.onSpaceSetupPlanProgress.channel;

function planProgressOf(window: FakeSpaceWindow): SpaceSetupPlanProgress[] {
  return window.sent
    .filter((m) => m.channel === PLAN_PROGRESS)
    .map((m) => m.payload as SpaceSetupPlanProgress);
}

const ORGANISATIONS = ['acme-org'];

/** A repository on the fake GitHub with a pushed `lore/space.md`, so `listSpaceRepositories` finds it. */
async function seedSpaceRepository(name: string): Promise<{ fullName: string }> {
  const created = await fake.createRepository({ owner: OWNER, name, private: true });
  assert.ok(created.ok);
  const checkout = join(temp.dir, `seed-space-${name}`);
  mkdirSync(join(checkout, 'lore'), { recursive: true });
  await git(checkout, 'init', '-b', 'main');
  writeFileSync(join(checkout, 'lore', 'space.md'), '# Space\n');
  await git(checkout, 'add', '-A');
  await git(
    checkout,
    '-c',
    'user.name=Seed',
    '-c',
    'user.email=seed@ai-lore.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Seed a Space manifest',
  );
  await git(checkout, 'remote', 'add', 'origin', created.value.cloneUrl);
  await git(checkout, 'push', '-u', 'origin', 'main');
  return { fullName: created.value.fullName };
}

before(() => {
  temp = makeTempDir('ai-lore-setup-ipc-');
  fake = createFakeGitHub({ account: OWNER, organisations: ORGANISATIONS });
  h = spaceHarnessFor(
    createSpaceSetupRegister({
      templateDir: () => ({ ok: true, value: LORE_TEMPLATE_DIR }),
      pickFolder: async () => picked,
      runner: async (deps) => deps.space.runner,
      github: () => fake,
      checkMachine: async () => {
        onMachineCheck();
        return READY_MACHINE;
      },
      gitConfig: GIT_CONFIG,
      spacesFolder: () => null,
      owners: async () => ({ account: OWNER, organisations: ORGANISATIONS }),
      planTimeLimitMs: 5_000,
      defaultsFile: () => join(temp.dir, 'setup-defaults.json'),
    }),
  );
});

after(() => {
  h.cleanup();
  fake.dispose();
  temp.cleanup();
});

test('the channels refuse a stranger, a window that is not setup, the other flow and a bad argument', async () => {
  const stranger = (await h.invoke(
    'spaceSetupState',
    { webContentsId: 424242 },
    {},
  )) as SpaceSetupStateResult;
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.error.kind, 'not-a-space-window');

  h.space.host.openWelcome();
  const welcome = h.space.created.at(-1);
  assert.ok(welcome);
  const notSetup = (await h.invoke('spaceSetupState', welcome, {})) as SpaceSetupStateResult;
  assert.equal(notSetup.ok, false);
  if (!notSetup.ok) assert.equal(notSetup.error.kind, 'not-allowed-here');

  const window = await setupWindow('new');
  const state = (await h.invoke('spaceSetupState', window, {})) as SpaceSetupStateResult;
  assert.deepEqual(state, {
    ok: true,
    value: {
      flow: 'create',
      parentDir: null,
      sourceDir: null,
      originUrl: null,
      source: null,
      owners: { account: OWNER, organisations: ORGANISATIONS, defaultOwner: OWNER },
      spacesFolder: null,
      running: false,
      interrupted: null,
    },
  });
  const otherFlow = (await h.invoke('spaceSetupPlan', window, {
    flow: 'open',
    address: 'fake-human/x',
    repositories: [],
  })) as SpaceSetupPlanResult;
  assert.equal(otherFlow.ok, false);
  if (!otherFlow.ok) assert.equal(otherFlow.error.kind, 'not-allowed-here');

  const withPath = (await h.invoke('spaceSetupPlan', window, {
    flow: 'create',
    name: 'x',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
    parentDir: '/etc',
  })) as SpaceSetupPlanResult;
  assert.equal(withPath.ok, false, 'a folder in the form is refused');
  if (!withPath.ok) assert.equal(withPath.error.kind, 'invalid-argument');

  picked = null;
  const cancelled = (await h.invoke(
    'spaceSetupChooseFolder',
    window,
    {},
  )) as SpaceSetupChooseFolderResult;
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) assert.equal(cancelled.error.kind, 'cancelled');

  const noSpace = (await h.invoke('spaceSetupOpenSpace', window, {})) as SpaceWindowResult;
  assert.equal(noSpace.ok, false);
});

test('the template folder is found above the code, or setup fails with a literal reason', () => {
  const found = loreTemplateDir();
  assert.ok(found.ok, found.ok ? '' : found.error.message);
  assert.ok(existsSync(join(found.value, 'lore')));
  const missing = loreTemplateDir({ from: folder('no-template-here') });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.kind, 'template-missing');
    assert.match(missing.error.message, /The Lore template was not found/);
  }
});

test('the GitHub port of setup, the app one, never starts gh in a test run and takes the fake only in end-to-end mode', async () => {
  const port = await createAppGitHubPort({ runner: execFileRunner, env: { AI_LORE_TEST: '1' } });
  const answer = await port.findRepository('fake-human/x');
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.error.kind, 'unreachable');
  const stateFile = join(folder('fake-state'), 'github.json');
  const noMode = await createAppGitHubPort({
    runner: execFileRunner,
    env: { AI_LORE_TEST: '1', AI_LORE_FAKE_GITHUB: stateFile },
  });
  const refused = await noMode.findRepository('fake-human/x');
  assert.equal(refused.ok, false, 'the fake is not taken outside end-to-end mode');
  if (!refused.ok) assert.equal(refused.error.kind, 'unreachable');
  const echo: CommandRunner = {
    run: async (_bin, _args, opts) =>
      ({ code: 0, stdout: opts?.env?.PATH ?? '', stderr: '' }) as RunResult,
  };
  const runner = runnerWithPath(echo, '/login/bin');
  assert.equal((await runner.run('git', [])).stdout, '/login/bin');
});

test('create: live validation, the plan, the run with progress, run again, open the Space; then open it by address twice', async () => {
  const app = await seedRepository('app');
  const window = await setupWindow('new');
  const parent = folder('parent-create');
  await choose(window, parent);

  const invalid = (await h.invoke('spaceSetupValidate', window, {
    flow: 'create',
    name: 'bad name',
    description: '',
    owner: '',
    private: true,
    repositories: [{ address: 'not an address' }],
  })) as SpaceSetupValidateResult;
  assert.ok(invalid.ok);
  const fields = invalid.value.problems.map((problem) => problem.field);
  assert.ok(fields.includes('name'), fields.join());
  assert.ok(fields.includes('owner'), fields.join());
  assert.ok(fields.includes('repositories[0].github'), fields.join());
  assert.ok(!fields.includes('repositories[0].name'), 'an address with no name has one problem');

  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'demo-space',
    description: 'A Space for the tests.',
    owner: OWNER,
    private: true,
    repositories: [{ address: `https://github.com/${app.fullName}` }],
  };
  const valid = (await h.invoke('spaceSetupValidate', window, form)) as SpaceSetupValidateResult;
  assert.deepEqual(valid, {
    ok: true,
    value: {
      problems: [],
      target: { spaceRoot: join(parent, 'demo-space'), state: 'absent', message: null },
    },
  });

  fake.calls.length = 0;
  const plan = (await h.invoke('spaceSetupPlan', window, form)) as SpaceSetupPlanResult;
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.plan.spaceRoot, join(parent, 'demo-space'));
  assert.equal(plan.value.plan.target, 'absent');
  assert.equal(plan.value.github?.repository, `${OWNER}/demo-space`);
  assert.equal(plan.value.github?.visibility, 'private');
  assert.equal(plan.value.github?.repositoryExists, false);
  assert.equal(plan.value.github?.repositoryUrl, null);
  assert.equal(plan.value.github?.projectUrl, null);
  assert.ok((plan.value.github?.labels.length ?? 0) > 0);
  assert.ok(
    !fake.calls.some((call) => call.operation === 'createRepository'),
    'the plan creates nothing',
  );
  assert.ok(!existsSync(join(parent, 'demo-space')), 'the plan writes nothing');

  const planEvents = planProgressOf(window);
  assert.ok(planEvents.length > 0);
  const [firstPlanEvent] = planEvents;
  assert.ok(firstPlanEvent);
  assert.ok(planEvents.every((event) => event.planId === firstPlanEvent.planId));
  assert.deepEqual(
    planEvents.map((event) => `${event.checkId}:${event.state}`),
    [
      'folder:running',
      'folder:done',
      'repository:running',
      'project:running',
      'repository:done',
      'project:done',
      'steps:running',
      'steps:done',
    ],
  );

  // The first run fails on GitHub; the second continues and repeats nothing.
  fake.setUnreachable(true);
  const failed = await run(window, { token: plan.value.token });
  fake.setUnreachable(false);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.error.stepId, 'space-repository');
    assert.ok(failed.error.message.length > 0);
  }
  const firstEvents = progressOf(window);
  assert.equal(firstEvents[0]?.state, 'checking');
  assert.equal(firstEvents.at(-1)?.state, 'failed');

  window.sent.length = 0;
  const ran = await run(window, { token: plan.value.token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);
  assert.equal(ran.value.spaceRoot, join(parent, 'demo-space'));
  assert.ok(
    ran.value.skipped.includes('machine-check') || ran.value.completed.includes('machine-check'),
  );
  assert.ok(Array.isArray(ran.value.byHand));
  assert.ok(existsSync(join(parent, 'demo-space', 'repos', 'app', '.git')));
  const states = new Set(progressOf(window).map((event) => event.state));
  assert.ok(states.has('done'));
  assert.ok(!states.has('failed'));

  const again = (await h.invoke('spaceSetupPlan', window, form)) as SpaceSetupPlanResult;
  assert.ok(again.ok);
  assert.equal(again.value.plan.target, 'half-made');
  assert.equal(again.value.github?.repositoryExists, true);
  assert.ok((again.value.github?.repositoryUrl?.length ?? 0) > 0);
  assert.equal(
    again.value.plan.complete,
    true,
    'the whole flow of a full run leaves nothing to do',
  );

  const opened = (await h.invoke('spaceSetupOpenSpace', window, {})) as SpaceWindowResult;
  assert.deepEqual(opened, { ok: true, value: { mode: 'space' } });

  // Open by address: the first run clones the Space and lists its repositories; the second clones the confirmed one.
  const byAddress = await setupWindow('from-address');
  const elsewhere = folder('parent-open');
  await choose(byAddress, elsewhere);
  const open: SpaceSetupForm = { flow: 'open', address: `${OWNER}/demo-space`, repositories: [] };
  const openPlan = (await h.invoke('spaceSetupPlan', byAddress, open)) as SpaceSetupPlanResult;
  assert.ok(openPlan.ok, openPlan.ok ? '' : openPlan.error.message);
  assert.equal(openPlan.value.github, null);
  const first = await run(byAddress, { token: openPlan.value.token, repositories: [] });
  assert.ok(first.ok, first.ok ? '' : first.error.message);
  assert.deepEqual(first.value.repositories, [
    { name: 'app', github: app.fullName, cloned: false },
  ]);
  const second = await run(byAddress, { token: openPlan.value.token, repositories: ['app'] });
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.deepEqual(second.value.repositories, [
    { name: 'app', github: app.fullName, cloned: true },
  ]);
  assert.ok(existsSync(join(elsewhere, 'demo-space', 'repos', 'app', '.git')));
});

test('a plan refused because the target folder holds something else offers no run', async () => {
  const window = await setupWindow('new');
  const parent = folder('parent-taken');
  mkdirSync(join(parent, 'taken-space'));
  writeFileSync(join(parent, 'taken-space', 'notes.txt'), 'mine\n');
  await choose(window, parent);
  const plan = (await h.invoke('spaceSetupPlan', window, {
    flow: 'create',
    name: 'taken-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  })) as SpaceSetupPlanResult;
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.equal(plan.error.kind, 'target-not-empty');
});

test('adopt: the folder main opened is the source, and the plan names what is created on GitHub', async () => {
  const plain = await seedRepository('plain');
  const opened = await h.space.host.openFolder(undefined, plain.checkout);
  assert.deepEqual(opened, { ok: true, value: { mode: 'not-a-space' } });
  const window = h.space.created.at(-1);
  assert.ok(window);
  const shown = await h.space.host.navigate(window, { to: 'setup', start: 'about-this-folder' });
  assert.ok(shown.ok, shown.ok ? '' : shown.error.message);
  const state = (await h.invoke('spaceSetupState', window, {})) as SpaceSetupStateResult;
  assert.ok(state.ok);
  assert.equal(state.value.flow, 'adopt');
  assert.ok(state.value.sourceDir?.endsWith('seed-plain'));
  await choose(window, folder('parent-adopt'));
  const plan = (await h.invoke('spaceSetupPlan', window, {
    flow: 'adopt',
    name: 'plain-space',
    description: '',
    owner: OWNER,
    private: false,
    github: plain.fullName,
  })) as SpaceSetupPlanResult;
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.plan.flow, 'adopt');
  assert.equal(plan.value.github?.visibility, 'public');
  assert.ok(plan.value.plan.steps.some((step) => step.stepId === 'clone:plain'));
});

test('stop ends the run before its next step; a second run of the window is refused meanwhile', async () => {
  const window = await setupWindow('new');
  await choose(window, folder('parent-stop'));
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'stopped-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const running = run(window, { token });
  const twice = await run(window, { token });
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.equal(twice.error.kind, 'already-running');
  const stop = (await h.invoke('spaceSetupStop', window, {})) as SpaceSetupStopResult;
  assert.deepEqual(stop, { ok: true, value: { stopping: true } });
  const result = await running;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'stopped');
  const state = (await h.invoke('spaceSetupState', window, {})) as SpaceSetupStateResult;
  assert.ok(state.ok);
  assert.equal(state.value.running, false);
});

test('closing the window mid-run stops after the current step and says the run can be resumed', async () => {
  const window = await setupWindow('new');
  const parent = folder('parent-closed');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'closed-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  onMachineCheck = () => window.destroy();
  const result = await run(window, { token });
  onMachineCheck = () => {};
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, 'stopped');
    assert.equal(
      result.error.stepId,
      'space-repository',
      'the machine check, which was running, finished',
    );
  }

  const next = await setupWindow('new');
  const state = (await h.invoke('spaceSetupState', next, {})) as SpaceSetupStateResult;
  assert.ok(state.ok);
  assert.deepEqual(state.value.interrupted, {
    flow: 'create',
    spaceRoot: join(parent, 'closed-space'),
    form,
  });
});

test('a run runs only the plan the window showed: no plan, another plan, another window, another folder, a form or a path are refused', async () => {
  const kindOf = (result: SpaceSetupRunResult): string => (result.ok ? 'ok' : result.error.kind);
  const window = await setupWindow('new');
  const parent = folder('parent-bound');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'bound-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  fake.calls.length = 0;

  assert.equal(kindOf(await run(window, { token: 'guessed' })), 'not-planned', 'no plan');
  assert.equal(kindOf(await run(window, form)), 'invalid-argument', 'a form is not a run');

  const first = await planned(window, form);
  const second = await planned(window, { ...form, name: 'other-space' });
  assert.equal(kindOf(await run(window, { token: first })), 'not-planned', 'an older plan');
  for (const forged of [
    { token: second, parentDir: '/etc' },
    { token: second, sourceDir: '/etc' },
    { token: second, input: { parentDir: '/etc' } },
  ]) {
    assert.equal(kindOf(await run(window, forged)), 'invalid-argument', JSON.stringify(forged));
  }
  assert.equal(
    kindOf(await run(window, { token: second, repositories: ['x'] })),
    'invalid-argument',
    'create takes no repositories at run time',
  );
  const chooseWithPath = (await h.invoke('spaceSetupChooseFolder', window, {
    path: '/etc',
  })) as SpaceSetupChooseFolderResult;
  assert.equal(chooseWithPath.ok, false);
  const validateWithPath = (await h.invoke('spaceSetupValidate', window, {
    ...form,
    sourceDir: '/etc',
  })) as SpaceSetupValidateResult;
  assert.equal(validateWithPath.ok, false);

  const other = await setupWindow('new');
  await choose(other, folder('parent-bound-other'));
  assert.equal(kindOf(await run(other, { token: second })), 'not-planned', 'another window');
  assert.equal(
    kindOf(await run({ webContentsId: 525252 }, { token: second })),
    'not-a-space-window',
  );
  h.space.host.openWelcome();
  const welcome = h.space.created.at(-1);
  assert.ok(welcome);
  assert.equal(kindOf(await run(welcome, { token: second })), 'not-allowed-here');

  await choose(window, folder('parent-bound-moved'));
  assert.equal(kindOf(await run(window, { token: second })), 'not-planned', 'another folder');
  assert.ok(
    !fake.calls.some((call) => call.operation.startsWith('create')),
    'nothing was created on GitHub',
  );
  assert.ok(!existsSync(join(parent, 'bound-space')) && !existsSync(join(parent, 'other-space')));

  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);
  assert.equal(ran.value.spaceRoot, join(temp.dir, 'parent-bound-moved', 'bound-space'));
});

test('a new window is offered the Spaces folder setting as its folder', async () => {
  const spacesFolderTemp = makeTempDir('ai-lore-setup-spaces-folder-');
  const h2 = spaceHarnessFor(
    createSpaceSetupRegister({
      templateDir: () => ({ ok: true, value: LORE_TEMPLATE_DIR }),
      pickFolder: async () => null,
      runner: async (deps) => deps.space.runner,
      github: () => fake,
      checkMachine: async () => READY_MACHINE,
      gitConfig: GIT_CONFIG,
      owners: async () => ({ account: OWNER, organisations: ORGANISATIONS }),
      defaultsFile: () => join(spacesFolderTemp.dir, 'setup-defaults.json'),
    }),
  );
  try {
    saveGlobalSetting(h2.space.userDataDir, SPACES_FOLDER_KEY, spacesFolderTemp.dir);
    h2.space.host.openWelcome();
    const window = h2.space.created.at(-1);
    assert.ok(window);
    window.finishLoad();
    const shown = await h2.space.host.navigate(window, { to: 'setup', start: 'new' });
    assert.ok(shown.ok, shown.ok ? '' : shown.error.message);
    const state = (await h2.invoke('spaceSetupState', window, {})) as SpaceSetupStateResult;
    assert.ok(state.ok, state.ok ? '' : state.error.message);
    assert.equal(state.value.parentDir, spacesFolderTemp.dir);
    assert.equal(state.value.spacesFolder, spacesFolderTemp.dir);
    assert.equal(state.value.owners.account, OWNER);
  } finally {
    h2.cleanup();
    spacesFolderTemp.cleanup();
  }
});

test('after a finished run, a new window offers that run’s owner as the default', async () => {
  const window = await setupWindow('new');
  const parent = folder('parent-default-owner');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'org-space',
    description: '',
    owner: 'acme-org',
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);

  const next = await setupWindow('new');
  const state = (await h.invoke('spaceSetupState', next, {})) as SpaceSetupStateResult;
  assert.ok(state.ok, state.ok ? '' : state.error.message);
  assert.equal(state.value.owners.defaultOwner, 'acme-org');
});

test('spaceSetupValidate previews a complete Space already on disk, and spaceSetupOpenExisting opens it', async () => {
  const window = await setupWindow('new');
  const parent = folder('parent-preview');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'preview-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);

  const again = await setupWindow('new');
  await choose(again, parent);
  const validated = (await h.invoke('spaceSetupValidate', again, form)) as SpaceSetupValidateResult;
  assert.ok(validated.ok, validated.ok ? '' : validated.error.message);
  assert.equal(validated.value.target?.state, 'complete');

  const opened = (await h.invoke('spaceSetupOpenExisting', again, {})) as SpaceWindowResult;
  assert.deepEqual(opened, { ok: true, value: { mode: 'space' } });

  const notPreviewed = await setupWindow('new');
  await choose(notPreviewed, folder('parent-no-preview'));
  const refused = (await h.invoke('spaceSetupOpenExisting', notPreviewed, {})) as SpaceWindowResult;
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.kind, 'not-allowed-here');
});

test('a plan that finds nothing left to do lets spaceSetupOpenSpace open its folder without a run', async () => {
  const window = await setupWindow('new');
  const parent = folder('parent-complete');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'complete-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);

  const again = await setupWindow('new');
  await choose(again, parent);
  const plan = (await h.invoke('spaceSetupPlan', again, form)) as SpaceSetupPlanResult;
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.plan.complete, true);

  const opened = (await h.invoke('spaceSetupOpenSpace', again, {})) as SpaceWindowResult;
  assert.deepEqual(opened, { ok: true, value: { mode: 'space' } });
});

test('spaceSetupChooseSource refuses a plain folder and a repository without origin, and reads one that has it', async () => {
  h.space.host.openWelcome();
  const window = h.space.created.at(-1);
  assert.ok(window);
  window.finishLoad();
  const shown = await h.space.host.navigate(window, { to: 'setup', start: 'from-repository' });
  assert.ok(shown.ok, shown.ok ? '' : shown.error.message);

  const plain = folder('choose-source-plain');
  picked = plain;
  const notARepo = (await h.invoke(
    'spaceSetupChooseSource',
    window,
    {},
  )) as SpaceSetupChooseSourceResult;
  assert.equal(notARepo.ok, false);
  if (!notARepo.ok) assert.equal(notARepo.error.kind, 'not-a-repository');

  const noOrigin = folder('choose-source-no-origin');
  await git(noOrigin, 'init', '-b', 'main');
  picked = noOrigin;
  const originless = (await h.invoke(
    'spaceSetupChooseSource',
    window,
    {},
  )) as SpaceSetupChooseSourceResult;
  assert.equal(originless.ok, false);
  if (!originless.ok) assert.equal(originless.error.kind, 'no-origin');

  const withOrigin = folder('choose-source-with-origin');
  await git(withOrigin, 'init', '-b', 'main');
  // A real `git remote add` of a github.com address is refused in test mode
  // (the live-system guard), so the origin is written straight to the local
  // config file `originUrl` then reads back with a read-only `git config`.
  appendFileSync(
    join(withOrigin, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/octo/tool.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
  );
  picked = withOrigin;
  const chosen = (await h.invoke(
    'spaceSetupChooseSource',
    window,
    {},
  )) as SpaceSetupChooseSourceResult;
  assert.ok(chosen.ok, chosen.ok ? '' : chosen.error.message);
  assert.equal(chosen.value.name, 'choose-source-with-origin');
  assert.equal(chosen.value.github, 'octo/tool');
  assert.equal(chosen.value.originUrl, 'https://github.com/octo/tool.git');

  const state = (await h.invoke('spaceSetupState', window, {})) as SpaceSetupStateResult;
  assert.ok(state.ok, state.ok ? '' : state.error.message);
  assert.deepEqual(state.value.source, chosen.value);
});

test('spaceSetupListSpaces refuses an unknown owner and lists only repositories with a Space manifest', async () => {
  const withSpace = await seedSpaceRepository('has-space');
  await seedRepository('plain-listed');
  const window = await setupWindow('new');

  const refused = (await h.invoke('spaceSetupListSpaces', window, {
    owner: 'someone-else',
  })) as SpaceSetupListSpacesResult;
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.kind, 'unknown-owner');

  const listed = (await h.invoke('spaceSetupListSpaces', window, {
    owner: OWNER,
  })) as SpaceSetupListSpacesResult;
  assert.ok(listed.ok, listed.ok ? '' : listed.error.message);
  const names = listed.value.repositories.map((repository) => repository.fullName);
  assert.ok(names.includes(withSpace.fullName), names.join());
  assert.ok(!names.includes(`${OWNER}/plain-listed`), names.join());
});

test('a plan that runs past its time limit stops with plan-timeout naming the last running check', async () => {
  const parent = folder('parent-timeout');
  const hangingGithub: GitHubPort = {
    ...fake,
    findRepository: () => new Promise(() => {}),
  };
  const h2 = spaceHarnessFor(
    createSpaceSetupRegister({
      templateDir: () => ({ ok: true, value: LORE_TEMPLATE_DIR }),
      pickFolder: async () => parent,
      runner: async (deps) => deps.space.runner,
      github: () => hangingGithub,
      checkMachine: async () => READY_MACHINE,
      gitConfig: GIT_CONFIG,
      owners: async () => ({ account: OWNER, organisations: [] }),
      planTimeLimitMs: 50,
      defaultsFile: () => join(temp.dir, 'setup-defaults-timeout.json'),
    }),
  );
  try {
    h2.space.host.openWelcome();
    const window = h2.space.created.at(-1);
    assert.ok(window);
    window.finishLoad();
    const shown = await h2.space.host.navigate(window, { to: 'setup', start: 'new' });
    assert.ok(shown.ok, shown.ok ? '' : shown.error.message);
    const chosen = (await h2.invoke(
      'spaceSetupChooseFolder',
      window,
      {},
    )) as SpaceSetupChooseFolderResult;
    assert.ok(chosen.ok, chosen.ok ? '' : chosen.error.message);

    const plan = (await h2.invoke('spaceSetupPlan', window, {
      flow: 'create',
      name: 'timeout-space',
      description: '',
      owner: OWNER,
      private: true,
      repositories: [],
    })) as SpaceSetupPlanResult;
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.equal(plan.error.kind, 'plan-timeout');
      assert.match(plan.error.message, /Looking for a Project named timeout-space/);
      assert.match(plan.error.message, /60 seconds\. Nothing was created\./);
    }
  } finally {
    h2.cleanup();
  }
});

test("choosing a different folder after a complete plan drops that plan's target, so opening it is refused", async () => {
  const window = await setupWindow('new');
  const parentA = folder('stale-target-parent-a');
  await choose(window, parentA);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'stale-target-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);

  const again = await setupWindow('new');
  await choose(again, parentA);
  const plan = (await h.invoke('spaceSetupPlan', again, form)) as SpaceSetupPlanResult;
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.plan.complete, true);

  // Choosing another folder, without asking for a plan of it, must drop the
  // earlier folder's complete target: nothing here names a Space to open.
  const parentB = folder('stale-target-parent-b');
  await choose(again, parentB);

  const opened = (await h.invoke('spaceSetupOpenSpace', again, {})) as SpaceWindowResult;
  assert.equal(opened.ok, false, 'a folder change must not leave the old folder open-able');
  if (!opened.ok) assert.equal(opened.error.kind, 'not-allowed-here');

  const state = (await h.invoke('spaceSetupState', again, {})) as SpaceSetupStateResult;
  assert.ok(state.ok, state.ok ? '' : state.error.message);
  assert.equal(state.value.parentDir, parentB);
});

test('choosing a repository source after a preview drops that preview, so opening it as an existing Space is refused', async () => {
  h.space.host.openWelcome();
  const window = h.space.created.at(-1);
  assert.ok(window);
  window.finishLoad();
  const shown = await h.space.host.navigate(window, { to: 'setup', start: 'new' });
  assert.ok(shown.ok, shown.ok ? '' : shown.error.message);
  const parent = folder('stale-preview-parent');
  await choose(window, parent);
  const form: SpaceSetupForm = {
    flow: 'create',
    name: 'stale-preview-space',
    description: '',
    owner: OWNER,
    private: true,
    repositories: [],
  };
  const token = await planned(window, form);
  const ran = await run(window, { token });
  assert.ok(ran.ok, ran.ok ? '' : ran.error.message);

  const again = await setupWindow('new');
  await choose(again, parent);
  const validated = (await h.invoke('spaceSetupValidate', again, form)) as SpaceSetupValidateResult;
  assert.ok(validated.ok, validated.ok ? '' : validated.error.message);
  assert.equal(validated.value.target?.state, 'complete');

  // Choosing another folder must drop that preview too.
  await choose(again, folder('stale-preview-parent-b'));
  const refused = (await h.invoke('spaceSetupOpenExisting', again, {})) as SpaceWindowResult;
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.kind, 'not-allowed-here');
});
