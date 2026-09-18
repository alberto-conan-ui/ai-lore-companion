import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { type SpaceFixture, makeSpaceFixture, makeTempDir } from '@ai-lore-companion/core/testing';
import { registerSpaceFiles } from '../../../src/main/space/ipc/files.js';
import { ROOT_SEARCH_MAX_QUERY } from '../../../src/main/space/ipc/root-search.js';
import {
  ROOT_SEARCH_LIMITS,
  ROOT_SEARCH_TUNING,
  setRootSearchHook,
  setRootSearchRipgrep,
} from '../../../src/main/space/root-search.js';
import { rootsServiceStats } from '../../../src/main/space/roots-service.js';
import { SPACE_FILES_CONTRACT } from '../../../src/shared/ipc/space/files.contract.js';
import type {
  RootSearchGroup,
  SpaceRootSearchCancelResult,
  SpaceRootSearchResult,
} from '../../../src/shared/ipc/space/root-search.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M5.6: search over the roots of a Space, `spaceRootSearch` and `spaceRootSearchCancel`,
// driven through the real Space host on fake windows against a Space fixture with one repository.

let space: SpaceFixture;
let outside: { dir: string; cleanup: () => void };
const opened: SpaceHarness[] = [];
const defaultTimeLimit = ROOT_SEARCH_TUNING.timeLimitMs;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'search-space',
    repositories: ['app'],
  });
  outside = makeTempDir('ai-lore-search-outside-');
  writeFileSync(join(outside.dir, 'outside-secret.txt'), 'zebraoutsideneedle\n');
  const app = join(space.root, 'repos', 'app');
  writeFileSync(join(app, 'needle-app-file.md'), 'The word quokkaneedle is in this line.\n');
  mkdirSync(join(app, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(app, 'node_modules', 'dep', 'needle-in-deps.js'), 'quokkaneedle\n');
  writeFileSync(join(app, '.gitignore'), '# comment\nignored-by-git/\n');
  mkdirSync(join(app, 'ignored-by-git'), { recursive: true });
  writeFileSync(join(app, 'ignored-by-git', 'needle-ignored.md'), 'quokkaneedle\n');
  mkdirSync(join(app, 'many'), { recursive: true });
  for (let i = 0; i < ROOT_SEARCH_LIMITS.names + 5; i += 1) {
    writeFileSync(join(app, 'many', `capfile-${i}.txt`), `capline ${i}\n`);
  }
  symlinkSync(join(outside.dir, 'outside-secret.txt'), join(space.root, 'lore', 'linkout.txt'));
});

after(() => {
  space.cleanup();
  outside.cleanup();
});

afterEach(async () => {
  setRootSearchHook(null);
  setRootSearchRipgrep(null);
  ROOT_SEARCH_TUNING.timeLimitMs = defaultTimeLimit;
  for (const h of opened.splice(0)) {
    await h.space.host.dispose();
    h.cleanup();
  }
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 }, 'no watcher is left');
});

async function open(): Promise<{ h: SpaceHarness; filesWindow: FakeSpaceWindow }> {
  const h = spaceHarnessFor(registerSpaceFiles);
  opened.push(h);
  await h.space.host.openFolder(undefined, space.root);
  const spaceWindow = h.space.created[h.space.created.length - 1];
  assert.ok(spaceWindow);
  const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(context);
  h.space.host.openFilesWindow(context);
  const filesWindow = h.space.created[h.space.created.length - 1];
  assert.ok(filesWindow && filesWindow !== spaceWindow);
  return { h, filesWindow };
}

type Opened = { h: SpaceHarness; filesWindow: FakeSpaceWindow };

async function search(o: Opened, arg: unknown): Promise<SpaceRootSearchResult> {
  return (await o.h.invoke('spaceRootSearch', o.filesWindow, arg)) as SpaceRootSearchResult;
}

function must(result: SpaceRootSearchResult): RootSearchGroup {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Search until `check` holds, for the watcher's events to arrive. */
async function searchUntil(
  o: Opened,
  arg: unknown,
  check: (group: RootSearchGroup) => boolean,
): Promise<RootSearchGroup> {
  let last: RootSearchGroup | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    last = must(await search(o, arg));
    if (check(last)) return last;
    await delay(100);
  }
  assert.fail(`the condition did not hold; last names: ${JSON.stringify(last?.names.hits)}`);
}

