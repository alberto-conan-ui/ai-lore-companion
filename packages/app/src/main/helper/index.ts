/**
 * Production wiring for the helper (AI Helper) — the app-level singleton that
 * binds the platform-neutral {@link createHelperManager} to real machinery: an
 * on-disk temp dir for the deny-writes settings + hooks, Electron `webContents`
 * egress (Channel C), and the one shared middleman HTTP ingress (Channel B).
 *
 * The helper **PTY** is *not* spawned here — CR2 spawns it through the window's
 * terminal `PtyService` so its output streams to the renderer and an xterm can
 * bind to it. That window-specific capability is built in
 * [`../ipc/helper.ts`](../ipc/helper.ts) and passed to the manager as a host.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { CHANNELS, type HelperEventPayload, type HelperReportPayload } from '../../shared/ipc.js';
import type { HelperEngine } from './engine.js';
import { type GeminiHost, createGeminiHelper, readOnlyPolicyToml } from './gemini.js';
import { mcpConfigJson, sessionStartScript, settingsJson, stopScript } from './hooks.js';
import { type HelperManager, createHelperManager } from './manager.js';
import { type McpHost, createMcpHost } from './mcp-host.js';
import { createMiddleman } from './middleman.js';

/** Write the deny-writes `--settings`, the two hook scripts, and the CR10
 *  `--mcp-config` into a fresh temp dir; returns the dir + the paths to pass to
 *  `claude`. All out-of-tree — never the user's `.claude/`. */
function materialize(w: { sessionId: string; token: string; port: number; mcpUrl: string }): {
  dir: string;
  settingsPath: string;
  mcpConfigPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lore-helper-'));
  const sessionStartPath = join(dir, 'session-start-hook.mjs');
  const stopPath = join(dir, 'stop-hook.mjs');
  const settingsPath = join(dir, 'settings.json');
  const mcpConfigPath = join(dir, 'mcp.json');
  writeFileSync(sessionStartPath, sessionStartScript(w));
  writeFileSync(stopPath, stopScript(w));
  writeFileSync(
    settingsPath,
    settingsJson({ sessionStartScript: sessionStartPath, stopScript: stopPath }),
  );
  writeFileSync(mcpConfigPath, mcpConfigJson({ url: w.mcpUrl, token: w.token }));
  return { dir, settingsPath, mcpConfigPath };
}

/** Send a structured report (an MCP tool call, CR10) to the window. */
function emitReport(winId: number, report: HelperReportPayload): void {
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.onHelperReport, report);
}

/** Send a helper event to the window that owns the session. */
function emit(winId: number, event: HelperEventPayload): void {
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.onHelperEvent, event);
}

let mcp: McpHost | null = null;

/** The app-wide MCP host (AI Helper, CR10) — the structured egress the
 *  read-only helper reports through. Built on first use; bound by
 *  {@link startMcpHost} at app boot. */
export function mcpHost(): McpHost {
  if (mcp) return mcp;
  mcp = createMcpHost();
  return mcp;
}

/** Bind the MCP host at app boot so the local server is up before any Connect —
 *  "provide an MCP locally as soon as you start up" (HL, 2026-06-03). A bind
 *  failure is logged, not fatal: the host is only exercised once a session
 *  reports, and the rest of the app must still launch. */
export async function startMcpHost(): Promise<void> {
  try {
    const port = await mcpHost().listen();
    console.log('[helper] MCP host listening on 127.0.0.1:%d', port);
  } catch (e) {
    console.error('[helper] MCP host failed to bind:', (e as Error).message);
  }
}

let manager: HelperManager | null = null;

/** The app-wide Claude helper manager, built on first use. */
export function helperManager(): HelperManager {
  if (manager) return manager;
  manager = createHelperManager({
    middleman: createMiddleman(),
    mcpHost: mcpHost(),
    materialize,
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
    emit,
    emitReport,
    newId: () => randomUUID(),
  });
  return manager;
}

// --- Gemini helper (CR7) — headless, no PTY/hooks/middleman -----------------

const LOGIN_SHELL = process.env.SHELL ?? '/bin/zsh';

