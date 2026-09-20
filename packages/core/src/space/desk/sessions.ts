/**
 * `sessions.json`: the sessions of the desk and the mode of each.
 *
 * The `write-guard` check script reads the `id` and the `mode` of a session
 * from this file, and refuses when an id is there twice, so `addSession`
 * refuses a second record with the same id.
 */

import { type Result, fail, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isJsonObject, isSessionRecord, toPlainJson } from './guards.js';
import {
  type DeskRecordFile,
  appendDeskRecord,
  readDeskRecords,
  updateDeskRecords,
} from './store.js';
import type { SessionPatch, SessionRecord, SessionSpend } from './types.js';

/** The record file of the sessions. */
export const SESSIONS_FILE: DeskRecordFile<SessionRecord> = {
  name: 'sessions',
  guard: isSessionRecord,
};

/** Every session of the desk, open and closed, oldest first. */
export function listSessions(desk: Desk): Result<SessionRecord[], DeskFailure> {
  return readDeskRecords(desk, SESSIONS_FILE);
}

/** The session with the id `sessionId`, or `null`. */
export function getSession(
  desk: Desk,
  sessionId: string,
): Result<SessionRecord | null, DeskFailure> {
  const sessions = listSessions(desk);
  if (!sessions.ok) return sessions;
  return ok(sessions.value.find((session) => session.id === sessionId) ?? null);
}

/** Record a new session. Fails with `duplicate` when the id is already recorded. */
export function addSession(desk: Desk, session: SessionRecord): Result<SessionRecord, DeskFailure> {
  return appendDeskRecord(desk, SESSIONS_FILE, session, (records) =>
    // Any entry with this id counts, understood or not: the check script reads ids only.
    records.some((record) => isJsonObject(record) && record.id === session.id)
      ? { kind: 'duplicate', message: `the session "${session.id}" is already recorded` }
      : null,
  );
}

/**
 * Change the mode, the close time, the item or the issue of a session. Fields
 * the patch does not name, and fields this build does not know, stay as they are.
 */
export function updateSession(
  desk: Desk,
  sessionId: string,
  patch: SessionPatch,
): Result<SessionRecord, DeskFailure> {
  return updateDeskRecords(desk, SESSIONS_FILE, (records) => {
    const index = records.findIndex((record) => isSessionRecord(record) && record.id === sessionId);
    const current = records[index];
    if (index < 0 || !isJsonObject(current)) {
      return fail('not-found', `no session "${sessionId}" is recorded`);
    }
    // A field the patch gives as `undefined` is a field it does not name, so it stays.
    const named = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const next = toPlainJson({ ...current, ...named });
    if (!isSessionRecord(next) || !isJsonObject(next) || next.id !== sessionId) {
      return fail(
        'invalid-record',
        `the change does not leave a session record for "${sessionId}"`,
      );
    }
    if (next.closedAt !== undefined && next.mode === 'writing') {
      // The check script reads the mode only, so a session that has ended is never left in Writing.
      return fail(
        'invalid-record',
        `the session "${sessionId}" has ended and cannot be in Writing`,
      );
    }
    const list = [...records];
    list[index] = next;
    return ok({ records: list, value: next });
  });
}

/**
 * Record that a session ended: sets `closedAt` and puts the session in Read
 * only. When `spend` is given, it is recorded in the same write. Its claims
 * are released separately, with `releaseClaims`.
 */
export function closeSession(
  desk: Desk,
  sessionId: string,
  spend?: SessionSpend,
): Result<SessionRecord, DeskFailure> {
  return updateSession(desk, sessionId, {
    mode: 'read-only',
    closedAt: desk.now().toISOString(),
    ...(spend !== undefined ? { spend } : {}),
  });
}