test('the channels are in the Files window fragment', () => {
  assert.equal(SPACE_FILES_CONTRACT.spaceRootSearch.channel, 'space:root-search');
  assert.equal(SPACE_FILES_CONTRACT.spaceRootSearchCancel.channel, 'space:root-search-cancel');
});

test('a root is searched by file name and inside files, every path relative to the root', async () => {
  const o = await open();
  const byName = must(await search(o, { rootId: 'repo:app', query: 'needle-app' }));
  assert.equal(byName.outcome, 'done');
  assert.equal(byName.rootId, 'repo:app');
  assert.ok(byName.names.hits.some((hit) => hit.path === 'needle-app-file.md'));
  assert.equal(byName.names.limit, ROOT_SEARCH_LIMITS.names);

  const inside = must(await search(o, { rootId: 'repo:app', query: 'quokkaneedle' }));
  assert.equal(inside.content.finished, true);
  assert.equal(inside.ripgrepMissing, false);
  const hit = inside.content.hits.find((entry) => entry.path === 'needle-app-file.md');
  assert.ok(hit, `found inside: ${JSON.stringify(inside.content.hits)}`);
  assert.equal(hit.line, 1);
  assert.equal(hit.name, 'needle-app-file.md');
  for (const entry of [...inside.names.hits, ...inside.content.hits]) {
    assert.ok(!entry.path.startsWith('/') && !entry.path.startsWith('./'), entry.path);
  }

  const lore = must(await search(o, { rootId: 'lore', query: 'space.md' }));
  assert.ok(lore.names.hits.some((entry) => entry.path === 'space.md'));
});

test('.git, node_modules and what the root .gitignore leaves out are not searched', async () => {
  const o = await open();
  const names = must(await search(o, { rootId: 'repo:app', query: 'needle' }));
  const paths = names.names.hits.map((hit) => hit.path);
  assert.ok(paths.includes('needle-app-file.md'));
  assert.ok(!paths.some((path) => path.includes('node_modules')), paths.join(', '));
  assert.ok(!paths.some((path) => path.includes('ignored-by-git')), paths.join(', '));

  const inside = must(await search(o, { rootId: 'repo:app', query: 'quokkaneedle' }));
  const contentPaths = inside.content.hits.map((hit) => hit.path);
  assert.deepEqual(contentPaths, ['needle-app-file.md']);

  const git = must(await search(o, { rootId: 'repo:app', query: 'HEAD' }));
  assert.ok(!git.names.hits.some((hit) => hit.path.toLowerCase().startsWith('.git/')));
});

test('a symbolic link that leads out of the root is not indexed', async () => {
  const o = await open();
  const group = must(await search(o, { rootId: 'lore', query: 'linkout' }));
  assert.deepEqual(group.names.hits, []);
});

test('each root caps its hits and says so', async () => {
  const o = await open();
  const group = must(await search(o, { rootId: 'repo:app', query: 'capfile' }));
  assert.equal(group.names.hits.length, ROOT_SEARCH_LIMITS.names);
  assert.equal(group.names.truncated, true);
  assert.equal(group.names.limit, ROOT_SEARCH_LIMITS.names);
  assert.equal(group.content.limit, ROOT_SEARCH_LIMITS.content);
  assert.equal(group.indexLimit, ROOT_SEARCH_LIMITS.indexFiles);
  assert.equal(group.indexTruncated, false);
});

test('the index of names follows the roots file events: a file added is found, a file removed is not', async () => {
  const o = await open();
  must(await search(o, { rootId: 'repo:app', query: 'walrusfresh' }));
  const file = join(space.root, 'repos', 'app', 'walrusfresh-new.md');
  writeFileSync(file, '# new\n');
  try {
    await searchUntil(o, { rootId: 'repo:app', query: 'walrusfresh' }, (group) =>
      group.names.hits.some((hit) => hit.path === 'walrusfresh-new.md'),
    );
  } finally {
    rmSync(file, { force: true });
  }
  await searchUntil(o, { rootId: 'repo:app', query: 'walrusfresh' }, (group) =>
    group.names.hits.every((hit) => hit.path !== 'walrusfresh-new.md'),
  );
});

