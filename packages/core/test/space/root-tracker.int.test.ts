import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type CommandRunner,
  type Root,
  type RootFileEvent,
  type RootSnapshot,
  type RootTracker,
  type RootTrackerOptions,
  attachRootTracker,
  execFileRunner,
  resolveRoots,
} from '../../src/index.js';
import { type SpaceFixture, makeSpaceFixture } from '../../src/space/testing/index.js';
import { loreTemplateDir } from '../support/paths.js';
import { useTempDir } from '../support/temp.js';

const REPO = 'repo:alpha';

/** The real runner, counting the change reads (`git status`) it was asked for. */
function countingRunner(): CommandRunner & { statusReads: () => number } {
  let reads = 0;
  return {
    statusReads: () => reads,
    run(bin, args, opts) {
      if (args.includes('status')) reads += 1;
      return execFileRunner.run(bin, args, opts);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

type Harness = {
  fixture: SpaceFixture;
  roots: Root[];
  tracker: RootTracker;
  changes: RootSnapshot[];
  events: RootFileEvent[];
  runner: ReturnType<typeof countingRunner>;
};

async function useTracker(
  t: TestContext,
  options: Partial<RootTrackerOptions> = {},
  prepare?: (fixture: SpaceFixture) => void,
): Promise<Harness> {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['alpha'],
  });
  t.after(() => fixture.cleanup());
  prepare?.(fixture);
  const runner = countingRunner();
  const resolved = await resolveRoots({ spaceRoot: fixture.root, runner });
  if (!resolved.ok) assert.fail(resolved.error.message);
  const changes: RootSnapshot[] = [];
  const events: RootFileEvent[] = [];
  const tracker = await attachRootTracker({
    roots: resolved.value,
    runner,
    onChange: (snapshot) => changes.push(snapshot),
    onFileEvent: (event) => events.push(event),
    ...options,
  });
  t.after(() => tracker.close());
  return { fixture, roots: resolved.value, tracker, changes, events, runner };
}

function pathsOf(snapshot: RootSnapshot | null): string[] {
  if (snapshot === null || snapshot.status !== 'ok') return [];
  return snapshot.changes.entries.map((entry) => entry.path).sort();
}

test('the tracker holds a snapshot per root from the start: changes for a tracked root, the reason for the Workbench', async (t) => {
  const { tracker, changes, roots } = await useTracker(t, { watch: false });
  assert.deepEqual(
    tracker.roots().map((root) => root.id),
    roots.map((root) => root.id),
  );
  assert.deepEqual(
    tracker.snapshots().map((snapshot) => [snapshot.rootId, snapshot.status, snapshot.baseline]),
    [
      ['lore', 'ok', 'HEAD'],
      ['workbench', 'untracked', 'HEAD'],
      ['publish:publish', 'ok', 'HEAD'],
      [REPO, 'ok', 'HEAD'],
    ],
  );
  assert.deepEqual(pathsOf(tracker.snapshot(REPO)), [
    'docs/delete-uncommitted.md',
    'docs/edit-uncommitted.md',
    'notes/untracked.md',
  ]);
  const workbench = tracker.snapshot('workbench');
  assert.equal(workbench?.status, 'untracked');
  if (workbench?.status === 'untracked') assert.equal(workbench.reason, 'git-ignored');
  assert.equal(tracker.snapshot('repo:unknown'), null);
  assert.equal(tracker.baseline('repo:unknown'), null);
  // Each tracked root reported its first read once.
  assert.deepEqual(
    changes.map((snapshot) => snapshot.rootId).sort(),
    ['lore', 'publish:publish', REPO].sort(),
  );
});

test('a starting baseline is honoured, and setBaseline reads at once and always reports', async (t) => {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['alpha'],
  });
  t.after(() => fixture.cleanup());
  const mark = fixture.repositories[0]?.baseCommit ?? '';
  const present = fixture.repositories[0]?.headCommit ?? '';
  const resolved = await resolveRoots({ spaceRoot: fixture.root, runner: execFileRunner });
  if (!resolved.ok) assert.fail(resolved.error.message);
  const changes: RootSnapshot[] = [];
  const tracker = await attachRootTracker({
    roots: resolved.value,
    runner: execFileRunner,
    watch: false,
    baselines: { [REPO]: mark },
    onChange: (snapshot) => changes.push(snapshot),
  });
  t.after(() => tracker.close());

  assert.equal(tracker.baseline(REPO), mark);
  assert.equal(pathsOf(tracker.snapshot(REPO)).length, 7);

  // Mark as reviewed: the baseline becomes the present commit and only the uncommitted files remain.
  changes.length = 0;
  await tracker.setBaseline(REPO, present);
  assert.equal(tracker.baseline(REPO), present);
  assert.deepEqual(
    changes.map((snapshot) => [snapshot.rootId, snapshot.baseline]),
    [[REPO, present]],
  );
  assert.deepEqual(pathsOf(tracker.snapshot(REPO)), [
    'docs/delete-uncommitted.md',
    'docs/edit-uncommitted.md',
    'notes/untracked.md',
  ]);

  // The Lore is clean under both baselines; the change of baseline is reported all the same.
  changes.length = 0;
  await tracker.setBaseline('lore', fixture.head);
  assert.equal(changes.length, 1);
  assert.deepEqual(pathsOf(changes[0] ?? null), []);
  await tracker.setBaseline('lore', fixture.head);
  assert.equal(changes.length, 1, 'the same baseline again is not a change');

  // A baseline that is not a commit is a failed snapshot, not a throw.
  await tracker.setBaseline(REPO, 'f'.repeat(40));
  const failed = tracker.snapshot(REPO);
  assert.equal(failed?.status, 'failed');
  if (failed?.status === 'failed') assert.equal(failed.error.kind, 'baseline-missing');

  await tracker.setBaseline('workbench', present);
  assert.equal(tracker.snapshot('workbench')?.status, 'untracked');
  assert.equal(tracker.baseline('workbench'), present);
});

