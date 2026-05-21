import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecentProject } from '../shared/ipc.js';

/**
 * Recently-opened project folders, persisted as a small JSON file under
 * `app.getPath('userData')`. The list is capped and ordered most-recent-first;
 * it survives restarts and feeds both the File ▸ Open Recent menu and the
 * welcome window.
 */

const MAX_RECENTS = 10;

function recentsFile(userDataDir: string): string {
  return join(userDataDir, 'recents.json');
}

/** Read the recents list — an empty list when the file is absent or corrupt. */
export function loadRecents(userDataDir: string): RecentProject[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(recentsFile(userDataDir), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentProject =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as RecentProject).path === 'string' &&
        typeof (r as RecentProject).openedAt === 'number',
    );
  } catch {
    // No recents file yet, or it is unreadable — start from empty.
    return [];
  }
}

function writeRecents(userDataDir: string, recents: RecentProject[]): void {
  const file = recentsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(recents, null, 2));
}

/** Record `path` as the most recent project; returns the updated list. */
export function addRecent(userDataDir: string, path: string): RecentProject[] {
  const others = loadRecents(userDataDir).filter((r) => r.path !== path);
  const next = [{ path, openedAt: Date.now() }, ...others].slice(0, MAX_RECENTS);
  writeRecents(userDataDir, next);
  return next;
}

/** Empty the recents list. */
export function clearRecents(userDataDir: string): void {
  writeRecents(userDataDir, []);
}
