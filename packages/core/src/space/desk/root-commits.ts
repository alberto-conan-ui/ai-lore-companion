/**
 * `session-closes.json` and `first-seen.json`: commits of a root that the
 * companion records for the baseline picker.
 *
 * A session close is the commit a session left on a root when it left Writing.
 * A first-seen record is the commit a root had the first time the companion
 * saw it; a root that was never marked as reviewed compares against it. Both
 * are appended and never edited or removed, and a root has one first-seen
 * record: a second call returns the first.
 */

import { type Result, fail, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isFirstSeen, isJsonObject, isSessionClose, toPlainJson } from './guards.js';
import {
  type DeskRecordFile,
  appendDeskRecord,
  readDeskRecords,
  updateDeskRecords,
} from './store.js';
import type { FirstSeen, SessionClose } from './types.js';

/** The record file of the session closes. */
export const SESSION_CLOSES_FILE: DeskRecordFile<SessionClose> = {
  name: 'sessionCloses',
  guard: isSessionClose,
};

/** The record file of the first-seen commits. */
export const FIRST_SEEN_FILE: DeskRecordFile<FirstSeen> = {
  name: 'firstSeen',
  guard: isFirstSeen,
};

/** The session closes of the root `rootId`, oldest first; of every root when left out. */
export function listSessionCloses(
  desk: Desk,
  rootId?: string,
): Result<SessionClose[], DeskFailure> {
  const closes = readDeskRecords(desk, SESSION_CLOSES_FILE);
  if (!closes.ok || rootId === undefined) return closes;
  return ok(closes.value.filter((close) => close.rootId === rootId));
}

/** Record the commit `sessionId` left on the root `rootId` when it left Writing, now. */
export function recordSessionClose(
  desk: Desk,
  input: { rootId: string; commit: string; sessionId: string },
): Result<SessionClose, DeskFailure> {
  return appendDeskRecord(desk, SESSION_CLOSES_FILE, {
    rootId: input.rootId,
    commit: input.commit,
    sessionId: input.sessionId,
    at: desk.now().toISOString(),
  });
}

/** The first-seen record of every root. */
export function listFirstSeen(desk: Desk): Result<FirstSeen[], DeskFailure> {
  return readDeskRecords(desk, FIRST_SEEN_FILE);
}

/** The first-seen record of the root `rootId`, or `null`. */
export function getFirstSeen(desk: Desk, rootId: string): Result<FirstSeen | null, DeskFailure> {
  const all = listFirstSeen(desk);
  if (!all.ok) return all;
  return ok(all.value.find((seen) => seen.rootId === rootId) ?? null);
}

/**
 * Record `commit` as the commit the root `rootId` had when the companion first
 * saw it. When the root already has a record, that record is returned and
 * nothing is written.
 */
export function recordFirstSeen(
  desk: Desk,
  rootId: string,
  commit: string,
): Result<FirstSeen, DeskFailure> {
  const candidate = toPlainJson({ rootId, commit, at: desk.now().toISOString() });
  if (!isFirstSeen(candidate) || !isJsonObject(candidate)) {
    return fail('invalid-record', 'a first-seen record needs a root id and a commit');
  }
  return updateDeskRecords(desk, FIRST_SEEN_FILE, (records) => {
    const existing = records.find((record) => isFirstSeen(record) && record.rootId === rootId);
    if (isFirstSeen(existing)) return ok({ records: null, value: existing });
    return ok({ records: [...records, candidate], value: candidate });
  });
}
