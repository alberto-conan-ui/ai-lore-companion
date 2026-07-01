import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { z } from 'zod';
import type { RecentProject } from '../shared/ipc.js';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';

/**
 * Recently-opened project folders, persisted as a small JSON file under
 * `app.getPath('userData')`. The list is capped and ordered most-recent-first;
 * it survives restarts and feeds both the File ▸ Open Recent menu and the
 * welcome window.
 */

/**
 * The File ▸ Open Recent menu label. Electron doesn't render a menu item's
 * `sublabel`, so the disambiguating path has to live in the label itself —
 * otherwise two projects with the same folder name (e.g. two `Iberia_2026`s)
 * are indistinguishable. Format: `<folder> — <tilde-abbreviated parent dir>`.
 */
export function recentMenuLabel(path: string): string {
  const parent = dirname(path);
  const home = homedir();
  const tildeParent =
    parent === home
      ? '~'
      : parent.startsWith(home + sep)
        ? `~${parent.slice(home.length)}`
        : parent;
  return `${basename(path)} — ${tildeParent}`;
}

const MAX_RECENTS = 10;

function recentsFile(userDataDir: string): string {
  return join(userDataDir, 'recents.json');
}

const recentSchema = z.object({ path: z.string(), openedAt: z.number() });

/** Read the recents list — an empty list when the file is absent or corrupt;
 *  malformed entries are dropped, well-formed ones kept. */
export function loadRecents(userDataDir: string): RecentProject[] {
  const parsed = readJsonFile(recentsFile(userDataDir));
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((r): RecentProject[] => {
    const entry = recentSchema.safeParse(r);
    return entry.success ? [entry.data] : [];
  });
}

function writeRecents(userDataDir: string, recents: RecentProject[]): void {
  writeJsonFileAtomic(recentsFile(userDataDir), recents, { pretty: true });
}

/** Record `path` as the most recent project; returns the updated list. */
export function addRecent(userDataDir: string, path: string): RecentProject[] {
  const others = loadRecents(userDataDir).filter((r) => r.path !== path);
  const next = [{ path, openedAt: Date.now() }, ...others].slice(0, MAX_RECENTS);
  writeRecents(userDataDir, next);
  return next;
}

/** Drop a single project from the recents list; returns the updated list. */
export function removeRecent(userDataDir: string, path: string): RecentProject[] {
  const next = loadRecents(userDataDir).filter((r) => r.path !== path);
  writeRecents(userDataDir, next);
  return next;
}

/** Empty the recents list. */
export function clearRecents(userDataDir: string): void {
  writeRecents(userDataDir, []);
}
