import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { deskPaths, spaceKey } from '@ai-lore-companion/core';
import {
  type PlainRepositoryFixture,
  type SpaceFixture,
  type V08Fixture,
  makePlainRepository,
  makeSpaceFixture,
  makeV08Fixture,
} from '@ai-lore-companion/core/testing';
import { defineSpaceService } from '../../../src/main/space/context.js';
import { LORE_TEMPLATE_DIR, type TestSpaceHost, testSpaceHost } from './space-harness.js';

// The Space host: what happens to windows when a folder is opened, with detection routing on
// and off, and the rules of the window actions.

let space: SpaceFixture;
let legacy: V08Fixture;
let plain: PlainRepositoryFixture;
let t: TestSpaceHost;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'host-space' });
  legacy = await makeV08Fixture({ name: 'host-project' });
  plain = await makePlainRepository();
});

after(() => {
  space.cleanup();
  legacy.cleanup();
  plain.cleanup();
});

beforeEach(() => {
  t = testSpaceHost({ spaceRouting: true });
});

afterEach(() => t.cleanup());

test('switch on: a Space opens a new window that is told it is a Space window once its page has loaded', async () => {
  const result = await t.host.openFolder(undefined, space.root);
  assert.deepEqual(result, { ok: true, value: { mode: 'space' } });
  const [window] = t.created;
  assert.ok(window);
  assert.deepEqual(window.inits(), [], 'nothing is sent while the page loads');
  window.finishLoad();
  const [init] = window.inits();
  assert.ok(init?.mode === 'space');
  assert.equal(init.space.root, space.root);
  assert.equal(window.title, 'host-space');
  assert.deepEqual(t.terminals, [{ windowId: window.id, folder: space.root }]);

  const context = t.host.contextFor({ sender: { id: window.webContents.id } });
  assert.ok(context);
  assert.equal(context.key, spaceKey(space.root));
  assert.deepEqual(context.desk, deskPaths(t.userDataDir, space.root));
  assert.notEqual(context.ptyService, null);
  assert.deepEqual(
    t.host.recentSpaces().map((recent) => [recent.path, recent.name]),
    [[space.root, 'host-space']],
  );
});

test('switch on: a v0.8 project opens the migration screen and a plain repository the not-a-Space screen', async () => {
  await t.host.openFolder(undefined, legacy.root);
  await t.host.openFolder(undefined, plain.dir);
  const [migration, notASpace] = t.created;
  assert.ok(migration && notASpace);
  migration.finishLoad();
  notASpace.finishLoad();
  assert.equal(migration.inits()[0]?.mode, 'migration');
  const init = notASpace.inits()[0];
  assert.ok(init?.mode === 'not-a-space');
  assert.equal(init.plainRepository, true);
  // Neither is a Space: no context, no recent Space. Both have a terminal.
  assert.equal(t.host.contextFor({ sender: { id: migration.webContents.id } }), undefined);
  assert.deepEqual(t.host.recentSpaces(), []);
  assert.equal(t.terminals.length, 2);
});

test('switch on: the welcome window is reused for the folder, and reloaded first', async () => {
  t.host.openWelcome();
  const [welcome] = t.created;
  assert.ok(welcome);
  welcome.finishLoad();
  assert.equal(welcome.inits()[0]?.mode, 'space-welcome');

  await t.host.openFolder(welcome, plain.dir);
  assert.equal(t.created.length, 1, 'no second window');
  assert.equal(welcome.reloads, 1);
  welcome.finishLoad();
  assert.equal(welcome.inits().at(-1)?.mode, 'not-a-space');
});

test('switch on: a folder that is already open is brought to the front, not opened twice', async () => {
  await t.host.openFolder(undefined, space.root);
  const again = await t.host.openFolder(undefined, space.root);
  assert.deepEqual(again, { ok: true, value: { mode: 'space' } });
  assert.equal(t.created.length, 1);
  assert.equal(t.created[0]?.focusCount, 1);

  t.cockpitFolders.add(legacy.root);
  const cockpit = await t.host.openFolder(undefined, legacy.root);
  assert.deepEqual(cockpit, { ok: true, value: { mode: 'cockpit' } });
  assert.equal(t.created.length, 1, 'the cockpit window of the folder was shown');
});

test('switch on: a path that is not a folder opens no window and says why', async () => {
  const result = await t.host.openFolder(undefined, `${plain.dir}/missing`);
  assert.ok(!result.ok);
  assert.equal(result.error.kind, 'not-a-folder');
  assert.equal(t.created.length, 0);

  await t.host.launch(`${plain.dir}/missing`);
  const [welcome] = t.created;
  assert.ok(welcome);
  welcome.finishLoad();
  const init = welcome.inits()[0];
  assert.ok(init?.mode === 'space-welcome');
  assert.match(init.notice ?? '', /is not a folder/);
});

