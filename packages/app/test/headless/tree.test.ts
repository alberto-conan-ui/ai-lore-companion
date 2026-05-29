import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { registerTree } from '../../src/main/ipc/tree.js';
import { resetElectronStub, shell } from './electron-stub.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

let h: Harness;
let root: string;

beforeEach(() => {
  resetElectronStub();
  h = harnessFor(registerTree);
  root = mkdtempSync(join(tmpdir(), 'cockpit-tree-'));
  // alpha.txt, sub/beta.md — enough to exercise expand + recursive search.
  writeFileSync(join(root, 'alpha.txt'), 'a');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'beta.md'), 'b');
  h.setCtx(fakeContext({ root, lorePath: join(root, '.ai-lore-proj') }));
});

afterEach(() => {
  h.cleanup();
  rmSync(root, { recursive: true, force: true });
});

test('openPath delegates to shell.openPath', () => {
  h.invoke('openPath', '/some/file');
  assert.deepEqual(shell.openPath.calls, [['/some/file']]);
});

test('revealInFinder shows a file in its folder but opens a directory', () => {
  h.invoke('revealInFinder', join(root, 'alpha.txt'));
  assert.deepEqual(shell.showItemInFolder.calls, [[join(root, 'alpha.txt')]]);
  assert.equal(shell.openPath.calls.length, 0);

  h.invoke('revealInFinder', join(root, 'sub'));
  assert.deepEqual(shell.openPath.calls, [[join(root, 'sub')]], 'a directory opens, not reveals');
});

test('treeExpand returns the directory children', () => {
  const children = h.invoke('treeExpand', { path: root, scope: 'payload' }) as { name: string }[];
  const names = children.map((c) => c.name).sort();
  assert.deepEqual(names, ['alpha.txt', 'sub']);
});

test('treeExpand returns [] with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('treeExpand', { path: root, scope: 'payload' }), []);
});

test('searchFiles finds a name substring match, recursing into subdirs', () => {
  const hits = h.invoke('searchFiles', { query: 'eta', dirs: [root] }) as { name: string }[];
  assert.deepEqual(
    hits.map((x) => x.name),
    ['beta.md'],
  );
});

test('searchFiles is case-insensitive and matches multiple files', () => {
  const hits = h.invoke('searchFiles', { query: 'A', dirs: [root] }) as { name: string }[];
  assert.deepEqual(hits.map((x) => x.name).sort(), ['alpha.txt', 'beta.md']);
});

test('searchFiles returns [] for an empty query and with no context', () => {
  assert.deepEqual(h.invoke('searchFiles', { query: '   ', dirs: [root] }), []);
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('searchFiles', { query: 'alpha', dirs: [root] }), []);
});
