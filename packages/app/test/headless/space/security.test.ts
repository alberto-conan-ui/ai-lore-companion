import assert from 'node:assert/strict';
import { existsSync, readdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  type SpaceFixture,
  type V08Fixture,
  makeSpaceFixture,
  makeV08Fixture,
} from '@ai-lore-companion/core/testing';
import type { RegisterModule } from '../../../src/main/ipc/types.js';
import { SPACE_MODULES } from '../../../src/main/space/ipc/index.js';
import { CONTRACT, type SpaceWindowResult } from '../../../src/shared/ipc.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  fakeSpaceWindow,
  spaceHarnessFor,
} from './space-harness.js';

// Attempts to make main open a folder the Human Lead did not choose, or to use a 1.0 channel
// from somewhere that is not a 1.0 window (architecture document, section 5.14). Every module
// of `SPACE_MODULES` is registered, so the last two tests also hold for the channels that
// later phases add.

const everyModule: RegisterModule = (reg, deps) => {
  for (const register of SPACE_MODULES) register(reg, deps);
};

/** Every renderer-to-main method of 1.0 that is in the contract today. */
const SPACE_REQUESTS = Object.entries(CONTRACT)
  .filter(([method, desc]) => /^space[A-Z]/.test(method) && desc.kind !== 'push')
  .map(([method]) => method);

let space: SpaceFixture;
let victim: SpaceFixture;
let legacy: V08Fixture;
let h: SpaceHarness;
let welcome: FakeSpaceWindow;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'security-space' });
  victim = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'security-victim' });
  legacy = await makeV08Fixture({ name: 'security-project' });
});

after(() => {
  space.cleanup();
  victim.cleanup();
  legacy.cleanup();
});

beforeEach(() => {
  h = spaceHarnessFor(everyModule);
  h.space.host.openWelcome();
  const created = h.space.created[0];
  assert.ok(created);
  welcome = created;
  welcome.finishLoad();
});

afterEach(() => h.cleanup());

const call = (key: string, sender: Parameters<SpaceHarness['invoke']>[1], arg: unknown) =>
  h.invoke(key, sender, arg) as Promise<SpaceWindowResult>;

/** Open a Space once, which puts it in the recents, and close its window. */
async function makeRecent(root: string): Promise<void> {
  await h.space.host.openFolder(undefined, root);
  const opened = h.space.created.at(-1);
  assert.ok(opened);
  await h.space.host.windowClosed(opened.id);
  opened.destroy();
}

test('a path with .. segments that leads out of a recent Space is not a recent', async () => {
  await makeRecent(space.root);
  const before = h.space.created.length;
  for (const folder of [
    `${space.root}/../${basename(legacy.root)}`,
    `${space.root}/../../../../../../etc`,
    `${space.root}/lore/..//../${basename(legacy.root)}`,
    `${space.root}\0/../x`,
  ]) {
    const result = await call('spaceOpenFolder', welcome, { folder });
    assert.ok(!result.ok, folder);
    assert.match(result.error.kind, /^(not-allowed-here|invalid-argument)$/, folder);
  }
  assert.equal(h.space.created.length, before, 'no window was opened');
  assert.equal(welcome.reloads, 0, 'the welcome window was not given a folder');
  assert.deepEqual(h.space.terminals.length, 1, 'no terminal beside the one of makeRecent');
});

test('a recent Space whose folder was replaced by a symbolic link to another folder is not opened', async () => {
  await makeRecent(victim.root);
  const moved = join(dirname(victim.root), `${basename(victim.root)}-moved`);
  renameSync(victim.root, moved);
  symlinkSync(legacy.root, victim.root, 'dir');
  try {
    const terminals = h.space.terminals.length;
    const result = await call('spaceOpenFolder', welcome, { folder: victim.root });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'not-allowed-here');
    assert.match(result.error.message, /no longer the folder that was opened/);
    assert.equal(
      h.space.terminals.length,
      terminals,
      'no terminal was started in the other folder',
    );
    assert.equal(welcome.reloads, 0);

    // Naming the place the link points to does not open it either: it is not a recent.
    const direct = await call('spaceOpenFolder', welcome, { folder: legacy.root });
    assert.ok(!direct.ok);
  } finally {
    unlinkSync(victim.root);
    renameSync(moved, victim.root);
  }
});

test('a symbolic link that leads to a recent Space opens the recent Space, by its recorded path', async () => {
  await makeRecent(space.root);
  const link = join(h.space.userDataDir, 'link-to-space');
  symlinkSync(space.root, link, 'dir');
  const result = await call('spaceOpenFolder', welcome, { folder: link });
  assert.deepEqual(result, { ok: true, value: { mode: 'space' } });
  assert.equal(h.space.terminals.at(-1)?.folder, space.root);
});

test('a call from a frame inside the page of a 1.0 window is refused', async () => {
  for (const frame of ['inside-the-page', 'gone'] as const) {
    const sender = { webContentsId: welcome.webContents.id, frame };
    for (const [key, arg] of [
      ['spaceOpenFolder', {}],
      ['spaceNavigate', { to: 'machine-check' }],
      ['spaceOpenInCockpit', {}],
    ] as const) {
      const result = await call(key, sender, arg);
      assert.ok(!result.ok, `${key} from a frame that is ${frame}`);
      assert.equal(result.error.kind, 'not-a-space-window');
    }
  }
  assert.equal(welcome.inits().at(-1)?.mode, 'space-welcome', 'the window did not change');
});

test('a window that became a v0.8 cockpit window can no longer use a 1.0 channel', async () => {
  await h.space.host.openFolder(welcome, legacy.root);
  welcome.finishLoad();
  const opened = await call('spaceOpenInCockpit', welcome, {});
  assert.deepEqual(opened, { ok: true, value: { mode: 'cockpit' } });
  assert.equal(h.space.host.owns(welcome.id), false);
  for (const key of SPACE_REQUESTS) {
    const result = (await h.invoke(key, welcome, {})) as unknown;
    assert.notEqual((result as { ok?: boolean } | null)?.ok, true, key);
  }
  assert.equal(h.space.openedV08.length, 1, 'the folder was handed over once');
});

test('switch off: no window is a 1.0 window, so every 1.0 channel refuses and nothing is written', async () => {
  const off = spaceHarnessFor(everyModule, { spaceRouting: false });
  try {
    const v08Window = fakeSpaceWindow();
    await off.space.host.openFolder(v08Window, space.root);
    assert.equal(off.space.host.owns(v08Window.id), false);
    assert.deepEqual(off.space.created, []);
    for (const key of SPACE_REQUESTS) {
      for (const arg of [{}, { folder: space.root }, { path: space.root }, { to: 'setup' }]) {
        const result = (await off.invoke(key, v08Window, arg)) as unknown;
        if (Array.isArray(result)) assert.deepEqual(result, [], key);
        else assert.equal((result as { ok?: boolean } | null)?.ok, false, key);
      }
    }
    assert.deepEqual(readdirSync(off.space.userDataDir), [], 'nothing was written to userData');
    assert.equal(existsSync(join(off.space.userDataDir, 'logs')), false);
  } finally {
    off.cleanup();
  }
});
