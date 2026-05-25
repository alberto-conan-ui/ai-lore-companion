import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { nativeImage } from 'electron';
import type { Shortcut } from '../shared/ipc.js';

/**
 * App-launch shortcuts — a user-configured list, persisted as a JSON file
 * under `app.getPath('userData')`. The list is global: the same shortcuts are
 * offered in every project window, and each resolves its target folder
 * (project root or Lore) against the window it is fired from.
 *
 * Default shortcuts (`DEFAULT_SHORTCUTS`) are back-filled on every load so
 * fresh installs and existing stores both end up with them. A user who removes
 * a default is recorded in `removedDefaults` so the seed does not respawn.
 */

type StoreFile = { shortcuts: Shortcut[]; removedDefaults: string[] };

/** Shortcuts every project starts with. Their ids are stable so removal is
 *  idempotent across sessions. The app path is the full bundle path so the
 *  icon extractor can read `Finder.app/Contents/Resources/*.icns` directly. */
const DEFAULT_SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'default.finder',
    label: 'Finder',
    target: 'project',
    app: '/System/Library/CoreServices/Finder.app',
  },
];

/** Bare app names → full bundle paths, for back-compat with stores that pre-date
 *  the full-path convention (e.g. the original Finder seed stored `app: 'Finder'`). */
const SYSTEM_APP_PATHS: Record<string, string> = {
  Finder: '/System/Library/CoreServices/Finder.app',
};

function shortcutsFile(userDataDir: string): string {
  return join(userDataDir, 'shortcuts.json');
}

function isShortcut(x: unknown): x is Shortcut {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    (s.target === 'project' ||
      s.target === 'lore' ||
      s.target === 'url' ||
      s.target === 'terminal') &&
    (s.app === undefined || typeof s.app === 'string') &&
    (s.url === undefined || typeof s.url === 'string') &&
    (s.command === undefined || typeof s.command === 'string')
  );
}

/** Parse the store file. Back-compat: a top-level array is the old shape. */
function readStore(userDataDir: string): StoreFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(shortcutsFile(userDataDir), 'utf8'));
    if (Array.isArray(parsed)) {
      return { shortcuts: parsed.filter(isShortcut), removedDefaults: [] };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const shortcuts = Array.isArray(obj.shortcuts) ? obj.shortcuts.filter(isShortcut) : [];
      const removedDefaults = Array.isArray(obj.removedDefaults)
        ? obj.removedDefaults.filter((x): x is string => typeof x === 'string')
        : [];
      return { shortcuts, removedDefaults };
    }
    return { shortcuts: [], removedDefaults: [] };
  } catch {
    return { shortcuts: [], removedDefaults: [] };
  }
}

function writeStore(userDataDir: string, store: StoreFile): void {
  const file = shortcutsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2));
}

/** Add any default whose id is absent and was never removed by the user. A
 *  user-added shortcut with the same target+app counts as a hit too — a
 *  collision-light check that avoids two Finders if the user wired one. */
function withDefaults(store: StoreFile): StoreFile {
  const have = new Set(store.shortcuts.map((s) => s.id));
  const removed = new Set(store.removedDefaults);
  const toAdd = DEFAULT_SHORTCUTS.filter((d) => {
    if (have.has(d.id) || removed.has(d.id)) return false;
    if (d.target !== 'url' && d.app) {
      const dupe = store.shortcuts.some((s) => s.target === d.target && s.app === d.app);
      if (dupe) return false;
    }
    return true;
  });
  if (toAdd.length === 0) return store;
  return { ...store, shortcuts: [...store.shortcuts, ...toAdd] };
}

/** Read the shortcut list — back-filling defaults so they appear without a
 *  one-shot bootstrap step. */
export function loadShortcuts(userDataDir: string): Shortcut[] {
  return withDefaults(readStore(userDataDir)).shortcuts;
}

/** Persist the shortcut list. A default whose id has disappeared from `list`
 *  is recorded in `removedDefaults` so it does not respawn on the next load. */
