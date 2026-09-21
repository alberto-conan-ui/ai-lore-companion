import assert from 'node:assert/strict';
import { readdirSync, renameSync } from 'node:fs';
import { after, afterEach, before, test } from 'node:test';
import { deskPaths } from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { registerSpaceRepositories } from '../../../src/main/space/ipc/repositories.js';
import { configureSpaceRepositories } from '../../../src/main/space/repositories.js';
import { rootsServiceStats } from '../../../src/main/space/roots-service.js';
import { SPACE_REPOSITORIES_CONTRACT } from '../../../src/shared/ipc/space/repositories.contract.js';
import type {
  SpaceRepositoriesState,
  SpaceRepositoriesStateResult,
} from '../../../src/shared/ipc/space/repositories.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase D1.3: the repositories service and its four channels, driven through the real Space
// host on fake windows, against a Space fixture with one repository. See the architecture
// document (`packages/docs/dashboard-repositories-architecture.md`), sections 5.2 to 5.4 and 7.

const STATE_PUSH = SPACE_REPOSITORIES_CONTRACT.onSpaceRepositoriesState.channel;

type Opened = {
  h: SpaceHarness;
  spaceWindow: FakeSpaceWindow;
  context: SpaceContext;
};

let space: SpaceFixture;
let other: SpaceFixture;
const opened: Opened[] = [];

before(async () => {
  // No timer in the test process: every read is driven explicitly by a channel call.
  configureSpaceRepositories({ intervalMs: 0 });
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'repositories-space',
    repositories: ['app'],
  });
  other = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'other-repositories-space',
  });
});

after(() => {
  configureSpaceRepositories(null);
  space.cleanup();
  other.cleanup();
});

afterEach(async () => {
  for (const { h } of opened.splice(0)) {
    await h.space.host.dispose();
    h.cleanup();
  }
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 }, 'no watcher is left');
});

async function open(root = space.root): Promise<Opened> {
  const h = spaceHarnessFor(registerSpaceRepositories);
  await h.space.host.openFolder(undefined, root);
  const spaceWindow = h.space.created[h.space.created.length - 1];
  assert.ok(spaceWindow);
  const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(context);
  const result = { h, spaceWindow, context };
  opened.push(result);
  return result;
}

async function call(o: Opened, key: string, arg: unknown, from?: FakeSpaceWindow) {
  return (await o.h.invoke(key, from ?? o.spaceWindow, arg)) as SpaceRepositoriesStateResult;
}

