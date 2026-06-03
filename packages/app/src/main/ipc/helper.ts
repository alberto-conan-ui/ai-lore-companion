import { join } from 'node:path';
import { isChainError } from '@ai-lore-companion/core';
import { BrowserWindow } from 'electron';
import type { HelperAction } from '../../shared/ipc.js';
import { loadEngines, loadHelperEngine, saveHelperEngine } from '../engines.js';
import { type HelperSubmitOpts, pickHelperEngine } from '../helper/engine.js';
import type { GeminiHost } from '../helper/gemini.js';
import { helperLaunchArgs, promptFor } from '../helper/hooks.js';
import { disposeHelperForWindow, geminiHelperManager, helperManager } from '../helper/index.js';
import type { HelperHost } from '../helper/manager.js';
import type { Deps, ProjectContext, RegisterModule } from './types.js';

/**
 * The model the Claude helper runs on. The dashboard crawl's job is now
 * **surfacing, not polishing** — a cheap, fast read that lists everything raw,
 * which the human then cleans up in the UI (Humanize / Consolidate). The spike
 * (2026-06-03) proved a cheap model + a "surface everything, don't reason"
 * prompt beats an expensive model + a complex prompt on completeness (Haiku
 * went 0 → 11 loose-ends once we stopped asking it to reason). So Haiku, not
 * Opus — quality of wording is the UI's job, not the model's. `haiku` is the
 * CLI alias for the latest Haiku.
 */
const HELPER_MODEL = 'haiku';

/**
 * The model the Gemini helper runs on. Same logic — surface, don't polish. With
 * the simple prompt the cheapest Gemini was the *most* complete (13 loose-ends,
 * ~26s). It can flake (an occasional empty reply), so a retry is owed. A model
 * must still be pinned or the CLI's auto-router crashes on a big prompt; an
 * explicit per-project `helperModel` overrides. (`gemini-2.5-flash` routes to
 * gemini-3-flash on current CLIs.)
 */
const GEMINI_HELPER_MODEL = 'gemini-2.5-flash';

/** Cap on the change list embedded in the `what-changed` prompt — a huge drift
 *  shouldn't blow the prompt. Truncation is noted in the prompt. */
const MAX_CHANGED_PATHS = 60;

/** The visible read-only helper PTY for a window: spawn `claude` with the
 *  deny-writes `--settings` profile (the read-only guard — see
 *  {@link helperLaunchArgs}) + the fast helper model **through the window's
 *  terminal service** — so its output streams to the renderer and an xterm
 *  binds to its id — marked `infra` so a live helper never trips the
 *  close/quit running-task guard. */
function hostFor(ctx: ProjectContext): HelperHost {
  return {
    spawn: ({ settingsPath, mcpConfigPath }) => {
      const id = ctx.ptyService.spawn(
        {
          binary: 'claude',
          args: helperLaunchArgs({ settingsPath, model: HELPER_MODEL, mcpConfigPath }),
        },
        { infra: true },
      );
      return {
        id,
        write: (data) => ctx.ptyService.write(id, data),
        kill: () => ctx.ptyService.kill(id),
      };
    },
  };
}

/** The project's current drift as a flat path list (payload then lore), capped.
 *  The helper can't run git (Bash denied), so `what-changed` hands it this. */
function changedPaths(ctx: ProjectContext): string[] {
  if (!ctx.wiring) return [];
  const snap = ctx.wiring.changes.snapshot();
  // Payload paths go out **absolute** so they resolve no matter where the engine
  // is anchored (Claude at the project root; Gemini in the lore repo with the
  // payload added as an included dir). Lore paths are labelled rather than handed
  // over as readable paths — context, not a file to open.
  const all = [
    ...snap.payload.map((e) => join(ctx.root, e.path)),
    ...snap.lore.map((e) => `[lore] ${e.path}`),
  ];
  if (all.length <= MAX_CHANGED_PATHS) return all;
  return [...all.slice(0, MAX_CHANGED_PATHS), `…and ${all.length - MAX_CHANGED_PATHS} more`];
}

/** The MCP tool the `dashboard` crawl calls to deliver the board (CR10). Bare
 *  name as the model sees it — must match a tool the {@link ../helper/mcp-host.ts}
 *  registers. Engines without an MCP egress yet pass `null` (print-JSON). */
const DASHBOARD_REPORT_TOOL = 'report_dashboard';

/** Turn timeout for the `dashboard` crawl. It reads the WHOLE lore before
 *  reporting — ~145s on interactive Haiku (measured 2026-06-03), past the snappy
 *  default a Q&A turn uses — so the crawl gets a generous window. Completeness
 *  beats latency here (the same reason Gemini's turn timeout is minutes). */
const DASHBOARD_TURN_TIMEOUT_MS = 300_000;

/** Build the read-only prompt for a canned action, supplying the data each one
 *  needs from the project context. `lightOrient` chooses the cheap one-file
 *  orient for engines without the AI-Lore skill (headless Gemini); `reportTool`
 *  routes the `dashboard` crawl through the MCP egress when the engine has one. */
function promptForAction(
  ctx: ProjectContext,
  action: HelperAction,
  lightOrient: boolean,
  reportTool: string | null,
): string {
  const memoryPath = isChainError(ctx.chain) ? '' : join(ctx.chain.lorePath, 'memory');
  const statusPath = memoryPath ? join(memoryPath, 'status/status.index.md') : '';
  const today = new Date().toISOString().slice(0, 10);
  return promptFor(action, {
    statusPath,
    memoryPath,
    today,
    changedPaths: changedPaths(ctx),
    lightOrient,
    reportTool: reportTool ?? undefined,
  });
}

