/**
 * Types for the cockpit's settings system — a two-tier store (global +
 * per-project) described by a registry. Pure types; no I/O.
 */

import type { AppEntry } from '../apps/apps.js';
import type { IgnoreRule } from '../ignore.js';

/** Which tier(s) a setting may be stored in. */
export type SettingTier = 'global' | 'project' | 'both';

/** The value kinds a setting can hold; the UI control follows from this. */
export type SettingType = 'boolean' | 'string' | 'number' | 'enum';

/** A setting's value — the union the store persists and resolves. */
export type SettingValue = boolean | string | number;

/** The tier a write targets — a `both` setting is written to one or the other. */
export type WriteTier = 'global' | 'project';

/**
 * One setting's declaration. The registry is a list of these: the Settings UI
 * renders from them and the store validates writes against them.
 */
export type SettingDef = {
  /** Stable identifier — the key the value is persisted under. */
  key: string;
  /** A short human label for the Settings UI. */
  label: string;
  /** The Settings-sheet section this setting is grouped under; defaults to `General`. */
  section?: string;
  /** The value kind. */
  type: SettingType;
  /** Which tier(s) may hold this setting. */
  tier: SettingTier;
  /** The value used when no tier carries one. */
  default: SettingValue;
  /** Allowed values — required when `type` is `enum`, ignored otherwise. */
  options?: readonly string[];
};

/** A persisted settings file — one per tier. */
export type SettingsFile = {
  /** The schema version the file was written at — for future migration. */
  schemaVersion: number;
  /** Stored values, keyed by `SettingDef.key`. */
  values: Record<string, SettingValue>;
  /** This tier's ignore rules — layered over the lower tiers by pattern. */
  ignores: IgnoreRule[];
  /**
   * The Apps catalog — entries the cockpit can invoke on files/folders from
   * context menus. Persisted in the global tier only; absent elsewhere. See
   * [apps.ts](../apps/apps.ts).
   */
  apps?: AppEntry[];
  /**
   * A project window's workspace-layout snapshot, persisted in the per-project
   * tier only; absent for the global tier. Independent of `schemaVersion` —
   * the snapshot carries its own version (`WorkspaceLayout.schemaVersion`).
   */
  layout?: WorkspaceLayout;
};

/**
 * What a restored tab was running in the previous session — drives the warn
 * banner shown on the restored (empty) tab. Purely descriptive: no live state
 * (PTY, page, engine) is ever revived, so this only carries enough to phrase
 * "Last session, this tab was …". Captured live, persisted, read back at
 * restore.
 */
export type TabLastSession = {
  /** The tab kind it was — picks the banner's phrasing. */
  kind: string;
  /**
   * The human detail: a shell's running command, a browser's URL, an AI tab's
   * engine name. Empty string when the tab was open but idle (e.g. a shell at
   * a bare prompt) — the banner falls back to a kind-only message.
   */
  detail: string;
};

/** The persisted shape of a tab in the layout snapshot — structure only, no
 *  live state. `lastSession` records what it was running, for the banner. */
export type LayoutTab = {
  id: string;
  /**
   * `'pane' | 'shell' | 'ai' | 'browser'` — matched against the runtime tab
   * kinds. An unknown kind is dropped on restore.
   */
  kind: string;
  title: string;
  baseTitle?: string;
  manualTitle?: boolean;
  /** For `kind === 'ai'`: the engine the tab was bound to. */
  engine?: string;
  lastSession?: TabLastSession;
};

/** One panel in the layout snapshot — its ordered tabs and the active one. */
export type LayoutPanel = {
  tabs: LayoutTab[];
  activeId: string;
};

/** One file open in the read-only-IDE editor, as persisted in the layout —
 *  restored on next open so the editor reopens where it was left. */
export type LayoutEditorDoc = {
  path: string;
  scope: 'payload' | 'lore';
  name: string;
  mode: 'code' | 'diff' | 'preview';
  oldPath?: string;
  diffBaseline?: string;
};

/** The editor column's persisted state: the open docs and which one was active. */
export type WorkspaceEditor = {
  docs: LayoutEditorDoc[];
  activePath: string | null;
};

/**
 * A project window's workspace layout — what every panel held, the column /
 * dock open + size state. Restored on next open when `workspace.restoreLayout`
 * is on. The six panels mirror the renderer's `PanelId` set; restore lifts each
 * tab into an **empty** runtime tab (no PTY, no page load, no engine launch).
 */
export type WorkspaceLayout = {
  /** Bumped when the shape changes; an unknown version is treated as no snapshot. */
  schemaVersion: number;
  panels: {
    leftRail: LayoutPanel;
    centre: LayoutPanel;
    right: LayoutPanel;
    leftRailBottom: LayoutPanel;
    centreBottom: LayoutPanel;
    rightBottom: LayoutPanel;
  };
  /** Right column open; the three bottom docks open. */
  rightOpen: boolean;
  leftRailBottomOpen: boolean;
  centreBottomOpen: boolean;
  rightBottomOpen: boolean;
  /** leftRail fixed width; right width when open; each dock's height. */
  leftRailWidth: number;
  rightWidth: number;
  leftRailBottomHeight: number;
  centreBottomHeight: number;
  rightBottomHeight: number;
  /** Editor column width when open. Optional — absent on pre-editor snapshots,
   *  which still restore (the editor simply opens at its default width). */
  editorWidth?: number;
  /** Open editor docs + the active one, so the editor reopens where it was left
   *  ("start always opened"). Optional for the same backward-compat reason. */
  editor?: WorkspaceEditor;
};
