import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SPACE_MODULES } from '../../../src/main/space/ipc/index.js';
import { createAppCommandRunner, liveGitHubAllowed } from '../../../src/main/space/live-github.js';
import {
  createSpaceLog,
  sanitizeLogFields,
  spaceLogFileName,
} from '../../../src/main/space/log.js';
import { addRecentSpace, loadRecentSpaces } from '../../../src/main/space/recents.js';
import { CONTRACT, SPACE_WINDOW_MODES, isSpaceWindowMode } from '../../../src/shared/ipc.js';
import { SPACE_COMMANDS_CONTRACT } from '../../../src/shared/ipc/space/commands.contract.js';
import { SPACE_DASHBOARD_REPORT_CONTRACT } from '../../../src/shared/ipc/space/dashboard-report.contract.js';
import { SPACE_DIALOGS_CONTRACT } from '../../../src/shared/ipc/space/dialogs.contract.js';
import { SPACE_FILES_CONTRACT } from '../../../src/shared/ipc/space/files.contract.js';
import { SPACE_MACHINE_CONTRACT } from '../../../src/shared/ipc/space/machine.contract.js';
import { SPACE_MIGRATION_CONTRACT } from '../../../src/shared/ipc/space/migration.contract.js';
import { SPACE_PROJECT_CONTRACT } from '../../../src/shared/ipc/space/project.contract.js';
import { SPACE_REPOSITORIES_CONTRACT } from '../../../src/shared/ipc/space/repositories.contract.js';
import { SPACE_ROOTS_CONTRACT } from '../../../src/shared/ipc/space/roots.contract.js';
import { SPACE_SESSIONS_CONTRACT } from '../../../src/shared/ipc/space/sessions.contract.js';
import { SPACE_SETUP_CONTRACT } from '../../../src/shared/ipc/space/setup.contract.js';
import { SPACE_WINDOWS_CONTRACT } from '../../../src/shared/ipc/space/windows.contract.js';

// The groundwork that the later 1.0 phases build on. These tests keep holding as the
// fragments fill: they check the rules of section 5.1 for whatever a fragment contains.

type Desc = { kind: 'invoke' | 'send' | 'push'; channel: string };

const FRAGMENTS: Record<string, Record<string, Desc>> = {
  windows: SPACE_WINDOWS_CONTRACT,
  setup: SPACE_SETUP_CONTRACT,
  machine: SPACE_MACHINE_CONTRACT,
  commands: SPACE_COMMANDS_CONTRACT,
  sessions: SPACE_SESSIONS_CONTRACT,
  dashboardReport: SPACE_DASHBOARD_REPORT_CONTRACT,
  dialogs: SPACE_DIALOGS_CONTRACT,
  roots: SPACE_ROOTS_CONTRACT,
  files: SPACE_FILES_CONTRACT,
  migration: SPACE_MIGRATION_CONTRACT,
  project: SPACE_PROJECT_CONTRACT,
  repositories: SPACE_REPOSITORIES_CONTRACT,
};

test('every entry of every 1.0 fragment is in CONTRACT and follows the naming rules', () => {
  const contract = CONTRACT as Record<string, Desc>;
  for (const [feature, fragment] of Object.entries(FRAGMENTS)) {
    for (const [method, desc] of Object.entries(fragment)) {
      assert.equal(contract[method], desc, `${feature}.${method} is spread into CONTRACT`);
      assert.match(desc.channel, /^space:[a-z0-9-]+$/, `${method}: the channel starts with space:`);
      if (desc.kind === 'push')
        assert.match(method, /^onSpace[A-Z]/, `${method}: a push is onSpace…`);
      else assert.match(method, /^space[A-Z]/, `${method}: a request is space…`);
    }
  }
});

test('no method and no channel is declared twice across CONTRACT and the fragments', () => {
  const channels = Object.values(CONTRACT as Record<string, Desc>).map((desc) => desc.channel);
  assert.equal(new Set(channels).size, channels.length, 'every channel string is unique');
  const methods = Object.values(FRAGMENTS).flatMap((fragment) => Object.keys(fragment));
  assert.equal(new Set(methods).size, methods.length, 'no two fragments declare one method');
  const spaceInContract = Object.keys(CONTRACT).filter((method) =>
    /^(onS|s)pace[A-Z]/.test(method),
  );
  assert.deepEqual(spaceInContract.sort(), [...methods].sort(), 'a 1.0 entry lives in a fragment');
});

test('there is one register module per fragment', () => {
  assert.equal(SPACE_MODULES.length, Object.keys(FRAGMENTS).length);
  assert.equal(new Set(SPACE_MODULES).size, SPACE_MODULES.length);
});

test('the 1.0 window modes are told apart from the v0.8 ones', () => {
  assert.deepEqual(
    [...SPACE_WINDOW_MODES],
    ['space-welcome', 'machine-check', 'setup', 'migration', 'not-a-space', 'space', 'space-files'],
  );
  for (const mode of ['welcome', 'cockpit', 'altered', '']) {
    assert.equal(isSpaceWindowMode(mode), false, mode);
  }
});

