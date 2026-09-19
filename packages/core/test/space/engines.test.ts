import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ENGINE_CATALOG, type EngineEntry, mergeEnginesWithCatalog } from '../../src/index.js';

test('ENGINE_CATALOG has the four engines, in order, with their ids and commands', () => {
  assert.deepEqual(
    ENGINE_CATALOG.map((entry) => entry.catalogId),
    ['claude-code', 'codex', 'antigravity', 'opencode'],
  );
  assert.deepEqual(
    ENGINE_CATALOG.map((entry) => entry.engineId),
    ['default.claude', 'default.codex', 'default.antigravity', 'default.opencode'],
  );
  const claude = ENGINE_CATALOG[0];
  assert.equal(claude?.name, 'Claude Code');
  assert.equal(claude?.maker, 'Anthropic');
  assert.equal(claude?.binary, 'claude');
  assert.equal(claude?.installCommand, 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(claude?.installNeeds, null);
  assert.equal(claude?.signInCommand, 'claude auth login');
  assert.deepEqual(claude?.signInCheck, { kind: 'claude-auth-status' });
  assert.equal(claude?.guardedSessions, true);
  assert.equal(claude?.required, true);
  assert.equal(claude?.note, null);
  assert.equal(claude?.page, 'https://code.claude.com/docs/en/setup');

  const codex = ENGINE_CATALOG[1];
  assert.equal(codex?.name, 'Codex CLI');
  assert.equal(codex?.maker, 'OpenAI');
  assert.equal(codex?.binary, 'codex');
  assert.equal(codex?.installCommand, 'npm install -g @openai/codex');
  assert.equal(codex?.installNeeds, 'npm');
  assert.equal(codex?.signInCommand, 'codex login');
  assert.deepEqual(codex?.signInCheck, { kind: 'exit-code', args: ['login', 'status'] });
  assert.equal(codex?.guardedSessions, false);
  assert.equal(codex?.required, false);

  const antigravity = ENGINE_CATALOG[2];
  assert.equal(antigravity?.name, 'Antigravity CLI');
  assert.equal(antigravity?.maker, 'Google');
  assert.equal(antigravity?.binary, 'agy');
  assert.equal(
    antigravity?.installCommand,
    'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  );
  assert.equal(antigravity?.signInCommand, 'agy');
  assert.deepEqual(antigravity?.signInCheck, { kind: 'none' });
  assert.equal(antigravity?.guardedSessions, false);
  assert.equal(antigravity?.required, false);

  const opencode = ENGINE_CATALOG[3];
  assert.equal(opencode?.name, 'OpenCode');
  assert.equal(opencode?.maker, null);
  assert.equal(opencode?.binary, 'opencode');
  assert.equal(opencode?.installCommand, 'curl -fsSL https://opencode.ai/install | bash');
  assert.equal(opencode?.signInCommand, 'opencode auth login');
  assert.deepEqual(opencode?.signInCheck, { kind: 'opencode-auth-list' });
  assert.equal(opencode?.guardedSessions, false);
  assert.equal(opencode?.required, false);
  assert.equal(opencode?.note, 'Also runs DeepSeek models: choose DeepSeek when signing in.');
});

test('mergeEnginesWithCatalog: an empty list gives the four catalog entries, changed', () => {
  const { engines, changed } = mergeEnginesWithCatalog([]);
  assert.deepEqual(
    engines.map((e) => e.id),
    ['default.claude', 'default.codex', 'default.antigravity', 'default.opencode'],
  );
  assert.deepEqual(engines[0], { id: 'default.claude', name: 'Claude Code', binary: 'claude' });
  assert.equal(changed, true);
});

test("mergeEnginesWithCatalog: the Human Lead's hand-added engines are taken into the catalog by id or by binary name", () => {
  const stored: EngineEntry[] = [
    { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
    { id: 'user.1', name: 'Claude', binary: 'claude', args: ['--model', 'opus'] },
    { id: 'user.2', name: 'agy', binary: 'agy' },
  ];
  const { engines, changed } = mergeEnginesWithCatalog(stored);
  assert.deepEqual(
    engines.map((e) => e.id),
    [
      'default.claude',
      'default.codex',
      'default.antigravity',
      'default.opencode',
      'default.gemini',
    ],
  );
  assert.equal(
    engines.some((e) => e.id === 'user.1' || e.id === 'user.2'),
    false,
  );
  const claude = engines.find((e) => e.id === 'default.claude');
  assert.deepEqual(claude?.args, ['--model', 'opus']);
  assert.equal(claude?.binary, 'claude');
  const antigravity = engines.find((e) => e.id === 'default.antigravity');
  assert.equal(antigravity?.binary, 'agy');
  const gemini = engines.find((e) => e.id === 'default.gemini');
  assert.deepEqual(gemini, { id: 'default.gemini', name: 'Gemini', binary: 'gemini' });
  assert.equal(changed, true);
});

test('mergeEnginesWithCatalog: a stored absolute binary is kept on the catalog entry', () => {
  const stored: EngineEntry[] = [{ id: 'e2e.claude', name: 'Claude', binary: '/tmp/x/bin/claude' }];
  const { engines } = mergeEnginesWithCatalog(stored);
  const claude = engines.find((e) => e.id === 'default.claude');
  assert.deepEqual(claude, {
    id: 'default.claude',
    name: 'Claude Code',
    binary: '/tmp/x/bin/claude',
  });
});

test('mergeEnginesWithCatalog: a second stored Claude Code stays a hand-added engine', () => {
  const stored: EngineEntry[] = [
    { id: 'a.claude', name: 'Claude A', binary: '/one/claude' },
    { id: 'b.claude', name: 'Claude B', binary: '/two/claude' },
  ];
  const { engines } = mergeEnginesWithCatalog(stored);
  const claude = engines.find((e) => e.id === 'default.claude');
  assert.equal(claude?.binary, '/one/claude');
  const handAdded = engines.filter((e) => e.id === 'b.claude');
  assert.equal(handAdded.length, 1);
  assert.deepEqual(handAdded[0], { id: 'b.claude', name: 'Claude B', binary: '/two/claude' });
});

test('mergeEnginesWithCatalog: a list already merged gives changed: false', () => {
  const first = mergeEnginesWithCatalog([
    { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
    { id: 'user.1', name: 'Claude', binary: 'claude', args: ['--model', 'opus'] },
  ]);
  const second = mergeEnginesWithCatalog(first.engines);
  assert.deepEqual(second.engines, first.engines);
  assert.equal(second.changed, false);
});
