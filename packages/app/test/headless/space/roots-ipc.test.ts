import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { deskPaths, takeDeskOwnership } from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
  makeTempDir,
} from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import {
  createAppGitHubPort,
  spaceGitHub,
  unreachableGitHub,
} from '../../../src/main/space/github-service.js';
import { registerSpaceRoots } from '../../../src/main/space/ipc/roots.js';
import {
  ROOT_FILE_MAX_BYTES,
  readRootDiff,
  resolveRootFile,
} from '../../../src/main/space/root-files.js';
import { ROOTS_TUNING, rootsServiceStats } from '../../../src/main/space/roots-service.js';
import { SPACE_ROOTS_CONTRACT } from '../../../src/shared/ipc/space/roots.contract.js';
import type {
  RootBaselinePoints,
  RootBaselineSet,
  RootChangesPayload,
  RootDiff,
  RootFileContent,
  RootFileEventsPayload,
  RootFileHistory,
  RootMarkedReviewed,
  RootSnapshot,
  SpaceRootsList,
  SpaceRootsResult,
} from '../../../src/shared/ipc/space/roots.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M5.1: the channels of roots, driven through the real Space host on fake windows,
// against a Space fixture with two repositories. GitHub is core's `FakeGitHub`.

const CHANGES = SPACE_ROOTS_CONTRACT.onSpaceRootChanges.channel;
const FILE_EVENTS = SPACE_ROOTS_CONTRACT.onSpaceRootFileEvents.channel;

type Opened = {
  h: SpaceHarness;
  spaceWindow: FakeSpaceWindow;
  filesWindow: FakeSpaceWindow;
  context: SpaceContext;
  gitHub: FakeGitHub;
};

let space: SpaceFixture;
let other: SpaceFixture;
const opened: Opened[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'roots-space',
    repositories: ['app', 'lib'],
  });
  other = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'other-space' });
});

after(() => {
  space.cleanup();
  other.cleanup();
});

afterEach(async () => {
  for (const { h, gitHub } of opened.splice(0)) {
    await h.space.host.dispose();
    gitHub.dispose();
    h.cleanup();
  }
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 }, 'no watcher is left');
});

async function open(root = space.root): Promise<Opened> {
  const h = spaceHarnessFor(registerSpaceRoots);
  await h.space.host.openFolder(undefined, root);
  const spaceWindow = h.space.created[h.space.created.length - 1];
  assert.ok(spaceWindow);
  const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(context);
  h.space.host.openFilesWindow(context);
  const filesWindow = h.space.created[h.space.created.length - 1];
  assert.ok(filesWindow && filesWindow !== spaceWindow);
  const gitHub = createFakeGitHub({ organisations: ['fixture-owner'] });
  context.service(spaceGitHub).use(gitHub);
  const result = { h, spaceWindow, filesWindow, context, gitHub };
  opened.push(result);
  return result;
}

async function call<T>(o: Opened, key: string, arg: unknown, from = o.filesWindow) {
  return (await o.h.invoke(key, from, arg)) as SpaceRootsResult<T>;
}

