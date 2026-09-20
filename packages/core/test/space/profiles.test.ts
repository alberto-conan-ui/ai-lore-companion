import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type EngineEntry,
  type Profile,
  engineNameOf,
  entryOf,
  mergeEnginesWithCatalog,
  parseEngineEntry,
  profileById,
  profileOf,
} from '../../src/index.js';

// M14.1 (`profile-shape-architecture.md` 3.1, 3.2): a profile's id is the
// engine's id, and `EngineEntry` survives, unchanged, as the stored shape of
// `engines.json`; a `Profile` is what that entry is read as.

/** `parseEngineEntry`, asserting the raw value is a well-formed entry. */
function parsedEntry(raw: unknown): EngineEntry {
  const entry = parseEngineEntry(raw);
  assert.ok(entry);
  return entry;
}

test('profileOf on a catalog entry gives the catalog id, and the id is the engine id, not a new one', () => {
  const entry: EngineEntry = { id: 'default.claude', name: 'Claude Code', binary: 'claude' };
  const profile = profileOf(entry);
  assert.equal(profile.id, 'default.claude');
  assert.equal(profile.name, 'Claude Code');
  assert.equal(profile.engine, 'claude-code');
  assert.equal(profile.binary, 'claude');
  assert.deepEqual(profile.params, []);
  assert.equal(profile.model, undefined);
});

test('profileOf on a hand-added entry gives engine: null, and engineNameOf reads the binary name', () => {
  const entry: EngineEntry = { id: 'default.gemini', name: 'Gemini', binary: 'gemini' };
  const profile = profileOf(entry);
  assert.equal(profile.engine, null);
  assert.equal(engineNameOf(profile), 'gemini');
});

test('engineNameOf on an absolute binary strips the directory, lower-cases and drops .exe', () => {
  const profile = profileOf({ id: 'x', name: 'Gemini', binary: '/opt/homebrew/bin/gemini' });
  assert.equal(engineNameOf(profile), 'gemini');
});

test('entryOf(profileOf(entry)) equals parseEngineEntry(entry) for a bare entry', () => {
  const entry = parsedEntry({ id: 'c', name: 'Claude', binary: 'claude' });
  assert.deepEqual(entryOf(profileOf(entry)), parseEngineEntry(entry));
});

test('entryOf(profileOf(entry)) equals parseEngineEntry(entry) for an entry with parameters', () => {
  const entry = parsedEntry({
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    params: [
      { text: '--dangerously-skip-permissions', defaultOn: true },
      { text: '--model opus', defaultOn: false },
    ],
  });
  assert.deepEqual(entryOf(profileOf(entry)), parseEngineEntry(entry));
});

test('entryOf(profileOf(entry)) equals parseEngineEntry(entry) for an entry with helperModel', () => {
  const entry = parsedEntry({
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    helperModel: 'opus',
  });
  assert.deepEqual(entryOf(profileOf(entry)), parseEngineEntry(entry));
});

test('entryOf(profileOf(entry)) equals parseEngineEntry(entry) for an entry with model', () => {
  const entry = parsedEntry({
    id: 'c',
    name: 'Claude',
    binary: 'claude',
    model: 'sonnet',
  });
  assert.deepEqual(entryOf(profileOf(entry)), parseEngineEntry(entry));
});

test('profileById finds a profile by id, or gives null', () => {
  const profiles: Profile[] = [
    profileOf({ id: 'a', name: 'A', binary: 'a' }),
    profileOf({ id: 'b', name: 'B', binary: 'b' }),
  ];
  assert.equal(profileById(profiles, 'b')?.name, 'B');
  assert.equal(profileById(profiles, 'missing'), null);
});

test('mergeEnginesWithCatalog carries a stored model onto the catalog entry it merges into', () => {
  const stored: EngineEntry[] = [
    {
      id: 'default.claude',
      name: 'Claude Code',
      binary: 'claude',
      model: 'opus',
      helperModel: 'opus',
    },
  ];
  const { engines } = mergeEnginesWithCatalog(stored);
  const claude = engines.find((e) => e.id === 'default.claude');
  assert.equal(claude?.model, 'opus');
  assert.equal(claude?.helperModel, 'opus');
});

// ---------- The test that matters more than the others ----------
//
// The Human Lead's real `engines.json`, read on 2026-09-20 (stage
// M14-the-profile-shape, "What the design found"; architecture doc 2.2):
// `default.claude`, `default.codex`, `default.antigravity` (with the seeded
// `--dangerously-skip-permissions` parameter and its derived `args`),
// `default.opencode`, and then a hand-added `default.gemini` last. No entry
// carries `helperModel`.

const humanLeadsEngines: EngineEntry[] = [
  { id: 'default.claude', name: 'Claude Code', binary: 'claude' },
  { id: 'default.codex', name: 'Codex CLI', binary: 'codex' },
  {
    id: 'default.antigravity',
    name: 'Antigravity CLI',
    binary: 'agy',
    params: [{ text: '--dangerously-skip-permissions', defaultOn: true }],
    args: ['--dangerously-skip-permissions'],
  },
  { id: 'default.opencode', name: 'OpenCode', binary: 'opencode' },
  { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
];

test("the Human Lead's engines.json reads unchanged through the catalog merge, and writes nothing back", () => {
  const { engines, changed } = mergeEnginesWithCatalog(humanLeadsEngines);
  assert.equal(changed, false);
  assert.deepEqual(engines, humanLeadsEngines);
});

test("the Human Lead's engines.json reads as five profiles, none with a model", () => {
  const profiles = humanLeadsEngines.map(profileOf);
  assert.deepEqual(
    profiles.map((p) => p.id),
    [
      'default.claude',
      'default.codex',
      'default.antigravity',
      'default.opencode',
      'default.gemini',
    ],
  );
  assert.deepEqual(
    profiles.map((p) => p.engine),
    ['claude-code', 'codex', 'antigravity', 'opencode', null],
  );
  assert.ok(profiles.every((p) => p.model === undefined));
  const gemini = profiles.find((p) => p.id === 'default.gemini');
  assert.ok(gemini);
  assert.equal(engineNameOf(gemini), 'gemini');
  const antigravity = profiles.find((p) => p.id === 'default.antigravity');
  assert.deepEqual(antigravity?.params, [
    { text: '--dangerously-skip-permissions', defaultOn: true },
  ]);
});

test("the Human Lead's engines.json round-trips through entryOf(profileOf(...)) unchanged, entry by entry", () => {
  for (const entry of humanLeadsEngines) {
    assert.deepEqual(entryOf(profileOf(entry)), entry);
  }
});