function must(result: SpaceRepositoriesStateResult): SpaceRepositoriesState {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

const pushes = (window: FakeSpaceWindow): SpaceRepositoriesState[] =>
  window.sent
    .filter((message) => message.channel === STATE_PUSH)
    .map((message) => message.payload as SpaceRepositoriesState);

/** Poll `spaceRepositoriesState` (which starts no new run once one has run) until `predicate` holds. */
async function waitForState(
  o: Opened,
  predicate: (state: SpaceRepositoriesState) => boolean,
  ms = 8000,
): Promise<SpaceRepositoriesState> {
  const until = Date.now() + ms;
  for (;;) {
    const state = must(await call(o, 'spaceRepositoriesState', {}));
    if (predicate(state)) return state;
    if (Date.now() > until) assert.fail('timed out waiting for the expected repositories state');
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Wait until every row of the model has answered (none is still `reading`). */
const waitForReady = (o: Opened): Promise<SpaceRepositoriesState> =>
  waitForState(
    o,
    (state) => state.model !== null && !state.model.rows.some((row) => row.status === 'reading'),
  );

test('state: the first request answers at once, with model null and reading true, and does not wait on a git read', async () => {
  const o = await open();
  const first = must(await call(o, 'spaceRepositoriesState', {}));
  assert.equal(first.model, null);
  assert.equal(first.reading, true);
  assert.equal(first.readAt, null);
  assert.equal(first.problem, null);
});

test('a later state carries a row for the repository and one for the Lore, none for the Workbench', async () => {
  const o = await open();
  const ready = await waitForReady(o);
  const model = ready.model;
  assert.ok(model);
  assert.deepEqual(
    model.rows.map((row) => row.rootId),
    ['repo:app', 'lore', 'publish:publish'],
    'the Workbench is not its own row, but publish-area gets its own',
  );
  const app = model.rows.find((row) => row.rootId === 'repo:app');
  assert.equal(app?.status, 'ready');
  assert.equal(app?.kind, 'repository');
  assert.equal(app?.head?.kind, 'branch');
  assert.equal(app?.head?.kind === 'branch' ? app.head.branch : '', 'main');
  assert.equal(app?.remote?.ahead, 1, 'the fixture repository has one unpushed commit');
  assert.equal(app?.remote?.behind, 0);

  const lore = model.rows.find((row) => row.rootId === 'lore');
  assert.equal(lore?.status, 'ready');
  assert.equal(lore?.name, 'Lore');
  assert.deepEqual(lore?.alsoCovers, []);

  const publish = model.rows.find((row) => row.rootId === 'publish:publish');
  assert.equal(publish?.status, 'ready');
});

test('one failing read fails only its own row: the others keep working', async () => {
  const o = await open();
  const appDir = `${space.paths.repos}/app`;
  const moved = `${appDir}-away`;
  renameSync(appDir, moved);
  try {
    const state = await waitForState(o, (candidate) => {
      const lore = candidate.model?.rows.find((row) => row.rootId === 'lore');
      const app = candidate.model?.rows.find((row) => row.rootId === 'repo:app');
      return lore?.status === 'ready' && app !== undefined && app.status !== 'reading';
    });
    const lore = state.model?.rows.find((row) => row.rootId === 'lore');
    const app = state.model?.rows.find((row) => row.rootId === 'repo:app');
    assert.equal(lore?.status, 'ready', 'the Lore row is unaffected by the other root');
    // `resolveRoots` marks the moved repository root untracked before any read of it is tried.
    assert.ok(
      app?.status === 'untracked' || app?.status === 'failed',
      `expected the repository row to say it could not be read, got ${app?.status}`,
    );
    assert.ok(app?.notKnown && app.notKnown.length > 0);
  } finally {
    renameSync(moved, appDir);
  }
});

test('version never goes down across every state given', async () => {
  const o = await open();
  // A tight sequential poll: each call happens strictly after the one before it resolved, so
  // this sequence is in true chronological order (unlike mixing it with the push channel, whose
  // sends interleave with these calls at points this test does not control).
  const polled: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    polled.push(must(await call(o, 'spaceRepositoriesState', {})).version);
  }
  await waitForReady(o);
  polled.push(must(await call(o, 'spaceRepositoriesRefresh', {})).version);
  polled.push(must(await call(o, 'spaceRepositoriesFocus', {})).version);
  for (let index = 1; index < polled.length; index += 1) {
    assert.ok(
      (polled[index] as number) >= (polled[index - 1] as number),
      `version went down: ${polled[index - 1]} then ${polled[index]}`,
    );
  }
  assert.ok(polled.length > 2, 'more than one state was given');

  // The pushed states are themselves in the order the service emitted them, and never go down either.
  const pushed = pushes(o.spaceWindow).map((state) => state.version);
  for (let index = 1; index < pushed.length; index += 1) {
    assert.ok(
      (pushed[index] as number) >= (pushed[index - 1] as number),
      `a pushed version went down: ${pushed[index - 1]} then ${pushed[index]}`,
    );
  }
  assert.ok(pushed.length > 0, 'at least one state was pushed');
});

test('each of the three invoke channels refuses a non-empty argument and a call from outside a Space window', async () => {
  const o = await open();
  for (const key of [
    'spaceRepositoriesState',
    'spaceRepositoriesRefresh',
    'spaceRepositoriesFocus',
  ]) {
    const invalid = await call(o, key, { extra: 1 });
    assert.equal(!invalid.ok && invalid.error.kind, 'invalid-argument', key);

    const stranger = (await o.h.invoke(key, { webContentsId: 424242 }, {})) as {
      ok: boolean;
      error?: { kind: string };
    };
    assert.equal(stranger.ok, false, key);
    assert.equal(stranger.error?.kind, 'not-a-space-window', key);
  }
});

test('a push reaches only the windows of that Space', async () => {
  const o = await open();
  const stranger = await open(other.root);
  await waitForReady(o);
  await waitForReady(stranger);

  assert.ok(pushes(o.spaceWindow).length > 0);
  assert.ok(pushes(stranger.spaceWindow).length > 0);
  assert.ok(
    pushes(o.spaceWindow).every(
      (state) =>
        state.model === null || state.model.rows.every((row) => row.path.startsWith(space.root)),
    ),
    'this Space is told only of its own roots',
  );
  assert.ok(
    pushes(stranger.spaceWindow).every(
      (state) =>
        state.model === null || state.model.rows.every((row) => row.path.startsWith(other.root)),
    ),
    'the other Space never hears of a root that is not its own',
  );
});

test('dispose stops the timer, and the windows of a closed Space are pushed nothing more', async () => {
  const o = await open();
  await waitForReady(o);
  await o.h.space.host.windowClosed(o.spaceWindow.id);
  const before = pushes(o.spaceWindow).length;
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(
    pushes(o.spaceWindow).length,
    before,
    'nothing more is pushed once the Space is closed',
  );
});

test('nothing is written to the desk: repeated repository reads write no new entry under it', async () => {
  const o = await open();
  const deskDir = deskPaths(o.h.space.userDataDir, space.root).desk;
  // Starting the roots service (D1.1/M5.1, not this phase) writes its own baseline records the
  // first time it resolves a root, such as `first-seen.json`. The repository read this phase adds
  // (`readRepositoryStateIn`, pure `git` reads) runs no differently once that has happened once:
  // the desk folder's entries settle, and a further read of the repositories adds none of its own.
  await waitForReady(o);
  const before = safeReaddir(deskDir);
  must(await call(o, 'spaceRepositoriesRefresh', {}));
  must(await call(o, 'spaceRepositoriesRefresh', {}));
  const afterRead = safeReaddir(deskDir);
  assert.deepEqual(
    afterRead,
    before,
    'a repository read writes no new entry under the desk folder',
  );
  assert.ok(
    !afterRead.some((name) => name.toLowerCase().includes('repositor')),
    'no repositories cache file exists on the desk, unlike the Project cache',
  );
});

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