function must<T>(result: SpaceRootsResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

/**
 * How long to wait for a watcher's event. See the note in
 * `root-search-ipc.test.ts`: the old budget failed when the machine was busy,
 * not when anything was wrong.
 */
const WATCHER_BUDGET_MS = 30_000;

async function waitFor<T>(
  what: string,
  probe: () => T | undefined,
  ms = WATCHER_BUDGET_MS,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = probe();
    if (found !== undefined) return found;
    if (Date.now() > until) assert.fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const pushes = <P>(window: FakeSpaceWindow, channel: string): P[] =>
  window.sent.filter((message) => message.channel === channel).map((m) => m.payload as P);

const paths = (snapshot: RootSnapshot): string[] =>
  snapshot.status === 'ok' ? snapshot.changes.entries.map((entry) => entry.path).sort() : [];

const repo = (name: string) => {
  const found = space.repositories.find((entry) => entry.name === name);
  assert.ok(found);
  return found;
};

test('list: every root with its baseline and changes; the first call starts one tracker per Space', async () => {
  const o = await open();
  assert.equal(rootsServiceStats().trackers, 0, 'nothing is watched before a window asks');
  const list = must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  assert.deepEqual(
    list.roots.map((summary) => summary.root.id),
    ['lore', 'workbench', 'publish:publish', 'repo:app', 'repo:lib'],
  );
  const app = list.roots.find((summary) => summary.root.id === 'repo:app');
  assert.ok(app);
  assert.equal(app.github, repo('app').github);
  assert.equal(app.defaultBaseline?.source, 'first-seen');
  assert.equal(app.baseline, repo('app').headCommit);
  assert.deepEqual(paths(app.snapshot), [
    'docs/delete-uncommitted.md',
    'docs/edit-uncommitted.md',
    'notes/untracked.md',
  ]);
  const workbench = list.roots.find((summary) => summary.root.id === 'workbench');
  assert.equal(workbench?.snapshot.status, 'untracked');
  assert.equal(list.deskWritable, true);

  // The Space window reaches the same tracker.
  must(await call<SpaceRootsList>(o, 'spaceRootsList', {}, o.spaceWindow));
  assert.equal(rootsServiceStats().trackers, 1);
});

test('changes: a file event, an index-only change and a stream of events are pushed to that Space only', async () => {
  const saved = { ...ROOTS_TUNING };
  ROOTS_TUNING.maxWaitMs = 500;
  ROOTS_TUNING.fileEventBatchMs = 50;
  try {
    const o = await open();
    // A second Space in the same app, with its tracker running.
    await o.h.space.host.openFolder(undefined, other.root);
    const strangerWindow = o.h.space.created[o.h.space.created.length - 1];
    assert.ok(strangerWindow && strangerWindow !== o.filesWindow);
    const strangerContext = o.h.space.host.contextFor({
      sender: { id: strangerWindow.webContents.id },
    });
    assert.ok(strangerContext && strangerContext.key !== o.context.key);
    must(await call<SpaceRootsList>(o, 'spaceRootsList', {}, strangerWindow));
    const stranger = { spaceWindow: strangerWindow, filesWindow: strangerWindow };
    must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
    const checkout = repo('app').checkout;

    checkout.write('new-file.md', 'new\n');
    const pushed = await waitFor('a change push', () =>
      pushes<RootChangesPayload>(o.filesWindow, CHANGES).find((p) =>
        paths(p.snapshot).includes('new-file.md'),
      ),
    );
    assert.equal(pushed.snapshot.rootId, 'repo:app');
    await waitFor('the same push in the Space window', () =>
      pushes<RootChangesPayload>(o.spaceWindow, CHANGES).find((p) =>
        paths(p.snapshot).includes('new-file.md'),
      ),
    );
    await waitFor('a file event for the tree', () =>
      pushes<RootFileEventsPayload>(o.filesWindow, FILE_EVENTS).find(
        (p) => p.rootId === 'repo:app' && p.events.some((e) => e.path === 'new-file.md'),
      ),
    );
    for (const window of [stranger.spaceWindow, stranger.filesWindow]) {
      // The other Space's window gets the changes of its own roots only.
      const foreign = pushes<RootChangesPayload>(window, CHANGES).filter(
        (p) => p.snapshot.rootId.startsWith('repo:') || paths(p.snapshot).includes('new-file.md'),
      );
      assert.equal(foreign.length, 0, 'the other Space is told nothing of this one');
      assert.equal(
        pushes<RootFileEventsPayload>(window, FILE_EVENTS).filter((p) => p.rootId === 'repo:app')
          .length,
        0,
      );
    }

    // `git add` changes the index only: the entry goes from untracked to added.
    await checkout.git('add', '--', 'new-file.md');
    await waitFor('the index change', () =>
      pushes<RootChangesPayload>(o.filesWindow, CHANGES).find(
        (p) =>
          p.snapshot.status === 'ok' &&
          p.snapshot.changes.entries.some((e) => e.path === 'new-file.md' && e.code === 'A '),
      ),
    );

    // A heavy ignored folder gives no file event.
    mkdirSync(join(checkout.dir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(checkout.dir, 'node_modules/pkg/index.js'), 'x\n');

    // A steady stream of events: the debounce never ends, the maximum wait gives a read.
    const before = pushes(o.filesWindow, CHANGES).length;
    let streaming = true;
    const stream = (async () => {
      for (let index = 0; streaming && index < 60; index += 1) {
        checkout.write(`stream/file-${index}.md`, `${index}\n`);
        await new Promise((done) => setTimeout(done, 60));
      }
    })();
    const during = await waitFor('a read during the stream', () =>
      pushes<RootChangesPayload>(o.filesWindow, CHANGES)
        .slice(before)
        .find((p) => paths(p.snapshot).some((path) => path.startsWith('stream/'))),
    );
    const stillStreaming = streaming;
    streaming = false;
    await stream;
    assert.ok(during);
    assert.ok(stillStreaming, 'the read came before the stream ended');
    assert.ok(
      !pushes<RootFileEventsPayload>(o.filesWindow, FILE_EVENTS).some((p) =>
        p.events.some((e) => e.path.startsWith('node_modules/')),
      ),
      'node_modules is not watched',
    );

    // The changes channel gives the same snapshot the tracker holds.
    const snapshot = must(await call<RootSnapshot>(o, 'spaceRootChanges', { rootId: 'repo:app' }));
    assert.ok(paths(snapshot).includes('new-file.md'));
  } finally {
    Object.assign(ROOTS_TUNING, saved);
    const checkout = repo('app').checkout;
    await checkout.git('reset', '-q', '--', 'new-file.md');
    for (const path of ['new-file.md', 'stream', 'node_modules']) checkout.remove(path);
  }
});

test('set baseline: a commit, HEAD, a missing commit, and forms that are refused', async () => {
  const o = await open();
  const app = repo('app');
  const set = must(
    await call<RootBaselineSet>(o, 'spaceRootSetBaseline', {
      rootId: 'repo:app',
      baseline: app.baseCommit.slice(0, 12),
    }),
  );
  assert.equal(set.baseline, app.baseCommit, 'held as the full SHA');
  for (const change of app.committedSinceBase) assert.ok(paths(set.snapshot).includes(change.path));
  assert.ok(
    pushes<RootChangesPayload>(o.filesWindow, CHANGES).some(
      (p) => p.snapshot.baseline === app.baseCommit,
    ),
  );

  const head = must(
    await call<RootBaselineSet>(o, 'spaceRootSetBaseline', {
      rootId: 'repo:app',
      baseline: 'HEAD',
    }),
  );
  assert.equal(head.baseline, 'HEAD');

  const missing = await call(o, 'spaceRootSetBaseline', {
    rootId: 'repo:app',
    baseline: 'deadbeefdeadbeef',
  });
  assert.equal(!missing.ok && missing.error.kind, 'baseline-missing');

  for (const baseline of ['main', '--output=x', 'HEAD~1', 'abc']) {
    const refused = await call(o, 'spaceRootSetBaseline', { rootId: 'repo:app', baseline });
    assert.equal(!refused.ok && refused.error.kind, 'invalid-argument', baseline);
  }
  for (const rootId of ['../x', '/abs', 'repo:..', 'repo:a/b', 'other']) {
    const refused = await call(o, 'spaceRootSetBaseline', { rootId, baseline: 'HEAD' });
    assert.equal(!refused.ok && refused.error.kind, 'invalid-argument', rootId);
  }
  const unknown = await call(o, 'spaceRootSetBaseline', { rootId: 'repo:none', baseline: 'HEAD' });
  assert.equal(!unknown.ok && unknown.error.kind, 'unknown-root');
  const untracked = await call(o, 'spaceRootSetBaseline', {
    rootId: 'workbench',
    baseline: 'HEAD',
  });
  assert.equal(!untracked.ok && untracked.error.kind, 'root-untracked');

  const reset = must(
    await call<RootBaselineSet>(o, 'spaceRootResetBaseline', { rootId: 'repo:app' }),
  );
  assert.equal(reset.baseline, app.headCommit, 'back to the first-seen commit');

  const stranger = await o.h.invoke(
    'spaceRootSetBaseline',
    { webContentsId: 424242 },
    {
      rootId: 'repo:app',
      baseline: 'HEAD',
    },
  );
  assert.equal((stranger as { ok: boolean }).ok, false);
});

test('mark reviewed: the present commit becomes the baseline; uncommitted files stay listed', async () => {
  const o = await open();
  const app = repo('app');
  must(await call(o, 'spaceRootSetBaseline', { rootId: 'repo:app', baseline: app.baseCommit }));
  const marked = must(
    await call<RootMarkedReviewed>(o, 'spaceRootMarkReviewed', { rootId: 'repo:app' }),
  );
  assert.equal(marked.baseline, app.headCommit);
  assert.equal(marked.mark.commit, app.headCommit);
  assert.equal(marked.mark.rootId, 'repo:app');
  assert.deepEqual(paths(marked.snapshot), [
    'docs/delete-uncommitted.md',
    'docs/edit-uncommitted.md',
    'notes/untracked.md',
  ]);
  const list = must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  const summary = list.roots.find((s) => s.root.id === 'repo:app');
  assert.equal(summary?.defaultBaseline?.source, 'reviewed-mark');

  const workbench = await call(o, 'spaceRootMarkReviewed', { rootId: 'workbench' });
  assert.equal(!workbench.ok && workbench.error.kind, 'root-untracked');
});

test('mark reviewed on a desk another running instance owns is refused with the desk reason', async () => {
  // Another instance: a live process, named in the desk's owner file with its start time.
  const holder: ChildProcess = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    assert.ok(holder.pid);
    const h = spaceHarnessFor(registerSpaceRoots);
    const desk = deskPaths(h.space.userDataDir, space.root).desk;
    const owned = takeDeskOwnership(desk, {
      pid: holder.pid as number,
      startedAt: new Date().toISOString(),
    });
    assert.ok(owned.ok && owned.value.owned);
    await h.space.host.openFolder(undefined, space.root);
    const spaceWindow = h.space.created[0];
    assert.ok(spaceWindow);
    const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
    assert.ok(context);
    const gitHub = createFakeGitHub();
    context.service(spaceGitHub).use(gitHub);
    const o: Opened = { h, spaceWindow, filesWindow: spaceWindow, context, gitHub };
    opened.push(o);

    const list = must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
    assert.equal(list.deskWritable, false);
    const refused = await call(o, 'spaceRootMarkReviewed', { rootId: 'repo:app' });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'desk-not-writable');
    assert.equal(refused.error.cause, 'not-writable');
    assert.equal(
      refused.error.message,
      `the desk is held by another running instance of the companion (process ${holder.pid}), so this one does not write its records`,
    );
  } finally {
    holder.kill();
  }
});

test('baseline points: with GitHub unreachable the other points come back and the failure is data', async () => {
  const o = await open();
  const app = repo('app');
  must(await call(o, 'spaceRootMarkReviewed', { rootId: 'repo:app' }));

  o.gitHub.setUnreachable(true);
  const offline = must(
    await call<RootBaselinePoints>(o, 'spaceRootBaselinePoints', { rootId: 'repo:app' }),
  );
  assert.equal(offline.points.mergedPullRequests.status, 'omitted');
  assert.equal(
    offline.points.mergedPullRequests.status === 'omitted' &&
      offline.points.mergedPullRequests.reason,
    'unreachable',
  );
  const kinds = new Set(offline.points.points.map((point) => point.kind));
  assert.ok(kinds.has('commit'));
  assert.ok(kinds.has('reviewed-mark'));
  assert.ok(offline.rows.length > 0);

  o.gitHub.setUnreachable(false);
  const [owner, name] = app.github.split('/');
  assert.ok(owner && name);
  const created = await o.gitHub.createRepository({ owner, name, private: true });
  assert.ok(created.ok);
  o.gitHub.addMergedPullRequest(app.github, {
    number: 7,
    title: 'Add the thing',
    url: 'https://example.invalid/pull/7',
    mergedAt: '2026-01-05T12:00:00Z',
    mergeCommit: app.baseCommit,
    headBranch: 'feature',
    baseBranch: 'main',
  });
  const online = must(
    await call<RootBaselinePoints>(o, 'spaceRootBaselinePoints', {
      rootId: 'repo:app',
      commitLimit: 5,
    }),
  );
  assert.equal(online.points.mergedPullRequests.status, 'read');
  assert.ok(online.points.points.some((p) => p.kind === 'merged-pull-request' && p.number === 7));

  const lore = must(
    await call<RootBaselinePoints>(o, 'spaceRootBaselinePoints', { rootId: 'lore' }),
  );
  assert.equal(lore.points.mergedPullRequests.status, 'not-applicable');
  const bad = await call(o, 'spaceRootBaselinePoints', { rootId: 'repo:app', commitLimit: 0 });
  assert.equal(!bad.ok && bad.error.kind, 'invalid-argument');
});

test('diff, file at a commit, blob and history: contained paths, capped content, binary reported', async () => {
  const o = await open();
  const app = repo('app');
  const checkout = app.checkout;
  const outside = makeTempDir('roots-outside-');
  writeFileSync(join(outside.dir, 'secret.txt'), 'secret\n');
  symlinkSync(join(outside.dir, 'secret.txt'), join(checkout.dir, 'link-out.txt'));
  writeFileSync(join(checkout.dir, 'image.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  writeFileSync(join(checkout.dir, 'big.txt'), 'a'.repeat(ROOT_FILE_MAX_BYTES + 10));
  try {
    const edited = must(
      await call<RootDiff>(o, 'spaceRootDiff', {
        rootId: 'repo:app',
        path: 'docs/edit-uncommitted.md',
      }),
    );
    assert.equal(edited.kind, 'text');
    assert.match(edited.kind === 'text' ? edited.text : '', /\+Second text, not committed\./);

    // Pinned to the first commit: the committed change shows; the root's baseline does not move.
    const pinned = must(
      await call<RootDiff>(o, 'spaceRootDiff', {
        rootId: 'repo:app',
        path: 'src/change-me.ts',
        baseline: app.baseCommit,
      }),
    );
    assert.equal(pinned.baseline, app.baseCommit);
    assert.equal(pinned.kind, 'text');
    assert.notEqual(pinned.kind === 'text' && pinned.text, '');
    const list = must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
    assert.equal(list.roots.find((s) => s.root.id === 'repo:app')?.baseline, app.headCommit);

    const untracked = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'notes/untracked.md' }),
    );
    assert.match(untracked.kind === 'text' ? untracked.text : '', /^\+\+\+ new file: /);
    const binary = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'image.bin' }),
    );
    assert.equal(binary.kind, 'binary');
    const big = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'big.txt' }),
    );
    assert.equal(big.kind, 'too-large');

    for (const path of ['../roots-space/x', '/etc/passwd', 'a/../../x']) {
      const refused = await call(o, 'spaceRootDiff', { rootId: 'repo:app', path });
      assert.equal(!refused.ok && refused.error.kind, 'invalid-argument', path);
    }
    for (const path of ['link-out.txt', '.git/config', 'src/../.git/HEAD']) {
      const refused = await call(o, 'spaceRootDiff', { rootId: 'repo:app', path });
      assert.equal(
        !refused.ok && refused.error.kind,
        path === 'src/../.git/HEAD' ? 'invalid-argument' : 'path-refused',
        path,
      );
    }

    const at = must(
      await call<RootFileContent>(o, 'spaceRootFileAt', {
        rootId: 'repo:app',
        path: 'src/delete-me.ts',
        commit: app.baseCommit,
      }),
    );
    assert.equal(at.kind, 'text');
    const gone = must(
      await call<RootFileContent>(o, 'spaceRootFileAt', {
        rootId: 'repo:app',
        path: 'src/delete-me.ts',
        commit: 'HEAD',
      }),
    );
    assert.equal(gone.kind, 'absent');

    const history = must(
      await call<RootFileHistory>(o, 'spaceRootFileHistory', {
        rootId: 'repo:app',
        path: 'src/change-me.ts',
      }),
    );
    assert.ok(history.entries.length >= 2);
    assert.equal(history.entries[0]?.sha, app.headCommit);
    const blob = history.entries[0]?.blob ?? '';
    const content = must(
      await call<RootFileContent>(o, 'spaceRootBlob', { rootId: 'repo:app', blob }),
    );
    assert.equal(content.kind, 'text');
    const renamed = must(
      await call<RootFileHistory>(o, 'spaceRootFileHistory', {
        rootId: 'repo:app',
        path: 'src/renamed.ts',
      }),
    );
    assert.equal(renamed.entries[0]?.newPath, 'src/renamed.ts');
    assert.equal(renamed.entries[0]?.oldPath, 'src/rename-me.ts');
    const badBlob = await call(o, 'spaceRootBlob', { rootId: 'repo:app', blob: 'HEAD:x' });
    assert.equal(!badBlob.ok && badBlob.error.kind, 'invalid-argument');
  } finally {
    for (const path of ['link-out.txt', 'image.bin', 'big.txt'])
      rmSync(join(checkout.dir, path), { force: true });
    outside.cleanup();
  }
});

