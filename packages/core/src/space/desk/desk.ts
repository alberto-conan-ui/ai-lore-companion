/**
 * An open desk: the handle every function of this module takes.
 *
 * The app's main process opens the desk of a Space (`open.ts`) with the
 * `DeskPaths` it built from its own data folder; core never finds that folder
 * itself. The handle says whether this instance may write the records, and it
 * collects the notices that the Space window's header shows. The handle is for
 * the main process; it does not cross IPC. `deskNotices` gives plain data.
 */

import type { DeskPaths } from '../layout/desk-paths.js';
import type { Failure } from '../result.js';
import type { DeskFailureKind, DeskInstance, DeskNotice, DeskOwner } from './types.js';

/** A failure of a desk operation. */
export type DeskFailure = Failure<DeskFailureKind>;

/** An open desk. */
export type Desk = {
  /** The data-folder paths the desk was opened with. */
  readonly paths: DeskPaths;
  /** Whether this instance owns the desk. When `false`, every write fails with `not-writable`. */
  readonly writable: boolean;
  /** This instance. */
  readonly instance: DeskInstance;
  /** The instance the owner file names: this one, or the live one that holds the desk. */
  readonly owner: DeskOwner;
  /** The clock used for every time this module records. */
  readonly now: () => Date;
  /** Collected by the module's functions; read with `deskNotices`. */
  readonly notices: DeskNotice[];
};

/** The notices collected since the desk was opened, oldest first. A copy, plain data. */
export function deskNotices(desk: Desk): DeskNotice[] {
  return [...desk.notices];
}

/** Add `notice` to the desk unless the same notice is already there. */
export function addDeskNotice(desk: Desk, notice: DeskNotice): void {
  const text = JSON.stringify(notice);
  if (!desk.notices.some((existing) => JSON.stringify(existing) === text)) {
    desk.notices.push(notice);
  }
}
