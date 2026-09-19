/**
 * `main/engines.ts`'s `loadEngines` / `saveEngines` (phase M9.4): the store
 * always merges with core's engine catalog (`mergeEnginesWithCatalog`), so
 * the catalog engines are first and a catalog entry can no longer be
 * user-removed. A v0.8 file with a `removedDefaults` field is written back
 * once, without it, and a later load that changes nothing does not write
 * again.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { ENGINE_CATALOG } from '@ai-lore-companion/core';
import { loadEngines, saveEngines } from '../../../src/main/engines.js';

let userDataDir: string;

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'ai-lore-engines-'));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

function enginesFilePath(): string {
  return join(userDataDir, 'engines.json');
}

const CATALOG_IDS = ENGINE_CATALOG.map((entry) => entry.engineId);

test("loadEngines puts the catalog engines first (Claude Code once), merges the Human Lead's " +
  'hand-added and removed-default engines (finding 8), and writes the file once without ' +
  '`removedDefaults`; a later load that changes nothing does not write again', () => {
  const raw = {
    engines: [
      { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
      { id: 'user.1', name: 'Claude', binary: 'claude' },
      { id: 'user.2', name: 'agy', binary: 'agy' },
    ],
    removedDefaults: ['default.claude'],
  };
  writeFileSync(enginesFilePath(), JSON.stringify(raw));

  const first = loadEngines(userDataDir);
  assert.deepEqual(
    first.map((e) => e.id),
    [...CATALOG_IDS, 'default.gemini'],
  );
  assert.equal(first.filter((e) => e.id === 'default.claude').length, 1);
  assert.deepEqual(first[0], { id: 'default.claude', name: 'Claude Code', binary: 'claude' });

  const writtenText = readFileSync(enginesFilePath(), 'utf8');
  const written = JSON.parse(writtenText) as { engines: unknown[]; removedDefaults?: unknown };
  assert.equal('removedDefaults' in written, false);
  assert.deepEqual(written.engines, first);

  // A second load merges to the same list (already merged) and writes nothing further.
  const second = loadEngines(userDataDir);
  assert.deepEqual(second, first);
  assert.equal(readFileSync(enginesFilePath(), 'utf8'), writtenText);
});

test('loadEngines on an empty userData gives the four catalog engines and writes them once', () => {
  const engines = loadEngines(userDataDir);
  assert.deepEqual(
    engines.map((e) => e.id),
    CATALOG_IDS,
  );
  const written = JSON.parse(readFileSync(enginesFilePath(), 'utf8')) as { engines: unknown[] };
  assert.deepEqual(written.engines, engines);
});

test('saveEngines gives back a catalog entry missing from the list it was given', () => {
  saveEngines(userDataDir, [
    { id: 'default.claude', name: 'Claude Code', binary: 'claude' },
    { id: 'default.antigravity', name: 'Antigravity CLI', binary: 'agy' },
    { id: 'default.opencode', name: 'OpenCode', binary: 'opencode' },
  ]);
  const engines = loadEngines(userDataDir);
  assert.deepEqual(
    engines.map((e) => e.id),
    CATALOG_IDS,
  );
});
