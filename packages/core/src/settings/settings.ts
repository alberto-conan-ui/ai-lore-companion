/**
 * The cockpit's settings system: a registry of declared settings, and pure
 * logic to parse, validate, merge, and resolve a two-tier (global +
 * per-project) store. All I/O lives in the Electron `main` process; this
 * module is Electron-free and fully unit-tested.
 */

import { type AppEntry, parseAppEntries } from '../apps/apps.js';
import { type IgnoreRule, isIgnoreRule } from '../ignore.js';
import type {
  LayoutEditorDoc,
  LayoutPanel,
  LayoutTab,
  SettingDef,
  SettingValue,
  SettingsFile,
  TabLastSession,
  WorkspaceEditor,
  WorkspaceLayout,
} from './types.js';

/**
 * The on-disk schema version of a settings file. Bump when the persisted shape
 * changes, so a future load can migrate older files.
 */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * The version of the embedded workspace-layout snapshot. Independent of the
 * settings file's `schemaVersion` — a snapshot with an unknown version is
 * dropped on load, and the window opens with the default layout.
 */
export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 1;

/**
 * Every setting the cockpit knows. The Settings UI renders from this list and
 * the store validates writes against it; adding a setting is one entry here
 * plus wiring its effect.
 */
export const SETTINGS_REGISTRY: readonly SettingDef[] = [
  {
    key: 'appearance.theme',
    label: 'Theme',
    section: 'Appearance',
    type: 'enum',
    tier: 'global',
    default: 'system',
    options: ['dark', 'system', 'light'],
  },
  {
    key: 'appearance.showProjectAccent',
    label: 'Tint the header with the project colour',
    section: 'Appearance',
    type: 'boolean',
    tier: 'both',
    default: true,
  },
  {
    key: 'workspace.restoreLayout',
    label: 'Restore workspace layout on open',
    section: 'Workspace',
    type: 'boolean',
    tier: 'global',
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
  const next: SettingsFile = {
    schemaVersion: file.schemaVersion,
    values: file.values,
    ignores: file.ignores,
    apps: [...apps],
  };
  if (file.layout) next.layout = file.layout;
  return next;
}

/** Whether a raw value is shaped like a `TabLastSession`. */
function parseLastSession(value: unknown): TabLastSession | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.kind !== 'string' || typeof o.detail !== 'string') return undefined;
  return { kind: o.kind, detail: o.detail };
}

/** Whether a raw value is shaped like a `LayoutTab`. Unknown fields are tolerated. */
function isLayoutTab(value: unknown): value is LayoutTab {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.kind !== 'string' || typeof o.title !== 'string') {
    return false;
  }
  if (o.baseTitle !== undefined && typeof o.baseTitle !== 'string') return false;
  if (o.manualTitle !== undefined && typeof o.manualTitle !== 'boolean') return false;
  if (o.engine !== undefined && typeof o.engine !== 'string') return false;
  return true;
}

/** Coerce a parsed value into a `LayoutPanel`, dropping malformed tabs. */
function parseLayoutPanel(value: unknown): LayoutPanel | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.tabs) || typeof o.activeId !== 'string') return null;
  const tabs: LayoutTab[] = [];
  for (const raw of o.tabs) {
    if (!isLayoutTab(raw)) continue;
    const t: LayoutTab = { id: raw.id, kind: raw.kind, title: raw.title };
    if (raw.baseTitle !== undefined) t.baseTitle = raw.baseTitle;
    if (raw.manualTitle !== undefined) t.manualTitle = raw.manualTitle;
    if (raw.engine !== undefined) t.engine = raw.engine;
    const last = parseLastSession((raw as Record<string, unknown>).lastSession);
    if (last) t.lastSession = last;
    tabs.push(t);
  }
  return { tabs, activeId: o.activeId };
}

const LAYOUT_PANEL_KEYS = [
  'leftRail',
  'centre',
  'right',
  'leftRailBottom',
  'centreBottom',
  'rightBottom',
] as const;

const LAYOUT_OPEN_KEYS = [
  'rightOpen',
  'leftRailBottomOpen',
  'centreBottomOpen',
  'rightBottomOpen',
] as const;

const LAYOUT_SIZE_KEYS = [
  'leftRailWidth',
  'rightWidth',
  'leftRailBottomHeight',
  'centreBottomHeight',
  'rightBottomHeight',
] as const;

