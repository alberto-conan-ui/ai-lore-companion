import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type HelperHost,
  type HelperManagerDeps,
  createHelperManager,
} from '../../src/main/helper/manager.js';
import type { MiddlemanSession } from '../../src/main/helper/middleman.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

/** Flush pending micro/macro-tasks (the manager's CR submit + awaits). */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const PROMPT = 'Read status.index.md and summarize what is pending.';

/** A fully-faked manager + host: a stub middleman that hands the registered
 *  session back to the test, a recording PTY host (the window's terminal
 *  service stand-in), and captured emits / materialise / cleanup. */
function makeManager(over: Partial<HelperManagerDeps> = {}) {
  let registered: MiddlemanSession | undefined;
  const unregistered: string[] = [];
  const materializeArgs: { sessionId: string; token: string; port: number }[] = [];
  const spawnSettings: string[] = [];
  const writes: string[] = [];
  const kills: number[] = [];
  const cleaned: string[] = [];
  const events: HelperEventPayload[] = [];
  let idN = 0;

  // The per-window host the IPC layer builds from the terminal service. Spawn
  // returns a visible-PTY handle with a fixed id.
  const host: HelperHost = {
    spawn: (settingsPath) => {
      spawnSettings.push(settingsPath);
      return { id: 'pty-1', write: (d) => writes.push(d), kill: () => kills.push(1) };
    },
  };

  const deps: HelperManagerDeps = {
    middleman: {
      listen: async () => 4321,
      port: () => 4321,
      register: (s) => {
        registered = s;
      },
      unregister: (id) => {
        unregistered.push(id);
      },
      close: async () => {},
    },
    materialize: (w) => {
      materializeArgs.push(w);
      return {
        dir: `/tmp/helper-${w.sessionId}`,
        settingsPath: `/tmp/helper-${w.sessionId}/settings.json`,
      };
    },
    cleanup: (dir) => cleaned.push(dir),
    emit: (_winId, event) => events.push(event),
    newId: () => `id${idN++}`,
    submitDelayMs: 0,
    readySettleMs: 0,
    // Short timeouts so a test that intentionally leaves a turn/connect pending
    // never holds a long timer open at suite end.
    readyTimeoutMs: 1000,
    resultTimeoutMs: 1000,
    ...over,
  };

  const mgr = createHelperManager(deps);
  return {
    mgr,
    host,
    get registered() {
      return registered;
    },
    unregistered,
    materializeArgs,
    spawnSettings,
    writes,
    kills,
    cleaned,
    events,
    phases: () => events.map((e) => e.phase),
  };
}

test('submit connects, materialises read-only settings, spawns visibly, and emits connecting with the ptyId', async () => {
  const h = makeManager();
  void h.mgr.submit(1, h.host, PROMPT);
  await tick();

  // Materialise got the port + a sessionId/token pair (distinct ids).
  assert.equal(h.materializeArgs.length, 1);
  assert.equal(h.materializeArgs[0]?.port, 4321);
  assert.notEqual(h.materializeArgs[0]?.sessionId, h.materializeArgs[0]?.token);
  // Spawned the visible PTY against the materialised settings file.
  assert.deepEqual(h.spawnSettings, ['/tmp/helper-id0/settings.json']);
  // The connecting event carries the helper's PTY id for the renderer to bind.
  const connecting = h.events.find((e) => e.phase === 'connecting');
  assert.equal(connecting?.ptyId, 'pty-1');
  h.mgr.disposeForWindow(1); // clear the pending connect timer
});

test('the full happy path: connecting → ready → thinking → answered; the prompt is injected then submitted', async () => {
  const h = makeManager();
  const askP = h.mgr.submit(1, h.host, PROMPT);
  await tick();

  h.registered?.onStarted();
  await tick();

  // The caller-built prompt was injected, then a bare CR submitted the turn.
  assert.deepEqual(h.writes, [PROMPT, '\r']);

  h.registered?.onResult('Pending: CR4 is being built.');
  await askP;

  assert.deepEqual(h.phases(), ['connecting', 'ready', 'thinking', 'answered']);
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'answered');
  assert.equal(last?.answer, 'Pending: CR4 is being built.');
});

test('a second submit while a turn is in flight is ignored (serialized)', async () => {
  const h = makeManager();
  void h.mgr.submit(1, h.host, PROMPT);
  await tick();
  h.registered?.onStarted();
  await tick();
  const writesAfterFirst = h.writes.length;

  // Second submit while pending — no new prompt is injected.
  void h.mgr.submit(1, h.host, 'another question');
  await tick();
  assert.equal(h.writes.length, writesAfterFirst);
  h.mgr.disposeForWindow(1); // clear the first turn's pending timer
});

test('a second connect reuses the existing session (one PTY per window)', async () => {
  const h = makeManager();
  void h.mgr.connect(1, h.host);
  await tick();
  h.registered?.onStarted();
  await tick();

  await h.mgr.connect(1, h.host); // already ready — must not spawn again
  assert.equal(h.spawnSettings.length, 1);
  h.mgr.disposeForWindow(1);
});

test('disposeForWindow unregisters, kills the PTY, and drops the temp dir', async () => {
  const h = makeManager();
  const askP = h.mgr.submit(1, h.host, PROMPT);
  await tick();
  h.registered?.onStarted();
  await tick();
  h.registered?.onResult('done');
  await askP;

  h.mgr.disposeForWindow(1);
  assert.deepEqual(h.unregistered, ['id0']);
  assert.equal(h.kills.length, 1);
  assert.deepEqual(h.cleaned, ['/tmp/helper-id0']);
});

test('a ready timeout surfaces an error phase', async () => {
  const h = makeManager({ readyTimeoutMs: 10 });
  void h.mgr.connect(1, h.host);
  await new Promise((r) => setTimeout(r, 30));
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
});

test('a result timeout surfaces an error phase', async () => {
  const h = makeManager({ resultTimeoutMs: 10 });
  void h.mgr.submit(1, h.host, PROMPT);
  await tick();
  h.registered?.onStarted();
  await new Promise((r) => setTimeout(r, 30));
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
});
