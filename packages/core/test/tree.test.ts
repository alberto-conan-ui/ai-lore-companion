import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isTreeError, readDirectory } from '../src/index.js';

function setupTempTree(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-tree-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('readDirectory returns immediate children sorted dirs-first then alpha', () => {
  const { root, cleanup } = setupTempTree();
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'README.md'), '# hi\n');
    writeFileSync(join(root, 'package.json'), '{}\n');

    const result = readDirectory(root, { ignore: [] });
    assert.ok(!isTreeError(result));
    if (isTreeError(result)) return;

    assert.equal(result.isDir, true);
    assert.equal(result.path, root);
    assert.ok(result.children);

    const names = (result.children ?? []).map((c) => c.name);
    assert.deepEqual(names, ['src', 'test', 'package.json', 'README.md']);

    const dirChild = (result.children ?? []).find((c) => c.name === 'src');
    assert.ok(dirChild);
    assert.equal(dirChild?.isDir, true);
    assert.equal(dirChild?.children, undefined);

    const fileChild = (result.children ?? []).find((c) => c.name === 'README.md');
    assert.ok(fileChild);
    assert.equal(fileChild?.isDir, false);
    assert.equal(fileChild?.children, undefined);

    // Children carry stat metadata: '# hi\n' is 5 bytes.
    assert.equal(fileChild?.size, 5);
    assert.equal(typeof fileChild?.mtimeMs, 'number');
    assert.equal(typeof dirChild?.size, 'number');
    assert.equal(typeof result.mtimeMs, 'number');
  } finally {
    cleanup();
  }
});

test('readDirectory honors the ignore list against child basenames', () => {
  const { root, cleanup } = setupTempTree();
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'package.json'), '{}\n');

    const result = readDirectory(root, {
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });
    assert.ok(!isTreeError(result));
    if (isTreeError(result)) return;

    const names = (result.children ?? []).map((c) => c.name);
    assert.deepEqual(names, ['src', 'package.json']);
  } finally {
    cleanup();
  }
});

test('readDirectory returns an error for a missing root', () => {
  const result = readDirectory('/this/path/does/not/exist/anywhere', { ignore: [] });
  assert.ok(isTreeError(result));
  if (isTreeError(result)) {
    assert.match(result.error, /cannot read directory|not a directory/);
  }
});

test('readDirectory returns an error when the path is a file, not a directory', () => {
  const { root, cleanup } = setupTempTree();
  try {
    const filePath = join(root, 'a-file.txt');
    writeFileSync(filePath, 'hi');
    const result = readDirectory(filePath, { ignore: [] });
    assert.ok(isTreeError(result));
    if (isTreeError(result)) {
      assert.match(result.error, /not a directory/);
    }
  } finally {
    cleanup();
  }
});

test('readDirectory omits children whose stat fails (broken symlink) without throwing', () => {
  const { root, cleanup } = setupTempTree();
  try {
    writeFileSync(join(root, 'good.txt'), 'ok');
    symlinkSync('/nowhere/does/not/exist', join(root, 'broken-link'));

    const result = readDirectory(root, { ignore: [] });
    assert.ok(!isTreeError(result));
    if (isTreeError(result)) return;

    const names = (result.children ?? []).map((c) => c.name);
    assert.ok(names.includes('good.txt'));
    assert.equal(names.includes('broken-link'), false);
  } finally {
    cleanup();
  }
});
