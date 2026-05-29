import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { PathIndex } from '../src/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cockpit-path-index-'));
  writeFileSync(join(root, 'alpha.ts'), '');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'beta.md'), '');
  writeFileSync(join(root, 'sub', 'Component.tsx'), '');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('build indexes files recursively, directories excluded', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  assert.equal(idx.ready, true);
  assert.equal(idx.size, 3); // alpha.ts, beta.md, Component.tsx — not `sub`
});

test('build honours the ignore list', () => {
  const idx = new PathIndex();
  idx.build([root], ['**/sub/**']);
  assert.equal(idx.size, 1); // only alpha.ts
});

test('search ranks fuzzy matches and respects the limit', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  const hits = idx.search('beta', 10);
  assert.equal(hits[0]?.name, 'beta.md');

  const capped = idx.search('a', 1); // matches alpha + (others?) — capped to 1
  assert.equal(capped.length, 1);
});

test('search returns nothing for an empty query', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  assert.deepEqual(idx.search('   ', 10), []);
});

test('add and remove patch the index without a rebuild', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  assert.equal(idx.size, 3);

  const added = join(root, 'sub', 'gamma.ts');
  idx.add(added);
  assert.equal(idx.size, 4);
  assert.equal(idx.search('gamma', 10)[0]?.name, 'gamma.ts');

  idx.remove(added);
  assert.equal(idx.size, 3);
  assert.deepEqual(idx.search('gamma', 10), []);
});

test('add ignores paths outside the indexed roots', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  idx.add('/somewhere/else/stray.ts');
  assert.equal(idx.size, 3);
});

test('coversExactly is order-insensitive and set-exact', () => {
  const idx = new PathIndex();
  idx.build([root, '/other'], []);
  assert.equal(idx.coversExactly(['/other', root]), true);
  assert.equal(idx.coversExactly([root]), false);
  assert.equal(idx.coversExactly([root, '/other', '/third']), false);
});

test('clear resets to an unbuilt, empty state', () => {
  const idx = new PathIndex();
  idx.build([root], []);
  idx.clear();
  assert.equal(idx.ready, false);
  assert.equal(idx.size, 0);
});
