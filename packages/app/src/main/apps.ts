/**
 * Apps catalog — main-process wiring around the core data model.
 *
 * The catalog supersedes the v0.5 *Project / Lore shortcut rows* in the
 * header. v0.6 Phase A migrates folder-target shortcuts (the ones that had
 * an `app:` field) into Apps entries on launch, then leaves the legacy
 * shortcuts table alone (URL + terminal shortcuts continue to surface in
 * each panel's tab strip).
 *
 * Phase A: [actions-in-context](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/A-actions-in-context.phase.md).
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type AppEntry,
  serializeSettingsFile,
  withApps,
  withSetting,
} from '@ai-lore-companion/core';
import { loadGlobalSettings } from './settings.js';
import { extractAppIcon, loadShortcuts } from './shortcuts.js';

/** The settings-values key recording that the one-time migration has run. */
const MIGRATION_KEY = 'apps.migratedFromShortcuts';

/** Finder is always available as the built-in "Open in Finder" entry, so
 *  migrating a Finder shortcut would duplicate it. */
const FINDER_APP_PATH = '/System/Library/CoreServices/Finder.app';

/**
 * Migrate legacy `project` / `lore` shortcuts to Apps catalog entries on
 * first launch under v0.6. Idempotent — guarded by a marker in the global
 * settings values. URL and terminal shortcuts are not migrated; they live
 * in the panel tab strip and remain unchanged.
 */
export function migrateShortcutsIfNeeded(userDataDir: string): void {
  const global = loadGlobalSettings(userDataDir);
  if (global.values[MIGRATION_KEY] === true) return;

  const shortcuts = loadShortcuts(userDataDir);
  const existing = global.apps ?? [];
  const existingPaths = new Set(
    existing.flatMap((a) => (a.appPath ? [a.appPath] : a.cliPath ? [a.cliPath] : [])),
  );
  const migrated: AppEntry[] = [];
  for (const s of shortcuts) {
    if (s.target !== 'project' && s.target !== 'lore') continue;
    if (!s.app) continue;
    if (s.app === FINDER_APP_PATH) continue; // built-in "Open in Finder"
    if (existingPaths.has(s.app)) continue;
    migrated.push({
      id: randomUUID(),
      label: s.label,
      kind: 'app',
      target: 'folder',
      appPath: s.app,
    });
    existingPaths.add(s.app);
  }

  // Persist apps + marker in one write — both `withApps` and `withSetting`
  // are pure, so chain them and write the resulting file once.
  const withCatalog = withApps(global, [...existing, ...migrated]);
  const withMarker = withSetting(withCatalog, MIGRATION_KEY, true);
  writeGlobalSettings(userDataDir, withMarker);
}

function globalSettingsPath(userDataDir: string): string {
  return join(userDataDir, 'settings.json');
}

function writeGlobalSettings(
  userDataDir: string,
  file: ReturnType<typeof loadGlobalSettings>,
): void {
  const path = globalSettingsPath(userDataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSettingsFile(file));
}

/** Decorate every app entry with its `iconUrl` when an `.app` icon exists. */
export function appsWithIcons(apps: readonly AppEntry[]): AppEntry[] {
  return apps.map((a) => {
    if (a.kind !== 'app' || !a.appPath || a.iconUrl) return a;
    const iconUrl = extractAppIcon(a.appPath);
    return iconUrl ? { ...a, iconUrl } : a;
  });
}