test('debounce: a burst of scheduleRefresh calls gives one read, and an unchanged list is not reported', async (t) => {
  const { fixture, tracker, changes, runner } = await useTracker(t, {
    watch: false,
    debounceMs: 80,
  });
  const readsAtStart = runner.statusReads();
  changes.length = 0;

  for (let index = 0; index < 6; index += 1) {
    tracker.scheduleRefresh(REPO);
    await sleep(10);
  }
  assert.equal(runner.statusReads(), readsAtStart, 'a read ran inside the debounce window');
  await waitFor(() => runner.statusReads() > readsAtStart, 'the debounced read');
  await sleep(250);
  assert.equal(runner.statusReads(), readsAtStart + 1);
  assert.equal(changes.length, 0);

  fixture.repositories[0]?.checkout.write('src/burst.ts', 'export const burst = 1;\n');
  tracker.scheduleRefresh(REPO);
  tracker.scheduleRefresh(REPO);
  await waitFor(() => changes.length > 0, 'the changed list');
  await sleep(250);
  assert.equal(changes.length, 1);
  assert.equal(runner.statusReads(), readsAtStart + 2);
  assert.ok(pathsOf(tracker.snapshot(REPO)).includes('src/burst.ts'));

  tracker.scheduleRefresh('workbench');
  tracker.scheduleRefresh('repo:unknown');
  await sleep(250);
  assert.equal(runner.statusReads(), readsAtStart + 2, 'an untracked or unknown root was read');
});

test('refreshNow reads at once, one root or all, and cancels a pending debounced read', async (t) => {
  const { fixture, tracker, changes, runner } = await useTracker(t, {
    watch: false,
    debounceMs: 150,
  });
  changes.length = 0;
  fixture.space.write('lore/fresh.md', '# fresh\n');
  tracker.scheduleRefresh('lore');
  const before = runner.statusReads();
  await tracker.refreshNow('lore');
  assert.deepEqual(pathsOf(tracker.snapshot('lore')), ['fresh.md']);
  assert.equal(runner.statusReads(), before + 1);
  await sleep(400);
  assert.equal(runner.statusReads(), before + 1, 'the pending debounced read still ran');

  fixture.space.write('publish/fresh.md', '# fresh\n');
  await tracker.refreshNow();
  assert.deepEqual(pathsOf(tracker.snapshot('publish:publish')), ['fresh.md']);
  assert.deepEqual(
    changes.map((snapshot) => snapshot.rootId),
    ['lore', 'publish:publish'],
  );
});

