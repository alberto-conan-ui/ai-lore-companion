import { join } from 'node:path';
import { isChainError } from '@ai-lore-companion/core';
import { BrowserWindow } from 'electron';
import type { HelperAction } from '../../shared/ipc.js';
import { promptFor } from '../helper/hooks.js';
import { helperManager } from '../helper/index.js';
import type { HelperHost } from '../helper/manager.js';
import type { Deps, ProjectContext, RegisterModule } from './types.js';

/**
 * The model the helper runs on. Its job is fast, read-only Q&A over the
 * project (summaries, "what's pending") — a Haiku-class task, not an Opus one.
 * Pinning the cheapest/fastest tier keeps answers snappy and cheap; the user's
 * own AI tab is unaffected. `haiku` is the CLI alias for the latest Haiku
 * (Haiku 4.5 today). (Per-engine model choice can move behind the adapter at CR7.)
 */
const HELPER_MODEL = 'haiku';

/** Cap on the change list embedded in the `what-changed` prompt — a huge drift
 *  shouldn't blow the prompt. Truncation is noted in the prompt. */
const MAX_CHANGED_PATHS = 60;

/** The visible read-only helper PTY for a window: spawn `claude` with the
 *  deny-writes `--settings` + the fast helper model **through the window's
 *  terminal service** — so its output streams to the renderer and an xterm
 *  binds to its id — marked `infra` so a live helper never trips the
 *  close/quit running-task guard. */
function hostFor(ctx: ProjectContext): HelperHost {
  return {
    spawn: (settingsPath) => {
      const id = ctx.ptyService.spawn(
        { binary: 'claude', args: ['--settings', settingsPath, '--model', HELPER_MODEL] },
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
  // Payload paths are readable from the helper's cwd (the project root); lore
  // paths live under the Lore folder, so label them rather than imply a path
  // the helper could Read directly.
  const all = [...snap.payload.map((e) => e.path), ...snap.lore.map((e) => `[lore] ${e.path}`)];
  if (all.length <= MAX_CHANGED_PATHS) return all;
  return [...all.slice(0, MAX_CHANGED_PATHS), `…and ${all.length - MAX_CHANGED_PATHS} more`];
}

/** Build the read-only prompt for a canned action, supplying the data each one
 *  needs from the project context. */
function promptForAction(ctx: ProjectContext, action: HelperAction): string {
  const statusPath = isChainError(ctx.chain)
    ? ''
    : join(ctx.chain.lorePath, 'memory/status/status.index.md');
  return promptFor(action, { statusPath, changedPaths: changedPaths(ctx) });
}

/** Resolve the window + host for an IPC call — null when the call has no window
 *  or no valid AI-Lore project (the PTY needs the window's terminal service and
 *  the prompts need the chain). */
function resolve(
  deps: Deps,
  event: Electron.IpcMainInvokeEvent,
): { winId: number; ctx: ProjectContext; host: HelperHost } | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ctx = deps.contextFor(event);
  if (!win || !ctx || isChainError(ctx.chain)) return null;
  return { winId: win.id, ctx, host: hostFor(ctx) };
}

/** The AI-assistant (helper) channels — connect a visible, read-only `claude`
 *  for the window and drive read-only turns through it: canned actions and
 *  free-text questions (AI Helper). */
export const registerHelper: RegisterModule = (reg, deps) => {
  reg.handle('helperConnect', async (event) => {
    const r = resolve(deps, event);
    if (!r) return;
    await helperManager().connect(r.winId, r.host);
  });

  reg.handle('helperAsk', async (event, action: HelperAction) => {
    const r = resolve(deps, event);
    if (!r) return;
    await helperManager().submit(r.winId, r.host, promptForAction(r.ctx, action));
  });

  reg.handle('helperAskText', async (event, text: string) => {
    const r = resolve(deps, event);
    if (!r) return;
    const prompt = text.trim();
    if (!prompt) return;
    await helperManager().submit(r.winId, r.host, prompt);
  });
};
