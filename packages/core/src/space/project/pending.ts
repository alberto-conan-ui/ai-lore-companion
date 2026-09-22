/**
 * Replaying the writes to GitHub that did not land.
 *
 * The queue itself is `desk/pending-writes.ts`, which says why it exists. This
 * module is the other half: turning a queued intent back into the call that
 * makes the Project say it.
 *
 * Two rules govern the replay, and both come from the queue holding intents
 * rather than requests.
 *
 * **In order, and stop at the first failure.** A comment on a session's issue
 * must not be replayed before the write that creates that issue. Draining
 * therefore walks the queue oldest first and gives up the moment one fails,
 * rather than skipping past it — a later intent may depend on an earlier one
 * having landed.
 *
 * **Replaying is safe more than once.** `putSessionIssue` finds a session's
 * issue by its marker before it creates one, and a move is a field value. A
 * comment is the exception: GitHub has no way to say "this comment, once", so a
 * comment that GitHub accepted and then failed to acknowledge would be written
 * twice. Losing a handover is worse than seeing it twice, so a comment is
 * replayed and the duplicate is accepted.
 */

import {
  type Desk,
  type DeskFailure,
  dropPendingWrite,
  listPendingWrites,
  recordPendingAttempt,
} from '../desk/index.js';
import type { PendingWrite } from '../desk/types.js';
import type { AgentsColumn } from '../github/types.js';
import { type Result, ok } from '../result.js';
import { describeGitHubFailure } from './session-issue.js';
import {
  type SessionIssueContent,
  type SessionIssuePlace,
  moveSessionIssue,
  putSessionIssue,
} from './session-issue.js';

/** What a drain did. */
export type DrainReport = {
  /** The writes that landed and were dropped from the queue. */
  landed: number;
  /** The writes still queued when the drain stopped. */
  waiting: number;
  /**
   * Why the drain stopped, or `null` when the queue emptied. A drain that stops
   * is not a failure of the drain: the writes are still queued.
   */
  stoppedBecause: string | null;
};

/**
 * Replay the queued writes, oldest first, until one fails or the queue empties.
 *
 * The desk is the record: a write that lands is dropped, and a write that does
 * not has its attempt counted with the reason, so a Human Lead reading the
 * queue sees what has not landed and why.
 */
export async function drainPendingWrites(
  place: SessionIssuePlace,
  desk: Desk,
): Promise<Result<DrainReport, DeskFailure>> {
  const queued = listPendingWrites(desk);
  if (!queued.ok) return queued;
  let landed = 0;
  for (const [index, write] of queued.value.entries()) {
    const sent = await replay(place, write);
    if (sent === null) {
      dropPendingWrite(desk, write.id);
      landed += 1;
      continue;
    }
    recordPendingAttempt(desk, write.id, sent);
    return ok({ landed, waiting: queued.value.length - index, stoppedBecause: sent });
  }
  return ok({ landed, waiting: 0, stoppedBecause: null });
}

/** Make the Project say what `write` says. `null` when it landed, the reason when it did not. */
async function replay(place: SessionIssuePlace, write: PendingWrite): Promise<string | null> {
  switch (write.kind) {
    case 'session-issue': {
      const put = await putSessionIssue(
        place,
        write.content as unknown as SessionIssueContent,
        write.column as AgentsColumn,
      );
      return put.ok ? null : describeGitHubFailure(put.error);
    }
    case 'comment': {
      const commented = await place.github.comment({ issue: write.issue, body: write.body });
      return commented.ok ? null : describeGitHubFailure(commented.error);
    }
    case 'move': {
      const moved = await moveSessionIssue(place, write.issue, write.column as AgentsColumn);
      return moved.ok ? null : describeGitHubFailure(moved.error);
    }
  }
}

/** One line per queued write, for a Human Lead who wants to know what has not landed. */
export function describePendingWrite(write: PendingWrite): string {
  const what =
    write.kind === 'session-issue'
      ? `the session's issue, in the column ${write.column}`
      : write.kind === 'comment'
        ? `a comment on ${write.issue.url}`
        : `${write.issue.url} moved to the column ${write.column}`;
  const tries = write.attempts === 1 ? 'tried once' : `tried ${write.attempts} times`;
  const why = write.lastError === undefined ? '' : `: ${write.lastError}`;
  return `${what}, queued at ${write.queuedAt}, ${tries}${why}`;
}
