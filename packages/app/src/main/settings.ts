import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type IgnoreRule,
  type SettingValue,
  type SettingsFile,
  type WorkspaceLayout,
  emptySettingsFile,
  parseSettingsFile,
  serializeSettingsFile,
  withIgnores,
  withLayout,
  withSetting,
} from '@ai-lore-companion/core';
import { projectDataDir } from './db-path.js';

/**
 * Disk binding for the two-tier settings store. Global settings live in one
 * JSON file under `app.getPath('userData')`; per-project settings live in the
 * project's data directory, next to its drift database. All merge and resolve
 * logic is pure and lives in `@ai-lore-companion/core` — this module only
 * reads and writes the files.
 */

function globalSettingsPath(userDataDir: string): string {
  return join(userDataDir, 'settings.json');
}

function projectSettingsPath(userDataDir: string, projectRoot: string): string {
  return join(projectDataDir(userDataDir, projectRoot), 'settings.json');
}

/** Read a settings file — an empty file when it is absent or corrupt. */
function readSettingsFile(path: string): SettingsFile {
  try {
    return parseSettingsFile(readFileSync(path, 'utf8'));
  } catch {
    return emptySettingsFile();
  }
}

/** Write a settings file, creating its directory if needed. */
function writeSettingsFile(path: string, file: SettingsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSettingsFile(file));
}

/** The global settings file. */
export function loadGlobalSettings(userDataDir: string): SettingsFile {
  return readSettingsFile(globalSettingsPath(userDataDir));
}

/** A project's settings file. */
export function loadProjectSettings(userDataDir: string, projectRoot: string): SettingsFile {
  return readSettingsFile(projectSettingsPath(userDataDir, projectRoot));
}

/** Write one global setting; returns the updated file. */
export function saveGlobalSetting(
  userDataDir: string,
  key: string,
  value: SettingValue,
): SettingsFile {
  const next = withSetting(loadGlobalSettings(userDataDir), key, value);
  writeSettingsFile(globalSettingsPath(userDataDir), next);
  return next;
}

/** Write one per-project setting; returns the updated file. */
export function saveProjectSetting(
  userDataDir: string,
  projectRoot: string,
  key: string,
  value: SettingValue,
): SettingsFile {
  const next = withSetting(loadProjectSettings(userDataDir, projectRoot), key, value);
  writeSettingsFile(projectSettingsPath(userDataDir, projectRoot), next);
  return next;
}

/** Replace the global tier's ignore rules; returns the updated file. */
export function saveGlobalIgnores(userDataDir: string, rules: readonly IgnoreRule[]): SettingsFile {
  const next = withIgnores(loadGlobalSettings(userDataDir), rules);
  writeSettingsFile(globalSettingsPath(userDataDir), next);
  return next;
}

/** Replace a project's ignore rules; returns the updated file. */
export function saveProjectIgnores(
  userDataDir: string,
  projectRoot: string,
  rules: readonly IgnoreRule[],
): SettingsFile {
  const next = withIgnores(loadProjectSettings(userDataDir, projectRoot), rules);
  writeSettingsFile(projectSettingsPath(userDataDir, projectRoot), next);
  return next;
}

/**
 * Replace (or clear, with `null`) the project's workspace-layout snapshot;
 * returns the updated file. Layouts live only in the per-project tier.
 */
export function saveProjectLayout(
  userDataDir: string,
  projectRoot: string,
  layout: WorkspaceLayout | null,
): SettingsFile {
  const next = withLayout(loadProjectSettings(userDataDir, projectRoot), layout);
  writeSettingsFile(projectSettingsPath(userDataDir, projectRoot), next);
  return next;
}
