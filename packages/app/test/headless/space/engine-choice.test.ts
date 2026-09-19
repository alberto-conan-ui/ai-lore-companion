/**
 * The engine of a Space session, chosen by readiness (phase M9.7, A.9):
 * `engineChoice` and `fixFor`, against a readiness stub. Finding 8 — a new
 * Space picked Gemini (first in the stored list) and could not start a
 * session — is the regression this phase closes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineEntry } from '@ai-lore-companion/core';
import { engineChoice, fixFor } from '../../../src/main/space/sessions/engine-choice.js';
import type { SessionStartFailure } from '../../../src/main/space/sessions/preflight.js';
import type { SessionReadiness } from '../../../src/main/space/sessions/service.js';

const CLAUDE: EngineEntry = { id: 'default.claude', name: 'Claude Code', binary: 'claude' };
const CODEX: EngineEntry = { id: 'default.codex', name: 'Codex CLI', binary: 'codex' };
const GEMINI: EngineEntry = { id: 'default.gemini', name: 'Gemini', binary: 'gemini' };
const OTHER_CLAUDE: EngineEntry = { id: 'other.claude', name: 'My Claude', binary: 'claude' };

const OK: SessionReadiness = {
  ok: true,
  value: {
    engine: CLAUDE,
    python: '/usr/bin/python3',
    install: { pluginDir: '', beforeChecks: [], afterChecks: [] },
    skillCount: 3,
  },
};

function refused(kind: SessionStartFailure['kind'], message = 'refused'): SessionReadiness {
  return { ok: false, error: { kind, message } };
}

/** A readiness stub that answers `answers[engineId]`, defaulting to `OK`. */
function readinessOf(answers: Record<string, SessionReadiness>) {
  return async (engineId: string): Promise<SessionReadiness> => answers[engineId] ?? OK;
}

test('finding 8: Gemini first in the list does not stop Claude Code from being chosen', async () => {
  const choice = await engineChoice([GEMINI, CLAUDE], readinessOf({}), null);
  assert.equal(choice.engineId, 'default.claude');
  const gemini = choice.options.find((o) => o.engineId === 'default.gemini');
  assert.equal(gemini?.canStart, false);
  assert.equal(gemini?.reason, 'guarded Space sessions are not available for this engine yet');
  assert.equal(gemini?.fix, null);
  const claude = choice.options.find((o) => o.engineId === 'default.claude');
  assert.equal(claude?.canStart, true);
  assert.equal(claude?.reason, null);
});

test("M10.3: an option's params carry the effect of each parameter", async () => {
  const claudeWithParams: EngineEntry = {
    ...CLAUDE,
    params: [
      { text: '--model opus', defaultOn: true },
      { text: '--dangerously-skip-permissions', defaultOn: false },
      { text: '--settings /tmp/x.json', defaultOn: false },
    ],
  };
  const choice = await engineChoice([claudeWithParams], readinessOf({}), null);
  const claude = choice.options.find((o) => o.engineId === 'default.claude');
  assert.deepEqual(claude?.params, [
    { text: '--model opus', defaultOn: true, effect: 'none', options: [] },
    {
      text: '--dangerously-skip-permissions',
      defaultOn: false,
      effect: 'unguarded',
      options: ['--dangerously-skip-permissions'],
    },
    {
      text: '--settings /tmp/x.json',
      defaultOn: false,
      effect: 'refused',
      options: ['--settings'],
    },
  ]);
});

test('a non-guarded engine never has its readiness run', async () => {
  const ran: string[] = [];
  const readiness = async (id: string): Promise<SessionReadiness> => {
    ran.push(id);
    return OK;
  };
  const choice = await engineChoice([CODEX, CLAUDE], readiness, null);
  assert.deepEqual(ran, ['default.claude']);
  assert.equal(choice.options[0]?.engineId, 'default.codex');
  assert.equal(choice.options[0]?.canStart, false);
});

test('a remembered engine that can start is chosen; one that cannot is not', async () => {
  const engines = [CLAUDE, OTHER_CLAUDE];
  const readiness = readinessOf({
    'other.claude': refused('engine-not-signed-in', 'not signed in'),
  });

  const remembered = await engineChoice(engines, readiness, 'default.claude');
  assert.equal(remembered.engineId, 'default.claude');

  const notStartable = await engineChoice(engines, readiness, 'other.claude');
  assert.equal(notStartable.engineId, 'default.claude', 'falls back to the first that can start');
});