test("switch off: every folder is handed to today's routing and no 1.0 window exists", async () => {
  const off = testSpaceHost({ spaceRouting: false });
  try {
    for (const folder of [space.root, legacy.root, plain.dir]) {
      const result = await off.host.openFolder(undefined, folder);
      assert.deepEqual(result, { ok: true, value: { mode: 'cockpit' } });
    }
    assert.deepEqual(
      off.openedV08.map((call) => call.folder),
      [space.root, legacy.root, plain.dir],
    );
    assert.equal(off.created.length, 0);
    assert.deepEqual(off.host.windows.all(), []);
    assert.deepEqual(off.host.recentSpaces(), []);
  } finally {
    off.cleanup();
  }
});

test('Open in the v0.8 cockpit: accepted from the migration screen only, with the folder main recorded', async () => {
  await t.host.openFolder(undefined, plain.dir);
  await t.host.openFolder(undefined, legacy.root);
  const [notASpace, migration] = t.created;
  assert.ok(notASpace && migration);

  const refused = await t.host.openInCockpit(notASpace);
  assert.ok(!refused.ok);
  assert.equal(refused.error.kind, 'not-allowed-here');
  assert.equal(t.openedV08.length === 0, true);

  const opened = await t.host.openInCockpit(migration);
  assert.deepEqual(opened, { ok: true, value: { mode: 'cockpit' } });
  assert.equal(t.openedV08.length, 1);
  assert.equal(t.openedV08[0]?.windowId, migration.id);
  assert.deepEqual(t.detached, [migration.id], 'its terminal was torn down first');
  assert.equal(t.host.owns(migration.id), false, 'the window is no longer a 1.0 window');
  // The page load that was pending tells the window nothing: today's routing tells it.
  migration.finishLoad();
  assert.deepEqual(migration.inits(), []);
});

test('navigate: create a Space about this folder is accepted from a plain repository only, and main fills the folder', async () => {
  await t.host.openFolder(undefined, legacy.root);
  await t.host.openFolder(undefined, plain.dir);
  const [migration, notASpace] = t.created;
  assert.ok(migration && notASpace);

  const refused = await t.host.navigate(migration, { to: 'setup', start: 'about-this-folder' });
  assert.ok(!refused.ok);
  assert.equal(refused.error.kind, 'not-allowed-here');

  const result = await t.host.navigate(notASpace, { to: 'setup', start: 'about-this-folder' });
  assert.deepEqual(result, { ok: true, value: { mode: 'setup' } });
  assert.deepEqual(t.detached, [notASpace.id], 'the folder terminal was torn down');
  notASpace.finishLoad();
  const init = notASpace.inits().at(-1);
  assert.ok(init?.mode === 'setup');
  assert.ok(init.start.kind === 'about-repository');
  assert.equal(init.start.originUrl, null);
  assert.match(init.start.folder, /./);
});

test('navigate: the screens with no folder change at once, and a window of a Space does not change', async () => {
  t.host.openWelcome();
  const [welcome] = t.created;
  assert.ok(welcome);
  welcome.finishLoad();
  await t.host.navigate(welcome, { to: 'machine-check' });
  await t.host.navigate(welcome, { to: 'setup', start: 'new' });
  assert.deepEqual(
    welcome.inits().map((init) => init.mode),
    ['space-welcome', 'machine-check', 'setup'],
  );
  assert.equal(welcome.reloads, 0);

  await t.host.openFolder(undefined, space.root);
  const spaceWindow = t.created[1];
  assert.ok(spaceWindow);
  const refused = await t.host.navigate(spaceWindow, { to: 'space-welcome' });
  assert.ok(!refused.ok);
  assert.equal(refused.error.kind, 'not-allowed-here');
});

test('the Files window shares the context of its Space, and the context ends with the last window', async () => {
  let disposed = 0;
  const counter = defineSpaceService({
    id: 'test-counter',
    create: () => ({ value: 1 }),
    dispose: () => {
      disposed += 1;
    },
  });

  await t.host.openFolder(undefined, space.root);
  const spaceWindow = t.created[0];
  assert.ok(spaceWindow);
  const opened = await t.host.navigate(spaceWindow, {
    to: 'space-files',
    open: { rootId: 'lore', relPath: 'index.md' },
  });
  assert.deepEqual(opened, { ok: true, value: { mode: 'space-files' } });
  const filesWindow = t.created[1];
  assert.ok(filesWindow);
  filesWindow.finishLoad();
  const init = filesWindow.inits()[0];
  assert.ok(init?.mode === 'space-files');
  assert.deepEqual(init.open, { rootId: 'lore', relPath: 'index.md' });
  assert.equal(t.terminals.length, 1, 'the Files window has no terminal');

  const fromSpace = t.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  const fromFiles = t.host.contextFor({ sender: { id: filesWindow.webContents.id } });
  assert.ok(fromSpace);
  assert.equal(fromSpace, fromFiles);
  assert.equal(fromSpace.service(counter), fromSpace.service(counter), 'a service is built once');

  // A second request shows the same Files window on the new file.
  await t.host.navigate(spaceWindow, { to: 'space-files', open: { rootId: 'publish' } });
  assert.equal(t.created.length, 2);
  assert.deepEqual(filesWindow.inits().at(-1), {
    mode: 'space-files',
    space: init.space,
    spaceTitle: init.spaceTitle,
    colorScheme: init.colorScheme,
    open: { rootId: 'publish' },
  });

  // A push for the Space reaches both windows.
  t.host.sendToSpace(space.root, 'space:test', { n: 1 });
  assert.equal(spaceWindow.sent.at(-1)?.channel, 'space:test');
  assert.equal(filesWindow.sent.at(-1)?.channel, 'space:test');

  await t.host.windowClosed(spaceWindow.id);
  assert.equal(disposed, 0, 'the Files window still holds the context');
  assert.equal(fromSpace.ptyService, null, 'the terminals went with the Space window');
  await t.host.windowClosed(filesWindow.id);
  assert.equal(disposed, 1);
  assert.equal(t.host.contextForKey(spaceKey(space.root)), undefined);
});