test('the watchers re-read a root on a file write, on a commit and on a branch change, and report no git internals', async (t) => {
  const { fixture, tracker, events } = await useTracker(t, { debounceMs: 50 });
  const checkout = fixture.repositories[0]?.checkout;
  if (checkout === undefined) assert.fail('the fixture has no repository');

  checkout.write('src/watched file.ts', 'export const watched = 1;\n');
  await waitFor(
    () => pathsOf(tracker.snapshot(REPO)).includes('src/watched file.ts'),
    'the written file',
  );

  // A commit writes nothing in the working tree; only `logs/HEAD` tells.
  await checkout.commitAll('Commit everything');
  await waitFor(() => pathsOf(tracker.snapshot(REPO)).length === 0, 'the commit');

  await checkout.git('checkout', '--quiet', '-b', 'other');
  await waitFor(() => {
    const snapshot = tracker.snapshot(REPO);
    return snapshot?.status === 'ok' && snapshot.changes.branch.branch === 'other';
  }, 'the branch change');

  // The Lore is a folder of the Space repository: its own watcher and the shared git folder.
  fixture.space.write('lore/watched.md', '# watched\n');
  await waitFor(() => pathsOf(tracker.snapshot('lore')).includes('watched.md'), 'the Lore file');
  await fixture.space.commitAll('Commit the Lore file');
  await waitFor(() => pathsOf(tracker.snapshot('lore')).length === 0, 'the Space commit');
  assert.deepEqual(pathsOf(tracker.snapshot('publish:publish')), []);

  // The Workbench has no change tracking, and its files still reach the host's tree.
  writeFileSync(join(fixture.paths.scratch, 'note.md'), '# note\n', 'utf8');
  await waitFor(
    () => events.some((event) => event.rootId === 'workbench' && event.absPath.endsWith('note.md')),
    'the Workbench file event',
  );

  const internals = events.filter((event) => event.absPath.split(sep).includes('.git'));
  assert.deepEqual(internals, []);
  assert.ok(events.some((event) => event.rootId === REPO && event.event === 'add'));
});

test('the watchers never follow a symbolic link out of a root', async (t) => {
  const outside = useTempDir(t);
  mkdirSync(join(outside, 'deep'));
  const { tracker, events, runner } = await useTracker(t, { debounceMs: 50 }, (fixture) => {
    symlinkSync(outside, join(fixture.repositories[0]?.checkout.dir ?? '', 'link-out'));
  });
  // git lists the link itself as one untracked entry and nothing behind it.
  assert.ok(pathsOf(tracker.snapshot(REPO)).includes('link-out'));
  assert.equal(
    pathsOf(tracker.snapshot(REPO)).some((path) => path.startsWith('link-out/')),
    false,
  );

  const reads = runner.statusReads();
  events.length = 0;
  writeFileSync(join(outside, 'written-outside.md'), '# outside\n', 'utf8');
  writeFileSync(join(outside, 'deep', 'also-outside.md'), '# outside\n', 'utf8');
  await sleep(900);
  assert.deepEqual(events, []);
  assert.equal(runner.statusReads(), reads);
});

test('close stops the timers and the watchers: nothing is read or reported afterwards, and it can be called twice', async (t) => {
  const { fixture, tracker, changes, events, runner } = await useTracker(t, { debounceMs: 50 });
  const checkout = fixture.repositories[0]?.checkout;
  if (checkout === undefined) assert.fail('the fixture has no repository');
  changes.length = 0;
  events.length = 0;

  tracker.scheduleRefresh(REPO);
  checkout.write('src/just-before-close.ts', 'export const x = 1;\n');
  await tracker.close();
  const reads = runner.statusReads();

  checkout.write('src/after-close.ts', 'export const y = 2;\n');
  await checkout.commitAll('After close');
  tracker.scheduleRefresh(REPO);
  await tracker.refreshNow();
  await tracker.setBaseline(REPO, fixture.repositories[0]?.baseCommit ?? '');
  await sleep(600);

  assert.equal(runner.statusReads(), reads);
  assert.deepEqual(changes, []);
  assert.deepEqual(events, []);
  assert.equal(tracker.baseline(REPO), 'HEAD');
  await tracker.close();
});

test('a listener that throws does not break the tracker: the attach finishes, later changes are read, and the throw is reported', async (t) => {
  const reported: string[] = [];
  const { fixture, tracker } = await useTracker(t, {
    debounceMs: 50,
    onChange: () => {
      throw new Error('the change listener broke');
    },
    onFileEvent: () => {
      throw new Error('the file listener broke');
    },
    onWatcherError: (message) => {
      reported.push(message);
      throw new Error('the error listener broke too');
    },
  });
  assert.equal(tracker.snapshot(REPO)?.status, 'ok');
  assert.ok(reported.some((message) => message.includes('the change listener broke')));

  fixture.repositories[0]?.checkout.write('src/after-the-throw.ts', 'export const a = 1;\n');
  await waitFor(
    () => pathsOf(tracker.snapshot(REPO)).includes('src/after-the-throw.ts'),
    'the file written after the listener threw',
  );
  await waitFor(
    () => reported.some((message) => message.includes('the file listener broke')),
    'the report of the file listener',
  );
  await tracker.refreshNow();
  await tracker.setBaseline(REPO, fixture.repositories[0]?.baseCommit ?? '');
  assert.equal(tracker.snapshot(REPO)?.status, 'ok');
});

