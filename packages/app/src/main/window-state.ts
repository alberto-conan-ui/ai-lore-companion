import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Rectangle } from 'electron';
import { projectDataDir } from './db-path.js';

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

/** Whether a raw value is a sane window rectangle — finite, positive extent. */
function isBounds(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return false;
  }
  return (o.width as number) > 0 && (o.height as number) > 0;
}

/** The project's stored window bounds, or null when absent/corrupt. */
export function loadWindowBounds(userDataDir: string, projectRoot: string): Rectangle | null {
  try {
    const raw = JSON.parse(readFileSync(windowStatePath(userDataDir, projectRoot), 'utf8'));
    return isBounds(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the project's window bounds, creating the data dir if needed. */
export function saveWindowBounds(
  userDataDir: string,
  projectRoot: string,
  bounds: Rectangle,
): void {
  const path = windowStatePath(userDataDir, projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bounds));
}