test('a root folder inside a working tree is read with paths relative to the root', async () => {
  const o = await open();
  must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  const list = must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  const lore = list.roots.find((s) => s.root.id === 'lore')?.root;
  assert.ok(lore?.tracking.tracked);
  const file = resolveRootFile(lore as never, 'space.md');
  assert.ok(file.ok);
  assert.equal(file.value.gitPath, `${lore.tracking.subPath}/space.md`);
  writeFileSync(join(lore.path, 'scratch.md'), 'scratch\n');
  try {
    const diff = await readRootDiff(o.context.runner, lore as never, {
      baseline: 'HEAD',
      path: 'scratch.md',
    });
    assert.ok(diff.ok && diff.value.kind === 'text');
  } finally {
    rmSync(join(lore.path, 'scratch.md'), { force: true });
  }
});

test('one failing root does not block the others, and a removed root folder is taken up again', async () => {
  const o = await open();
  must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  const lib = repo('lib');
  const moved = `${lib.checkout.dir}-away`;
  const { renameSync } = await import('node:fs');
  renameSync(lib.checkout.dir, moved);
  try {
    const list = must(await call<SpaceRootsList>(o, 'spaceRootsRefresh', {}));
    const libRoot = list.roots.find((s) => s.root.id === 'repo:lib');
    assert.equal(libRoot?.snapshot.status, 'untracked');
    const appRoot = list.roots.find((s) => s.root.id === 'repo:app');
    assert.equal(appRoot?.snapshot.status, 'ok');
    assert.equal(rootsServiceStats().trackers, 1, 'the old tracker was closed');
    assert.ok(pushes(o.filesWindow, SPACE_ROOTS_CONTRACT.onSpaceRootsReloaded.channel).length > 0);
  } finally {
    renameSync(moved, lib.checkout.dir);
  }
  const back = must(await call<SpaceRootsList>(o, 'spaceRootsRefresh', {}));
  assert.equal(back.roots.find((s) => s.root.id === 'repo:lib')?.snapshot.status, 'ok');
});