/** One persisted editor doc, or `null` if malformed (dropped, not fatal). */
function parseLayoutEditorDoc(value: unknown): LayoutEditorDoc | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.path !== 'string' || typeof o.name !== 'string') return null;
  if (o.scope !== 'payload' && o.scope !== 'lore') return null;
  if (o.mode !== 'code' && o.mode !== 'diff' && o.mode !== 'preview') return null;
  const doc: LayoutEditorDoc = { path: o.path, scope: o.scope, name: o.name, mode: o.mode };
  if (typeof o.oldPath === 'string') doc.oldPath = o.oldPath;
  if (typeof o.diffBaseline === 'string') doc.diffBaseline = o.diffBaseline;
  return doc;
}

/** The editor column's persisted docs. Malformed docs drop individually; a
 *  malformed container yields `null` (the editor opens empty). */
function parseWorkspaceEditor(value: unknown): WorkspaceEditor | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.docs)) return null;
  const docs = o.docs.map(parseLayoutEditorDoc).filter((d): d is LayoutEditorDoc => d !== null);
  return { docs, activePath: typeof o.activePath === 'string' ? o.activePath : null };
}

/**
 * Read a workspace-layout snapshot out of a parsed `layout` field. Returns
 * `null` for absent, malformed, or unknown-version snapshots — the caller
 * treats that as "no snapshot" and the window opens with defaults. The editor
 * fields (`editorWidth`, `editor`) are optional: a pre-editor snapshot still
 * restores, just without reopening any files.
 */
function parseWorkspaceLayout(value: unknown): WorkspaceLayout | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.schemaVersion !== WORKSPACE_LAYOUT_SCHEMA_VERSION) return null;
  if (typeof o.panels !== 'object' || o.panels === null) return null;
  const p = o.panels as Record<string, unknown>;
  const panels = {} as WorkspaceLayout['panels'];
  for (const key of LAYOUT_PANEL_KEYS) {
    const panel = parseLayoutPanel(p[key]);
    if (!panel) return null;
    panels[key] = panel;
  }
  for (const key of LAYOUT_OPEN_KEYS) {
    if (typeof o[key] !== 'boolean') return null;
  }
  for (const key of LAYOUT_SIZE_KEYS) {
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key] as number)) return null;
  }
  const layout: WorkspaceLayout = {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    panels,
    rightOpen: o.rightOpen as boolean,
    leftRailBottomOpen: o.leftRailBottomOpen as boolean,
    centreBottomOpen: o.centreBottomOpen as boolean,
    rightBottomOpen: o.rightBottomOpen as boolean,
    leftRailWidth: o.leftRailWidth as number,
    rightWidth: o.rightWidth as number,
    leftRailBottomHeight: o.leftRailBottomHeight as number,
    centreBottomHeight: o.centreBottomHeight as number,
    rightBottomHeight: o.rightBottomHeight as number,
  };
  if (typeof o.editorWidth === 'number' && Number.isFinite(o.editorWidth)) {
    layout.editorWidth = o.editorWidth;
  }
  const editor = parseWorkspaceEditor(o.editor);
  if (editor) layout.editor = editor;
  const changesHeights = parseChangesHeights(o.changesHeightByPane);
  if (changesHeights) layout.changesHeightByPane = changesHeights;
  return layout;
}

/** Parse the per-pane Changes-panel heights — a record of finite numbers.
 *  Malformed entries are dropped; an empty/absent map yields `undefined`. */
function parseChangesHeights(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const layout = parseWorkspaceLayout(obj.layout);
  const file: SettingsFile = { schemaVersion: version, values, ignores };
  if (apps.length > 0) file.apps = apps;
  if (layout) file.layout = layout;
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
  if (file.layout) next.layout = file.layout;
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
  if (file.layout) next.layout = file.layout;
  return next;
}

/**
 * A new settings file carrying `layout` (or clearing it, when `null`) — the
 * input is not mutated. The layout snapshot belongs to the per-project tier.
 */
export function withLayout(file: SettingsFile, layout: WorkspaceLayout | null): SettingsFile {
  const next: SettingsFile = {
    schemaVersion: file.schemaVersion,
    values: file.values,
    ignores: file.ignores,
  };
  if (file.apps) next.apps = file.apps;
  if (layout) next.layout = layout;
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
