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
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  type DeskPaths,
  ENGINE_CATALOG,
  type EngineEntry,
  claudeCodeInstallPaths,
  deskPaths,
  installClaudeCode,
  readLore,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { loadEngines, saveEngines } from '../../../src/main/engines.js';
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import { adapterFor } from '../../../src/main/space/sessions/engines/index.js';
import { sessionInstructions } from '../../../src/main/space/sessions/engines/instructions.js';
import { readInstalledSkills } from '../../../src/main/space/sessions/engines/skills.js';
import { sessionFilePaths } from '../../../src/main/space/sessions/files.js';
import { verifyInstall } from '../../../src/main/space/sessions/preflight.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

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

// M10.9 item 7: every catalog engine whose `guardedSessions` is true (set in this phase
// once its real-engine checks passed) has an adapter whose `launch` does not throw for a
// real fixture session.

const CONNECTION: SessionConnection = {
  sessionId: 's-catalog-launch',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-catalog-launch',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

let launchSpace: SpaceFixture;
let launchBase: string;
let launchPaths: DeskPaths;

before(async () => {
  launchSpace = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'catalog-launch' });
  launchBase = mkdtempSync(join(tmpdir(), 'm10-9-catalog-launch-'));
  launchPaths = deskPaths(launchBase, launchSpace.root);
  const lore = await readLore(launchSpace.root);
  assert.ok(lore.ok);
  const installed = await installClaudeCode(lore.value, launchPaths.install);
  assert.ok(installed.ok, installed.ok ? '' : installed.error.message);
});

after(() => {
  launchSpace.cleanup();
  rmSync(launchBase, { recursive: true, force: true });
});

test('every catalog engine with guardedSessions: true has an adapter whose launch does not throw for a fixture input', async () => {
  const verified = await verifyInstall(launchPaths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);
  const skills = await readInstalledSkills(launchPaths.install, launchSpace.root);
  const install = {
    pluginDir: claudeCodeInstallPaths(launchPaths.install).plugin,
    beforeChecks: verified.value.beforeChecks,
    afterChecks: verified.value.afterChecks,
  };

  for (const entry of ENGINE_CATALOG) {
    if (!entry.guardedSessions) continue;
    const engine: EngineEntry = { id: entry.engineId, name: entry.name, binary: entry.binary };
    const adapter = adapterFor(engine);
    assert.notEqual(adapter, null, entry.catalogId);
    const sessionId = `s-catalog-${entry.catalogId}`;
    const filePaths = sessionFilePaths(launchPaths.sessions, sessionId);
    const instructions = sessionInstructions({
      spaceRoot: launchSpace.root,
      skills,
      adapter: adapter as NonNullable<typeof adapter>,
    });
    assert.doesNotThrow(() => {
      (adapter as NonNullable<typeof adapter>).launch({
        sessionId,
        spaceRoot: launchSpace.root,
        deskDir: launchPaths.desk,
        paths: filePaths,
        python: '/usr/bin/python3',
        install,
        skills,
        connection: { ...CONNECTION, sessionId },
        repositories: [],
        instructions,
        paramArgv: [],
      });
    }, entry.catalogId);
  }
});
