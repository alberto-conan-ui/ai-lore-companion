/**
 * The Lore readiness report (phase M10.5, `m10-architecture.md` 3.6):
 * `loreReadiness`, against a stubbed `SessionReadiness`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeCodeAdapter } from '../../../src/main/space/sessions/engines/claude-code.js';
import { codexAdapter } from '../../../src/main/space/sessions/engines/codex.js';
import { loreReadiness } from '../../../src/main/space/sessions/engines/lore-readiness.js';
import type { SessionReadiness } from '../../../src/main/space/sessions/service.js';

const READY: SessionReadiness = {
  ok: true,
  value: {
    engine: { id: 'default.claude', name: 'Claude Code', binary: 'claude' },
    python: '/usr/bin/python3',
    install: { pluginDir: '/plugin', beforeChecks: [], afterChecks: [] },
    skillCount: 5,
  },
};

function readinessFailure(
  kind:
    | 'not-installed'
    | 'install-record-unreadable'
    | 'install-record-newer'
    | 'plugin-missing'
    | 'check-missing'
    | 'check-altered'
    | 'python3-missing'
    | 'engine-not-installed'
    | 'engine-not-signed-in'
    | 'engine-not-found',
): SessionReadiness {
  return { ok: false, error: { kind, message: `refused: ${kind}` } };
}

test('no adapter gives three no lines and asClaudeCode: false', () => {
  const lore = loreReadiness(null, readinessFailure('engine-not-installed'), null);
  assert.equal(lore.lines.length, 3);
  assert.ok(lore.lines.every((line) => line.state === 'no'));
  assert.deepEqual(
    lore.lines.map((line) => line.aspect),
    ['lore', 'session-tools', 'guard'],
  );
  assert.equal(lore.asClaudeCode, false);
});

test('Claude Code with a ready readiness gives three yes and asClaudeCode: true', () => {
  const lore = loreReadiness(claudeCodeAdapter, READY, READY.value.skillCount);
  assert.ok(lore.lines.every((line) => line.state === 'yes'));
  assert.equal(lore.asClaudeCode, true);
});

test('plugin-missing sets lore to no with its text', () => {
  const lore = loreReadiness(claudeCodeAdapter, readinessFailure('plugin-missing'), null);
  const loreLine = lore.lines.find((line) => line.aspect === 'lore');
  assert.equal(loreLine?.state, 'no');
  assert.equal(loreLine?.text, 'The Lore is not installed for this Space.');
  assert.equal(lore.asClaudeCode, false);
});

test('check-missing and check-altered set guard to no', () => {
  for (const kind of ['check-missing', 'check-altered'] as const) {
    const lore = loreReadiness(claudeCodeAdapter, readinessFailure(kind), null);
    const guard = lore.lines.find((line) => line.aspect === 'guard');
    assert.equal(guard?.state, 'no', kind);
    assert.match(guard?.text ?? '', /not installed as the install recorded them/);
  }
});

test('python3-missing sets guard to no', () => {
  const lore = loreReadiness(claudeCodeAdapter, readinessFailure('python3-missing'), null);
  const guard = lore.lines.find((line) => line.aspect === 'guard');
  assert.equal(guard?.state, 'no');
  assert.match(guard?.text ?? '', /python3 3\.8 or later was not found/);
});

test('skillCount: 0 sets lore to partly', () => {
  const lore = loreReadiness(claudeCodeAdapter, READY, 0);
  const loreLine = lore.lines.find((line) => line.aspect === 'lore');
  assert.equal(loreLine?.state, 'partly');
  assert.equal(loreLine?.text, 'The install holds no verb; install the Lore again.');
  assert.equal(lore.asClaudeCode, false);
});

test('engine-not-installed, engine-not-signed-in and engine-not-found change no line', () => {
  for (const kind of [
    'engine-not-installed',
    'engine-not-signed-in',
    'engine-not-found',
  ] as const) {
    const lore = loreReadiness(claudeCodeAdapter, readinessFailure(kind), null);
    assert.deepEqual(lore.lines, [
      claudeCodeAdapter.capability.lore,
      claudeCodeAdapter.capability.sessionTools,
      claudeCodeAdapter.capability.guard,
    ]);
  }
});

test('standard-file Lore: Claude Code says no write-guard and no Read only, and marks standardLore', () => {
  const standard: SessionReadiness = {
    ok: true,
    value: { ...(READY.ok ? READY.value : ({} as never)), skillCount: 0, standardLore: true },
  };
  const lore = loreReadiness(claudeCodeAdapter, standard, 0);
  assert.equal(lore.standardLore, true);
  assert.equal(lore.asClaudeCode, true);
  assert.match(lore.lines[2]?.text ?? '', /No write-guard and no Read only/);
  assert.match(lore.lines[0]?.text ?? '', /AGENTS\.md/);
});

test('standard-file Lore: an adapter without support keeps its guarded report', () => {
  const standard: SessionReadiness = {
    ok: true,
    value: { ...(READY.ok ? READY.value : ({} as never)), standardLore: true },
  };
  const lore = loreReadiness(codexAdapter, standard, 5);
  assert.equal(lore.standardLore, undefined);
  assert.deepEqual(lore.lines[2], codexAdapter.capability.guard);
});

test('Codex gives asClaudeCode: false, its own static capability', () => {
  const lore = loreReadiness(codexAdapter, READY, READY.value.skillCount);
  assert.equal(lore.asClaudeCode, false);
  assert.equal(lore.lines.find((line) => line.aspect === 'lore')?.state, 'partly');
});