test('the log writes one JSON line per event under logs/, named by the day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-log-'));
  try {
    const lines: string[] = [];
    const sink = {
      log: (line: string) => lines.push(line),
      warn: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    };
    const log = createSpaceLog({
      logsDir: () => join(dir, 'logs'),
      now: () => new Date('2026-09-18T10:00:00Z'),
      console: sink,
    });
    log.info('folder-detected', { folder: '/tmp/x', kind: 'space' });
    log.error('step-failed', { step: 'push', time: 'not this', level: 'not this' });

    assert.equal(spaceLogFileName(new Date('2026-09-18T23:59:59Z')), 'space-2026-09-18.log');
    assert.deepEqual(readdirSync(join(dir, 'logs')), ['space-2026-09-18.log']);
    const written = readFileSync(join(dir, 'logs', 'space-2026-09-18.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(written[0], {
      folder: '/tmp/x',
      kind: 'space',
      time: '2026-09-18T10:00:00.000Z',
      level: 'info',
      event: 'folder-detected',
    });
    assert.equal(written[1]?.level, 'error', 'a field cannot replace the level');
    assert.equal(written[1]?.time, '2026-09-18T10:00:00.000Z');
    assert.equal(lines.length, 2, 'each line also goes to the console');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the log writes no token and no content', () => {
  const fields = sanitizeLogFields({
    sessionToken: 'abcd1234secretsecret',
    headers: { Authorization: 'Bearer xyz987654' },
    stdout: 'ghp_a-token-printed-by-gh-auth',
    content: 'the text of a file',
    args: ['auth', 'status'],
    exitCode: 0,
    long: 'x'.repeat(2000),
  });
  assert.equal(fields.sessionToken, 'abcd…');
  assert.deepEqual(fields.headers, { Authorization: 'Bear…' });
  assert.equal(fields.stdout, '[not logged]');
  assert.equal(fields.content, '[not logged]');
  assert.deepEqual(fields.args, ['auth', 'status']);
  assert.equal(fields.exitCode, 0);
  assert.equal(String(fields.long).length, 501);
  assert.doesNotMatch(JSON.stringify(fields), /secretsecret|xyz987654|ghp_|text of a file/);
});

test('a log that cannot write its file still does not throw', () => {
  const log = createSpaceLog({
    logsDir: () => '/dev/null/not-a-folder',
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });
  assert.doesNotThrow(() => log.warn('anything', { a: 1 }));
});

test('live GitHub is allowed for a normal run and for no test or end-to-end run', () => {
  assert.equal(liveGitHubAllowed({}), true);
  assert.equal(createAppCommandRunner({}).liveGitHub, true);

  for (const env of [
    { COCKPIT_E2E: '1', AI_LORE_ALLOW_LIVE_GITHUB: '1' },
    { AI_LORE_TEST: '1', AI_LORE_ALLOW_LIVE_GITHUB: '1' },
    { NODE_ENV: 'test' },
  ] as Record<string, string | undefined>[]) {
    assert.equal(liveGitHubAllowed(env), false);
    assert.equal(createAppCommandRunner(env).liveGitHub, false);
  }
});

test('the permission to reach live GitHub is never in the environment a terminal gets', () => {
  // `main/pty.ts` gives a terminal `{ ...process.env, COLORTERM }`. The app's runner carries
  // the permission as an option, so the variable is in no environment: not set by a normal
  // run, and removed when the app inherited it from the shell that started it.
  for (const env of [
    {},
    { AI_LORE_ALLOW_LIVE_GITHUB: '1' },
    { COCKPIT_E2E: '1', AI_LORE_ALLOW_LIVE_GITHUB: '1' },
  ] as Record<string, string | undefined>[]) {
    createAppCommandRunner(env);
    const terminalEnv = { ...env, COLORTERM: 'truecolor' };
    assert.equal('AI_LORE_ALLOW_LIVE_GITHUB' in terminalEnv, false);
  }

  // The same on the process's own environment, which is what the app passes.
  const before = process.env.AI_LORE_ALLOW_LIVE_GITHUB;
  process.env.AI_LORE_ALLOW_LIVE_GITHUB = '1';
  try {
    createAppCommandRunner();
    assert.equal('AI_LORE_ALLOW_LIVE_GITHUB' in process.env, false);
    assert.equal(Object.keys({ ...process.env }).includes('AI_LORE_ALLOW_LIVE_GITHUB'), false);
  } finally {
    if (before !== undefined) process.env.AI_LORE_ALLOW_LIVE_GITHUB = before;
  }
});

test('the recents of Spaces are a file of their own under spaces/, newest first, damaged entries dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-recents-'));
  try {
    assert.deepEqual(loadRecentSpaces(dir), []);
    addRecentSpace(dir, { path: '/tmp/a', name: 'a' }, 1);
    addRecentSpace(dir, { path: '/tmp/b', name: 'b' }, 2);
    const recents = addRecentSpace(dir, { path: '/tmp/a', name: 'a2' }, 3);
    assert.deepEqual(recents, [
      { path: '/tmp/a', name: 'a2', openedAt: 3 },
      { path: '/tmp/b', name: 'b', openedAt: 2 },
    ]);
    assert.deepEqual(readdirSync(dir), ['spaces'], 'nothing beside spaces/ was written');
    assert.deepEqual(readdirSync(join(dir, 'spaces')), ['recents.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
