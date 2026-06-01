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

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { CHANNELS, type HelperEventPayload } from '../../shared/ipc.js';
import { sessionStartScript, settingsJson, stopScript } from './hooks.js';
import { type HelperManager, createHelperManager } from './manager.js';
import { createMiddleman } from './middleman.js';

/** Write the deny-writes `--settings` and the two hook scripts into a fresh
 *  temp dir; returns the dir + the settings path to pass to `claude`. */
function materialize(w: { sessionId: string; token: string; port: number }): {
  dir: string;
  settingsPath: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lore-helper-'));
  const sessionStartPath = join(dir, 'session-start-hook.mjs');
  const stopPath = join(dir, 'stop-hook.mjs');
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(sessionStartPath, sessionStartScript(w));
  writeFileSync(stopPath, stopScript(w));
  writeFileSync(
    settingsPath,
    settingsJson({ sessionStartScript: sessionStartPath, stopScript: stopPath }),
  );
  return { dir, settingsPath };
}

/** Send a helper event to the window that owns the session. */
function emit(winId: number, event: HelperEventPayload): void {
  const win = BrowserWindow.fromId(winId);
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.onHelperEvent, event);
}

let manager: HelperManager | null = null;

/** The app-wide helper manager, built on first use. */
export function helperManager(): HelperManager {
  if (manager) return manager;
  manager = createHelperManager({
    middleman: createMiddleman(),
    materialize,
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
    emit,
    newId: () => randomUUID(),
  });
  return manager;
}

/** Tear down a window's helper (called from the window teardown). No-op if the
 *  manager was never built. */
export function disposeHelperForWindow(winId: number): void {
  manager?.disposeForWindow(winId);
}

/** Tear down every helper and close the middleman (called on quit). */
export async function disposeAllHelpers(): Promise<void> {
  if (manager) await manager.disposeAll();
}
