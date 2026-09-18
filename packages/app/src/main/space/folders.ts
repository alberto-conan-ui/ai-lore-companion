/** Folder paths as main compares them. */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A folder's path for comparing two folders: symbolic links and the case of
 * the path on disk are resolved with `realpath`. A path that cannot be
 * resolved (the folder has moved) is only made absolute. `main/index.ts` has
 * the same rule for the windows of v0.8 projects.
 */
export function canonicalFolder(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch {
    return resolve(folder);
  }
}
