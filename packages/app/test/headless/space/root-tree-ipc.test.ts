import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { type SpaceFixture, makeSpaceFixture, makeTempDir } from '@ai-lore-companion/core/testing';
import { registerSpaceFiles } from '../../../src/main/space/ipc/files.js';
import {
  ROOT_TREE_MAX_ENTRIES,
  setRootRevealOpener,
} from '../../../src/main/space/ipc/root-tree.js';
import { rootsServiceStats } from '../../../src/main/space/roots-service.js';
import { SPACE_FILES_CONTRACT } from '../../../src/shared/ipc/space/files.contract.js';
import type { RootTreeLevel } from '../../../src/shared/ipc/space/root-tree.types.js';
import type { SpaceRootsResult } from '../../../src/shared/ipc/space/roots.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M5.2: the tree listing of a root, `spaceRootTreeExpand`, driven through the real
// Space host on fake windows against a Space fixture with one repository.

let space: SpaceFixture;
let outside: { dir: string; cleanup: () => void };
const opened: SpaceHarness[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'tree-space',
    repositories: ['app'],
  });
  outside = makeTempDir('ai-lore-tree-outside-');
  writeFileSync(join(outside.dir, 'secret.txt'), 'outside\n');
});

after(() => {
  space.cleanup();
  outside.cleanup();
});

