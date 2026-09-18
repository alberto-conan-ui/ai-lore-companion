import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { type SpaceFixture, makeSpaceFixture, makeTempDir } from '@ai-lore-companion/core/testing';
import { registerSpaceFiles } from '../../../src/main/space/ipc/files.js';
import { ROOT_FILE_MAX_BYTES } from '../../../src/main/space/root-files.js';
import { rootsServiceStats } from '../../../src/main/space/roots-service.js';
import { SPACE_FILES_CONTRACT } from '../../../src/shared/ipc/space/files.contract.js';
import type {
  RootFileEditResult,
  RootFileWritten,
  RootWorkingFile,
} from '../../../src/shared/ipc/space/root-file-edit.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// Phase M5.5: reading and saving a file of a root for the editor of the Files window,
// `spaceRootReadFile` and `spaceRootWriteFile`, through the real Space host on fake
// windows against a Space fixture with one repository.

let space: SpaceFixture;
let outside: { dir: string; cleanup: () => void };
const opened: SpaceHarness[] = [];

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'edit-space',
    repositories: ['app'],
  });
  outside = makeTempDir('ai-lore-edit-outside-');
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

type Opened = { h: SpaceHarness; filesWindow: FakeSpaceWindow };

async function read(o: Opened, arg: unknown): Promise<RootFileEditResult<RootWorkingFile>> {
  return (await o.h.invoke(
    'spaceRootReadFile',
    o.filesWindow,
    arg,
  )) as RootFileEditResult<RootWorkingFile>;
}

async function write(o: Opened, arg: unknown): Promise<RootFileEditResult<RootFileWritten>> {
  return (await o.h.invoke(
    'spaceRootWriteFile',
    o.filesWindow,
    arg,
  )) as RootFileEditResult<RootFileWritten>;
}

