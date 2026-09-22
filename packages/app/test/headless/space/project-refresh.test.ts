import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_STAGES,
  FOCUS_LEVEL,
  type GitHubPort,
  LEVEL_FIELD,
  LEVEL_VALUES,
  type ProjectInfo,
  deskFile,
  recordProjectSnapshot,
} from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
} from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { spaceGitHub } from '../../../src/main/space/github-service.js';
import { registerSpaceProject } from '../../../src/main/space/ipc/project.js';
import {
  configureProjectRefresh,
  createProjectRefresh,
} from '../../../src/main/space/project-refresh.js';
import type { SpaceProjectState, SpaceProjectStateResult } from '../../../src/shared/ipc.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M7.1: the refresh of the Project on the fake GitHub: on demand, on focus, on the timer,
// one at a time, and unreachable keeping the cache. No test reaches GitHub.

const OWNER = 'fake-human';
const NAME = 'dash-space';
const OTHER = 'other-space';
const PUSH = 'space:on-project-state';

let space: SpaceFixture;
let other: SpaceFixture;
let harness: SpaceHarness;
let fake: FakeGitHub;
let project: ProjectInfo;
let window: FakeSpaceWindow;
let otherWindow: FakeSpaceWindow;
let context: SpaceContext;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: NAME,
    owner: OWNER,
    project: 1,
  });
  other = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: OTHER,
    owner: OWNER,
    project: 2,
  });
});

after(async () => {
  await space.cleanup();
  await other.cleanup();
});

async function openSpaces(): Promise<void> {
  harness = spaceHarnessFor(registerSpaceProject);
  await harness.space.host.openFolder(undefined, space.root);
  await harness.space.host.openFolder(undefined, other.root);
  const [first, second] = harness.space.created;
  assert.ok(first && second);
  window = first;
  otherWindow = second;
  const found = harness.space.host.contextFor({ sender: { id: window.webContents.id } });
  assert.ok(found);
  context = found;
  context.service(spaceGitHub).use(fake);
}

beforeEach(async () => {
  fake = createFakeGitHub();
  assert.ok((await fake.createRepository({ owner: OWNER, name: NAME, private: true })).ok);
  const made = await fake.createProject({ owner: OWNER, title: NAME });
  assert.ok(made.ok);
  project = made.value;
  assert.ok(
    (await fake.ensureSingleSelectField({ project, name: 'Stage', options: [...DEFAULT_STAGES] }))
      .ok,
  );
  const focus = await fake.createIssue({
    repository: `${OWNER}/${NAME}`,
    title: 'A focus',
    body: '',
    labels: [],
  });
  assert.ok(focus.ok);
  const added = await fake.addIssueToProject({ project, issue: focus.value });
  assert.ok(added.ok);
  // The Project says which issues are focuses; a Stage no longer implies one.
  const level = await fake.ensureSingleSelectField({
    project,
    name: LEVEL_FIELD,
    options: [...LEVEL_VALUES],
  });
  assert.ok(level.ok);
  assert.ok(
    (
      await fake.setSingleSelect({
        project,
        item: added.value,
        field: level.value,
        option: FOCUS_LEVEL,
      })
    ).ok,
  );
  const stage = await fake.ensureSingleSelectField({ project, name: 'Stage', options: [] });
  assert.ok(stage.ok);
  assert.ok(
    (
      await fake.setSingleSelect({
        project,
        item: added.value,
        field: stage.value,
        option: 'Review',
      })
    ).ok,
  );
  configureProjectRefresh({ intervalMs: 0 });
});

afterEach(async () => {
  for (const created of harness.space.created) await harness.space.host.windowClosed(created.id);
  harness.cleanup();
  configureProjectRefresh(null);
  fake.setDelay(0);
  await fake.dispose();
});

const reads = (): number => fake.calls.filter((call) => call.operation === 'readProject').length;

