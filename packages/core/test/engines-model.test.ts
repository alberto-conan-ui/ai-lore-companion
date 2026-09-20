import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type EngineEntry, dedupEngines, isEngineEntry, parseEngineEntry } from '../src/index.js';

// M14.1 (`profile-shape-architecture.md` 3.5): `helperModel` becomes `model`,
// and is still written back beside it so an older build keeps working —
// exactly as `args` is kept beside `params`.

test('isEngineEntry accepts a model field and rejects a non-string one', () => {
  const base: EngineEntry = { id: 'c', name: 'Claude', binary: 'claude' };
  assert.equal(isEngineEntry({ ...base, model: 'opus' }), true);
  assert.equal(isEngineEntry({ ...base, model: 7 }), false);
});

test('parseEngineEntry with model set and no helperModel mirrors it onto helperModel', () => {
  const parsed = parseEngineEntry({ id: 'c', name: 'Claude', binary: 'claude', model: 'sonnet' });
  assert.equal(parsed?.model, 'sonnet');
  assert.equal(parsed?.helperModel, 'sonnet');
});

test('parseEngineEntry with helperModel set and no model reads it as model, and keeps helperModel', () => {
  const parsed = parseEngineEntry({
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    helperModel: 'opus',
  });
  assert.equal(parsed?.model, 'opus');
  assert.equal(parsed?.helperModel, 'opus');
});

test('parseEngineEntry with model and helperModel both set: model wins and helperModel is overwritten with it', () => {
  const parsed = parseEngineEntry({
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    model: 'sonnet',
    helperModel: 'opus',
  });
  assert.equal(parsed?.model, 'sonnet');
  assert.equal(parsed?.helperModel, 'sonnet');
});

test('parseEngineEntry with neither model nor helperModel has neither', () => {
  const parsed = parseEngineEntry({ id: 'c', name: 'Claude', binary: 'claude' });
  assert.equal(parsed && 'model' in parsed, false);
  assert.equal(parsed && 'helperModel' in parsed, false);
});

test('engineCatalog.identity (via dedupEngines) tells apart two entries that differ only by model', () => {
  const a: EngineEntry = {
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    model: 'sonnet',
    helperModel: 'sonnet',
  };
  const b: EngineEntry = { ...a, model: 'opus', helperModel: 'opus' };
  const list = dedupEngines([a, b]);
  assert.equal(list.length, 2);
});