test('a slow root does not hold back another root, and is sent when its time limit passes', async () => {
  const o = await open();
  // The slow root is held in its hook until the end of the test; it can only
  // end by its time limit. The fast root runs under the default limit, so the
  // time it takes on a loaded machine cannot turn it into a time-out: what is
  // checked is that it ends while the slow root is still held.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let slowStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    slowStarted = resolve;
  });
  setRootSearchHook((rootId) => {
    if (rootId !== 'lore') return undefined;
    slowStarted();
    return held;
  });
  try {
    ROOT_SEARCH_TUNING.timeLimitMs = 400;
    const slow = search(o, { rootId: 'lore', query: 'space' });
    // The slow root's timer is set in the same step as its hook is called.
    await started;
    ROOT_SEARCH_TUNING.timeLimitMs = defaultTimeLimit;
    const fastGroup = must(await search(o, { rootId: 'repo:app', query: 'needle' }));
    assert.equal(fastGroup.outcome, 'done');
    const slowGroup = must(await slow);
    assert.equal(slowGroup.outcome, 'timed-out');
    assert.equal(slowGroup.names.finished, false);
    assert.equal(slowGroup.timeLimitMs, 400);
  } finally {
    release();
  }
});

test('a newer search of the same window for the same root cancels the older one', async () => {
  const o = await open();
  let calls = 0;
  setRootSearchHook(() => {
    calls += 1;
    return calls === 1 ? delay(1500) : undefined;
  });
  const older = search(o, { rootId: 'repo:app', query: 'need' });
  await delay(50);
  const newer = must(await search(o, { rootId: 'repo:app', query: 'needle' }));
  assert.equal(newer.outcome, 'done');
  assert.equal(must(await older).outcome, 'cancelled');
});

test('spaceRootSearchCancel stops every running search of the window', async () => {
  const o = await open();
  setRootSearchHook(() => delay(1500));
  const running = search(o, { rootId: 'repo:app', query: 'needle' });
  await delay(50);
  const cancelled = (await o.h.invoke(
    'spaceRootSearchCancel',
    o.filesWindow,
    undefined,
  )) as SpaceRootSearchCancelResult;
  assert.deepEqual(cancelled, { ok: true, value: { cancelled: 1 } });
  assert.equal(must(await running).outcome, 'cancelled');
});

test('without ripgrep, names are still searched and the result says ripgrep is missing', async () => {
  const o = await open();
  setRootSearchRipgrep(join(outside.dir, 'no-such-rg'));
  const group = must(await search(o, { rootId: 'repo:app', query: 'needle-app' }));
  assert.equal(group.ripgrepMissing, true);
  assert.ok(group.names.hits.some((hit) => hit.path === 'needle-app-file.md'));
});

test('the query and the root are validated', async () => {
  const o = await open();
  const refusedArgs: unknown[] = [
    { rootId: 'lore', query: '' },
    { rootId: 'lore', query: '   ' },
    { rootId: 'lore', query: 'a\nb' },
    { rootId: 'lore', query: 'x'.repeat(ROOT_SEARCH_MAX_QUERY + 1) },
    { rootId: 'lore', query: 'x', path: '/etc' },
    { rootId: '../lore', query: 'x' },
    { query: 'x' },
    null,
  ];
  for (const arg of refusedArgs) {
    const result = await search(o, arg);
    assert.equal(result.ok, false, JSON.stringify(arg));
    if (!result.ok) assert.equal(result.error.kind, 'invalid-argument');
  }
  const unknown = await search(o, { rootId: 'repo:nothing', query: 'x' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.kind, 'unknown-root');
});

// Attacks by the M5.6 tester.

test('a glob query built to make a regular expression backtrack answers at once', async () => {
  const o = await open();
  const long = join(space.root, 'repos', 'app', `${'a'.repeat(60)}.txt`);
  writeFileSync(long, 'a\n');
  try {
    const query = `${'*a'.repeat(40)}b`;
    const started = Date.now();
    const group = must(await search(o, { rootId: 'repo:app', query }));
    assert.equal(group.outcome, 'done');
    assert.deepEqual(group.names.hits, []);
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
    const glob = must(await search(o, { rootId: 'repo:app', query: 'needle-*.m?' }));
    assert.deepEqual(
      glob.names.hits.map((hit) => hit.path),
      ['needle-app-file.md'],
    );
  } finally {
    rmSync(long, { force: true });
  }
});

test('a query of the longest length and one of 100 KB are handled', async () => {
  const o = await open();
  const longest = must(
    await search(o, { rootId: 'repo:app', query: 'q'.repeat(ROOT_SEARCH_MAX_QUERY) }),
  );
  assert.equal(longest.outcome, 'done');
  const huge = await search(o, { rootId: 'repo:app', query: 'q'.repeat(100 * 1024) });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.error.kind, 'invalid-argument');
  const dash = must(await search(o, { rootId: 'repo:app', query: '--files' }));
  assert.equal(dash.outcome, 'done');
  assert.deepEqual(dash.content.hits, []);
});