test('the tracker and its watchers close with the last window of the Space, and when the app quits', async () => {
  const o = await open();
  must(await call<SpaceRootsList>(o, 'spaceRootsList', {}));
  assert.deepEqual(rootsServiceStats().trackers, 1);
  assert.ok(rootsServiceStats().indexWatchers >= 1);
  await o.h.space.host.windowClosed(o.spaceWindow.id);
  assert.equal(rootsServiceStats().trackers, 1, 'the Files window still holds the Space');
  await o.h.space.host.windowClosed(o.filesWindow.id);
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 });

  const again = await open();
  must(await call<SpaceRootsList>(again, 'spaceRootsList', {}));
  assert.equal(rootsServiceStats().trackers, 1);
  await again.h.space.host.dispose();
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 });
});

// Added by the M5.1 tester: every argument from the renderer is taken as hostile.
test('hostile arguments are refused with a reason and never reach git as an option', async () => {
  const o = await open();
  const app = repo('app');
  const checkout = app.checkout;
  const outside = makeTempDir('roots-hostile-');
  writeFileSync(join(outside.dir, 'secret.txt'), 'secret\n');
  symlinkSync(join(checkout.dir, '.git'), join(checkout.dir, 'git-link'));
  symlinkSync(outside.dir, join(checkout.dir, 'dir-out'));
  const refusedKind = async (key: string, arg: unknown): Promise<string> => {
    const result = await call(o, key, arg);
    assert.ok(!result.ok, `${key} ${JSON.stringify(arg).slice(0, 80)} was accepted`);
    assert.ok(result.error.message.length > 0);
    return result.error.kind;
  };
  try {
    // Paths: a git folder in any case, reached through a link, a folder link out of the root.
    for (const path of ['.GIT/config', '.Git/HEAD', 'git-link/config', 'dir-out/secret.txt']) {
      assert.equal(
        await refusedKind('spaceRootDiff', { rootId: 'repo:app', path }),
        'path-refused',
      );
      assert.equal(
        await refusedKind('spaceRootFileAt', { rootId: 'repo:app', path, commit: 'HEAD' }),
        'path-refused',
      );
    }
    for (const path of ['a\0b', 'x'.repeat(5000), '..\\..\\x', '/etc/passwd', 'C:\\x', '']) {
      assert.equal(
        await refusedKind('spaceRootDiff', { rootId: 'repo:app', path }),
        'invalid-argument',
      );
      assert.equal(
        await refusedKind('spaceRootFileHistory', { rootId: 'repo:app', path }),
        'invalid-argument',
      );
    }
    assert.equal(
      await refusedKind('spaceRootDiff', { rootId: 'repo:app', path: 'a', oldPath: '../x' }),
      'invalid-argument',
    );
    // A long path under the schema's limit is answered, not thrown.
    const long = await call(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'y/'.repeat(1500) });
    assert.ok(long.ok || long.error.message.length > 0);
    // Backslashes are separators: the file inside the root is read.
    const back = must(
      await call<RootDiff>(o, 'spaceRootDiff', {
        rootId: 'repo:app',
        path: 'docs\\edit-uncommitted.md',
      }),
    );
    assert.equal(back.kind, 'text');
    // A case variant of a file (the same file on macOS) stays inside the root.
    const variant = await call(o, 'spaceRootDiff', {
      rootId: 'repo:app',
      path: 'DOCS/EDIT-UNCOMMITTED.md',
    });
    assert.ok(variant.ok || variant.error.kind === 'path-refused');

    // Revisions: only HEAD or hex; a tree is not a commit; options never pass.
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: checkout.dir })
      .toString()
      .trim();
    for (const commit of ['--output=/tmp/x', 'HEAD~1', 'HEAD^', 'main', '-p', 'ABCDEF1']) {
      assert.equal(
        await refusedKind('spaceRootFileAt', { rootId: 'repo:app', path: 'README.md', commit }),
        'invalid-argument',
        commit,
      );
      assert.equal(
        await refusedKind('spaceRootDiff', {
          rootId: 'repo:app',
          path: 'README.md',
          baseline: commit,
        }),
        'invalid-argument',
      );
    }
    assert.equal(
      await refusedKind('spaceRootFileAt', { rootId: 'repo:app', path: 'README.md', commit: tree }),
      'baseline-missing',
    );
    assert.equal(
      await refusedKind('spaceRootSetBaseline', { rootId: 'repo:app', baseline: tree }),
      'baseline-missing',
    );
    // Blobs: a commit or a tree is not shown as a blob; a ref or an option is refused.
    for (const blob of [app.headCommit, tree]) {
      const answer = must(
        await call<RootFileContent>(o, 'spaceRootBlob', { rootId: 'repo:app', blob }),
      );
      assert.equal(answer.kind, 'absent');
    }
    for (const blob of ['HEAD', '--batch', `${app.headCommit}:README.md`]) {
      assert.equal(
        await refusedKind('spaceRootBlob', { rootId: 'repo:app', blob }),
        'invalid-argument',
      );
    }
    // Limits.
    for (const limit of [-1, 0, 1.5, 1e9, Number.NaN, '5']) {
      assert.equal(
        await refusedKind('spaceRootFileHistory', { rootId: 'repo:app', path: 'README.md', limit }),
        'invalid-argument',
      );
      assert.equal(
        await refusedKind('spaceRootBaselinePoints', { rootId: 'repo:app', commitLimit: limit }),
        'invalid-argument',
      );
    }
    // Extra fields and a forged root id.
    assert.equal(
      await refusedKind('spaceRootChanges', { rootId: 'repo:app', extra: 1 }),
      'invalid-argument',
    );
    assert.equal(await refusedKind('spaceRootChanges', { rootId: 'repo:zzz' }), 'unknown-root');
    // A root of this Space named from a window of another Space.
    await o.h.space.host.openFolder(undefined, other.root);
    const strangerWindow = o.h.space.created[o.h.space.created.length - 1];
    assert.ok(strangerWindow);
    const foreign = await call(o, 'spaceRootChanges', { rootId: 'repo:app' }, strangerWindow);
    assert.equal(!foreign.ok && foreign.error.kind, 'unknown-root');
  } finally {
    for (const path of ['git-link', 'dir-out']) unlinkSync(join(checkout.dir, path));
    outside.cleanup();
  }
});

