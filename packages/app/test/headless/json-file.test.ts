import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  readJsonFile,
  readTextFile,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from '../../src/main/json-file.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cockpit-json-file-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('writeJsonFileAtomic round-trips through readJsonFile, creating parent dirs', () => {
  const path = join(dir, 'nested', 'deeper', 'store.json');
  writeJsonFileAtomic(path, { a: 1, b: ['x'] });
  assert.deepEqual(readJsonFile(path), { a: 1, b: ['x'] });
});

test('readJsonFile returns undefined for a missing or corrupt file', () => {
  assert.equal(readJsonFile(join(dir, 'absent.json')), undefined);
  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, '{ not json');
  assert.equal(readJsonFile(corrupt), undefined);
});

test('writeTextFileAtomic writes the text verbatim and leaves no staging files', () => {
  const path = join(dir, 'settings.json');
  writeTextFileAtomic(path, '{\n  "k": "v"\n}\n');
  assert.equal(readFileSync(path, 'utf8'), '{\n  "k": "v"\n}\n');
  // The atomic write stages a tmp sibling and renames it over the target —
  // after the write only the target may remain.
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});

test('pretty writes match the stores` human-readable 2-space format', () => {
  const path = join(dir, 'pretty.json');
  writeJsonFileAtomic(path, { k: 'v' }, { pretty: true });
  assert.equal(readFileSync(path, 'utf8'), '{\n  "k": "v"\n}');
});

test('readTextFile returns undefined for a missing file', () => {
  assert.equal(readTextFile(join(dir, 'absent.txt')), undefined);
});
