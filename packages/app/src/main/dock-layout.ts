import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type DockWorkspaceSnapshot, parseDockSnapshot } from '@ai-lore-companion/core';
import { projectDataDir } from './project-data.js';

/**
 * The Dockview workspace snapshot (v2 P2 / S-D) — group placement plus the dock
 * tabs' dormant metadata — persisted in its **own** per-project sidecar
 * (`dock-layout.json`, next to `window-state.json` / `engine-state.json`).
 *
 * Deliberately separate from `settings.json`: a second app instance — notably an
 * older deployed build that predates Dockview — rewrites `settings.json`
 * wholesale and strips any field it doesn't know. Keeping the dock snapshot in a
 * file that older build never opens lets the arrangement survive even when the
 * deployed app runs alongside this one. Like the rest of layout restore, the
 * call site gates reads on the `workspace.restoreLayout` toggle.
 */
function dockLayoutPath(userDataDir: string, projectRoot: string): string {
  return join(projectDataDir(userDataDir, projectRoot), 'dock-layout.json');
}

/** The project's stored dock snapshot, or `null` when absent / corrupt /
 *  unknown-version (the workspace then opens with the default dock). */
export function loadDockLayout(
  userDataDir: string,
  projectRoot: string,
): DockWorkspaceSnapshot | null {
  try {
    const raw = JSON.parse(readFileSync(dockLayoutPath(userDataDir, projectRoot), 'utf8'));
    return parseDockSnapshot(raw);
  } catch {
    return null;
  }
}

/** Persist (or clear, with `null`) the project's dock snapshot. */
export function saveDockLayout(
  userDataDir: string,
  projectRoot: string,
  snapshot: DockWorkspaceSnapshot | null,
): void {
  const path = dockLayoutPath(userDataDir, projectRoot);
  if (snapshot === null) {
    try {
      rmSync(path);
    } catch {}
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot));
}