function must<T>(result: RootFileEditResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

function kindOf<T>(result: RootFileEditResult<T>): string {
  return result.ok ? 'ok' : result.error.kind;
}

const appFolder = (): string => join(space.root, 'repos', 'app');

test('the channels are in the Files window fragment', () => {
  assert.equal(SPACE_FILES_CONTRACT.spaceRootReadFile.channel, 'space:root-read-file');
  assert.equal(SPACE_FILES_CONTRACT.spaceRootWriteFile.channel, 'space:root-write-file');
});

test('a text file of a repository root is read with its time, and saved byte for byte', async () => {
  const o = await open();
  writeFileSync(join(appFolder(), 'notes.md'), '# Notes\n');
  const file = must(await read(o, { rootId: 'repo:app', path: 'notes.md' }));
  assert.equal(file.kind, 'text');
  if (file.kind !== 'text') return;
  assert.equal(file.text, '# Notes\n');
  const text = '# Notes\n\nA line with é and a trailing space \n';
  const saved = must(
    await write(o, {
      rootId: 'repo:app',
      path: 'notes.md',
      text,
      expectedMtimeMs: file.mtimeMs,
    }),
  );
  assert.equal(saved.path, 'notes.md');
  assert.equal(saved.bytes, Buffer.byteLength(text, 'utf8'));
  assert.equal(readFileSync(join(appFolder(), 'notes.md'), 'utf8'), text);
  assert.equal(saved.mtimeMs, statSync(join(appFolder(), 'notes.md')).mtimeMs);
});

test('a file changed on disk since it was read is not overwritten', async () => {
  const o = await open();
  const path = join(appFolder(), 'race.md');
  writeFileSync(path, 'first\n');
  const file = must(await read(o, { rootId: 'repo:app', path: 'race.md' }));
  assert.equal(file.kind, 'text');
  if (file.kind !== 'text') return;
  writeFileSync(path, 'written by someone else\n');
  const later = new Date(file.mtimeMs + 5_000);
  // Make sure the time differs on a file system with a coarse clock.
  const { utimesSync } = await import('node:fs');
  utimesSync(path, later, later);
  const refused = await write(o, {
    rootId: 'repo:app',
    path: 'race.md',
    text: 'mine\n',
    expectedMtimeMs: file.mtimeMs,
  });
  assert.equal(kindOf(refused), 'changed-on-disk');
  assert.equal(readFileSync(path, 'utf8'), 'written by someone else\n');
});

test('binary, too-large and absent files are said as such', async () => {
  const o = await open();
  writeFileSync(join(appFolder(), 'image.bin'), Buffer.from([1, 0, 2, 3]));
  writeFileSync(join(appFolder(), 'big.txt'), 'x'.repeat(ROOT_FILE_MAX_BYTES + 1));
  assert.deepEqual(must(await read(o, { rootId: 'repo:app', path: 'image.bin' })), {
    kind: 'binary',
    bytes: 4,
  });
  const big = must(await read(o, { rootId: 'repo:app', path: 'big.txt' }));
  assert.equal(big.kind, 'too-large');
  assert.deepEqual(must(await read(o, { rootId: 'repo:app', path: 'no/such.md' })), {
    kind: 'absent',
  });
});

test('a save never creates a file, never writes a folder, and refuses text over the limit', async () => {
  const o = await open();
  const missing = await write(o, { rootId: 'repo:app', path: 'new-file.md', text: 'x' });
  assert.equal(kindOf(missing), 'not-a-file');
  mkdirSync(join(appFolder(), 'a-folder'), { recursive: true });
  const folder = await write(o, { rootId: 'repo:app', path: 'a-folder', text: 'x' });
  assert.equal(kindOf(folder), 'not-a-file');
  writeFileSync(join(appFolder(), 'small.md'), 'small\n');
  // Two-byte characters: fewer characters than the limit, more bytes.
  const tooBig = await write(o, {
    rootId: 'repo:app',
    path: 'small.md',
    text: 'é'.repeat(ROOT_FILE_MAX_BYTES / 2 + 1),
  });
  assert.equal(kindOf(tooBig), 'too-large');
  assert.equal(readFileSync(join(appFolder(), 'small.md'), 'utf8'), 'small\n');
});

test('paths that leave the root or enter .git are refused, by text and through a link', async () => {
  const o = await open();
  symlinkSync(join(outside.dir, 'secret.txt'), join(appFolder(), 'leak.txt'));
  for (const path of ['../outside.txt', '.git/config', '.GIT/HEAD', 'leak.txt']) {
    const readResult = await read(o, { rootId: 'repo:app', path });
    const writeResult = await write(o, { rootId: 'repo:app', path, text: 'x' });
    assert.notEqual(kindOf(readResult), 'ok', `read ${path}`);
    assert.notEqual(kindOf(writeResult), 'ok', `write ${path}`);
  }
  assert.equal(readFileSync(join(outside.dir, 'secret.txt'), 'utf8'), 'outside\n');
  const absolute = await write(o, { rootId: 'repo:app', path: '/etc/hosts', text: 'x' });
  assert.equal(kindOf(absolute), 'invalid-argument');
  const unknown = await read(o, { rootId: 'repo:none', path: 'a.md' });
  assert.equal(kindOf(unknown), 'unknown-root');
});

test('a file of the Workbench, which git does not track, can be read and saved', async () => {
  const o = await open();
  const folder = join(space.root, 'workbench');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'draft.md'), 'draft\n');
  const file = must(await read(o, { rootId: 'workbench', path: 'draft.md' }));
  assert.equal(file.kind, 'text');
  must(await write(o, { rootId: 'workbench', path: 'draft.md', text: 'draft 2\n' }));
  assert.equal(readFileSync(join(folder, 'draft.md'), 'utf8'), 'draft 2\n');
});

test('a save keeps the permission bits, replaces the file whole and leaves no temporary file', async () => {
  const o = await open();
  const path = join(appFolder(), 'run.sh');
  writeFileSync(path, '#!/bin/sh\r\necho a\r\n');
  chmodSync(path, 0o751);
  const inodeBefore = statSync(path).ino;
  const file = must(await read(o, { rootId: 'repo:app', path: 'run.sh' }));
  assert.equal(file.kind, 'text');
  if (file.kind !== 'text') return;
  assert.equal(file.text, '#!/bin/sh\r\necho a\r\n', 'line endings are read as they are');
  must(
    await write(o, {
      rootId: 'repo:app',
      path: 'run.sh',
      text: '#!/bin/sh\r\necho b\r\n',
      expectedMtimeMs: file.mtimeMs,
    }),
  );
  assert.equal(
    readFileSync(path, 'utf8'),
    '#!/bin/sh\r\necho b\r\n',
    'line endings are written as sent',
  );
  assert.equal(statSync(path).mode & 0o7777, 0o751);
  assert.notEqual(statSync(path).ino, inodeBefore, 'the file was replaced by a rename');
  assert.deepEqual(
    readdirSync(appFolder()).filter((name) => name.includes('ai-lore-save')),
    [],
    'no temporary file is left',
  );
});

