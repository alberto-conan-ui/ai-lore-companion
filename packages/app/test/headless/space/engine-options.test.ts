/**
 * The reserved and guard-changing options of each engine (M10.3,
 * `m10-architecture.md` 3.5): `paramEffect` and `optionsFor`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineEntry } from '@ai-lore-companion/core';
import {
  ANTIGRAVITY_OPTIONS,
  CLAUDE_CODE_OPTIONS,
  CODEX_OPTIONS,
  type EngineOptions,
  OPENCODE_OPTIONS,
  optionsFor,
  paramEffect,
} from '../../../src/main/space/sessions/engine-options.js';

const CONSTANTS: readonly [string, EngineOptions][] = [
  ['CLAUDE_CODE_OPTIONS', CLAUDE_CODE_OPTIONS],
  ['ANTIGRAVITY_OPTIONS', ANTIGRAVITY_OPTIONS],
  ['CODEX_OPTIONS', CODEX_OPTIONS],
  ['OPENCODE_OPTIONS', OPENCODE_OPTIONS],
];

test('every reserved option of every constant gives refused, as itself and in the =value form', () => {
  for (const [name, options] of CONSTANTS) {
    for (const option of options.reserved) {
      assert.equal(paramEffect(options, [option]).effect, 'refused', `${name}: ${option}`);
      assert.equal(paramEffect(options, [`${option}=x`]).effect, 'refused', `${name}: ${option}=x`);
    }
  }
});

test('every guard-changing option of every constant gives unguarded, as itself and in the =value form', () => {
  for (const [name, options] of CONSTANTS) {
    for (const option of options.guardChanging) {
      assert.equal(paramEffect(options, [option]).effect, 'unguarded', `${name}: ${option}`);
      assert.equal(
        paramEffect(options, [`${option}=x`]).effect,
        'unguarded',
        `${name}: ${option}=x`,
      );
    }
  }
});

test('an argument list that matches nothing gives none, for every constant', () => {
  for (const [name, options] of CONSTANTS) {
    assert.equal(paramEffect(options, ['--model', 'opus']).effect, 'none', name);
  }
});

test('--dangerously-skip-permissions is unguarded under Claude Code and none under Antigravity', () => {
  assert.equal(
    paramEffect(CLAUDE_CODE_OPTIONS, ['--dangerously-skip-permissions']).effect,
    'unguarded',
  );
  assert.equal(paramEffect(ANTIGRAVITY_OPTIONS, ['--dangerously-skip-permissions']).effect, 'none');
  assert.ok(!ANTIGRAVITY_OPTIONS.guardChanging.includes('--dangerously-skip-permissions'));
});

test('Codex: -c/--config are guard-changing unless the key is model or model_reasoning_effort', () => {
  assert.equal(paramEffect(CODEX_OPTIONS, ['-c', 'model="o3"']).effect, 'none');
  assert.equal(
    paramEffect(CODEX_OPTIONS, ['-c', 'sandbox_mode="danger-full-access"']).effect,
    'unguarded',
  );
  assert.equal(paramEffect(CODEX_OPTIONS, ['--config=hooks.x=1']).effect, 'unguarded');
  // The key rule is Codex's own: under Claude Code's options, `-c` matches nothing.
  assert.equal(paramEffect(CLAUDE_CODE_OPTIONS, ['-c', 'sandbox_mode="x"']).effect, 'none');
});

function engine(id: string, binary: string): EngineEntry {
  return { id, name: id, binary };
}

test('optionsFor looks an engine up by its catalog id, or by isClaudeEngine for a hand-added Claude Code', () => {
  assert.equal(optionsFor(engine('default.antigravity', 'agy')), ANTIGRAVITY_OPTIONS);
  assert.equal(optionsFor(engine('user.claude', 'claude')), CLAUDE_CODE_OPTIONS);
  assert.equal(optionsFor(engine('user.gemini', 'gemini')), null);
});

test('paramEffect(null, …) gives none', () => {
  assert.deepEqual(paramEffect(null, ['--dangerously-skip-permissions']), {
    effect: 'none',
    options: [],
  });
});