export function saveShortcuts(userDataDir: string, list: Shortcut[]): void {
  const prev = readStore(userDataDir);
  const newIds = new Set(list.map((s) => s.id));
  const removedDefaults = new Set(prev.removedDefaults);
  for (const d of DEFAULT_SHORTCUTS) {
    if (!newIds.has(d.id)) removedDefaults.add(d.id);
  }
  writeStore(userDataDir, { shortcuts: list, removedDefaults: [...removedDefaults] });
}

/**
 * Launch a macOS application on a folder. Uses `open -a` — the only way to
 * target a *specific* app; Electron's `shell.openPath` opens the default
 * handler. macOS-specific by design (see the Phase D out-of-scope).
 */
export function launchApp(app: string, folder: string): void {
  execFile('open', ['-a', app, folder], (err) => {
    if (err) console.error(`shortcut launch failed (${app}): ${err.message}`);
  });
}

/** Open a URL in a Chrome window. */
export function launchUrl(url: string): void {
  execFile('open', ['-a', 'Google Chrome', url], (err) => {
    if (err) console.error(`shortcut URL launch failed: ${err.message}`);
  });
}

/** Find the bundle's primary `.icns` file. Order of preference: `AppIcon.icns`
 *  (the common Xcode default), an `.icns` named after the app, any `.icns`. */
function findBundleIcns(bundlePath: string): string | null {
  const resources = join(bundlePath, 'Contents/Resources');
  let files: string[];
  try {
    files = readdirSync(resources);
  } catch {
    return null;
  }
  const icnsFiles = files.filter((f) => f.toLowerCase().endsWith('.icns'));
  if (icnsFiles.length === 0) return null;
  const appName = basename(bundlePath, '.app').toLowerCase();
  const exact = icnsFiles.find((f) => f.toLowerCase() === 'appicon.icns');
  if (exact) return join(resources, exact);
  const named = icnsFiles.find((f) => f.toLowerCase().startsWith(appName));
  if (named) return join(resources, named);
  return join(resources, icnsFiles[0]);
}

/**
 * Extract the native icon for a macOS `.app` and return it as a data URL.
 * Cached per app path. `null` if extraction fails.
 *
 * **Why not `app.getFileIcon`.** On macOS 26.x with Electron 32, `getFileIcon`
 * for `.app` bundles dispatches through `[NSWorkspace iconForContentType:]`
 * and returns the generic "macOS application" icon for every app, not the
 * bundle's actual icon. Parallel calls also hang the icon-manager dispatch
 * queue long enough to trip V8's stuck-thread guard (see the crash earlier in
 * this phase). Reading the bundle's `.icns` file directly via
 * `nativeImage.createFromPath` bypasses NSWorkspace entirely — fast, no
 * contention, and returns the real icon.
 */
const iconCache = new Map<string, string | null>();
export function extractAppIcon(appPath: string): string | null {
  if (iconCache.has(appPath)) return iconCache.get(appPath) ?? null;
  const resolved = appPath.startsWith('/') ? appPath : (SYSTEM_APP_PATHS[appPath] ?? null);
  if (!resolved) {
    iconCache.set(appPath, null);
    return null;
  }
  const icns = findBundleIcns(resolved);
  if (!icns) {
    iconCache.set(appPath, null);
    return null;
  }
  try {
    const image = nativeImage.createFromPath(icns);
    const url = image.isEmpty() ? null : image.toDataURL();
    iconCache.set(appPath, url);
    return url;
  } catch {
    iconCache.set(appPath, null);
    return null;
  }
}

/** Decorate every shortcut with its `iconUrl` when an `.app` icon is available.
 *  For `project`/`lore` shortcuts only — `url` and `terminal` render glyph
 *  fallbacks in the renderer. Synchronous now that extraction is pure file I/O
 *  via `nativeImage.createFromPath` instead of the async NSWorkspace path. */
export function withIcons(list: Shortcut[]): Shortcut[] {
  return list.map((s) => {
    if (s.target === 'terminal' || s.target === 'url' || !s.app) return s;
    const iconUrl = extractAppIcon(s.app);
    return iconUrl ? { ...s, iconUrl } : s;
  });
}