test('binary files are not searched inside, and a very long line does not hide other hits', async () => {
  const o = await open();
  const app = join(space.root, 'repos', 'app');
  writeFileSync(
    join(app, 'binary.dat'),
    Buffer.concat([Buffer.from('ibexneedle'), Buffer.alloc(16), Buffer.from('ibexneedle')]),
  );
  writeFileSync(join(app, 'a-huge-line.txt'), `${'x'.repeat(3_000_000)}ibexneedle\n`);
  writeFileSync(join(app, 'z-small.txt'), 'one ibexneedle here\n');
  try {
    const group = must(await search(o, { rootId: 'repo:app', query: 'ibexneedle' }));
    assert.deepEqual(
      group.content.hits.map((hit) => hit.path),
      ['z-small.txt'],
    );
  } finally {
    for (const name of ['binary.dat', 'a-huge-line.txt', 'z-small.txt']) {
      rmSync(join(app, name), { force: true });
    }
  }
});

test('a symbolic link out of the root is not entered and its target is not read', async () => {
  const o = await open();
  const linkDir = join(space.root, 'lore', 'linkdir');
  symlinkSync(outside.dir, linkDir);
  try {
    const inside = must(await search(o, { rootId: 'lore', query: 'zebraoutsideneedle' }));
    assert.deepEqual(inside.content.hits, []);
    const names = must(await search(o, { rootId: 'lore', query: 'outside-secret' }));
    assert.deepEqual(names.names.hits, []);
  } finally {
    unlinkSync(linkDir);
  }
});

