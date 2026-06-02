/**
 * The helper session manager (AI Helper) — the app-level brain that turns a
 * renderer request into a driven, read-only `claude` turn and an answer.
 *
 * One helper session per window. The manager owns the protocol's three
 * channels:
 *   - **A (app → session):** inject the prompt, wait, then submit a carriage
 *     return — the one unsupported, swappable leg, isolated in `submit`.
 *   - **B (session → app):** registered with the {@link Middleman}; the hooks'
 *     POSTs land as `onStarted` / `onResult` callbacks here.
 *   - **C (app → renderer):** every state change is emitted as a helper event.
 *
 * Turns are **serialized** — one in flight per session; a second `ask` while a
 * turn is pending is ignored (the panel's action buttons are disabled then).
 *
 * CR2 makes the session **visible**: the PTY is spawned through the window's
 * terminal service (so its output streams to the renderer and an xterm binds to
 * its `id`) rather than a hidden process. The window-specific PTY capabilities
 * come in as a per-call {@link HelperHost}, so the manager itself stays
 * **electron-free and PTY-free** — the whole flow (connect, ready, ask, result,
 * teardown) is exercised headlessly with fakes. Production wiring lives in
 * [`./index.ts`](./index.ts); the host is built in [`../ipc/helper.ts`](../ipc/helper.ts).
 */

import type { HelperEventPayload, HelperPhase } from '../../shared/ipc.js';
import type { Middleman } from './middleman.js';

/** A spawned read-only helper PTY — its visible-terminal id plus the leg the
 *  manager drives. `id` is what the renderer binds an xterm to. */
export type HelperPtyHandle = {
  /** The PTY id (the renderer's xterm binds to this over the terminal channels). */
  id: string;
  /** Write raw bytes to the PTY's stdin (Channel A injection). */
  write: (data: string) => void;
  /** Terminate the PTY. */
  kill: () => void;
};

/** The per-window PTY capability `connect` needs — spawns the read-only helper
 *  against the materialised `--settings` file and returns its visible handle.
 *  Built by the IPC layer from the window's terminal service. */
export type HelperHost = {
  spawn: (settingsPath: string) => HelperPtyHandle;
};

export type HelperManagerDeps = {
  middleman: Middleman;
  /** Materialise the deny-writes `--settings` + hooks into a fresh temp dir. */
  materialize: (w: { sessionId: string; token: string; port: number }) => {
    dir: string;
    settingsPath: string;
  };
  /** Remove a materialised temp dir on teardown. */
  cleanup: (dir: string) => void;
  /** Emit a helper event to the window that owns the session. */
  emit: (winId: number, event: HelperEventPayload) => void;
  /** Mint a random id / token (UUID in production). */
  newId: () => string;
  /** Delay between injecting the prompt and submitting the turn (Channel A).
   *  Defaults to 400ms — the spike's working value. */
  submitDelayMs?: number;
  /** Settle delay after `ready` before the first turn is allowed. Default 0. */
  readySettleMs?: number;
  /** How long to wait for the SessionStart signal before giving up. */
  readyTimeoutMs?: number;
  /** How long to wait for a turn's result before giving up. */
  resultTimeoutMs?: number;
};

export type HelperManager = {
  /** Engine id — Claude (the {@link HelperEngine} seam, CR7). */
  readonly id: 'claude';
  /** Claude hosts a visible PTY session the panel binds an xterm to (CR2). */
  readonly hasVisibleSession: true;
  /** Ensure the window's helper is connected; resolves once it is `ready`. The
   *  `host` supplies the window's PTY spawn (used only on a fresh connect). */
  connect: (winId: number, host: HelperHost) => Promise<void>;
  /** Connect if needed, then drive one read-only turn with `prompt`. The prompt
   *  is built by the caller (the IPC layer, which holds the project context) —
   *  canned actions and free-text questions share this one path. */
  submit: (winId: number, host: HelperHost, prompt: string) => Promise<void>;
  /** Tear down the window's helper — kill the PTY, drop the temp dir. */
  disposeForWindow: (winId: number) => void;
  /** Tear down every helper and close the middleman. */
  disposeAll: () => Promise<void>;
};

type Session = {
  sessionId: string;
  token: string;
  winId: number;
  proc: HelperPtyHandle;
  dir: string;
  phase: HelperPhase;
  /** Resolves when the session settles — `ready` on the SessionStart hook, or
   *  on a ready timeout (which also flips the phase to `error`). Always
   *  resolves, never rejects: failures travel over the event channel, so a
   *  caller awaiting it never has to catch. */
  ready: { promise: Promise<void>; resolve: () => void };
  /** Set while a turn is in flight (serialization gate). */
  pending: { resolve: () => void; timer: ReturnType<typeof setTimeout> } | null;
  /** Pending ready-timeout, cleared once ready (or torn down). */
  readyTimer: ReturnType<typeof setTimeout> | null;
};

