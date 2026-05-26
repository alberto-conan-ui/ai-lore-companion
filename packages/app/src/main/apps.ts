/**
 * Apps catalog — main-process wiring around the core data model.
 *
 * The catalog supersedes the v0.5 *Project / Lore shortcut rows* in the
 * header. Catalog evolution is run idempotently through `runAppsMigrations`,
 * gated by an integer version marker in the global settings values.
 *
 *  - v1 brings legacy folder-target shortcuts (the ones that had an `app:`
 *    field) into the catalog as Apps entries. URL + terminal shortcuts are
 *    untouched; they continue to surface in each panel's tab strip.
 *  - v2 cleans labels through `cleanAppLabel` (strips the legacy
 *    "Open project in X" verb prefix the v1 migration carried verbatim)
 *    and deduplicates by identity tuple. After v2, scope-bound legacy
 *    shortcuts that pointed at the same `.app` collapse to one entry —
 *    apps are flat openers, filtered by `target` only.
 *
 * Phase A: [actions-in-context](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/A-actions-in-context.phase.md).
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type AppEntry,
  cleanAppLabel,
  dedupApps,
  serializeSettingsFile,
  withApps,
  withSetting,
} from '@ai-lore-companion/core';
import { loadGlobalSettings } from './settings.js';
import { extractAppIcon, loadShortcuts } from './shortcuts.js';

/** Integer marker — the catalog has been migrated up to this version. */
const MIGRATION_VERSION_KEY = 'apps.migrationVersion';
const CURRENT_MIGRATION_VERSION = 2;
/** Legacy boolean marker — v1 wrote `true`; treated as v1 when present. */
const LEGACY_V1_MARKER_KEY = 'apps.migratedFromShortcuts';

/** Finder is always available as the built-in "Open in Finder" entry, so
 *  migrating a Finder shortcut would duplicate it. */
const FINDER_APP_PATH = '/System/Library/CoreServices/Finder.app';

/**
 * Bring the Apps catalog up to the current schema version. Idempotent —
 * each step only fires when the marker says it has not yet run. New
 * migrations append a step + bump `CURRENT_MIGRATION_VERSION`.
 */
export function runAppsMigrations(userDataDir: string): void {
  const global = loadGlobalSettings(userDataDir);

  // Resolve from-version. Explicit integer marker wins; legacy boolean
  // marker from v0.6 Phase A v1 means we're at v1.
  const fromVersionRaw = global.values[MIGRATION_VERSION_KEY];
  const fromVersion =
    typeof fromVersionRaw === 'number'
      ? fromVersionRaw
      : global.values[LEGACY_V1_MARKER_KEY] === true
        ? 1
        : 0;

  if (fromVersion >= CURRENT_MIGRATION_VERSION) return;

  let working = global;

  if (fromVersion < 1) {
    working = applyV1Migration(working, userDataDir);
  }

  if (fromVersion < 2) {
    working = applyV2Migration(working);
  }

  const withMarker = withSetting(working, MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
  writeGlobalSettings(userDataDir, withMarker);
}

/** v1 — fold legacy folder-target shortcuts into the catalog. */
function applyV1Migration(
  global: ReturnType<typeof loadGlobalSettings>,
  userDataDir: string,
): ReturnType<typeof loadGlobalSettings> {
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
  return withApps(global, [...existing, ...migrated]);
}

/**
 * v2 — clean every entry's label through `cleanAppLabel` (the menu prepends
 * "Open with "), then dedup by identity tuple so two scope-bound legacy
 * shortcuts pointing at the same app collapse to one.
 */
function applyV2Migration(
  global: ReturnType<typeof loadGlobalSettings>,
): ReturnType<typeof loadGlobalSettings> {
  const apps = global.apps ?? [];
  const cleaned = apps.map((a) => ({ ...a, label: cleanAppLabel(a.label) }));
  const deduped = dedupApps(cleaned);
  return withApps(global, deduped);
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
