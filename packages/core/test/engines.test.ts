import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type EngineEntry,
  dedupEngines,
  isEngineEntry,
  parseEngineEntries,
  parseEngineEntry,
} from '../src/index.js';

const claude: EngineEntry = {
  id: 'claude',
  name: 'Claude',
  binary: 'claude',
};

const gemini: EngineEntry = {
  id: 'gemini',
  name: 'Gemini',
  binary: 'gemini',
  args: ['--colour'],
};

test('isEngineEntry accepts a minimal entry', () => {
  assert.equal(isEngineEntry(claude), true);
});

test('isEngineEntry accepts an entry with args', () => {
  assert.equal(isEngineEntry(gemini), true);
});

test('isEngineEntry rejects missing or empty required fields', () => {
  assert.equal(isEngineEntry({ ...claude, id: '' }), false);
  assert.equal(isEngineEntry({ ...claude, name: '' }), false);
  assert.equal(isEngineEntry({ ...claude, binary: '' }), false);
  assert.equal(isEngineEntry({ ...claude, id: undefined }), false);
});

test('isEngineEntry rejects non-string-array args', () => {
  assert.equal(isEngineEntry({ ...claude, args: 'flag' }), false);
  assert.equal(isEngineEntry({ ...claude, args: [1, 2] }), false);
});

test('parseEngineEntry drops unknown fields', () => {
  const parsed = parseEngineEntry({ ...claude, extra: 'ignored' });
  assert.equal(parsed?.id, 'claude');
  assert.equal((parsed as unknown as { extra?: string }).extra, undefined);
});

test('parseEngineEntries skips malformed entries silently', () => {
  const list = parseEngineEntries([
    claude,
    null,
    { id: 'broken' }, // missing required fields
    gemini,
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.id, 'claude');
  assert.equal(list[1]?.id, 'gemini');
});

test('dedupEngines collapses identical entries, preserving order', () => {
  const list = dedupEngines([claude, gemini, { ...claude }, gemini]);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.id, 'claude');
  assert.equal(list[1]?.id, 'gemini');
});

test('dedupEngines keeps entries that differ in any identity field', () => {
  const list = dedupEngines([
    claude,
    { ...claude, binary: '/usr/local/bin/claude' },
  ]);
  assert.equal(list.length, 2);
});
