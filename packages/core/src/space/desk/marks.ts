/**
 * `reviewed-marks.json`: the commits at which the Human Lead marked a root as
 * reviewed.
 *
 * Marks are appended and never edited or removed, so the baseline picker can
 * list earlier marks: this module has no function that changes or deletes one.
 * `baseline/` and the Files window call only `listMarks` and `addMark`, so a
 * different store for marks changes this file alone.
 */

import { type Result, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isReviewedMark } from './guards.js';
import { type DeskRecordFile, appendDeskRecord, readDeskRecords } from './store.js';
import type { ReviewedMark } from './types.js';

/** The record file of the reviewed marks. */
export const REVIEWED_MARKS_FILE: DeskRecordFile<ReviewedMark> = {
  name: 'reviewedMarks',
  guard: isReviewedMark,
};

/** The reviewed marks of the root `rootId`, oldest first; of every root when `rootId` is left out. */
export function listMarks(desk: Desk, rootId?: string): Result<ReviewedMark[], DeskFailure> {
  const marks = readDeskRecords(desk, REVIEWED_MARKS_FILE);
  if (!marks.ok || rootId === undefined) return marks;
  return ok(marks.value.filter((mark) => mark.rootId === rootId));
}

/** The newest reviewed mark of the root `rootId`, which is the root's default baseline, or `null`. */
export function lastMark(desk: Desk, rootId: string): Result<ReviewedMark | null, DeskFailure> {
  const marks = listMarks(desk, rootId);
  if (!marks.ok) return marks;
  return ok(marks.value.at(-1) ?? null);
}

/** Record that the root `rootId` was marked as reviewed at `commit`, now. */
export function addMark(
  desk: Desk,
  rootId: string,
  commit: string,
): Result<ReviewedMark, DeskFailure> {
  return appendDeskRecord(desk, REVIEWED_MARKS_FILE, {
    rootId,
    commit,
    markedAt: desk.now().toISOString(),
  });
}