function value(result: unknown): SpaceProjectState {
  const answer = result as SpaceProjectStateResult;
  if (!answer.ok) assert.fail(answer.error.message);
  return answer.value;
}

async function refresh(): Promise<SpaceProjectState> {
  return value(await harness.invoke('spaceProjectRefresh', window, {}));
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail('the condition was not met in time');
    await delay(10);
  }
}

test('on demand: the Project is read, cached on the desk, modelled and pushed to its Space only', async () => {
  await openSpaces();
  const state = await refresh();
  assert.equal(state.state, 'fresh');
  assert.equal(state.failure, null);
  assert.equal(state.snapshot?.focuses[0]?.title, 'A focus');
  assert.equal(state.fetchedAt, state.snapshot?.fetchedAt);
  assert.deepEqual(
    state.model?.columns.map((column) => column.name),
    [...DEFAULT_STAGES],
  );
  assert.equal(state.model?.needsYou[0]?.kind, 'review');
  const cached = JSON.parse(readFileSync(deskFile(context.desk, 'projectCache'), 'utf8'));
  assert.equal(cached.records[0].snapshot.focuses[0].title, 'A focus');
  const pushes = window.sent.filter((message) => message.channel === PUSH);
  assert.ok(pushes.length >= 2, 'a push when the refresh started and when it ended');
  assert.equal((pushes.at(-1)?.payload as SpaceProjectState).state, 'fresh');
  // Each state has a higher version than the one before, so the Dashboard can order them.
  const versions = pushes.map((message) => (message.payload as SpaceProjectState).version);
  assert.ok(
    versions.every((version, index) => index === 0 || version > (versions[index - 1] ?? 0)),
  );
  assert.equal(otherWindow.sent.filter((message) => message.channel === PUSH).length, 0);
});

test('the first state request reads GitHub once; the answer is the cache as it is', async () => {
  await openSpaces();
  const state = value(harness.invoke('spaceProjectState', window, {}));
  assert.equal(state.snapshot, null);
  assert.equal(state.state, 'stale');
  await until(
    () =>
      reads() === 1 && window.sent.some((m) => (m.payload as SpaceProjectState)?.state === 'fresh'),
  );
  value(harness.invoke('spaceProjectState', window, {}));
  await delay(30);
  assert.equal(reads(), 1);
});

test('one at a time: requests made during a refresh are served by one more run', async () => {
  await openSpaces();
  fake.setDelay(40);
  const all = await Promise.all([refresh(), refresh(), refresh(), refresh()]);
  assert.equal(reads(), 2);
  for (const state of all) assert.equal(state.state, 'fresh');
});

test('focus: a window of the Space gaining focus refreshes', async () => {
  await openSpaces();
  harness.invoke('spaceProjectFocus', window, {});
  await until(() => reads() === 1);
});

test('timer: the Project is read again at the interval', async () => {
  configureProjectRefresh({ intervalMs: 30 });
  await openSpaces();
  value(harness.invoke('spaceProjectState', window, {}));
  await until(() => reads() >= 3);
});

test('unreachable keeps the cache and records the failure time; the state is offline', async () => {
  await openSpaces();
  const first = await refresh();
  fake.setUnreachable(true);
  const second = await refresh();
  assert.equal(second.state, 'offline');
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(second.failure?.kind, 'unreachable');
  assert.ok(second.failure && !Number.isNaN(Date.parse(second.failure.at)));
  const cached = JSON.parse(readFileSync(deskFile(context.desk, 'projectCache'), 'utf8'));
  assert.deepEqual(cached.records[0].snapshot, first.snapshot);
  assert.equal(cached.records[0].failure.kind, 'unreachable');
  fake.setUnreachable(false);
  const third = await refresh();
  assert.equal(third.state, 'fresh');
  assert.equal(third.failure, null);
});

