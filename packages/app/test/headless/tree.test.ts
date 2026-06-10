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

test('readFile returns text for a small text file', () => {
  assert.deepEqual(h.invoke('readFile', { path: join(root, 'alpha.txt') }), {
    kind: 'text',
    text: 'a',
  });
});

test('readFile flags a binary file (a NUL byte in the sniff window)', () => {
  const bin = join(root, 'blob.bin');
  writeFileSync(bin, Buffer.from([0x68, 0x00, 0x69]));
  assert.deepEqual(h.invoke('readFile', { path: bin }), { kind: 'binary' });
});

test('readFile flags a file past the size cap', () => {
  const big = join(root, 'big.txt');
  writeFileSync(big, Buffer.alloc(2_000_001, 0x61));
  const r = h.invoke('readFile', { path: big }) as { kind: string; bytes: number };
  assert.equal(r.kind, 'too-large');
  assert.equal(r.bytes, 2_000_001);
});

test('readFile fails for a missing path and for a directory', () => {
  assert.equal(
    (h.invoke('readFile', { path: join(root, 'nope.txt') }) as { kind: string }).kind,
    'failed',
  );
  assert.equal(
    (h.invoke('readFile', { path: join(root, 'sub') }) as { kind: string }).kind,
    'failed',
  );
});

// `searchFiles` is async — it awaits the search service (a `utilityProcess` in
// production, the in-process index in these tests).
async function search(query: string): Promise<string[]> {
  const hits = (await h.invoke('searchFiles', { query, dirs: [root] })) as { name: string }[];
  return hits.map((x) => x.name);
}

test('searchFiles finds a name match, recursing into subdirs', async () => {
  assert.deepEqual(await search('eta'), ['beta.md']);
});

test('searchFiles is case-insensitive and matches multiple files', async () => {
  assert.deepEqual((await search('A')).sort(), ['alpha.txt', 'beta.md']);
});

test('searchFiles returns [] for an empty query and with no context', async () => {
  assert.deepEqual(await search('   '), []);
  h.setCtx(undefined);
  assert.deepEqual(await search('alpha'), []);
});

test('searchFiles matches a fuzzy subsequence the old substring search would miss', async () => {
  // "bta" is not a substring of "beta.md" but is a subsequence (B-e-T-A). The
  // old substring `includes` matcher returned nothing for this.
  assert.deepEqual(await search('bta'), ['beta.md']);
});

test('searchFiles ranks the more relevant file first (rank-then-slice)', async () => {
  writeFileSync(join(root, 'search.ts'), '');
  writeFileSync(join(root, 'sub', 'my-search-helper.ts'), '');
  const names = await search('search');
  // Both match; the shorter, boundary-anchored "search.ts" outranks the longer
  // "my-search-helper.ts".
  assert.equal(names[0], 'search.ts');
  assert.ok(names.includes('my-search-helper.ts'));
});

test('searchFiles reflects a watcher add without rebuilding the index', async () => {
  // First search builds the index over `root`.
  await search('alpha');
  // Simulate the watcher patching a newly-created file into the live index.
  const added = join(root, 'sub', 'gamma.ts');
  writeFileSync(added, '');
  h.ctx?.search.add(added);
  assert.deepEqual(await search('gamma'), ['gamma.ts']);
});
