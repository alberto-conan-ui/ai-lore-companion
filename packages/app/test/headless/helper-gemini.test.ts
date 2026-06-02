import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type GeminiHelperDeps,
  type GeminiHost,
  createGeminiHelper,
  geminiLaunchArgs,
  parseGeminiResult,
  readOnlyPolicyToml,
} from '../../src/main/helper/gemini.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const PROMPT = 'Read status.index.md and summarize what is pending.';
const HOST: GeminiHost = { binary: 'gemini', cwd: '/proj', model: 'gemini-2.5-flash' };

// --- pure builders: the read-only guarantee in test form ---------------------

test('the read-only policy denies every mutation + network-egress tool', () => {
  const toml = readOnlyPolicyToml();
  for (const tool of [
    'write_file',
    'replace',
    'run_shell_command',
    'web_fetch',
    'google_web_search',
  ]) {
    assert.match(toml, new RegExp(`"${tool}"`), `${tool} must be in the policy`);
  }
  assert.match(toml, /decision = "deny"/);
  assert.doesNotMatch(toml, /decision = "(allow|ask_user)"/);
});

test('launch args use default approval mode (NOT plan) + the admin policy + json', () => {
  const args = geminiLaunchArgs({
    prompt: PROMPT,
    policyPath: '/tmp/p.toml',
    model: 'gemini-2.5-flash',
  });
  // The CR5/spike lesson: plan mode is unsafe headless (the model exits it and writes).
  const mode = args[args.indexOf('--approval-mode') + 1];
  assert.equal(mode, 'default');
  assert.ok(!args.includes('plan'), 'must not launch in plan mode');
  assert.equal(args[args.indexOf('--admin-policy') + 1], '/tmp/p.toml');
  assert.equal(args[args.indexOf('-o') + 1], 'json');
  assert.ok(args.includes('--skip-trust'));
  assert.equal(args[args.indexOf('-p') + 1], PROMPT);
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-2.5-flash');
});

test('launch args omit --model when no model is configured', () => {
  const args = geminiLaunchArgs({ prompt: PROMPT, policyPath: '/tmp/p.toml' });
  assert.ok(!args.includes('--model'));
});

test('parseGeminiResult reads the response field', () => {
  const r = parseGeminiResult(JSON.stringify({ session_id: 'x', response: 'all clear' }));
  assert.deepEqual(r, { answer: 'all clear' });
});

test('parseGeminiResult tolerates leading noise before the JSON', () => {
  const r = parseGeminiResult(`Ripgrep is not available.\n${JSON.stringify({ response: 'hi' })}`);
  assert.deepEqual(r, { answer: 'hi' });
});

test('parseGeminiResult errors on unparseable output', () => {
  const r = parseGeminiResult('not json at all');
  assert.ok('error' in r);
});

test('parseGeminiResult surfaces a JSON error field instead of "no answer"', () => {
  const r = parseGeminiResult(JSON.stringify({ session_id: 'x', error: { code: 500 } }));
  assert.ok('error' in r);
  assert.match((r as { error: string }).error, /500/);
});

// --- the headless manager ----------------------------------------------------

function makeGemini(over: Partial<GeminiHelperDeps> = {}) {
  const events: HelperEventPayload[] = [];
  const runArgs: { args: string[]; cwd: string }[] = [];
  const cleaned: string[] = [];
  let idN = 0;
  const deps: GeminiHelperDeps = {
    run: async (_binary, args, cwd) => {
      runArgs.push({ args, cwd });
      return JSON.stringify({ response: 'Pending: CR7 is being built.' });
    },
    materializePolicy: () => ({ dir: '/tmp/gem-0', policyPath: '/tmp/gem-0/readonly.policy.toml' }),
    cleanup: (dir) => cleaned.push(dir),
    emit: (_winId, event) => events.push(event),
    newId: () => `gid${idN++}`,
    ...over,
  };
  return {
    helper: createGeminiHelper(deps),
    events,
    runArgs,
    cleaned,
    phases: () => events.map((e) => e.phase),
  };
}

test('connect emits connecting → ready (headless is ready at once)', async () => {
  const h = makeGemini();
  await h.helper.connect(1, HOST);
  assert.deepEqual(h.phases(), ['connecting', 'ready']);
});

test('the engine advertises itself: id gemini, no visible session', () => {
  const h = makeGemini();
  assert.equal(h.helper.id, 'gemini');
  assert.equal(h.helper.hasVisibleSession, false);
});

test('submit runs gemini in the project cwd and emits thinking → answered with the parsed response', async () => {
  const h = makeGemini();
  await h.helper.submit(1, HOST, PROMPT);
  assert.equal(h.runArgs.length, 1);
  assert.equal(h.runArgs[0]?.cwd, '/proj');
  assert.ok(h.runArgs[0]?.args.includes('--admin-policy'));
  assert.deepEqual(h.phases(), ['thinking', 'answered']);
  assert.equal(h.events.at(-1)?.answer, 'Pending: CR7 is being built.');
  // No visible terminal → never emits a ptyId.
  assert.ok(h.events.every((e) => e.ptyId === undefined));
});

test('a run failure surfaces an error phase carrying the engine reason', async () => {
  const h = makeGemini({
    run: async () => {
      throw new Error('Gemini error 500');
    },
  });
  await h.helper.submit(1, HOST, PROMPT);
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
  assert.match(last?.error ?? '', /Gemini error 500/);
});

test('a turn that never returns times out into an error (no infinite "thinking")', async () => {
  const h = makeGemini({
    run: () => new Promise<string>(() => {}), // never resolves
    turnTimeoutMs: 20,
  });
  await h.helper.submit(1, HOST, PROMPT);
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
  assert.match(last?.error ?? '', /timed out/i);
});

test('a second submit while a turn is in flight is ignored (serialized)', async () => {
  let resolveRun!: (s: string) => void;
  let runs = 0;
  const h = makeGemini({
    run: () => {
      runs++;
      return new Promise<string>((res) => {
        resolveRun = res;
      });
    },
  });
  void h.helper.submit(1, HOST, PROMPT);
  await tick();
  void h.helper.submit(1, HOST, 'another'); // in flight — ignored
  await tick();
  assert.equal(runs, 1);
  resolveRun(JSON.stringify({ response: 'done' }));
  await tick();
});

test('disposeForWindow drops the materialised policy temp dir', async () => {
  const h = makeGemini();
  await h.helper.connect(1, HOST);
  h.helper.disposeForWindow(1);
  assert.deepEqual(h.cleaned, ['/tmp/gem-0']);
});