function deferred(): Session['ready'] {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createHelperManager(deps: HelperManagerDeps): HelperManager {
  const submitDelayMs = deps.submitDelayMs ?? 400;
  const readySettleMs = deps.readySettleMs ?? 0;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 30_000;
  const resultTimeoutMs = deps.resultTimeoutMs ?? 120_000;

  const sessions = new Map<string, Session>();
  const byWindow = new Map<number, string>();

  function setPhase(
    session: Session,
    phase: HelperPhase,
    extra?: Partial<HelperEventPayload>,
  ): void {
    session.phase = phase;
    deps.emit(session.winId, { sessionId: session.sessionId, phase, ...extra });
  }

  async function connect(winId: number, host: HelperHost): Promise<void> {
    const existing = byWindow.get(winId);
    if (existing) {
      const session = sessions.get(existing);
      if (session) return session.ready.promise;
    }

    const port = await deps.middleman.listen();
    const sessionId = deps.newId();
    const token = deps.newId();
    const { dir, settingsPath } = deps.materialize({ sessionId, token, port });

    const ready = deferred();
    const session: Session = {
      sessionId,
      token,
      winId,
      proc: undefined as unknown as HelperPtyHandle, // set just below, before any await
      dir,
      phase: 'connecting',
      ready,
      pending: null,
      readyTimer: null,
    };
    sessions.set(sessionId, session);
    byWindow.set(winId, sessionId);

    deps.middleman.register({
      sessionId,
      token,
      onStarted: () => {
        const s = sessions.get(sessionId);
        if (!s || s.phase !== 'connecting') return;
        if (s.readyTimer) clearTimeout(s.readyTimer);
        s.readyTimer = null;
        setPhase(s, 'ready');
        s.ready.resolve();
      },
      onResult: (answer) => {
        const s = sessions.get(sessionId);
        if (!s || !s.pending) return;
        clearTimeout(s.pending.timer);
        const resolve = s.pending.resolve;
        s.pending = null;
        setPhase(s, 'answered', { answer });
        resolve();
      },
    });

    // Spawn the visible PTY, then announce `connecting` carrying its id so the
    // renderer can bind an xterm to the booting session.
    session.proc = host.spawn(settingsPath);
    setPhase(session, 'connecting', { ptyId: session.proc.id });

    session.readyTimer = setTimeout(() => {
      const s = sessions.get(sessionId);
      if (!s || s.phase !== 'connecting') return;
      s.readyTimer = null;
      setPhase(s, 'error', { error: 'The assistant did not start in time.' });
      s.ready.resolve();
    }, readyTimeoutMs);

    return session.ready.promise;
  }

  async function submit(winId: number, host: HelperHost, prompt: string): Promise<void> {
    await connect(winId, host);
    const sessionId = byWindow.get(winId);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) return;
    // The connect settled into an error (e.g. ready timeout) — don't drive a
    // turn at a session that never came up.
    if (session.phase === 'error') return;
    // Serialize: one turn in flight per session.
    if (session.pending) return;
    if (readySettleMs) await delay(readySettleMs);
    if (!sessions.has(session.sessionId)) return; // torn down while settling

    setPhase(session, 'thinking');
    await new Promise<void>((resolve) => {
      session.pending = {
        resolve,
        timer: setTimeout(() => {
          const s = sessions.get(session.sessionId);
          if (!s || !s.pending) return;
          s.pending = null;
          setPhase(s, 'error', { error: 'The assistant timed out answering.' });
          resolve();
        }, resultTimeoutMs),
      };
      // Channel A — the unsupported inject-and-submit leg, isolated here: write
      // the prompt, wait, then a bare CR submits the turn.
      session.proc.write(prompt);
      void delay(submitDelayMs).then(() => {
        if (sessions.has(session.sessionId)) session.proc.write('\r');
      });
    });
  }

  function disposeForWindow(winId: number): void {
    const sessionId = byWindow.get(winId);
    if (!sessionId) return;
    byWindow.delete(winId);
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    deps.middleman.unregister(sessionId);
    if (session.readyTimer) clearTimeout(session.readyTimer);
    if (session.pending) clearTimeout(session.pending.timer);
    try {
      session.proc.kill();
    } catch {
      // Already exited — nothing to kill.
    }
    deps.cleanup(session.dir);
  }

  async function disposeAll(): Promise<void> {
    for (const winId of [...byWindow.keys()]) disposeForWindow(winId);
    await deps.middleman.close();
  }

  return { id: 'claude', hasVisibleSession: true, connect, submit, disposeForWindow, disposeAll };
}
