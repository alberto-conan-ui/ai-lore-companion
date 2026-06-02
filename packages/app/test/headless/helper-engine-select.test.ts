import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineEntry } from '@ai-lore-companion/core';
import { isHelperCapable, pickHelperEngine } from '../../src/main/helper/engine.js';

const claude: EngineEntry = { id: 'c1', name: 'Claude', binary: 'claude' };
const gemini: EngineEntry = { id: 'default.gemini', name: 'Gemini', binary: 'gemini' };
const cursor: EngineEntry = { id: 'x1', name: 'Cursor', binary: 'cursor' };
const geminiAbs: EngineEntry = { id: 'g2', name: 'Gemini', binary: '/opt/homebrew/bin/gemini' };

test('only claude/gemini are helper-capable', () => {
  assert.equal(isHelperCapable(claude), true);
  assert.equal(isHelperCapable(gemini), true);
  assert.equal(isHelperCapable(geminiAbs), true); // absolute path classifies on basename
  assert.equal(isHelperCapable(cursor), false);
});

// The CR7 bug: engines.json had Gemini first + Claude's default removed, the
// dropdown defaulted to Gemini (capable[0]) but nothing was persisted, and the
// resolver hardcoded a Claude fallback → "showed Gemini, launched Claude". The
// default must be the first helper-capable engine, matching the dropdown.
test('no pick defaults to the first helper-capable engine — Gemini when it is first', () => {
  const r = pickHelperEngine([gemini, claude], null);
  assert.deepEqual(r, { kind: 'gemini', entry: gemini });
});

test('no pick defaults to Claude when Claude is first', () => {
  const r = pickHelperEngine([claude, gemini], null);
  assert.deepEqual(r, { kind: 'claude' });
});

test('an explicit Gemini pick routes to Gemini', () => {
  const r = pickHelperEngine([gemini, claude], 'default.gemini');
  assert.deepEqual(r, { kind: 'gemini', entry: gemini });
});

test('an explicit Claude pick routes to Claude', () => {
  const r = pickHelperEngine([gemini, claude], 'c1');
  assert.deepEqual(r, { kind: 'claude' });
});

test('an unknown picked id falls back to the default (first capable)', () => {
  const r = pickHelperEngine([gemini, claude], 'stale-id');
  assert.deepEqual(r, { kind: 'gemini', entry: gemini });
});

test('non-helper-capable engines are skipped when choosing the default', () => {
  const r = pickHelperEngine([cursor, claude, gemini], null);
  assert.deepEqual(r, { kind: 'claude' }); // cursor skipped, claude is first capable
});

test('no helper-capable engines at all → Claude (the safe fallback)', () => {
  const r = pickHelperEngine([cursor], null);
  assert.deepEqual(r, { kind: 'claude' });
});
