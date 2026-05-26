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
   * A project window's workspace layout snapshot, persisted in the per-project
   * tier only. Absent for the global tier. Independent of `schemaVersion` —
   * the snapshot carries its own version.
   */
  layout?: WorkspaceLayout;
};

/** The persisted shape of a tab in the layout snapshot. */
export type LayoutTab = {
  id: string;
  /** `'pane' | 'terminal' | 'browser'` — matched against the runtime tab kinds. */
  kind: string;
  title: string;
  baseTitle?: string;
  manualTitle?: boolean;
};

/** One panel in the layout snapshot — its ordered tabs and the active one. */
export type LayoutPanel = {
  tabs: LayoutTab[];
  activeId: string;
};

/**
 * A project window's workspace layout — what every panel held, the dock
 * open/size state, and the URL each browser tab was on. Restored on next open
 * when the `workspace.restoreLayout` setting is on.
 */
export type WorkspaceLayout = {
  /** Bumped when the shape changes; an unknown version is treated as no snapshot. */
  schemaVersion: number;
  panels: {
    left: LayoutPanel;
    right: LayoutPanel;
    bottom: LayoutPanel;
  };
  rightOpen: boolean;
  bottomOpen: boolean;
  rightWidth: number;
  bottomHeight: number;
  /** Per-browser-tab URL, keyed by the tab id at capture time. */
  browserUrls: Record<string, string>;
};
