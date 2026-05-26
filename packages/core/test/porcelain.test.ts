import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isAdded, isDeleted, isRenamed, parsePorcelainZ } from '../src/index.js';

test('parsePorcelainZ handles an empty input', () => {
  assert.deepEqual(parsePorcelainZ(''), []);
});

test('parsePorcelainZ parses a single modified entry', () => {
  const out = parsePorcelainZ(' M src/foo.ts\0');
  assert.deepEqual(out, [{ code: ' M', path: 'src/foo.ts' }]);
});

test('parsePorcelainZ parses an untracked entry', () => {
  const out = parsePorcelainZ('?? notes/draft.md\0');
  assert.deepEqual(out, [{ code: '??', path: 'notes/draft.md' }]);
});

test('parsePorcelainZ parses multiple entries separated by NULs', () => {
  const out = parsePorcelainZ(' M a.ts\0?? b.ts\0 D c.ts\0');
  assert.equal(out.length, 3);
  assert.equal(out[0]?.path, 'a.ts');
  assert.equal(out[1]?.path, 'b.ts');
  assert.equal(out[2]?.path, 'c.ts');
});

test('parsePorcelainZ parses a rename with the source path in the next field', () => {
  // `git status -z` for a rename emits: `R  new\0old\0`
  const out = parsePorcelainZ('R  src/new.ts\0src/old.ts\0');
  assert.equal(out.length, 1);
  assert.equal(out[0]?.code, 'R ');
  assert.equal(out[0]?.path, 'src/new.ts');
  assert.equal(out[0]?.oldPath, 'src/old.ts');
});

test('parsePorcelainZ tolerates paths with embedded spaces', () => {
  const out = parsePorcelainZ(' M src/has space.ts\0');
  assert.deepEqual(out, [{ code: ' M', path: 'src/has space.ts' }]);
});

test('parsePorcelainZ skips entries shorter than the minimum porcelain length', () => {
  const out = parsePorcelainZ('A\0 M ok.ts\0');
  assert.equal(out.length, 1);
  assert.equal(out[0]?.path, 'ok.ts');
});

test('isAdded recognises both added and untracked codes', () => {
  assert.equal(isAdded('A '), true);
  assert.equal(isAdded('??'), true);
  assert.equal(isAdded(' M'), false);
  assert.equal(isAdded('R '), false);
});

test('isDeleted recognises both index and working-tree deletes', () => {
  assert.equal(isDeleted('D '), true);
  assert.equal(isDeleted(' D'), true);
  assert.equal(isDeleted(' M'), false);
});

test('isRenamed recognises renames and copies', () => {
  assert.equal(isRenamed('R '), true);
  assert.equal(isRenamed('C '), true);
  assert.equal(isRenamed(' M'), false);
});