test('a call from web contents that are not a 1.0 window own gets no window and no context', async () => {
  await t.host.openFolder(undefined, space.root);
  const [window] = t.created;
  assert.ok(window);
  // An embedded browser tab has web contents of its own, with another id.
  assert.equal(t.host.windowFor({ sender: { id: window.webContents.id + 1 } }), undefined);
  assert.equal(t.host.contextFor({ sender: { id: window.webContents.id + 1 } }), undefined);
  // The window id is not the web contents id.
  assert.equal(t.host.windowFor({ sender: { id: window.id } }), undefined);
});

test('reload runs detection again for the window folder', async () => {
  await t.host.openFolder(undefined, plain.dir);
  const [window] = t.created;
  assert.ok(window);
  window.finishLoad();
  await t.host.reload(window);
  assert.equal(window.reloads, 1);
  assert.deepEqual(t.detached, [window.id]);
  window.finishLoad();
  assert.deepEqual(
    window.inits().map((init) => init.mode),
    ['not-a-space', 'not-a-space'],
  );
  assert.equal(t.terminals.length, 2, 'the terminal was attached again');
});

test('launch(null) shows the welcome screen with checkOnLaunch; other ways to it send no flag', async () => {
  await t.host.launch(null);
  const [launched] = t.created;
  assert.ok(launched);
  launched.finishLoad();
  const init = launched.inits()[0];
  assert.ok(init?.mode === 'space-welcome');
  assert.equal(init.checkOnLaunch, true);

  const result = await t.host.navigate(launched, { to: 'space-welcome' });
  assert.deepEqual(result, { ok: true, value: { mode: 'space-welcome' } });
  const again = launched.inits().at(-1);
  assert.ok(again?.mode === 'space-welcome');
  assert.equal(again.checkOnLaunch, undefined);
});

test('navigate to machine-check from a window of a Space opens or reuses a second window, with its section', async () => {
  await t.host.openFolder(undefined, space.root);
  const [spaceWindow] = t.created;
  assert.ok(spaceWindow);

  const opened = await t.host.navigate(spaceWindow, { to: 'machine-check', section: 'engines' });
  assert.deepEqual(opened, { ok: true, value: { mode: 'machine-check' } });
  assert.equal(t.created.length, 2, 'a second window was created for it');
  const machineWindow = t.created[1];
  assert.ok(machineWindow);
  machineWindow.finishLoad();
  assert.deepEqual(machineWindow.inits().at(-1), { mode: 'machine-check', section: 'engines' });

  const again = await t.host.navigate(spaceWindow, { to: 'machine-check', section: 'engines' });
  assert.deepEqual(again, { ok: true, value: { mode: 'machine-check' } });
  assert.equal(t.created.length, 2, 'the existing machine-check window was reused');
  assert.equal(machineWindow.focusCount, 1);
});

test('navigate to setup with start "from-repository", from the welcome window', async () => {
  t.host.openWelcome();
  const [welcome] = t.created;
  assert.ok(welcome);
  welcome.finishLoad();
  const result = await t.host.navigate(welcome, { to: 'setup', start: 'from-repository' });
  assert.deepEqual(result, { ok: true, value: { mode: 'setup' } });
  welcome.finishLoad();
  const init = welcome.inits().at(-1);
  assert.ok(init?.mode === 'setup');
  assert.deepEqual(init.start, { kind: 'from-repository' });
});

test('commandTerminal gives a window with no folder one terminal, torn down when it is given another screen', async () => {
  t.host.openWelcome();
  const [welcome] = t.created;
  assert.ok(welcome);
  welcome.finishLoad();
  await t.host.navigate(welcome, { to: 'machine-check' });

  const first = t.host.commandTerminal(welcome);
  assert.ok(first);
  assert.deepEqual(t.terminals, [{ windowId: welcome.id, folder: homedir() }]);
  const second = t.host.commandTerminal(welcome);
  assert.equal(second, first, 'the same terminal is kept while the screen does not change');
  assert.equal(t.terminals.length, 1, 'attachTerminal was called once');

  await t.host.navigate(welcome, { to: 'space-welcome' });
  assert.deepEqual(t.detached, [welcome.id]);
  const third = t.host.commandTerminal(welcome);
  assert.notEqual(third, first, 'a new terminal is made after the screen changed');
  assert.equal(t.terminals.length, 2);
});