/** Quote a token for the login-shell `-c` payload (mirror of `pty.ts`). */
function shellQuote(token: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** Pull a short error line out of `gemini`'s stderr/stdout when a run fails —
 *  the CLI reports backend failures as a JSON `{ error: { code, message } }`,
 *  on stderr in headless mode. Returns e.g. "Gemini error 500", or null. */
function geminiErrorMessage(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { error?: { code?: unknown } };
    if (obj.error) {
      const code = typeof obj.error.code === 'number' ? ` ${obj.error.code}` : '';
      return `Gemini error${code}`;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Run `gemini` headless through the user's login shell — the same PATH source
 *  the PTY engine spawn uses, so a bare `gemini` resolves the way the user's
 *  terminal would. The interactive shell prints job-control noise to stderr;
 *  the `-o json` answer comes back clean on stdout. A non-zero exit with no
 *  stdout is a real failure — reject with the engine's own error (off stderr)
 *  so the panel can show *why*, not a generic message. A generous 10-minute hard
 *  timeout kills a genuinely hung process without cutting off the dashboard crawl
 *  (a whole-lore read can run minutes on a strong model — trip 2026-06-03). */
function runGeminiOnce(binary: string, args: string[], cwd: string): Promise<string> {
  const cmd = [binary, ...args].map(shellQuote).join(' ');
  return new Promise((resolve, reject) => {
    execFile(
      LOGIN_SHELL,
      ['-i', '-l', '-c', cmd],
      { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 600_000 },
      (err, stdout, stderr) => {
        // A normal answer comes on stdout (exit 0); let the parser judge it.
        console.log(
          '[helper] gemini returned',
          stdout?.length ?? 0,
          'bytes',
          err ? `(err: ${err.message.slice(0, 80)})` : '',
          stdout?.trim() ? `head: ${stdout.trim().slice(0, 80).replace(/\n/g, ' ')}` : '(empty)',
        );
        if (stdout?.trim()) return resolve(stdout);
        if (err) return reject(new Error(geminiErrorMessage(stderr ?? '') ?? err.message));
        resolve(stdout); // exit 0 with empty stdout — the cheap-model flake
      },
    );
  });
}

/** Run `gemini`, retrying the known cheap-model flake: gemini-flash occasionally
 *  returns an **empty** reply (or a transient error) on exit 0. Up to 3 attempts
 *  before letting the empty result fall through to the parser's error. */
async function runGemini(binary: string, args: string[], cwd: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = await runGeminiOnce(binary, args, cwd);
      if (out.trim()) return out;
      console.log('[helper] gemini empty reply — retry', attempt, 'of 3');
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(
        '[helper] gemini error — retry',
        attempt,
        'of 3:',
        (e as Error).message.slice(0, 60),
      );
    }
  }
  return ''; // all attempts empty → the parser surfaces a read error
}

/** Materialise the read-only admin-policy TOML into a fresh temp dir — never the
 *  user's `~/.gemini/`. */
function materializePolicy(): { dir: string; policyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lore-helper-gemini-'));
  const policyPath = join(dir, 'readonly.policy.toml');
  writeFileSync(policyPath, readOnlyPolicyToml());
  return { dir, policyPath };
}

let gemini: HelperEngine<GeminiHost> | null = null;

/** The app-wide Gemini helper engine, built on first use. */
export function geminiHelperManager(): HelperEngine<GeminiHost> {
  if (gemini) return gemini;
  gemini = createGeminiHelper({
    run: runGemini,
    materializePolicy,
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
    emit,
    newId: () => randomUUID(),
  });
  return gemini;
}

/** Tear down a window's helper across both engines (called from the window
 *  teardown). No-op for an engine that never owned the window. */
export function disposeHelperForWindow(winId: number): void {
  manager?.disposeForWindow(winId);
  gemini?.disposeForWindow(winId);
}

/** Tear down every helper and close the middleman + MCP host (called on quit). */
export async function disposeAllHelpers(): Promise<void> {
  if (manager) await manager.disposeAll();
  if (gemini) await gemini.disposeAll();
  if (mcp) await mcp.close();
}
