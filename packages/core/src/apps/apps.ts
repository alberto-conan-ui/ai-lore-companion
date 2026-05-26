/**
 * Apps catalog — user-configured list of applications the cockpit can invoke
 * on a file or folder. The catalog feeds the *Open with…* entries in every
 * file/folder context menu (tree, grid, drift surface).
 *
 * Two flavours:
 *   - `kind: 'app'` — a macOS `.app` bundle invoked via `open -a <appPath> <path>`.
 *   - `kind: 'cli'` — a CLI binary spawned directly with an argv template.
 *
 * The diff entry is a `kind: 'cli'` with `role: 'diff'` — its `argvTemplate`
 * carries `{baseline}` + `{current}` placeholders (everything else uses
 * `{path}`). One per role at most; the catalog finds it by role for diff
 * invocations from any file context menu.
 *
 * Persisted in the global settings tier — apps are user-wide preferences,
 * the same across all projects.
 */

export type AppKind = 'app' | 'cli';

/** Which kinds of nodes an entry shows up on in context menus. */
export type AppTarget = 'file' | 'folder' | 'both';

/** Specialised entries the catalog finds by purpose, not just by id. */
export type AppRole = 'diff';

export type AppEntry = {
  /** Stable identifier — used in IPC and context-menu keys. */
  id: string;
  /** Display name shown in the *Open with…* menu and Settings list. */
  label: string;
  /** Which invocation mechanism to use. */
  kind: AppKind;
  /** Which node kinds this entry appears on. */
  target: AppTarget;
  /** `kind: 'app'` only — absolute path to the `.app` bundle. */
  appPath?: string;
  /** `kind: 'cli'` only — path to the CLI binary (or name resolvable on PATH). */
  cliPath?: string;
  /**
   * `kind: 'cli'` only — whitespace-tokenised argv template. Single-path
   * entries use `{path}`; the diff entry uses `{baseline}` + `{current}`.
   */
  argvTemplate?: string;
  /** Specialised role; set on diff entries so the catalog can find them by purpose. */
  role?: AppRole;
  /** Populated by main when extractable from the `.app` bundle's `.icns`. */
  iconUrl?: string;
};

/** Shape-check a raw value as an `AppEntry`. Tolerant of extra fields. */
export function isAppEntry(value: unknown): value is AppEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (typeof o.label !== 'string' || o.label.length === 0) return false;
  if (o.kind !== 'app' && o.kind !== 'cli') return false;
  if (o.target !== 'file' && o.target !== 'folder' && o.target !== 'both') return false;
  if (o.kind === 'app') {
    if (typeof o.appPath !== 'string' || o.appPath.length === 0) return false;
  } else {
    if (typeof o.cliPath !== 'string' || o.cliPath.length === 0) return false;
    if (typeof o.argvTemplate !== 'string') return false;
  }
  if (o.role !== undefined && o.role !== 'diff') return false;
  if (o.iconUrl !== undefined && typeof o.iconUrl !== 'string') return false;
  return true;
}

/**
 * Coerce a raw value into an `AppEntry`, dropping unknown fields. Returns
 * `null` when the value is not shaped like an entry — callers filter the
 * list, never abort. The settings store has been forward-compatible by this
 * pattern since the ignore-rules implementation.
 */
export function parseAppEntry(value: unknown): AppEntry | null {
  if (!isAppEntry(value)) return null;
  const v = value as Record<string, unknown>;
  const out: AppEntry = {
    id: v.id as string,
    label: v.label as string,
    kind: v.kind as AppKind,
    target: v.target as AppTarget,
  };
  if (out.kind === 'app') {
    out.appPath = v.appPath as string;
  } else {
    out.cliPath = v.cliPath as string;
    out.argvTemplate = v.argvTemplate as string;
  }
  if (v.role !== undefined) out.role = v.role as AppRole;
  if (typeof v.iconUrl === 'string') out.iconUrl = v.iconUrl;
  return out;
}

/** Parse an array of entries from a raw value, dropping malformed elements. */
export function parseAppEntries(value: unknown): AppEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AppEntry[] = [];
  for (const raw of value) {
    const parsed = parseAppEntry(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Find the catalog's diff entry (the `role: 'diff'` `cli` entry), if any. */
export function findDiffApp(apps: readonly AppEntry[]): AppEntry | null {
  for (const a of apps) {
    if (a.role === 'diff' && a.kind === 'cli') return a;
  }
  return null;
}

/**
 * The catalog entries that should appear on a node of the given kind. A
 * `target: 'both'` entry shows on either; `target: 'file'` skips folders and
 * vice-versa. The diff entry is excluded — diff has its own menu item with
 * special semantics, not a generic *Open with* slot.
 */
export function appsForNode(apps: readonly AppEntry[], nodeKind: 'file' | 'folder'): AppEntry[] {
  return apps.filter((a) => {
    if (a.role === 'diff') return false;
    return a.target === 'both' || a.target === nodeKind;
  });
}
