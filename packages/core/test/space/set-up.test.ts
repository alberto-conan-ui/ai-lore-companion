import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type {
  EngineCheck,
  MachineCheck,
  MachineCheckState,
  MachineRequirementCheck,
  MachineRequirementId,
} from '../../src/index.js';
import { setUpReadiness } from '../../src/index.js';

function req(id: MachineRequirementId, state: MachineCheckState): MachineRequirementCheck {
  return { id, binary: id, state, guidance: null, command: null };
}

function claudeCode(overrides: Partial<EngineCheck> = {}): EngineCheck {
  return {
    engineId: 'default.claude',
    name: 'Claude Code',
    binary: 'claude',
    state: { kind: 'fine', version: '1.0.0' },
    guidance: null,
    command: null,
    catalogId: 'claude-code',
    maker: 'Anthropic',
    required: true,
    guardedSessions: true,
    installed: { kind: 'installed', version: '1.0.0' },
    signIn: { kind: 'signed-in' },
    installCommand: 'install',
    installNeeds: null,
    signInCommand: 'sign in',
    note: null,
    page: 'https://example.test',
    ...overrides,
  };
}

function fineCheck(overrides: Partial<MachineCheck> = {}): MachineCheck {
  const requirements = [
    req('git', { kind: 'fine', version: '2.40.0' }),
    req('gh', { kind: 'fine', version: '2.92.0' }),
    req('engine', { kind: 'fine', version: '1.0.0' }),
    req('python3', { kind: 'fine', version: '3.12.0' }),
  ];
  return {
    requirements,
    engines: [claudeCode()],
    ready: true,
    github: { account: 'lead', organisations: [] },
    tools: { brew: true, npm: true },
    ...overrides,
  };
}

test('setUpReadiness: everything fine and a folder chosen is ready, with nothing left', () => {
  const readiness = setUpReadiness(fineCheck(), '/Users/lead/Spaces');
  assert.deepEqual(readiness, { ready: true, left: [] });
});

test('setUpReadiness: git missing, too old, or undetermined', () => {
  const missing = setUpReadiness(
    fineCheck({
      requirements: fineCheck().requirements.map((r) =>
        r.id === 'git' ? req('git', { kind: 'missing' }) : r,
      ),
    }),
    '/x',
  );
  assert.deepEqual(missing.left, [{ id: 'git', text: 'install Git' }]);

  const tooOld = setUpReadiness(
    fineCheck({
      requirements: fineCheck().requirements.map((r) =>
        r.id === 'git' ? req('git', { kind: 'too-old', version: '2.0.0', minimum: '2.28.0' }) : r,
      ),
    }),
    '/x',
  );
  assert.deepEqual(tooOld.left, [{ id: 'git', text: 'update Git' }]);

  const undetermined = setUpReadiness(
    fineCheck({
      requirements: fineCheck().requirements.map((r) =>
        r.id === 'git' ? req('git', { kind: 'undetermined', reason: 'it broke' }) : r,
      ),
    }),
    '/x',
  );
  assert.deepEqual(undetermined.left, [{ id: 'git', text: 'check Git' }]);
});

test('setUpReadiness: python3 missing, too old, or undetermined', () => {
  const withPython3 = (state: MachineCheckState) =>
    setUpReadiness(
      fineCheck({
        requirements: fineCheck().requirements.map((r) =>
          r.id === 'python3' ? req('python3', state) : r,
        ),
      }),
      '/x',
    );
  assert.deepEqual(withPython3({ kind: 'missing' }).left, [
    { id: 'python3', text: 'install Python 3' },
  ]);
  assert.deepEqual(withPython3({ kind: 'too-old', version: '3.6.0', minimum: '3.8.0' }).left, [
    { id: 'python3', text: 'update Python 3' },
  ]);
  assert.deepEqual(withPython3({ kind: 'undetermined', reason: 'it broke' }).left, [
    { id: 'python3', text: 'check Python 3' },
  ]);
});

