/**
 * Temporary folders for tests and fixture builders.
 *
 * This folder (`space/testing`) is built with the package because the app's
 * tests use the same builders as core's tests and cannot import from
 * `packages/core/test/`. It is not part of core's main barrel, which the app
 * loads in production; tests import it as `@ai-lore-companion/core/testing`.
 * Nothing here runs when the module is loaded: test mode is switched on by
 * calling a builder, never by importing one.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_MODE_ENV } from '../exec/guard.js';

/** A temporary folder and the function that removes it. */
export type TempDir = {
  /** The folder's real path (on macOS the temporary folder is behind a symbolic link). */
  dir: string;
  /** Remove the folder and everything in it. Safe to call twice. */
  cleanup: () => void;
};

/**
 * Put this process in test mode (`AI_LORE_TEST=1`), in which the real command
 * runner refuses a working folder or a git address outside the temporary
 * folder. Every builder in this folder calls it first.
 */
export function enableTestMode(): void {
  process.env[TEST_MODE_ENV] = '1';
}

/** Create a folder under `os.tmpdir()` whose name starts with `prefix`. */
export function makeTempDir(prefix = 'ai-lore-test-'): TempDir {
  enableTestMode();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