test('rate-limited keeps the cache; the state is stale with the reason', async () => {
  await openSpaces();
  const first = await refresh();
  fake.rateLimitNext(1, 60);
  const second = await refresh();
  assert.equal(second.state, 'stale');
  assert.equal(second.failure?.kind, 'rate-limited');
  assert.deepEqual(second.snapshot, first.snapshot);
});

test('a Project deleted on GitHub is reported in words, and the cache is kept', async () => {
  await openSpaces();
  const first = await refresh();
  fake.failNext({ kind: 'not-found', message: 'the Project is gone' });
  const second = await refresh();
  assert.equal(second.failure?.kind, 'not-found');
  assert.match(second.failure?.message ?? '', /was not found on GitHub/);
  assert.deepEqual(second.snapshot, first.snapshot);
});

test('a Project renamed on GitHub is not found by the Space name, and says so', async () => {
  await openSpaces();
  const theOther = harness.space.host.contextFor({ sender: { id: otherWindow.webContents.id } });
  assert.ok(theOther);
  theOther.service(spaceGitHub).use(fake);
  const state = value(await harness.invoke('spaceProjectRefresh', otherWindow, {}));
  assert.equal(state.snapshot, null);
  assert.equal(state.failure?.kind, 'not-found');
  assert.match(state.failure?.message ?? '', new RegExp(`"${OTHER}" with the number 2`));
  assert.match(state.failure?.message ?? '', /deleted or renamed/);
});

test('a cache from a week ago is stale at start, and offline once GitHub cannot be reached', async () => {
  await openSpaces();
  const read = await fake.readProject({ project });
  assert.ok(read.ok);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const desk = context.service(spaceDesk).open();
  assert.ok(desk.ok);
  assert.ok(recordProjectSnapshot(desk.value, { ...read.value, fetchedAt: weekAgo }).ok);
  fake.setUnreachable(true);
  const first = value(harness.invoke('spaceProjectState', window, {}));
  assert.equal(first.state, 'stale');
  assert.equal(first.fetchedAt, weekAgo);
  assert.ok(first.model !== null, 'the model is computed from the cache');
  await until(() =>
    window.sent.some(
      (m) => m.channel === PUSH && (m.payload as SpaceProjectState).state === 'offline',
    ),
  );
  const after = value(harness.invoke('spaceProjectState', window, {}));
  assert.equal(after.fetchedAt, weekAgo);
  assert.equal(after.failure?.kind, 'unreachable');
});

test('closing the last window of the Space stops its timer: no read after', async () => {
  configureProjectRefresh({ intervalMs: 20 });
  await openSpaces();
  value(harness.invoke('spaceProjectState', window, {}));
  await until(() => reads() >= 2);
  for (const created of harness.space.created) await harness.space.host.windowClosed(created.id);
  await delay(10);
  const count = reads();
  await delay(100);
  assert.equal(reads(), count);
});

test('a refresh slower than the interval never overlaps the next one', async () => {
  await openSpaces();
  let active = 0;
  let most = 0;
  let runs = 0;
  const github = fake;
  const port: GitHubPort = {
    ...github,
    readProject: async (arg) => {
      active += 1;
      runs += 1;
      most = Math.max(most, active);
      await delay(60);
      active -= 1;
      return github.readProject(arg);
    },
  };
  const service = createProjectRefresh({
    github: async () => port,
    manifest: () => context.manifest,
    desk: () => context.service(spaceDesk).open(),
    gates: () => [],
    intervalMs: 10,
  });
  try {
    await until(() => runs >= 3);
  } finally {
    service.dispose();
  }
  await until(() => active === 0);
  assert.equal(most, 1);
});

test('a request from a window that shows no Space is refused', async () => {
  await openSpaces();
  const answer = harness.invoke('spaceProjectState', { webContentsId: 9999 }, {}) as
    | SpaceProjectStateResult
    | undefined;
  assert.equal(answer?.ok, false);
  assert.equal(answer?.ok === false ? answer.error.kind : '', 'not-a-space-window');
  assert.equal(reads(), 0);
});