test("another window of the Space cannot cancel this window's search", async () => {
  const o = await open();
  const spaceWindow = o.h.space.created[0];
  assert.ok(spaceWindow && spaceWindow !== o.filesWindow);
  setRootSearchHook(() => delay(600));
  const running = search(o, { rootId: 'repo:app', query: 'needle' });
  await delay(50);
  const other = (await o.h.invoke(
    'spaceRootSearchCancel',
    spaceWindow,
    undefined,
  )) as SpaceRootSearchCancelResult;
  assert.deepEqual(other, { ok: true, value: { cancelled: 0 } });
  assert.equal(must(await running).outcome, 'done');
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a newer search stops the ripgrep process of the older one, and cancel stops the rest', async () => {
  const o = await open();
  const pids = join(outside.dir, 'rg-pids');
  const fake = join(outside.dir, 'fake-rg.sh');
  writeFileSync(fake, `#!/bin/sh\necho $$ >> '${pids}'\nexec sleep 30\n`);
  chmodSync(fake, 0o755);
  setRootSearchRipgrep(fake);
  const readPids = (): number[] =>
    existsSync(pids)
      ? readFileSync(pids, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map(Number)
      : [];
  try {
    const older = search(o, { rootId: 'repo:app', query: 'need' });
    while (readPids().length < 1) await delay(20);
    const newer = search(o, { rootId: 'repo:app', query: 'needle' });
    assert.equal(must(await older).outcome, 'cancelled');
    while (readPids().length < 2) await delay(20);
    const [first, second] = readPids();
    assert.ok(first !== undefined && second !== undefined);
    await delay(100);
    assert.equal(alive(first), false, 'the older search left its ripgrep running');
    assert.equal(alive(second), true);
    await o.h.invoke('spaceRootSearchCancel', o.filesWindow, undefined);
    assert.equal(must(await newer).outcome, 'cancelled');
    await delay(100);
    assert.equal(alive(second), false, 'cancel left a ripgrep running');
  } finally {
    for (const pid of readPids()) if (alive(pid)) process.kill(pid);
    rmSync(pids, { force: true });
  }
});

test('a change of a .gitignore file rebuilds the index of names', async () => {
  const o = await open();
  const app = join(space.root, 'repos', 'app');
  const ignoreFile = join(app, '.gitignore');
  const before = readFileSync(ignoreFile, 'utf8');
  writeFileSync(join(app, 'lynxfresh.log'), 'x\n');
  try {
    await searchUntil(o, { rootId: 'repo:app', query: 'lynxfresh' }, (group) =>
      group.names.hits.some((hit) => hit.path === 'lynxfresh.log'),
    );
    writeFileSync(ignoreFile, `${before}*.log\n`);
    await searchUntil(o, { rootId: 'repo:app', query: 'lynxfresh' }, (group) =>
      group.names.hits.every((hit) => hit.path !== 'lynxfresh.log'),
    );
  } finally {
    writeFileSync(ignoreFile, before);
    rmSync(join(app, 'lynxfresh.log'), { force: true });
  }
});

test('the index of names stops at its cap and says so', async () => {
  const o = await open();
  const cap = ROOT_SEARCH_LIMITS.indexFiles;
  ROOT_SEARCH_LIMITS.indexFiles = 10;
  try {
    const group = must(await search(o, { rootId: 'repo:app', query: 'capfile' }));
    assert.equal(group.indexTruncated, true);
    assert.equal(group.indexLimit, 10);
    assert.ok(group.names.hits.length <= 10);
  } finally {
    ROOT_SEARCH_LIMITS.indexFiles = cap;
  }
});

test(
  'a root of 100,000 files is searched within its caps and time limit',
  { skip: process.env.AI_LORE_SLOW_TESTS !== '1' && 'set AI_LORE_SLOW_TESTS=1 to run it' },
  async () => {
    const big = await makeSpaceFixture({
      templateDir: LORE_TEMPLATE_DIR,
      name: 'big-space',
      repositories: ['big'],
    });
    try {
      const repo = join(big.root, 'repos', 'big');
      for (let folder = 0; folder < 101; folder += 1) {
        const dir = join(repo, `folder-${folder}`);
        mkdirSync(dir);
        for (let file = 0; file < 1000; file += 1) {
          writeFileSync(join(dir, `file-${folder}-${file}.txt`), `line ${folder} ${file}\n`);
        }
      }
      const h = spaceHarnessFor(registerSpaceFiles);
      opened.push(h);
      await h.space.host.openFolder(undefined, big.root);
      const spaceWindow = h.space.created[h.space.created.length - 1];
      assert.ok(spaceWindow);
      const context = h.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
      assert.ok(context);
      h.space.host.openFilesWindow(context);
      const filesWindow = h.space.created[h.space.created.length - 1];
      assert.ok(filesWindow);
      const started = Date.now();
      const first = must(
        (await h.invoke('spaceRootSearch', filesWindow, {
          rootId: 'repo:big',
          query: 'file-7-9',
        })) as SpaceRootSearchResult,
      );
      const firstMs = Date.now() - started;
      assert.equal(first.outcome, 'done', `first search took ${firstMs} ms`);
      assert.equal(first.indexTruncated, true);
      assert.ok(first.names.hits.length <= ROOT_SEARCH_LIMITS.names);
      assert.ok(first.content.hits.length <= ROOT_SEARCH_LIMITS.content);
      const again = Date.now();
      must(
        (await h.invoke('spaceRootSearch', filesWindow, {
          rootId: 'repo:big',
          query: 'file-9*',
        })) as SpaceRootSearchResult,
      );
      console.log(`100,000 files: first search ${firstMs} ms, next ${Date.now() - again} ms`);
    } finally {
      for (const h of opened.splice(0)) {
        await h.space.host.dispose();
        h.cleanup();
      }
      big.cleanup();
    }
  },
);

test('a window that is not a window of an open Space is refused', async () => {
  const o = await open();
  const result = (await o.h.invoke(
    'spaceRootSearch',
    { webContentsId: 987_654 },
    { rootId: 'lore', query: 'space' },
  )) as SpaceRootSearchResult;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'not-a-space-window');
  const cancel = (await o.h.invoke(
    'spaceRootSearchCancel',
    { webContentsId: 987_654 },
    undefined,
  )) as SpaceRootSearchCancelResult;
  assert.equal(cancel.ok, false);
});