test('a failure in one root does not stop the others: a runner that throws, and a root whose folder is removed while it is watched', async (t) => {
  let broken = false;
  const runner: CommandRunner = {
    run(bin, args, opts) {
      if (broken && (opts?.cwd ?? '').includes(`${sep}repos${sep}alpha`)) {
        return Promise.reject(new Error('the runner broke'));
      }
      return execFileRunner.run(bin, args, opts);
    },
  };
  const { fixture, tracker } = await useTracker(t, { debounceMs: 50, watch: true, runner });
  const checkout = fixture.repositories[0]?.checkout;
  if (checkout === undefined) assert.fail('the fixture has no repository');

  broken = true;
  await tracker.refreshNow();
  const failed = tracker.snapshot(REPO);
  assert.equal(failed?.status, 'failed');
  if (failed?.status === 'failed') assert.equal(failed.error.kind, 'command-failed');
  assert.equal(tracker.snapshot('lore')?.status, 'ok');
  broken = false;
  await tracker.refreshNow(REPO);
  assert.equal(tracker.snapshot(REPO)?.status, 'ok');

  rmSync(checkout.dir, { recursive: true, force: true });
  await waitFor(() => {
    const snapshot = tracker.snapshot(REPO);
    return snapshot?.status === 'failed' && snapshot.error.kind === 'folder-missing';
  }, 'the removed folder');
  fixture.space.write('lore/after-the-removal.md', '# still read\n');
  await waitFor(
    () => pathsOf(tracker.snapshot('lore')).includes('after-the-removal.md'),
    'the Lore file after the repository went away',
  );
  await tracker.refreshNow();
  await tracker.close();
});

test('a burst of 10,000 file events gives a bounded number of reads, and a read slower than the debounce never overlaps itself', async (t) => {
  let reads = 0;
  let active = 0;
  let overlapped = false;
  const runner: CommandRunner = {
    async run(bin, args, opts) {
      const counted = args.includes('status') && (opts?.cwd ?? '').includes(`${sep}alpha`);
      if (!counted) return execFileRunner.run(bin, args, opts);
      reads += 1;
      active += 1;
      if (active > 1) overlapped = true;
      try {
        await sleep(300);
        return await execFileRunner.run(bin, args, opts);
      } finally {
        active -= 1;
      }
    },
  };
  const { fixture, tracker } = await useTracker(t, { debounceMs: 50, runner });
  const dir = fixture.repositories[0]?.checkout.dir ?? '';
  const before = pathsOf(tracker.snapshot(REPO)).length;
  reads = 0;

  mkdirSync(join(dir, 'burst'));
  for (let index = 0; index < 10_000; index += 1) {
    writeFileSync(join(dir, 'burst', `${index}.md`), 'x');
    if (index % 1000 === 0) tracker.scheduleRefresh(REPO);
  }
  await waitFor(
    () => {
      const snapshot = tracker.snapshot(REPO);
      return snapshot?.status === 'ok' && snapshot.changes.total === before + 10_000;
    },
    'the read after the burst',
    30_000,
  );
  await sleep(800);
  assert.equal(overlapped, false);
  assert.ok(reads >= 1 && reads <= 12, `${reads} reads for 10,000 events`);
});

test('a git reset is noticed, and a change of the index alone is not watched', async (t) => {
  const { fixture, tracker, runner } = await useTracker(t, { debounceMs: 50 });
  const repository = fixture.repositories[0];
  if (repository === undefined) assert.fail('the fixture has no repository');
  await repository.checkout.commitAll('Commit everything');
  await waitFor(() => pathsOf(tracker.snapshot(REPO)).length === 0, 'the commit');

  await repository.checkout.git('reset', '--quiet', '--soft', repository.baseCommit);
  await waitFor(() => {
    const snapshot = tracker.snapshot(REPO);
    return snapshot?.status === 'ok' && snapshot.changes.head === repository.baseCommit;
  }, 'the reset');
  assert.ok(pathsOf(tracker.snapshot(REPO)).length > 0);

  // `git add` rewrites `.git/index` and leaves `HEAD` and its log alone: no read follows it.
  repository.checkout.write('src/index-only.ts', 'export const i = 1;\n');
  await waitFor(
    () => pathsOf(tracker.snapshot(REPO)).includes('src/index-only.ts'),
    'the written file',
  );
  await sleep(400);
  const reads = runner.statusReads();
  await repository.checkout.git('add', 'src/index-only.ts');
  await sleep(700);
  assert.equal(runner.statusReads(), reads);
});
