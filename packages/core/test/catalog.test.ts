import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CatalogModel, dedupEntries, parseEntries } from '../src/catalog/catalog.js';

/** A tiny catalog model for the tests — an entry is `{ id, name }`, identity
 *  is the lowercased name (so two entries with the same name collide). */
type Entry = { id: string; name: string };
const model: CatalogModel<Entry> = {
  parseEntry: (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0) return null;
    if (typeof o.name !== 'string' || o.name.length === 0) return null;
    return { id: o.id, name: o.name };
  },
  identity: (e) => e.name.toLowerCase(),
};

test('parseEntries returns [] for non-array input', () => {
  assert.deepEqual(parseEntries(model, null), []);
  assert.deepEqual(parseEntries(model, { id: 'a', name: 'A' }), []);
  assert.deepEqual(parseEntries(model, 'nope'), []);
});

test('parseEntries drops elements that do not parse', () => {
  const list = parseEntries(model, [
    { id: 'a', name: 'A' },
    { id: '', name: 'bad' },
    'nonsense',
    { id: 'c', name: 'C' },
  ]);
  assert.deepEqual(
    list.map((e) => e.id),
    ['a', 'c'],
  );
});

test('dedupEntries keeps the first occurrence of each identity', () => {
  const out = dedupEntries(model, [
    { id: '1', name: 'Same' },
    { id: '2', name: 'same' },
    { id: '3', name: 'Other' },
  ]);
  assert.deepEqual(
    out.map((e) => e.id),
    ['1', '3'],
  );
});

test('dedupEntries on an empty list is empty', () => {
  assert.deepEqual(dedupEntries(model, []), []);
});
