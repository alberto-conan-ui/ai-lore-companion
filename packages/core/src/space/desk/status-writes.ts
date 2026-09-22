/**
 * `status-writes.json`: what the companion last set each root's `Status` to.
 *
 * One record per root, replaced rather than appended: only the last value the
 * companion wrote matters. `project/activity.ts` says why the record exists
 * and how an override is told from it.
 */

import { type Result, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isStatusWrite } from './guards.js';
import { type DeskRecordFile, readDeskRecords, updateDeskRecords } from './store.js';
import type { JsonValue, StatusWrite } from './types.js';

/** The record file of the status marks. */
export const STATUS_WRITES_FILE: DeskRecordFile<StatusWrite> = {
  name: 'statusWrites',
  guard: isStatusWrite,
};

/** Every status mark. */
export function listStatusWrites(desk: Desk): Result<StatusWrite[], DeskFailure> {
  return readDeskRecords(desk, STATUS_WRITES_FILE);
}

/** The mark of the root `key`, or `null`. */
export function statusWriteOf(desk: Desk, key: string): Result<StatusWrite | null, DeskFailure> {
  const marks = listStatusWrites(desk);
  if (!marks.ok) return marks;
  return ok(marks.value.find((mark) => mark.key === key) ?? null);
}

/** Record that the companion set the root `key` to `set`, now. Replaces the root's mark. */
export function rememberStatusWrite(
  desk: Desk,
  key: string,
  set: string,
): Result<StatusWrite, DeskFailure> {
  return put(desk, key, { key, set, setAt: desk.now().toISOString() });
}

/**
 * Record that a value the companion did not write was seen on the root `key`.
 *
 * The mark keeps the value the companion last wrote, because that is still
 * what it wrote; `overriddenAt` says the Project no longer agrees.
 */
export function rememberStatusOverridden(
  desk: Desk,
  key: string,
  seen: string,
): Result<StatusWrite, DeskFailure> {
  const existing = statusWriteOf(desk, key);
  if (!existing.ok) return existing;
  return put(desk, key, {
    key,
    set: existing.value?.set ?? seen,
    setAt: existing.value?.setAt ?? desk.now().toISOString(),
    overriddenAt: desk.now().toISOString(),
  });
}

function put(desk: Desk, key: string, mark: StatusWrite): Result<StatusWrite, DeskFailure> {
  return updateDeskRecords(desk, STATUS_WRITES_FILE, (records) => {
    const kept = records.filter((entry) => !(isStatusWrite(entry) && entry.key === key));
    return ok({ records: [...kept, mark as unknown as JsonValue], value: mark });
  });
}
