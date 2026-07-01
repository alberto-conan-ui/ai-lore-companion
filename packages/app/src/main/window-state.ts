import { join } from 'node:path';
import type { Rectangle } from 'electron';
import { z } from 'zod';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';
import { projectDataDir } from './project-data.js';

/**
 * Per-project window bounds — the OS window's size and position, so reopening a
 * project restores the window the user left, not the default 1100×720. A
 * main-only sidecar (`window-state.json` in the project's data dir, next to
 * `engine-state.json`); the renderer never sees it. Part of layout restore, so
 * it is gated by the same `workspace.restoreLayout` toggle at the call site.
 */
function windowStatePath(userDataDir: string, projectRoot: string): string {
  return join(projectDataDir(userDataDir, projectRoot), 'window-state.json');
}

/** A sane window rectangle — finite, positive extent. */
const boundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

/** The project's stored window bounds, or null when absent/corrupt. */
export function loadWindowBounds(userDataDir: string, projectRoot: string): Rectangle | null {
  const parsed = boundsSchema.safeParse(readJsonFile(windowStatePath(userDataDir, projectRoot)));
  return parsed.success ? parsed.data : null;
}

/** Persist the project's window bounds, creating the data dir if needed. */
export function saveWindowBounds(
  userDataDir: string,
  projectRoot: string,
  bounds: Rectangle,
): void {
  writeJsonFileAtomic(windowStatePath(userDataDir, projectRoot), bounds);
}
