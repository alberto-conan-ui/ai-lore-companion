import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Resolve the per-project data directory under userData.
 *   <userData>/projects/<sha1(absolute-root)>/
 *
 * Hashing the absolute root keeps paths filesystem-safe and isolates projects
 * from each other (a project at /a/foo and one at /b/foo land in distinct dirs).
 * Per-project state lives here as flat JSON sidecar files.
 */
export function projectDataDir(userDataDir: string, projectRoot: string): string {
  const hash = createHash('sha1').update(resolve(projectRoot)).digest('hex');
  return resolve(userDataDir, 'projects', hash);
}