afterEach(async () => {
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

async function expand(
  o: { h: SpaceHarness; filesWindow: FakeSpaceWindow },
  arg: unknown,
): Promise<SpaceRootsResult<RootTreeLevel>> {
  return (await o.h.invoke(
    'spaceRootTreeExpand',
    o.filesWindow,
    arg,
  )) as SpaceRootsResult<RootTreeLevel>;
}

function must<T>(result: SpaceRootsResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

test('the channel is in the Files window fragment', () => {
  assert.equal(SPACE_FILES_CONTRACT.spaceRootTreeExpand.channel, 'space:root-tree-expand');
});

test('the root folder of the Lore is listed one level deep, folders first, with paths relative to the root', async () => {
  const o = await open();
  const level = must(await expand(o, { rootId: 'lore' }));
  assert.equal(level.rootId, 'lore');
  assert.equal(level.path, '');
  assert.ok(level.entries.length > 0);
  assert.ok(level.entries.some((entry) => entry.name === 'space.md' && !entry.isDir));
  const firstFile = level.entries.findIndex((entry) => !entry.isDir);
  const lastFolder = level.entries.map((entry) => entry.isDir).lastIndexOf(true);
  assert.ok(firstFile === -1 || lastFolder < firstFile, 'folders come before files');
  for (const entry of level.entries) assert.equal(entry.path, entry.name);

  const folder = level.entries.find((entry) => entry.isDir);
  if (folder) {
    const inner = must(await expand(o, { rootId: 'lore', path: folder.path }));
    assert.equal(inner.path, folder.path);
    for (const entry of inner.entries) assert.equal(entry.path, `${folder.path}/${entry.name}`);
  }
});

test('a repository root never lists its .git folder, and a path into it is refused', async () => {
  const o = await open();
  const level = must(await expand(o, { rootId: 'repo:app', path: '' }));
  assert.ok(!level.entries.some((entry) => entry.name.toLowerCase() === '.git'));
  const refused = await expand(o, { rootId: 'repo:app', path: '.git' });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.kind, 'path-refused');
  const upper = await expand(o, { rootId: 'repo:app', path: '.GIT/refs' });
  assert.equal(upper.ok, false);
});

test('the Workbench, which git does not track, has a tree', async () => {
  const o = await open();
  const workbenchPath = join(space.root, 'workbench');
  mkdirSync(workbenchPath, { recursive: true });
  const first = must(await expand(o, { rootId: 'workbench' }));
  writeFileSync(join(workbenchPath, 'draft-for-tree.md'), '# draft\n');
  const level = must(await expand(o, { rootId: 'workbench' }));
  assert.ok(
    level.entries.some((entry) => entry.name === 'draft-for-tree.md'),
    `the new draft is listed (before: ${first.entries.map((e) => e.name).join(', ')})`,
  );
});

test('a path that leaves the root, by its text or through a symbolic link, is refused', async () => {
  const o = await open();
  const dotdot = await expand(o, { rootId: 'lore', path: '../' });
  assert.equal(dotdot.ok, false);
  if (!dotdot.ok) assert.equal(dotdot.error.kind, 'invalid-argument');
  const absolute = await expand(o, { rootId: 'lore', path: '/etc' });
  assert.equal(absolute.ok, false);

  const lorePath = join(space.root, 'lore');
  symlinkSync(outside.dir, join(lorePath, 'link-out'));
  const linked = await expand(o, { rootId: 'lore', path: 'link-out' });
  assert.equal(linked.ok, false);
  if (!linked.ok) assert.equal(linked.error.kind, 'path-refused');

  const missing = await expand(o, { rootId: 'lore', path: 'no-such-folder' });
  assert.equal(missing.ok, false);
  const unknown = await expand(o, { rootId: 'repo:nothing' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.kind, 'unknown-root');
});

test('a NUL, a file given as a folder, and .git reached through a link are refused', async () => {
  const o = await open();
  const nul = await expand(o, { rootId: 'lore', path: 'a\0b' });
  assert.equal(nul.ok, false);
  if (!nul.ok) assert.equal(nul.error.kind, 'invalid-argument');
  const file = await expand(o, { rootId: 'lore', path: 'space.md' });
  assert.equal(file.ok, false);
  if (!file.ok) assert.equal(file.error.message, 'The path is a file, not a folder.');

  const repoPath = join(space.root, 'repos', 'app');
  symlinkSync(join(repoPath, '.git'), join(repoPath, 'git-link'));
  try {
    const through = await expand(o, { rootId: 'repo:app', path: 'git-link' });
    assert.equal(through.ok, false);
    if (!through.ok) assert.equal(through.error.kind, 'path-refused');
    const level = must(await expand(o, { rootId: 'repo:app' }));
    assert.ok(!level.entries.some((e) => e.name === 'git-link'), 'a link into .git is not listed');
  } finally {
    unlinkSync(join(repoPath, 'git-link'));
  }
});

test('a symbolic link that leads out of the root is neither listed nor followed; one inside is listed', async () => {
  const o = await open();
  const workbench = join(space.root, 'workbench');
  mkdirSync(join(workbench, 'inner'), { recursive: true });
  symlinkSync(outside.dir, join(workbench, 'out-link'));
  symlinkSync(join(workbench, 'inner'), join(workbench, 'in-link'));
  try {
    const level = must(await expand(o, { rootId: 'workbench' }));
    assert.ok(!level.entries.some((e) => e.name === 'out-link'));
    assert.ok(level.entries.some((e) => e.name === 'in-link' && e.isDir));
    const out = await expand(o, { rootId: 'workbench', path: 'out-link' });
    assert.equal(out.ok, false);
  } finally {
    unlinkSync(join(workbench, 'out-link'));
    unlinkSync(join(workbench, 'in-link'));
  }
});

test('a folder with 100,000 entries is capped, and the level says so', async () => {
  const o = await open();
  const big = join(space.root, 'workbench', 'big');
  mkdirSync(big, { recursive: true });
  try {
    for (let i = 0; i < 100_000; i++) writeFileSync(join(big, `f${i}`), '');
    const level = must(await expand(o, { rootId: 'workbench', path: 'big' }));
    assert.equal(level.entries.length, ROOT_TREE_MAX_ENTRIES);
    assert.equal(level.limit, ROOT_TREE_MAX_ENTRIES);
    assert.equal(level.total, 100_000);
    assert.equal(level.truncated, true);
  } finally {
    rmSync(big, { recursive: true, force: true });
  }
});

test('a root of another Space is not served to this Space', async () => {
  const other = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'other-space',
    repositories: ['elsewhere'],
  });
  try {
    const o = await open();
    await o.h.space.host.openFolder(undefined, other.root);
    const result = await expand(o, { rootId: 'repo:elsewhere' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'unknown-root');
  } finally {
    other.cleanup();
  }
});

test('Reveal in Finder takes a root id and a relative path, and is refused outside the root', async () => {
  const o = await open();
  const shown: [string, boolean][] = [];
  setRootRevealOpener((abs, isDir) => shown.push([abs, isDir]));
  try {
    const reveal = (arg: unknown) =>
      o.h.invoke('spaceRootReveal', o.filesWindow, arg) as Promise<SpaceRootsResult<null>>;
    must(await reveal({ rootId: 'lore', path: 'space.md' }));
    must(await reveal({ rootId: 'lore', path: '' }));
    assert.deepEqual(shown, [
      [join(space.root, 'lore', 'space.md'), false],
      [join(space.root, 'lore'), true],
    ]);
    for (const path of ['../x', '/etc', '.git', 'link-out']) {
      const refused = await reveal({ rootId: 'lore', path });
      assert.equal(refused.ok, false, path);
    }
    const absolute = await reveal({ rootId: 'lore', path: join(space.root, 'lore', 'space.md') });
    assert.equal(absolute.ok, false);
    assert.equal(shown.length, 2);
    const stranger = await o.h.invoke(
      'spaceRootReveal',
      { webContentsId: 9999 },
      {
        rootId: 'lore',
        path: 'space.md',
      },
    );
    assert.equal((stranger as SpaceRootsResult<null>).ok, false);
  } finally {
    setRootRevealOpener(null);
  }
});

test('closing the Files window, the last of its Space, closes the trackers the tree started', async () => {
  const o = await open();
  must(await expand(o, { rootId: 'lore' }));
  assert.equal(rootsServiceStats().trackers, 1);
  const spaceWindow = o.h.space.created.find((w) => w !== o.filesWindow);
  assert.ok(spaceWindow);
  await o.h.space.host.windowClosed(spaceWindow.id);
  assert.equal(rootsServiceStats().trackers, 1, 'the Files window still holds the Space');
  await o.h.space.host.windowClosed(o.filesWindow.id);
  assert.deepEqual(rootsServiceStats(), { trackers: 0, indexWatchers: 0 });
});

test('a call that does not come from a window of an open Space is refused', async () => {
  const o = await open();
  const result = (await o.h.invoke(
    'spaceRootTreeExpand',
    { webContentsId: 9999 },
    {
      rootId: 'lore',
    },
  )) as SpaceRootsResult<RootTreeLevel>;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'not-a-space-window');
});
