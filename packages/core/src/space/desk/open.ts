/**
 * Opening and closing a desk.
 *
 * Opening creates the desk folder, decides whether this instance may write the
 * records (`owner.ts`), removes the temporary files an interrupted write left
 * behind, and makes sure the two files the `write-guard` check script reads
 * are on disk, because the script refuses when one is missing.
 */

import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isAtomicTempName } from '../fs/atomic-write.js';
import type { DeskPaths } from '../layout/desk-paths.js';
import { type Result, ok } from '../result.js';
import { CLAIMS_FILE } from './claims.js';
import type { Desk, DeskFailure } from './desk.js';
import {
  DESK_DIR_MODE,
  type OwnerProbe,
  currentDeskInstance,
  isProcessRunning,
  releaseDeskOwnership,
  takeDeskOwnership,
} from './owner.js';
import { SESSIONS_FILE } from './sessions.js';
import { ensureDeskRecordFile } from './store.js';
import type { DeskInstance } from './types.js';

/** Options of `openDesk`. The defaults are what the app uses; tests pass their own. */
export type OpenDeskOptions = {
  /** The clock. Default: the system clock. */
  now?: () => Date;
  /** The instance that opens the desk. Default: this process. */
  instance?: DeskInstance;
  /** Whether the process an owner file names still runs. Default: `isDeskOwnerRunning`. */
  isOwnerRunning?: OwnerProbe;
};

/** The process id in the name of a temporary file of an atomic write: `.<name>.<pid>-<random>.atomic-tmp`. */
const TEMP_NAME_PID = /\.(\d+)-[0-9a-f]+\.atomic-tmp$/;

/**
 * Remove what an interrupted atomic write left in the desk folder. The
 * temporary file of another process that still runs is left: an instance that
 * opens the desk at the same moment is writing its owner file through one.
 * Failures are ignored.
 */
function removeLeftoverTempFiles(deskDir: string): void {
  try {
    for (const name of readdirSync(deskDir)) {
      if (!isAtomicTempName(name)) continue;
      const pid = Number(TEMP_NAME_PID.exec(name)?.[1] ?? Number.NaN);
      if (pid !== process.pid && Number.isInteger(pid) && pid > 0 && isProcessRunning(pid))
        continue;
      rmSync(join(deskDir, name), { force: true });
    }
  } catch {
    // A reader opens a record by its own name, so a temporary file that stays is never read.
  }
}

/** Give the desk folder the mode of the desk when an earlier build or a tool created it more open. */
function tightenDeskDir(deskDir: string): void {
  try {
    // Not through a symbolic link: the folder it points to is not the desk's to change.
    if (lstatSync(deskDir).isDirectory()) chmodSync(deskDir, DESK_DIR_MODE);
  } catch {
    // The folder stays as it is; the record files are written with their own mode.
  }
}

/**
 * Open the desk at `paths`. A desk held by another live instance opens with
 * `writable: false`; that is a successful result, and the caller shows it in
 * the header. `desk.notices` says what was found: a stale owner replaced, a
 * file set aside.
 */
export function openDesk(
  paths: DeskPaths,
  options: OpenDeskOptions = {},
): Result<Desk, DeskFailure> {
  const now = options.now ?? (() => new Date());
  const instance = options.instance ?? currentDeskInstance();
  const taken = takeDeskOwnership(paths.desk, instance, {
    now,
    ...(options.isOwnerRunning ? { isOwnerRunning: options.isOwnerRunning } : {}),
  });
  if (!taken.ok) return taken;
  const { owned, owner, notices } = taken.value;
  const desk: Desk = { paths, writable: owned, instance, owner, now, notices: [...notices] };
  if (owned) {
    tightenDeskDir(paths.desk);
    removeLeftoverTempFiles(paths.desk);
    for (const file of [SESSIONS_FILE, CLAIMS_FILE]) {
      const ensured = ensureDeskRecordFile(desk, file);
      // A file of a newer build is left as it is; reading it reports the same failure.
      if (!ensured.ok && ensured.error.kind !== 'newer-version') return ensured;
    }
  }
  return ok(desk);
}

/** Give the desk up when the Space closes: removes the owner file when it names this instance. */
export function closeDesk(desk: Desk): Result<void, DeskFailure> {
  if (!desk.writable) return ok(undefined);
  return releaseDeskOwnership(desk.paths.desk, desk.instance);
}