test('a link inside the root to a file of the root stays a link; its target is saved', async () => {
  const o = await open();
  writeFileSync(join(appFolder(), 'target.md'), 'target\n');
  symlinkSync('target.md', join(appFolder(), 'alias.md'));
  must(await write(o, { rootId: 'repo:app', path: 'alias.md', text: 'via alias\n' }));
  assert.ok(lstatSync(join(appFolder(), 'alias.md')).isSymbolicLink());
  assert.equal(readFileSync(join(appFolder(), 'target.md'), 'utf8'), 'via alias\n');
});

test('a folder linked out of the root, a link into .git, a FIFO and a device are refused', async () => {
  const o = await open();
  symlinkSync(outside.dir, join(appFolder(), 'out-dir'));
  symlinkSync('.git', join(appFolder(), 'git-link'));
  symlinkSync(join(appFolder(), '.git', 'HEAD'), join(appFolder(), 'head-link'));
  execFileSync('mkfifo', [join(appFolder(), 'pipe')]);
  symlinkSync('/dev/null', join(appFolder(), 'null-link'));
  const headBefore = readFileSync(join(appFolder(), '.git', 'HEAD'), 'utf8');
  for (const path of [
    'out-dir/secret.txt',
    'git-link/HEAD',
    'git-link/config',
    'head-link',
    '.Git/config',
    'sub/../../x',
    'pipe',
    'null-link',
  ]) {
    const result = await write(o, { rootId: 'repo:app', path, text: 'x' });
    assert.notEqual(kindOf(result), 'ok', `write ${path}`);
  }
  assert.equal(kindOf(await read(o, { rootId: 'repo:app', path: 'pipe' })), 'not-a-file');
  assert.equal(readFileSync(join(outside.dir, 'secret.txt'), 'utf8'), 'outside\n');
  assert.equal(readFileSync(join(appFolder(), '.git', 'HEAD'), 'utf8'), headBefore);
});

test('a file replaced by a link out of the root after it was read is not written through', async () => {
  const o = await open();
  const path = join(appFolder(), 'swap.md');
  writeFileSync(path, 'mine\n');
  const file = must(await read(o, { rootId: 'repo:app', path: 'swap.md' }));
  assert.equal(file.kind, 'text');
  if (file.kind !== 'text') return;
  rmSync(path);
  symlinkSync(join(outside.dir, 'secret.txt'), path);
  const result = await write(o, {
    rootId: 'repo:app',
    path: 'swap.md',
    text: 'x',
    expectedMtimeMs: file.mtimeMs,
  });
  assert.notEqual(kindOf(result), 'ok');
  assert.equal(readFileSync(join(outside.dir, 'secret.txt'), 'utf8'), 'outside\n');
});

test('a forged root id, a root id of the wrong shape and an absolute path are refused', async () => {
  const o = await open();
  for (const rootId of ['repo:../..', 'repo:app/..', '/tmp', 'lore/..', 'repo:other']) {
    const result = await write(o, { rootId, path: 'notes.md', text: 'x' });
    assert.notEqual(kindOf(result), 'ok', rootId);
  }
  const extra = await write(o, { rootId: 'repo:app', path: 'notes.md', text: 'x', abs: '/tmp/x' });
  assert.equal(kindOf(extra), 'invalid-argument');
});

test('a frame inside the page, a gone frame and a window of no Space may not save', async () => {
  const o = await open();
  writeFileSync(join(appFolder(), 'frame.md'), 'frame\n');
  const id = o.filesWindow.webContents.id;
  for (const sender of [
    { webContentsId: id, frame: 'inside-the-page' as const },
    { webContentsId: id, frame: 'gone' as const },
    { webContentsId: 4242 },
  ]) {
    const result = (await o.h.invoke('spaceRootWriteFile', sender, {
      rootId: 'repo:app',
      path: 'frame.md',
      text: 'x',
    })) as RootFileEditResult<RootFileWritten>;
    assert.equal(kindOf(result), 'not-a-space-window');
  }
  assert.equal(readFileSync(join(appFolder(), 'frame.md'), 'utf8'), 'frame\n');
});

test('only a window of an open Space may call them', async () => {
  const o = await open();
  const result = (await o.h.invoke(
    'spaceRootReadFile',
    { webContentsId: 9999 },
    {
      rootId: 'repo:app',
      path: 'a.md',
    },
  )) as RootFileEditResult<RootWorkingFile>;
  assert.equal(kindOf(result), 'not-a-space-window');
});
