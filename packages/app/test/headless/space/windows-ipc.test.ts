import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  type PlainRepositoryFixture,
  type SpaceFixture,
  type V08Fixture,
  makePlainRepository,
  makeSpaceFixture,
  makeV08Fixture,
} from '@ai-lore-companion/core/testing';
import { registerSpaceWindows } from '../../../src/main/space/ipc/windows.js';
import type { RecentSpace, SpaceWindowResult } from '../../../src/shared/ipc.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The window channels, driven through the register module: each accepts a call only from a
// 1.0 window, validates its argument, and opens no path on the renderer's word.

let space: SpaceFixture;
let legacy: V08Fixture;
let plain: PlainRepositoryFixture;
let h: SpaceHarness;
let welcome: FakeSpaceWindow;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'ipc-space' });
  legacy = await makeV08Fixture({ name: 'ipc-project' });
  plain = await makePlainRepository();
});

after(() => {
  space.cleanup();
  legacy.cleanup();
  plain.cleanup();
});

beforeEach(() => {
  h = spaceHarnessFor(registerSpaceWindows);
  h.space.host.openWelcome();
  const created = h.space.created[0];
  assert.ok(created);
  welcome = created;
  welcome.finishLoad();
});

afterEach(() => h.cleanup());

const call = (key: string, sender: Parameters<SpaceHarness['invoke']>[1], arg: unknown) =>
  h.invoke(key, sender, arg) as Promise<SpaceWindowResult>;

test('spaceOpenFolder with no folder opens what the Human Lead picks in the dialog', async () => {
  h.space.setPickedFolder(plain.dir);
  const result = await call('spaceOpenFolder', welcome, {});
  assert.deepEqual(result, { ok: true, value: { mode: 'not-a-space' } });
  welcome.finishLoad();
  assert.equal(welcome.inits().at(-1)?.mode, 'not-a-space');
});

test('spaceOpenFolder with a cancelled dialog is not an error of the screen', async () => {
  h.space.setPickedFolder(null);
  const result = await call('spaceOpenFolder', welcome, {});
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'cancelled');
});

test('spaceOpenFolder refuses a path that is not in the recents of Spaces', async () => {
  const result = await call('spaceOpenFolder', welcome, { folder: legacy.root });
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'not-allowed-here');
  assert.equal(h.space.created.length, 1, 'no window was opened');
  assert.equal(welcome.reloads, 0);
});

test('spaceOpenFolder opens a path that is in the recents of Spaces', async () => {
  // Opening the Space once puts it in the recents; then close its window.
  await h.space.host.openFolder(undefined, space.root);
  const first = h.space.created[1];
  assert.ok(first);
  await h.space.host.windowClosed(first.id);
  first.destroy();

  const result = await call('spaceOpenFolder', welcome, { folder: space.root });
  assert.deepEqual(result, { ok: true, value: { mode: 'space' } });
});

test('every channel refuses an argument that is not of its form, and names no value', async () => {
  const bad: [string, unknown][] = [
    ['spaceOpenFolder', { folder: 'relative/path' }],
    ['spaceOpenFolder', { folder: '/tmp/x', extra: true }],
    ['spaceOpenFolder', 'a string'],
    ['spaceOpenFolder', undefined],
    ['spaceNavigate', { to: 'cockpit' }],
    ['spaceNavigate', { to: 'setup', start: { kind: 'about-repository', folder: '/etc' } }],
    ['spaceNavigate', { to: 'space-files', open: { rootId: '../lore' } }],
    ['spaceNavigate', { to: 'space-files', open: { rootId: 'lore', relPath: '../../etc/passwd' } }],
    ['spaceNavigate', { to: 'space-files', open: { rootId: 'lore', relPath: '/etc/passwd' } }],
    ['spaceNavigate', { to: 'space-files', open: { rootId: 'repo:..' } }],
    ['spaceNavigate', { to: 'space-files', open: { rootId: 'app' } }],
    ['spaceOpenInCockpit', { folder: '/etc' }],
    ['spaceOpenInCockpit', undefined],
  ];
  for (const [key, arg] of bad) {
    const result = await call(key, welcome, arg);
    assert.ok(!result.ok, `${key} ${JSON.stringify(arg)}`);
    assert.equal(result.error.kind, 'invalid-argument', `${key} ${JSON.stringify(arg)}`);
    assert.doesNotMatch(result.error.message, /etc|passwd|relative/);
  }
  // Every kind of root id is of the form: a repository's and a publish area's pass validation.
  for (const rootId of ['lore', 'workbench', 'repo:app', 'publish:site']) {
    const result = await call('spaceNavigate', welcome, {
      to: 'space-files',
      open: { rootId, relPath: 'a.md' },
    });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'not-allowed-here', rootId);
  }
  assert.equal(h.space.created.length, 1);
  assert.deepEqual(h.space.openedV08, []);
});

test('every channel refuses a call that does not come from a 1.0 window', async () => {
  const stranger = { webContentsId: 424242 };
  for (const [key, arg] of [
    ['spaceOpenFolder', {}],
    ['spaceNavigate', { to: 'machine-check' }],
    ['spaceOpenInCockpit', {}],
  ] as const) {
    const result = await call(key, stranger, arg);
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'not-a-space-window');
  }
  assert.equal(h.space.created.length, 1);
});

test('spaceNavigate moves the welcome window to the machine check', async () => {
  const result = await call('spaceNavigate', welcome, { to: 'machine-check' });
  assert.deepEqual(result, { ok: true, value: { mode: 'machine-check' } });
  assert.equal(welcome.inits().at(-1)?.mode, 'machine-check');
});

test('spaceOpenInCockpit works from the migration screen and takes no path', async () => {
  await h.space.host.openFolder(welcome, legacy.root);
  welcome.finishLoad();
  assert.equal(welcome.inits().at(-1)?.mode, 'migration');
  const result = await call('spaceOpenInCockpit', welcome, {});
  assert.deepEqual(result, { ok: true, value: { mode: 'cockpit' } });
  assert.equal(h.space.openedV08.length, 1);
  assert.equal(h.space.openedV08[0]?.windowId, welcome.id);
});

test('spaceRecentsRemove drops one Space and returns the list', async () => {
  await h.space.host.openFolder(undefined, space.root);
  assert.equal(h.space.host.recentSpaces().length, 1);
  const unchanged = (await h.invoke('spaceRecentsRemove', welcome, {
    path: 'not-absolute',
  })) as RecentSpace[];
  assert.equal(unchanged.length, 1);
  const next = (await h.invoke('spaceRecentsRemove', welcome, {
    path: space.root,
  })) as RecentSpace[];
  assert.deepEqual(next, []);
  assert.deepEqual(h.space.host.recentSpaces(), []);
});
