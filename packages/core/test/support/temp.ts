/**
 * Temporary folders for core's own tests.
 *
 * Loading this file puts the process in test mode (`AI_LORE_TEST=1`), so the
 * real command runner refuses a working folder or a git address outside the
 * temporary folder. Every test that uses the real runner gets its folders
 * from here or from the builders of `src/space/testing`.
 */

import type { TestContext } from 'node:test';
import { enableTestMode, makeTempDir } from '../../src/space/testing/temp.js';

enableTestMode();

/** What `useTempDir` needs from a test: a place to register the removal. */
export type CleanupHost = Pick<TestContext, 'after'>;

/**
 * Create a temporary folder that is removed when the test `t` ends, passed or
 * failed. Returns the folder's real path.
 */
export function useTempDir(t: CleanupHost, prefix?: string): string {
  const temp = makeTempDir(prefix);
  t.after(() => temp.cleanup());
  return temp.dir;
}
