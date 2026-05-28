/**
 * The cockpit's settings system: a registry of declared settings, and pure
 * logic to parse, validate, merge, and resolve a two-tier (global +
 * per-project) store. All I/O lives in the Electron `main` process; this
 * module is Electron-free and fully unit-tested.
 */

import { type AppEntry, parseAppEntries } from '../apps/apps.js';
import { type IgnoreRule, isIgnoreRule } from '../ignore.js';
import type { SettingDef, SettingValue, SettingsFile } from './types.js';

/**
 * The on-disk schema version of a settings file. Bump when the persisted shape
 * changes, so a future load can migrate older files.
 */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * Every setting the cockpit knows. The Settings UI renders from this list and
 * the store validates writes against it; adding a setting is one entry here
 * plus wiring its effect.
 */
export const SETTINGS_REGISTRY: readonly SettingDef[] = [
  {
    key: 'appearance.showProjectAccent',
    label: 'Tint the header with the project colour',
    section: 'Appearance',
    type: 'boolean',
    tier: 'both',
    default: true,
  },
  // (The v0.5 `diff.externalCliPath` / `diff.externalArgvTemplate` settings
  // were replaced in v0.6 Phase A by an entry in the Apps catalog with
  // `role: 'diff'`. The catalog is the single source of "what app opens
  // what" — there is no parallel diff-only setting.)
];

/** A fresh, empty settings file at the current schema version. */
export function emptySettingsFile(): SettingsFile {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, values: {}, ignores: [] };
}

/** A new settings file carrying `apps` as its catalog — the input is not mutated. */
export function withApps(file: SettingsFile, apps: readonly AppEntry[]): SettingsFile {
  return {
    schemaVersion: file.schemaVersion,
    values: file.values,
    ignores: file.ignores,
    apps: [...apps],
  };
}

/** Whether `value` is a primitive the store can persist. */
function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number';
}

/**
 * Parse the JSON text of a settings file. A missing or corrupt file is not an
 * error — `null` or unparseable text yields an empty file. Stored values that
 * are not primitives, and malformed ignore rules, are dropped.
 */
export function parseSettingsFile(text: string | null): SettingsFile {
  if (text === null) return emptySettingsFile();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptySettingsFile();
  }
  if (typeof raw !== 'object' || raw === null) return emptySettingsFile();
  const obj = raw as Record<string, unknown>;
  const version =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : SETTINGS_SCHEMA_VERSION;
  const values: Record<string, SettingValue> = {};
  if (typeof obj.values === 'object' && obj.values !== null) {
    for (const [key, value] of Object.entries(obj.values as Record<string, unknown>)) {
      if (isSettingValue(value)) values[key] = value;
    }
  }
  const ignores: IgnoreRule[] = Array.isArray(obj.ignores) ? obj.ignores.filter(isIgnoreRule) : [];
  const apps: AppEntry[] = parseAppEntries(obj.apps);
  const file: SettingsFile = { schemaVersion: version, values, ignores };
  if (apps.length > 0) file.apps = apps;
  return file;
}

/** Serialize a settings file to pretty JSON. */
export function serializeSettingsFile(file: SettingsFile): string {
  return JSON.stringify(file, null, 2);
}

/** A new settings file with `key` set to `value` — the input is not mutated. */
export function withSetting(file: SettingsFile, key: string, value: SettingValue): SettingsFile {
  const next: SettingsFile = {
    schemaVersion: file.schemaVersion,
    values: { ...file.values, [key]: value },
    ignores: file.ignores,
  };
  if (file.apps) next.apps = file.apps;
  return next;
}

/** A new settings file carrying `rules` as its ignore set — the input is not mutated. */
export function withIgnores(file: SettingsFile, rules: readonly IgnoreRule[]): SettingsFile {
  const next: SettingsFile = {
    schemaVersion: file.schemaVersion,
    values: file.values,
    ignores: [...rules],
  };
  if (file.apps) next.apps = file.apps;
  return next;
}

/** Whether a raw value is valid for a setting's declared type. */
export function isValidValue(def: SettingDef, value: unknown): value is SettingValue {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'enum':
      return typeof value === 'string' && (def.options ?? []).includes(value);
  }
}

/** Whether a setting may be stored in the given tier. */
function tierAllows(def: SettingDef, tier: 'global' | 'project'): boolean {
  return def.tier === tier || def.tier === 'both';
}

/**
 * Resolve one setting: the per-project value when the setting may live in the
 * project tier and the project file carries a valid one, else the global
 * value under the same rule, else the registry default. A stored value that
 * fails validation is skipped, never returned.
 */
export function resolveSetting(
  def: SettingDef,
  global: SettingsFile,
  project: SettingsFile | null,
): SettingValue {
  if (project && tierAllows(def, 'project')) {
    const value = project.values[def.key];
    if (isValidValue(def, value)) return value;
  }
  if (tierAllows(def, 'global')) {
    const value = global.values[def.key];
    if (isValidValue(def, value)) return value;
  }
  return def.default;
}

/** Resolve every setting in a registry into a flat key→value map. */
export function resolveAll(
  registry: readonly SettingDef[],
  global: SettingsFile,
  project: SettingsFile | null,
): Record<string, SettingValue> {
  const resolved: Record<string, SettingValue> = {};
  for (const def of registry) {
    resolved[def.key] = resolveSetting(def, global, project);
  }
  return resolved;
}

/**
 * Check a registry for authoring mistakes — a duplicate key, an `enum` without
 * `options`, or a `default` that fails its own type. Returns one message per
 * problem; an empty list means the registry is sound.
 */
export function validateRegistry(registry: readonly SettingDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of registry) {
    if (seen.has(def.key)) errors.push(`duplicate key: ${def.key}`);
    seen.add(def.key);
    if (def.type === 'enum' && (def.options === undefined || def.options.length === 0)) {
      errors.push(`enum setting has no options: ${def.key}`);
    }
    if (!isValidValue(def, def.default)) {
      errors.push(`default is not a valid ${def.type}: ${def.key}`);
    }
  }
  return errors;
}
