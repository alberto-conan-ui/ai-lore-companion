/**
 * The recents of Spaces: the Spaces the Human Lead has opened, newest first,
 * kept in `<userData>/spaces/recents.json`. It is a file of its own, apart
 * from the `recents.json` of the v0.8 projects, so that no file the current
 * app rewrites gains a 1.0 field. A missing or damaged file reads as an empty
 * list, and an entry that is not well formed is dropped.
 *
 * Beside what the welcome screen shows, the file keeps for each Space the
 * path its folder resolved to when the Human Lead opened it (`realPath`).
 * The renderer may name a recent Space to open; main opens it only while the
 * folder still resolves to that path (`resolveRecentSpace`). A folder that
 * has since been replaced by a symbolic link to another place is not opened
 * on the renderer's word.
 */

import { join } from 'node:path';
import { spacesDir } from '@ai-lore-companion/core';
import { z } from 'zod';
import type { RecentSpace } from '../../shared/ipc.js';
import { readJsonFile, writeJsonFileAtomic } from '../json-file.js';
import { canonicalFolder } from './folders.js';

const MAX_RECENT_SPACES = 10;

const storedRecentSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  openedAt: z.number(),
  realPath: z.string().min(1).optional(),
});

/** An entry of the file: what the welcome screen shows, and where the folder resolved to. */
type StoredRecentSpace = z.infer<typeof storedRecentSchema>;

/** Whether main opens the recent Space the renderer named. */
export type RecentSpaceLookup =
  /** `folder` is a recent Space and its folder still resolves where it did. Open `path`. */
  | { status: 'found'; path: string }
  /** `folder` is a recent Space, but its folder now resolves to another place. */
  | { status: 'moved' }
  /** `folder` is not in the recents. */
  | { status: 'unknown' };

function recentsFile(userDataDir: string): string {
  return join(spacesDir(userDataDir), 'recents.json');
}

function loadStored(userDataDir: string): StoredRecentSpace[] {
  const parsed = readJsonFile(recentsFile(userDataDir));
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): StoredRecentSpace[] => {
    const read = storedRecentSchema.safeParse(entry);
    return read.success ? [read.data] : [];
  });
}

function shown(stored: readonly StoredRecentSpace[]): RecentSpace[] {
  return stored.map(({ path, name, openedAt }) => ({ path, name, openedAt }));
}

/** Read the recents of Spaces. */
export function loadRecentSpaces(userDataDir: string): RecentSpace[] {
  return shown(loadStored(userDataDir));
}

function writeStored(userDataDir: string, recents: StoredRecentSpace[]): void {
  writeJsonFileAtomic(recentsFile(userDataDir), recents, { pretty: true });
}

/** Record the Space at `path` as the most recent; returns the updated list. */
export function addRecentSpace(
  userDataDir: string,
  space: { path: string; name: string },
  now: number = Date.now(),
): RecentSpace[] {
  const others = loadStored(userDataDir).filter((recent) => recent.path !== space.path);
  const entry: StoredRecentSpace = {
    path: space.path,
    name: space.name,
    openedAt: now,
    realPath: canonicalFolder(space.path),
  };
  const next = [entry, ...others].slice(0, MAX_RECENT_SPACES);
  writeStored(userDataDir, next);
  return shown(next);
}

/** Drop one Space from the list; returns the updated list. */
export function removeRecentSpace(userDataDir: string, path: string): RecentSpace[] {
  const recents = loadStored(userDataDir);
  const next = recents.filter((recent) => recent.path !== path);
  if (next.length !== recents.length) writeStored(userDataDir, next);
  return shown(next);
}

/**
 * The recent Space the renderer named with `folder`. It is found by its
 * recorded path, as text or after symbolic links are resolved, and it is
 * opened only while its folder resolves to the path recorded when the Human
 * Lead opened it.
 */
export function resolveRecentSpace(userDataDir: string, folder: string): RecentSpaceLookup {
  const wanted = canonicalFolder(folder);
  const recent = loadStored(userDataDir).find(
    (entry) => entry.path === folder || canonicalFolder(entry.path) === wanted,
  );
  if (!recent) return { status: 'unknown' };
  if (recent.realPath === undefined || canonicalFolder(recent.path) !== recent.realPath) {
    return { status: 'moved' };
  }
  return { status: 'found', path: recent.path };
}