test('setUpReadiness: gh missing or too old', () => {
  const withGh = (state: MachineCheckState) =>
    setUpReadiness(
      fineCheck({
        requirements: fineCheck().requirements.map((r) => (r.id === 'gh' ? req('gh', state) : r)),
      }),
      '/x',
    );
  assert.deepEqual(withGh({ kind: 'missing' }).left, [
    { id: 'gh', text: 'install the GitHub CLI' },
  ]);
  assert.deepEqual(withGh({ kind: 'too-old', version: '2.0.0', minimum: '2.81.0' }).left, [
    { id: 'gh', text: 'update the GitHub CLI' },
  ]);
});

test('setUpReadiness: gh not signed in, missing scope, or undetermined gives a github item', () => {
  const withGh = (state: MachineCheckState) =>
    setUpReadiness(
      fineCheck({
        requirements: fineCheck().requirements.map((r) => (r.id === 'gh' ? req('gh', state) : r)),
      }),
      '/x',
    );
  assert.deepEqual(withGh({ kind: 'not-signed-in' }).left, [
    { id: 'github', text: 'sign in to GitHub' },
  ]);
  assert.deepEqual(withGh({ kind: 'missing-scope', scope: 'project' }).left, [
    { id: 'github', text: 'give GitHub access to Projects' },
  ]);
  assert.deepEqual(withGh({ kind: 'undetermined', reason: 'offline' }).left, [
    { id: 'github', text: 'check the GitHub sign-in' },
  ]);
});

test('setUpReadiness: Claude Code not installed, undetermined, or not signed in', () => {
  const notInstalled = setUpReadiness(
    fineCheck({ engines: [claudeCode({ installed: { kind: 'missing' } })] }),
    '/x',
  );
  assert.deepEqual(notInstalled.left, [{ id: 'claude-code', text: 'install Claude Code' }]);

  const undeterminedInstall = setUpReadiness(
    fineCheck({
      engines: [claudeCode({ installed: { kind: 'undetermined', reason: 'it broke' } })],
    }),
    '/x',
  );
  assert.deepEqual(undeterminedInstall.left, [{ id: 'claude-code', text: 'check Claude Code' }]);

  const notSignedIn = setUpReadiness(
    fineCheck({ engines: [claudeCode({ signIn: { kind: 'not-signed-in' } })] }),
    '/x',
  );
  assert.deepEqual(notSignedIn.left, [{ id: 'claude-code', text: 'sign in to Claude Code' }]);
});

test('setUpReadiness: Claude Code sign-in that cannot be checked does not block', () => {
  const undeterminedSignIn = setUpReadiness(
    fineCheck({ engines: [claudeCode({ signIn: { kind: 'undetermined', reason: 'it broke' } })] }),
    '/x',
  );
  assert.deepEqual(undeterminedSignIn, { ready: true, left: [] });

  const notChecked = setUpReadiness(
    fineCheck({ engines: [claudeCode({ signIn: { kind: 'not-checked' } })] }),
    '/x',
  );
  assert.deepEqual(notChecked, { ready: true, left: [] });
});

test('setUpReadiness: no Spaces folder chosen', () => {
  const readiness = setUpReadiness(fineCheck(), null);
  assert.deepEqual(readiness.left, [{ id: 'spaces-folder', text: 'choose a Spaces folder' }]);
  assert.equal(readiness.ready, false);
});

test('setUpReadiness: several things left are all reported', () => {
  const check = fineCheck({
    requirements: fineCheck().requirements.map((r) =>
      r.id === 'git' ? req('git', { kind: 'missing' }) : r,
    ),
    engines: [claudeCode({ installed: { kind: 'missing' } })],
  });
  const readiness = setUpReadiness(check, null);
  assert.deepEqual(readiness.left, [
    { id: 'git', text: 'install Git' },
    { id: 'claude-code', text: 'install Claude Code' },
    { id: 'spaces-folder', text: 'choose a Spaces folder' },
  ]);
});
