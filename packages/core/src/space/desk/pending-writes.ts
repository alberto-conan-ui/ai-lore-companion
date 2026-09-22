/**
 * `pending-writes.json`: the writes to GitHub that did not land, kept until
 * they do.
 *
 * Every write the companion makes to the Project used to be attempted once. If
 * GitHub could not be reached the caller was told and the write was gone. That
 * is not a hypothetical: on 2026-09-22 a session was granted Writing and the
 * companion answered, in as many words, *"the Agents board on GitHub was not
 * updated because GitHub answered: gh was not found on this machine, and
 * nothing will retry it"* — and several sessions of this Space lost their
 * handovers entirely the same way.
 *
 * A pending write is an **intent**, not a request: what the Project should say,
 * rather than the call that failed to say it. Replaying an intent is therefore
 * safe more than once. `putSessionIssue` finds a session's issue by its marker
 * before it creates one, so replaying `session-issue` updates the issue that
 * exists instead of making a second.
 *
 * The queue is a desk record file, so it is on disk and survives the companion
 * being closed, which is what makes it durable rather than merely deferred.
 */

import { type Result, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isPendingWrite } from './guards.js';
import { type DeskRecordFile, readDeskRecords, updateDeskRecords } from './store.js';
import type { JsonValue, PendingWrite } from './types.js';

/** The record file of the pending writes. */
export const PENDING_WRITES_FILE: DeskRecordFile<PendingWrite> = {
  name: 'pendingWrites',
  guard: isPendingWrite,
};

/**
 * Every pending write, oldest first.
 *
 * The order is the order they were queued, and draining keeps it: a comment on
 * a session's issue must not be replayed before the write that creates the
 * issue.
 */
export function listPendingWrites(desk: Desk): Result<PendingWrite[], DeskFailure> {
  return readDeskRecords(desk, PENDING_WRITES_FILE);
}

/** The pending writes of one session, oldest first. */
export function pendingWritesOf(
  desk: Desk,
  sessionId: string,
): Result<PendingWrite[], DeskFailure> {
  const all = listPendingWrites(desk);
  if (!all.ok) return all;
  return ok(all.value.filter((write) => write.sessionId === sessionId));
}

/**
 * A pending write as its caller states it: everything but the two fields the
 * queue keeps for itself.
 *
 * Distributive on purpose. A plain `Omit` over a discriminated union collapses
 * it to the fields every member shares, and `column` and `issue` would then be
 * rejected on the very shapes that have them.
 */
export type PendingWriteInput = PendingWrite extends infer W
  ? W extends PendingWrite
    ? Omit<W, 'queuedAt' | 'attempts'> & { attempts?: number }
    : never
  : never;

/** Queue a write that did not land. `id` is the caller's, so a repeat of the same intent replaces it. */
export function queuePendingWrite(
  desk: Desk,
  write: PendingWriteInput,
): Result<PendingWrite, DeskFailure> {
  const record = {
    ...write,
    attempts: write.attempts ?? 1,
    queuedAt: desk.now().toISOString(),
  } as PendingWrite;
  // An intent supersedes an earlier one with the same id: the newest statement
  // of what the Project should say is the only one worth replaying.
  return updateDeskRecords(desk, PENDING_WRITES_FILE, (records) => {
    const kept = records.filter((entry) => !(isPendingWrite(entry) && entry.id === record.id));
    return ok({ records: [...kept, asJson(record)], value: record });
  });
}

/** A record on its way into a desk file, which holds plain JSON. */
function asJson(write: PendingWrite): JsonValue {
  return write as unknown as JsonValue;
}

/** Forget a pending write, because it landed. */
export function dropPendingWrite(desk: Desk, id: string): Result<void, DeskFailure> {
  return updateDeskRecords(desk, PENDING_WRITES_FILE, (records) => {
    const kept = records.filter((entry) => !(isPendingWrite(entry) && entry.id === id));
    return ok({ records: kept, value: undefined });
  });
}

/** Record that a pending write was tried again and did not land. */
export function recordPendingAttempt(
  desk: Desk,
  id: string,
  error: string,
): Result<void, DeskFailure> {
  return updateDeskRecords(desk, PENDING_WRITES_FILE, (records) => {
    const next = records.map((entry) =>
      isPendingWrite(entry) && entry.id === id
        ? asJson({
            ...entry,
            attempts: entry.attempts + 1,
            lastError: error,
            lastTriedAt: desk.now().toISOString(),
          })
        : entry,
    );
    return ok({ records: next, value: undefined });
  });
}
