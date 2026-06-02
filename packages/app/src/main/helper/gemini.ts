/**
 * The Gemini helper engine (AI Helper, CR7) — the headless counterpart to the
 * Claude {@link ./manager.ts}. The CR7 Phase-0 spike proved Gemini is *simpler*
 * than Claude: its headless `-p` mode runs on the user's OAuth login (no API
 * key, no setup-token, no separate credit pool — the blocker that forces Claude
 * into an interactive PTY), and `-o json` returns the answer on stdout. So a
 * Gemini turn is **one process**: `gemini -p <prompt> --admin-policy <deny> -o
 * json` → read `response`. Turn-complete = process exit. No PTY, no Stop hook,
 * no transcript parsing, no middleman.
 *
 * **Read-only guard.** NOT `--approval-mode plan` — the spike showed Gemini
 * calls `exit_plan_mode` itself in headless mode and then writes (the CR5
 * plan-mode lesson, harder). Instead a temp `--admin-policy` TOML in the
 * **default** approval mode: a `deny` rule on the mutation + network-egress
 * tools, which the Policy Engine *excludes from the model's memory entirely*.
 * See [`blueprint/contracts/helper-read-only.contract.md`].
 *
 * This engine emits the same {@link HelperEventPayload} phases as Claude
 * (Channel C unchanged), minus `ptyId` — there is no visible terminal (the
 * "watch the session" affordance is Claude-only; HL 2026-06-02 "easiest win").
 * Pure builders + a DI'd `run` keep it exercisable headlessly with fakes.
 */

import type { HelperEventPayload, HelperPhase } from '../../shared/ipc.js';
import type { HelperEngine } from './engine.js';

/**
 * The model the Gemini helper launches with when the engine has no configured
 * `helperModel` (CR7) — the analogue of Claude's `haiku` default. A *stable,
 * fast* tier for read-only Q&A: the CLI's bare default resolves to a preview
 * model (`gemini-3-flash`) that proved flaky; `gemini-2.5-flash` answers in a
 * few seconds and is GA. A later CR makes this user-configurable.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Mutation tools denied to the read-only helper — `deny` excludes them from
 *  the model's memory (Policy Engine). */
const DENY_MUTATION_TOOLS = ['write_file', 'replace', 'run_shell_command'] as const;
/** Network-egress tools denied — closes the exfiltration path for
 *  prompt-injection-from-project-content (the CR5 containment lesson). */
const DENY_EGRESS_TOOLS = ['web_fetch', 'google_web_search'] as const;

/** The read-only admin-policy TOML handed to `gemini --admin-policy`. Pure so
 *  the shape is assertable without spawning — this is the read-only guarantee
 *  for Gemini, the analogue of Claude's deny-writes `settingsJson`. */
export function readOnlyPolicyToml(): string {
  const list = (tools: readonly string[]): string => tools.map((t) => `"${t}"`).join(', ');
  return `# AI-Lore helper read-only admin policy — generated, do not edit.
# 'deny' excludes these tools from the model's memory entirely (Policy Engine).
[[rule]]
toolName = [${list(DENY_MUTATION_TOOLS)}]
decision = "deny"
priority = 900
denyMessage = "Read-only helper: mutations are disabled."

[[rule]]
toolName = [${list(DENY_EGRESS_TOOLS)}]
decision = "deny"
priority = 900
denyMessage = "Read-only helper: network egress is disabled."
`;
}

/**
 * The `gemini` argv for one read-only headless turn. `default` approval mode
 * (explicit — NOT `plan`, which the spike proved unsafe headless) + the
 * out-of-tree `--admin-policy` deny + JSON output. `--skip-trust` mirrors
 * Claude running in the already-trusted project cwd. Pure + the read-only flags
 * are the security-critical part, so they're asserted in tests.
 */
export function geminiLaunchArgs(opts: {
  prompt: string;
  policyPath: string;
  model?: string;
}): string[] {
  const args = [
    '-p',
    opts.prompt,
    '--approval-mode',
    'default',
    '--admin-policy',
    opts.policyPath,
    '-o',
    'json',
    '--skip-trust',
  ];
  if (opts.model) args.push('--model', opts.model);
  return args;
}

/** Extract the assistant answer from `gemini -o json` stdout. The happy path is
 *  a single JSON object with a `response` string; we tolerate leading noise by
 *  falling back to the last `{…}` block. */
