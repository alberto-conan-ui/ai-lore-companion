import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type EngineEntry, parseEngineEntry } from '@ai-lore-companion/core';
import { geminiHelperModel } from '../../src/main/ipc/helper.js';

// M14.5: the read-only helper's model is the profile's model — `EngineEntry.model`,
// read through `profileOf` (`profile-shape-architecture.md` 3.5) — falling back to the
// Gemini helper's own default when the profile names none.
//
// `profileOf` itself reads `entry.model` verbatim; the `model`-from-`helperModel`
// reconciliation for an entry written before M14 happens once, in `parseEngineEntry`,
// at load time (`main/engines.ts`'s `loadEngines`). So a raw stored entry is parsed
// first here, exactly as `loadEngines` parses it, before `geminiHelperModel` sees it.

const base = { id: 'default.gemini', name: 'Gemini', binary: 'gemini' };

function parsed(raw: Record<string, unknown>): EngineEntry {
  const entry = parseEngineEntry({ ...base, ...raw });
  assert.ok(entry, 'the fixture entry must parse');
  return entry;
}

test('an entry with model gives that model', () => {
  const entry = parsed({ model: 'gemini-2.5-pro' });
  assert.equal(geminiHelperModel(entry), 'gemini-2.5-pro');
});

test('an entry with only the pre-M14 helperModel gives that model', () => {
  const entry = parsed({ helperModel: 'gemini-2.5-pro' });
  assert.equal(geminiHelperModel(entry), 'gemini-2.5-pro');
});

test('model wins over helperModel when both are set', () => {
  const entry = parsed({ model: 'gemini-3-flash', helperModel: 'gemini-2.5-pro' });
  assert.equal(geminiHelperModel(entry), 'gemini-3-flash');
});

test('an entry with neither gives the Gemini helper default', () => {
  const entry = parsed({});
  assert.equal(geminiHelperModel(entry), 'gemini-2.5-flash');
});
