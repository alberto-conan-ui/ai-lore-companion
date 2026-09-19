/**
 * The engine adapter interface (phase M10.5, `m10-architecture.md` 3.2 and
 * section 5, M10.5): `adapterFor`, each adapter's `options`, the Claude Code
 * adapter's `launch`, `sessionInstructions`, and `writeSessionFiles`'s new
 * `LaunchFile` handling.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
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
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import {
  ANTIGRAVITY_OPTIONS,
  CLAUDE_CODE_OPTIONS,
  CODEX_OPTIONS,
  OPENCODE_OPTIONS,
} from '../../../src/main/space/sessions/engine-options.js';
import { antigravityAdapter } from '../../../src/main/space/sessions/engines/antigravity.js';
import { claudeCodeAdapter } from '../../../src/main/space/sessions/engines/claude-code.js';
import { codexAdapter } from '../../../src/main/space/sessions/engines/codex.js';
import { adapterFor, optionsFor } from '../../../src/main/space/sessions/engines/index.js';
import { sessionInstructions } from '../../../src/main/space/sessions/engines/instructions.js';
import { opencodeAdapter } from '../../../src/main/space/sessions/engines/opencode.js';
import { readInstalledSkills } from '../../../src/main/space/sessions/engines/skills.js';
import {
  buildSessionMcpConfig,
  buildSessionSettings,
  sessionFilePaths,
  writeSessionFiles,
} from '../../../src/main/space/sessions/files.js';
import { verifyInstall } from '../../../src/main/space/sessions/preflight.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

const CONNECTION: SessionConnection = {
  sessionId: 's-adapter',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-adapter',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

function engine(id: string, binary: string): EngineEntry {
  return { id, name: id, binary };
}

test('every catalog entry with guardedSessions: true has an adapter', () => {
  for (const entry of ENGINE_CATALOG) {
    if (!entry.guardedSessions) continue;
    const adapter = adapterFor(engine(entry.engineId, entry.binary));
    assert.notEqual(adapter, null, entry.catalogId);
  }
});

test('adapterFor: a hand-added Claude Code is the Claude Code adapter; Gemini is null', () => {
  assert.equal(adapterFor(engine('user.claude', 'claude')), claudeCodeAdapter);
  assert.equal(adapterFor(engine('user.gemini', 'gemini')), null);
});

test('every adapter carries its own engine constant as options, and optionsFor looks it up', () => {
  assert.equal(claudeCodeAdapter.options, CLAUDE_CODE_OPTIONS);
  assert.equal(antigravityAdapter.options, ANTIGRAVITY_OPTIONS);
  assert.equal(codexAdapter.options, CODEX_OPTIONS);
  assert.equal(opencodeAdapter.options, OPENCODE_OPTIONS);
  assert.equal(optionsFor(engine('default.antigravity', 'agy')), ANTIGRAVITY_OPTIONS);
  assert.equal(optionsFor(engine('default.claude', 'claude')), CLAUDE_CODE_OPTIONS);
});

test('sessionInstructions: invoked names /lore:session-orient; listed lists each skill with its card path in name order', () => {
  const invoked = sessionInstructions({
    spaceRoot: '/space',
    skills: [],
    adapter: { skillInvocation: (name) => `/lore:${name}`, verbsAre: 'invoked' },
  });
  assert.match(invoked, /\/lore:session-orient/);
  assert.match(invoked, /\/space\/ai_readme\.md/);

  const listed = sessionInstructions({
    spaceRoot: '/space',
    skills: [
      {
        name: 'zeta',
        description: 'Zeta does things.',
        cardPath: '/space/lore/verbs/zeta.md',
        skillFile: '/install/zeta/SKILL.md',
        text: '',
      },
      {
        name: 'alpha',
        description: 'Alpha does other things.',
        cardPath: '/space/lore/verbs/alpha.md',
        skillFile: '/install/alpha/SKILL.md',
        text: '',
      },
    ],
    adapter: {
      skillInvocation: (name) => `Run the Lore's ${name}: read its card and follow it.`,
      verbsAre: 'listed',
    },
  });
  const alphaLine = listed.indexOf(
    '- alpha: Alpha does other things. (/space/lore/verbs/alpha.md)',
  );
  const zetaLine = listed.indexOf('- zeta: Zeta does things. (/space/lore/verbs/zeta.md)');
  assert.ok(alphaLine >= 0 && zetaLine >= 0);
  assert.ok(alphaLine < zetaLine, 'name order');
});

test('writeSessionFiles refuses a LaunchFile path outside the session folder, and writes a nested one privately', async () => {
  const base = mkdtempSync(join(tmpdir(), 'm10-5-launch-files-'));
  try {
    for (const bad of ['../x', '/abs', 'a/../../b']) {
      await assert.rejects(
        writeSessionFiles(
          base,
          { sessionId: `s-bad-${Math.random().toString(16).slice(2, 6)}` },
          { args: [], env: {}, files: [{ path: bad, content: 'x' }] },
        ),
        /an adapter named a file outside the session folder/,
      );
    }
    const sessionId = 's-nested';
    const written = await writeSessionFiles(
      base,
      { sessionId },
      { args: [], env: {}, files: [{ path: 'a/b/c.json', content: '{}' }] },
    );
    const nested = join(written.dir, 'a', 'b', 'c.json');
    assert.equal(statSync(join(written.dir, 'a')).mode & 0o777, 0o700);
    assert.equal(statSync(join(written.dir, 'a', 'b')).mode & 0o777, 0o700);
    assert.equal(statSync(nested).mode & 0o777, 0o600);
    assert.equal(readFileSync(nested, 'utf8'), '{}');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

let space: SpaceFixture;
let base: string;
let paths: DeskPaths;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'adapter-space' });
  base = mkdtempSync(join(tmpdir(), 'm10-5-adapter-'));
  paths = deskPaths(base, space.root);
  mkdirSync(paths.install, { recursive: true });
  mkdirSync(paths.desk, { recursive: true });
  mkdirSync(paths.sessions, { recursive: true });
});

after(() => {
  space.cleanup();
  rmSync(base, { recursive: true, force: true });
});

test('the Claude Code launch gives the parameters first, --append-system-prompt before --allowedTools, and settings/mcp equal to buildSessionSettings/buildSessionMcpConfig', async () => {
  const lore = await readLore(space.root);
  assert.ok(lore.ok);
  const installed = await installClaudeCode(lore.value, paths.install);
  assert.ok(installed.ok, installed.ok ? '' : installed.error.message);
  const verified = await verifyInstall(paths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);

  const sessionId = 's-launch';
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const skills = await readInstalledSkills(paths.install, space.root);
  const instructions = sessionInstructions({
    spaceRoot: space.root,
    skills,
    adapter: claudeCodeAdapter,
  });
  const launch = claudeCodeAdapter.launch({
    sessionId,
    spaceRoot: space.root,
    deskDir: paths.desk,
    paths: filePaths,
    python: '/usr/bin/python3',
    install: verified.value,
    skills,
    connection: CONNECTION,
    repositories: [],
    instructions,
    paramArgv: ['--model', 'opus'],
  });

  assert.deepEqual(launch.args.slice(0, 2), ['--model', 'opus']);
  const appendIndex = launch.args.indexOf('--append-system-prompt');
  assert.ok(appendIndex >= 0);
  assert.equal(launch.args[appendIndex + 1], instructions);
  assert.ok(appendIndex < launch.args.indexOf('--allowedTools'));
  assert.deepEqual(launch.env, {});
  assert.equal(claudeCodeInstallPaths(paths.install).plugin, verified.value.pluginDir);

  const settingsFile = launch.files.find((file) => file.path === 'settings.json');
  const mcpFile = launch.files.find((file) => file.path === 'mcp.json');
  assert.ok(settingsFile && mcpFile);
  const expectedSettings = buildSessionSettings(
    {
      sessionId,
      spaceRoot: space.root,
      deskDir: paths.desk,
      python: '/usr/bin/python3',
      beforeChecks: verified.value.beforeChecks,
      afterChecks: verified.value.afterChecks,
      repositories: [],
      connection: CONNECTION,
    },
    filePaths,
  );
  assert.deepEqual(JSON.parse(settingsFile?.content ?? '{}'), expectedSettings);
  assert.deepEqual(JSON.parse(mcpFile?.content ?? '{}'), buildSessionMcpConfig(CONNECTION));
});