/** Which engine the window's helper uses (CR7) — the **assistant engine the
 *  user picked for this project** in the Assistant-panel dropdown
 *  (`helperEngine`, persisted per project). The decision (incl. the default when
 *  unpicked: the first helper-capable engine, matching the dropdown) lives in
 *  the pure {@link pickHelperEngine} so the UI and backend never disagree. */
function resolveHelperEngine(deps: Deps, root: string) {
  return pickHelperEngine(
    loadEngines(deps.getUserDataDir()),
    loadHelperEngine(deps.getUserDataDir(), root),
  );
}

/** One window's helper, with its engine + host already bound (CR7). The IPC
 *  handlers drive `connect`/`submit` without caring which engine answers — the
 *  seam ({@link HelperEngine}) keeps the renderer contract identical. */
type BoundHelper = {
  ctx: ProjectContext;
  /** True for engines without the AI-Lore skill (headless Gemini) — use the
   *  cheap one-file orient so the first turn doesn't blow the timeout. */
  lightOrient: boolean;
  /** The MCP tool the `dashboard` crawl reports through (CR10), or null for an
   *  engine still on the print-JSON path (Gemini, until its MCP egress lands). */
  reportTool: string | null;
  connect: () => Promise<void>;
  submit: (prompt: string, opts?: HelperSubmitOpts) => Promise<void>;
};

/** Resolve the window, project context, and engine for an IPC call — null when
 *  the call has no window or no valid AI-Lore project (the prompts need the
 *  chain; the PTY/cwd need a real project). */
function resolve(deps: Deps, event: Electron.IpcMainInvokeEvent): BoundHelper | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ctx = deps.contextFor(event);
  if (!win || !ctx || isChainError(ctx.chain)) return null;
  const winId = win.id;

  const engine = resolveHelperEngine(deps, ctx.root);
  if (engine.kind === 'gemini') {
    const mgr = geminiHelperManager();
    const host: GeminiHost = {
      binary: engine.entry.binary,
      // Anchor Gemini in the lore's git repo so it can read the (payload-
      // gitignored) lore cleanly; add the project root back so it still sees the
      // payload. Launching at the project root made `read_file` on lore files
      // refuse + thrash → turn timeout. See {@link GeminiHost}.
      cwd: join(ctx.chain.lorePath, 'memory'),
      includeDirs: [ctx.root],
      // Pin Gemini 3 Pro for the crawl — without a pinned model the CLI's
      // auto-router crashes on the big prompt; with it, 3.1-pro-preview gives the
      // most complete board in ~90s (trip 2026-06-03). A per-project
      // `helperModel` still overrides.
      model: engine.entry.helperModel ?? GEMINI_HELPER_MODEL,
    };
    return {
      ctx,
      lightOrient: true, // Gemini has no AI-Lore skill — the cheap orient
      reportTool: null, // Gemini's MCP egress isn't wired yet — keep print-JSON
      connect: () => mgr.connect(winId, host),
      submit: (prompt, opts) => mgr.submit(winId, host, prompt, opts),
    };
  }
  const mgr = helperManager();
  const host = hostFor(ctx);
  return {
    ctx,
    lightOrient: false, // Claude loads the AI-Lore skill — the full orient is cheap
    reportTool: DASHBOARD_REPORT_TOOL, // Claude reports the board via the MCP tool (CR10)
    connect: () => mgr.connect(winId, host),
    submit: (prompt, opts) => mgr.submit(winId, host, prompt, opts),
  };
}

/** The AI-assistant (helper) channels — connect a read-only assistant for the
 *  window (a visible `claude` PTY or a headless `gemini`, per the picked engine)
 *  and drive read-only turns through it: canned actions and free-text
 *  questions (AI Helper). */
export const registerHelper: RegisterModule = (reg, deps) => {
  reg.handle('helperConnect', async (event) => {
    const r = resolve(deps, event);
    console.log('[helper] connect', r ? 'resolved' : 'NO-OP (no engine/project)');
    if (!r) return;
    await r.connect();
  });

  reg.handle('helperAsk', async (event, action: HelperAction) => {
    const r = resolve(deps, event);
    console.log('[helper] ask', action, r ? '' : 'NO-OP (no engine/project)');
    if (!r) return;
    // The dashboard crawl reads the whole lore before reporting — give it a far
    // longer turn timeout than a quick Q&A (CR10; measured ~145s on Haiku).
    const opts: HelperSubmitOpts | undefined =
      action === 'dashboard' ? { resultTimeoutMs: DASHBOARD_TURN_TIMEOUT_MS } : undefined;
    await r.submit(promptForAction(r.ctx, action, r.lightOrient, r.reportTool), opts);
  });

  reg.handle('helperAskText', async (event, text: string) => {
    const r = resolve(deps, event);
    console.log('[helper] askText', `"${text.slice(0, 48)}…"`, r ? '' : 'NO-OP');
    if (!r) return;
    const prompt = text.trim();
    if (!prompt) return;
    await r.submit(prompt);
  });

  reg.handle('helperEngineGet', (event) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return null;
    return loadHelperEngine(deps.getUserDataDir(), ctx.root);
  });

  reg.handle('helperEngineSet', (event, engineId: string) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return;
    if (typeof engineId !== 'string' || engineId.length === 0) return;
    saveHelperEngine(deps.getUserDataDir(), ctx.root, engineId);
  });

  reg.handle('helperReset', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) disposeHelperForWindow(win.id);
  });
};