test('Claude refused with engine-not-signed-in gives the sign-in refusal', async () => {
  const readiness = readinessOf({
    'default.claude': refused(
      'engine-not-signed-in',
      'No AI session was started: Claude Code is installed and not signed in.',
    ),
  });
  const choice = await engineChoice([CLAUDE], readiness, null);
  assert.equal(choice.engineId, null);
  assert.equal(choice.buttonName, 'Claude Code');
  assert.ok(choice.refusal);
  assert.equal(
    choice.refusal?.message,
    'No AI session was started: Claude Code is installed and not signed in.',
  );
  assert.equal(choice.refusal?.fix?.kind, 'sign-in');
  assert.equal(choice.refusal?.fix?.commandId, 'engine-sign-in:claude-code');
  assert.equal(choice.refusal?.fix?.commandLine, 'claude auth login');
  const claudeOption = choice.options[0];
  assert.equal(claudeOption?.reason, 'not signed in');
});

test('each row of the A.9 table maps to its fix', () => {
  const cases: [SessionStartFailure['kind'], string | null][] = [
    ['engine-not-found', 'set-up-claude-code'],
    ['engine-not-installed', 'set-up-claude-code'],
    ['engine-not-signed-in', 'sign-in'],
    ['python3-missing', 'set-up-python3'],
    ['not-installed', 'reinstall-lore'],
    ['install-record-unreadable', 'reinstall-lore'],
    ['plugin-missing', 'reinstall-lore'],
    ['check-missing', 'reinstall-lore'],
    ['check-altered', 'reinstall-lore'],
    ['engine-not-supported', 'edit-engine'],
    ['desk-unavailable', null],
    ['install-record-newer', null],
    ['session-server-unavailable', null],
    ['session-files-failed', null],
    ['start-failed', null],
    ['no-terminal', null],
    ['invalid-argument', null],
    ['not-a-space-window', null],
  ];
  for (const [kind, fixKind] of cases) {
    const fix = fixFor({ kind, message: 'x' }, CLAUDE);
    assert.equal(fix?.kind ?? null, fixKind, kind);
  }
});

test('set-up-claude-code opens Set up this computer at engines, set-up-python3 at tools, and sign-in at neither', () => {
  assert.equal(fixFor({ kind: 'engine-not-installed', message: 'x' }, CLAUDE)?.section, 'engines');
  assert.equal(fixFor({ kind: 'python3-missing', message: 'x' }, CLAUDE)?.section, 'tools');
  assert.equal(fixFor({ kind: 'engine-not-signed-in', message: 'x' }, CLAUDE)?.section, null);
  assert.equal(fixFor({ kind: 'not-installed', message: 'x' }, CLAUDE)?.section, null);
});

test('M10.5: every option carries a lore readiness report', async () => {
  const choice = await engineChoice([GEMINI, CLAUDE], readinessOf({}), null);
  const gemini = choice.options.find((o) => o.engineId === 'default.gemini');
  assert.ok(
    gemini?.lore.lines.every((line) => line.state === 'no'),
    'not guarded: three no',
  );
  assert.equal(gemini?.lore.asClaudeCode, false);
  const claude = choice.options.find((o) => o.engineId === 'default.claude');
  assert.ok(
    claude?.lore.lines.every((line) => line.state === 'yes'),
    'ready Claude Code: three yes',
  );
  assert.equal(claude?.lore.asClaudeCode, true);
});

test('M10.5: the sign-in fix of a Codex option is engine-sign-in:codex with the label Sign in to Codex CLI', () => {
  const fix = fixFor(
    { kind: 'engine-not-signed-in', message: 'x' },
    { id: 'default.codex', name: 'Codex CLI', binary: 'codex' },
  );
  assert.equal(fix?.kind, 'sign-in');
  assert.equal(fix?.commandId, 'engine-sign-in:codex');
  assert.equal(fix?.label, 'Sign in to Codex CLI');
  assert.equal(fix?.commandLine, 'codex login');
});