export function parseGeminiResult(stdout: string): { answer: string } | { error: string } {
  const tryParse = (s: string): { answer: string } | { error: string } | null => {
    try {
      const d = JSON.parse(s) as { response?: unknown; error?: { code?: unknown } };
      if (typeof d.response === 'string') return { answer: d.response };
      // Gemini sometimes reports a backend failure as a JSON `error` (rather
      // than on stderr) — surface it instead of a generic "no answer".
      if (d.error) {
        const code = typeof d.error.code === 'number' ? ` ${d.error.code}` : '';
        return { error: `The engine returned an error${code}.` };
      }
    } catch {
      // not JSON
    }
    return null;
  };
  const direct = tryParse(stdout.trim());
  if (direct) return direct;
  // Fallback: last top-level object in the stream.
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(stdout.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return { error: 'Could not read the assistant’s answer from Gemini output.' };
}

/** What one Gemini turn needs from the window/project: the engine binary to run
 *  (from the resolved `EngineEntry`), the cwd it runs in (the project root,
 *  where it reads from), and the model to launch with. The per-engine
 *  equivalent of Claude's PTY {@link HelperHost}. */
export type GeminiHost = {
  /** The engine binary — `gemini`, or an absolute path from its `EngineEntry`. */
  binary: string;
  /** The project root — `gemini` runs here and reads project files from it. */
  cwd: string;
  /** The model to launch with, from the resolved engine's `helperModel`. */
  model?: string;
};

export type GeminiHelperDeps = {
  /** Run the engine `binary` headless in `cwd`; resolve its stdout. Rejects on
   *  spawn failure / non-zero exit — ideally with a useful message (the engine
   *  error). DI'd so tests never spawn. */
  run: (binary: string, args: string[], cwd: string) => Promise<string>;
  /** Materialise the read-only policy TOML into a fresh temp dir. */
  materializePolicy: () => { dir: string; policyPath: string };
  /** Remove a materialised temp dir on teardown. */
  cleanup: (dir: string) => void;
  /** Emit a helper event to the window that owns the session. */
  emit: (winId: number, event: HelperEventPayload) => void;
  /** Mint a random id (UUID in production) — the per-window session id. */
  newId: () => string;
  /** How long to wait for a turn before giving up (default 120s). Without it a
   *  hung/slow engine (or a backend outage) leaves the panel on "thinking…"
   *  indefinitely. */
  turnTimeoutMs?: number;
};

/** Sentinel rejection used by the turn timeout. */
const TIMEOUT = Symbol('gemini-turn-timeout');

/** Reject after `ms` so a stuck turn surfaces an error instead of hanging. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(TIMEOUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** A short, human error line for a failed turn — the timeout, or the engine's
 *  own message (e.g. "Gemini error 500") when `run` rejected with one. */
function turnErrorMessage(err: unknown): string {
  if (err === TIMEOUT) return 'The assistant timed out — the engine did not respond in time.';
  const msg = err instanceof Error ? err.message.trim() : '';
  return msg ? `The assistant failed: ${msg}`.slice(0, 200) : 'The assistant failed to answer.';
}

type GeminiSession = {
  sessionId: string;
  dir: string;
  policyPath: string;
  /** True while a turn is in flight (serialization gate). */
  busy: boolean;
};

/** Build the Gemini helper engine. Conforms to {@link HelperEngine} so the IPC
 *  layer drives it exactly like the Claude manager (same Channel-C events). */
export function createGeminiHelper(deps: GeminiHelperDeps): HelperEngine<GeminiHost> {
  const byWindow = new Map<number, GeminiSession>();
  const turnTimeoutMs = deps.turnTimeoutMs ?? 120_000;

  function emit(
    winId: number,
    sessionId: string,
    phase: HelperPhase,
    extra?: Partial<HelperEventPayload>,
  ): void {
    deps.emit(winId, { sessionId, phase, ...extra });
  }

  function ensure(winId: number): GeminiSession {
    const existing = byWindow.get(winId);
    if (existing) return existing;
    const { dir, policyPath } = deps.materializePolicy();
    const session: GeminiSession = { sessionId: deps.newId(), dir, policyPath, busy: false };
    byWindow.set(winId, session);
    return session;
  }

  async function connect(winId: number, _host: GeminiHost): Promise<void> {
    const session = ensure(winId);
    // No persistent process to boot — a headless engine is ready at once. Emit
    // connecting→ready so the panel enables its controls, same as Claude.
    emit(winId, session.sessionId, 'connecting');
    emit(winId, session.sessionId, 'ready');
  }

  async function submit(winId: number, host: GeminiHost, prompt: string): Promise<void> {
    const session = ensure(winId);
    if (session.busy) return; // serialize: one turn in flight per window
    session.busy = true;
    emit(winId, session.sessionId, 'thinking');
    try {
      const args = geminiLaunchArgs({ prompt, policyPath: session.policyPath, model: host.model });
      const stdout = await withTimeout(deps.run(host.binary, args, host.cwd), turnTimeoutMs);
      if (!byWindow.has(winId)) return; // torn down mid-turn
      const result = parseGeminiResult(stdout);
      if ('answer' in result) {
        emit(winId, session.sessionId, 'answered', { answer: result.answer });
      } else {
        emit(winId, session.sessionId, 'error', { error: result.error });
      }
    } catch (err) {
      if (byWindow.has(winId)) {
        emit(winId, session.sessionId, 'error', { error: turnErrorMessage(err) });
      }
    } finally {
      const s = byWindow.get(winId);
      if (s) s.busy = false;
    }
  }

  function disposeForWindow(winId: number): void {
    const session = byWindow.get(winId);
    if (!session) return;
    byWindow.delete(winId);
    deps.cleanup(session.dir);
  }

  async function disposeAll(): Promise<void> {
    for (const winId of [...byWindow.keys()]) disposeForWindow(winId);
  }

  return { id: 'gemini', hasVisibleSession: false, connect, submit, disposeForWindow, disposeAll };
}
