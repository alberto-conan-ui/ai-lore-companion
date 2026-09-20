/**
 * What a Claude Code session spent (phase M14.6, `profile-shape-architecture.md`
 * 3.6 and 5 `M14.6`): the `Stop` hook `buildSessionSettings` registers,
 * `readSessionSpend`'s honesty about a `spend.json` that is missing or
 * malformed, the spend adapter (`SPEND_ADAPTER`) run as Claude Code would run
 * it, and which engines never pretend to a number.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { execFileRunner } from '@ai-lore-companion/core';
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import { SPEND_ADAPTER } from '../../../src/main/space/sessions/adapters.js';
import { SPEND_HOOK_TIMEOUTS } from '../../../src/main/space/sessions/constants.js';
import { antigravityAdapter } from '../../../src/main/space/sessions/engines/antigravity.js';
import { claudeCodeAdapter } from '../../../src/main/space/sessions/engines/claude-code.js';
import { codexAdapter } from '../../../src/main/space/sessions/engines/codex.js';
import { opencodeAdapter } from '../../../src/main/space/sessions/engines/opencode.js';
import {
  type SessionFilePaths,
  buildSessionSettings,
  readSessionSpend,
  sessionFilePaths,
} from '../../../src/main/space/sessions/files.js';
import { findPython3 } from '../../../src/main/space/sessions/preflight.js';

const CONNECTION: SessionConnection = {
  sessionId: 's-spend',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-spend',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

let base: string;
let python: string;

before(async () => {
  base = mkdtempSync(join(tmpdir(), 'm14-6-spend-'));
  const found = await findPython3(execFileRunner, null, base);
  assert.ok(found.ok, 'python3 is needed by these tests');
  python = found.value;
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

// --- Honesty per engine (3.6): only Claude Code has a reader at all. ---

test('only the Claude Code adapter has a readSpend; Antigravity, Codex and OpenCode do not', () => {
  assert.equal(typeof claudeCodeAdapter.readSpend, 'function');
  assert.equal(antigravityAdapter.readSpend, undefined);
  assert.equal(codexAdapter.readSpend, undefined);
  assert.equal(opencodeAdapter.readSpend, undefined);
});

// --- buildSessionSettings: the Stop hook, not a SessionEnd hook. ---

test('buildSessionSettings registers exactly one Stop hook, at the spend hook timeout, running the spend hook with --out and --adapter-seconds', () => {
  const paths = sessionFilePaths(join(base, 'sessions'), 's-settings');
  const settings = buildSessionSettings(
    {
      sessionId: 's-settings',
      spaceRoot: join(base, 'space'),
      deskDir: join(base, 'desk'),
      python,
      beforeChecks: [],
      afterChecks: [],
      repositories: [],
      connection: CONNECTION,
    },
    paths,
  );
  assert.equal(settings.hooks.Stop.length, 1);
  const stop = settings.hooks.Stop[0];
  assert.ok(stop);
  assert.equal(stop.hooks.length, 1);
  const hook = stop.hooks[0];
  assert.ok(hook);
  assert.equal(hook.type, 'command');
  assert.equal(hook.timeout, SPEND_HOOK_TIMEOUTS.hookSeconds);
  assert.match(hook.command, /session-spend\.py/);
  assert.match(hook.command, /'--out'/);
  assert.match(hook.command, new RegExp(`'${paths.spend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(hook.command, /'--adapter-seconds' '8'/);
});

// --- readSessionSpend: a session's close never shows a number it does not have. ---

test('readSessionSpend: a well-formed file gives it back, exactly', async () => {
  const paths = sessionFilePaths(join(base, 'sessions'), 's-good');
  mkdirSync(paths.dir, { recursive: true });
  const spend = {
    source: 'engine',
    usd: 0.0456,
    tokens: { input: 100, output: 40, cacheRead: 5, cacheWrite: 2 },
    model: 'claude-opus-4-1',
  };
  writeFileSync(paths.spend, JSON.stringify(spend));
  assert.deepEqual(await readSessionSpend(paths), spend);
});

test('readSessionSpend: a missing file gives { source: "none" }, and does not throw', async () => {
  const paths = sessionFilePaths(join(base, 'sessions'), 's-missing');
  assert.deepEqual(await readSessionSpend(paths), { source: 'none' });
});

test('readSessionSpend: a file that is not JSON gives { source: "none" }, and does not throw', async () => {
  const paths = sessionFilePaths(join(base, 'sessions'), 's-not-json');
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.spend, 'this is not json');
  assert.deepEqual(await readSessionSpend(paths), { source: 'none' });
});

test('readSessionSpend: a file with the wrong shape gives { source: "none" }, and does not throw', async () => {
  const paths = sessionFilePaths(join(base, 'sessions'), 's-wrong-shape');
  mkdirSync(paths.dir, { recursive: true });
  // `usd` must be a non-negative number; here it is a string.
  writeFileSync(paths.spend, JSON.stringify({ source: 'engine', usd: 'a lot' }));
  assert.deepEqual(await readSessionSpend(paths), { source: 'none' });

  const noSource = sessionFilePaths(join(base, 'sessions'), 's-no-source');
  mkdirSync(noSource.dir, { recursive: true });
  writeFileSync(noSource.spend, JSON.stringify({ usd: 1 }));
  assert.deepEqual(await readSessionSpend(noSource), { source: 'none' });
});

// --- The spend adapter itself, run as Claude Code would run it: a Stop hook's JSON on
// standard input, and --out naming where to write. It always exits 0. ---

function spendPaths(name: string): SessionFilePaths {
  const paths = sessionFilePaths(join(base, 'sessions'), name);
  mkdirSync(paths.hooksDir, { recursive: true });
  writeFileSync(paths.spendHook, SPEND_ADAPTER);
  return paths;
}

function runSpendAdapter(
  paths: SessionFilePaths,
  input: string,
): { status: number | null; stdout: string; stderr: string } {
  const done = spawnSync(
    python,
    [paths.spendHook, '--out', paths.spend, '--adapter-seconds', '8'],
    { input, encoding: 'utf8', timeout: 15_000 },
  );
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

test('a transcript that holds a readable cost: the adapter writes spend.json and exits 0', () => {
  const paths = spendPaths('s-adapter-good');
  const transcript = join(base, 'transcript-good.jsonl');
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-opus-4-1',
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
            cost_usd: 0.01,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-4-1', usage: { input_tokens: 20, output_tokens: 5 } },
      }),
      '',
    ].join('\n'),
  );
  const result = runSpendAdapter(
    paths,
    JSON.stringify({ session_id: 'x', transcript_path: transcript }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(paths.spend));
  const written = JSON.parse(readFileSync(paths.spend, 'utf8')) as {
    source: string;
    usd?: number;
    tokens?: Record<string, number>;
    model?: string;
  };
  assert.equal(written.source, 'engine');
  assert.equal(written.usd, 0.01);
  assert.deepEqual(written.tokens, { input: 120, output: 45, cacheRead: 10, cacheWrite: 5 });
  assert.equal(written.model, 'claude-opus-4-1');
});

test('a transcript that holds nothing usable: the adapter writes nothing and exits 0', () => {
  const paths = spendPaths('s-adapter-nothing');
  const transcript = join(base, 'transcript-nothing.jsonl');
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-1' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-1', usage: {} } }),
      'not even json',
      '',
    ].join('\n'),
  );
  const result = runSpendAdapter(
    paths,
    JSON.stringify({ session_id: 'x', transcript_path: transcript }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(paths.spend), false);
});

test('a missing transcript file: the adapter writes nothing and exits 0', () => {
  const paths = spendPaths('s-adapter-missing-transcript');
  const result = runSpendAdapter(
    paths,
    JSON.stringify({ session_id: 'x', transcript_path: join(base, 'nowhere', 'gone.jsonl') }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(paths.spend), false);
});

test('a malformed hook input (not JSON, or JSON with no transcript_path): the adapter writes nothing and exits 0', () => {
  const notJson = spendPaths('s-adapter-not-json');
  let result = runSpendAdapter(notJson, 'this is not json at all');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(notJson.spend), false);

  const noPath = spendPaths('s-adapter-no-path');
  result = runSpendAdapter(noPath, JSON.stringify({ session_id: 'x' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(noPath.spend), false);

  const emptyInput = spendPaths('s-adapter-empty');
  result = runSpendAdapter(emptyInput, '');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(emptyInput.spend), false);
});