test('content: caps before reading, binary anywhere in the capped content, text kept as it is', async () => {
  const o = await open();
  const checkout = repo('app').checkout;
  const edited = join(checkout.dir, 'docs/edit-uncommitted.md');
  const original = readFileSync(edited);
  const huge = join(checkout.dir, 'huge.txt');
  const lateNul = join(checkout.dir, 'late-nul.txt');
  const odd = join(checkout.dir, 'odd.txt');
  writeFileSync(huge, '');
  truncateSync(huge, 50 * 1024 * 1024);
  writeFileSync(lateNul, Buffer.concat([Buffer.alloc(1024 * 1024 + 5, 0x61), Buffer.from([0])]));
  writeFileSync(odd, Buffer.from([0xff, 0xfe, 0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x0a]));
  try {
    const big = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'huge.txt' }),
    );
    assert.equal(big.kind, 'too-large');
    const nul = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'late-nul.txt' }),
    );
    assert.equal(nul.kind, 'binary', 'a NUL after 1 MB marks the file binary');
    const blob = execFileSync('git', ['hash-object', '-w', '--', 'late-nul.txt'], {
      cwd: checkout.dir,
    })
      .toString()
      .trim();
    const stored = must(
      await call<RootFileContent>(o, 'spaceRootBlob', { rootId: 'repo:app', blob }),
    );
    assert.equal(stored.kind, 'binary');
    const text = must(
      await call<RootDiff>(o, 'spaceRootDiff', { rootId: 'repo:app', path: 'odd.txt' }),
    );
    assert.equal(text.kind, 'text');
    assert.ok(text.kind === 'text' && text.text.includes('A\r\n+B\r'), 'CRLF kept');

    const lines = Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join('\n');
    writeFileSync(edited, `${lines}\n`);
    const long = must(
      await call<RootDiff>(o, 'spaceRootDiff', {
        rootId: 'repo:app',
        path: 'docs/edit-uncommitted.md',
      }),
    );
    assert.equal(long.kind, 'text');
    assert.ok(long.kind === 'text' && long.text.split('\n').length > 20_000);
  } finally {
    writeFileSync(edited, original);
    for (const path of [huge, lateNul, odd]) rmSync(path, { force: true });
  }
});

test('mark reviewed twice with no change appends two marks, as section 4.1 has them', async () => {
  const o = await open();
  const first = must(
    await call<RootMarkedReviewed>(o, 'spaceRootMarkReviewed', { rootId: 'repo:lib' }),
  );
  const second = must(
    await call<RootMarkedReviewed>(o, 'spaceRootMarkReviewed', { rootId: 'repo:lib' }),
  );
  assert.equal(first.baseline, second.baseline);
  const points = must(
    await call<RootBaselinePoints>(o, 'spaceRootBaselinePoints', { rootId: 'repo:lib' }),
  );
  const marks = points.points.points.filter((point) => point.kind === 'reviewed-mark');
  assert.equal(marks.length, 2);
});

test('the GitHub port: the unreachable port can be awaited, and a test run never gets gh', async () => {
  const settled = await Promise.race([
    Promise.resolve(unreachableGitHub('offline')).then(() => 'settled'),
    new Promise((done) => setTimeout(() => done('hung'), 1000)),
  ]);
  assert.equal(settled, 'settled');
  const refuseAll = {
    run: async () => assert.fail('no command is run to choose the port'),
  };
  for (const env of [{ AI_LORE_TEST: '1' }, { NODE_ENV: 'test' }, { COCKPIT_E2E: '1' }]) {
    const port = await createAppGitHubPort({ runner: refuseAll, env });
    const answer = await port.mergedPullRequests({ repository: 'o/r', limit: 1 });
    assert.equal(!answer.ok && answer.error.kind, 'unreachable');
  }
  // The Space service with no port given: built on the first call, and it settles.
  const h = spaceHarnessFor(registerSpaceRoots);
  try {
    await h.space.host.openFolder(undefined, other.root);
    const window = h.space.created[0];
    assert.ok(window);
    const context = h.space.host.contextFor({ sender: { id: window.webContents.id } });
    assert.ok(context);
    const port = await context.service(spaceGitHub).port();
    assert.equal(typeof port.auth, 'function');
  } finally {
    await h.space.host.dispose();
    h.cleanup();
  }
});
