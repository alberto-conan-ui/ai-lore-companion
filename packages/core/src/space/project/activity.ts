/**
 * What `Status` should say about a root, and when the companion may say it.
 *
 * `Status` is the activity axis: is a desk on this **now**. It was set by hand,
 * and a hand-maintained activity field goes stale exactly the way the first
 * one did — which is the defect this focus exists to cure, so shipping a
 * second instance of it would be self-defeating. The companion already knows
 * when a session claims a write target and when it releases, so it can say.
 *
 * This module is the decision alone, with no GitHub and no desk in it, because
 * the decision is the part worth being sure of.
 *
 * ## The rules
 *
 * - A root a session is working on is `In Progress`.
 * - A root no session is on, that some session has worked, is `Paused`.
 * - **`Todo` only ever means no session has yet worked it.** Nothing moves a
 *   root back to it. A root that is still `Todo` and that nobody is on is left
 *   alone, because there is nothing to say about it.
 * - **`Done` is the Human Lead's call**, never the companion's. A root that is
 *   ready for the Done call is not moved to `Paused` behind it: the readiness
 *   computation is the thing that asks for the call, and a root flipping to
 *   `Paused` underneath that question would contradict it.
 * - **A Human Lead's value sticks.** See below.
 *
 * ## How an override is known
 *
 * The companion records what it last set. When the value on the Project is not
 * that, somebody else set it, and the companion stops writing that root's
 * Status until the Human Lead's value and the computed one agree again.
 *
 * This is deliberately not done with `updatedAt`. A single-select value does
 * carry its own timestamp, but whether re-setting a value to what it already
 * is moves that timestamp was never established — it is an open question in
 * this Space's own notes on the GitHub API. A rule built on it would be a rule
 * nobody has checked. What the companion last wrote is a fact it owns.
 */

import type { StatusWrite } from '../desk/types.js';
import type { StatusValue } from '../github/types.js';

export type { StatusWrite };

/** What the companion knows about a root when it decides. */
export type ActivityInput = {
  /** The value the Project carries now, or null when the root has none. */
  current: StatusValue | null;
  /** What the companion last set, when it has set anything. */
  mark: StatusWrite | null;
  /** Whether a session is working on this root now. */
  working: boolean;
  /**
   * Whether the root is ready for the Human Lead's Done call. A ready root is
   * not moved to `Paused`: the call is the question being asked of it.
   */
  doneCallDue: boolean;
};

/** What to do about a root's Status. */
export type ActivityDecision =
  | { write: StatusValue; clearOverride: boolean }
  | { leave: string; override: boolean };

/**
 * The Status a root should carry, or why the companion leaves it alone.
 *
 * `override` on a `leave` says the value was set by somebody else and the
 * caller should record that, so the next decision knows without having to work
 * it out again.
 */
export function decideStatus(input: ActivityInput): ActivityDecision {
  const { current, mark, working, doneCallDue } = input;

  // Someone changed it since the companion wrote it. Their value stands.
  const changedByHand = mark !== null && current !== mark.set;
  if (changedByHand) {
    return { leave: `the Status was set to ${current ?? 'nothing'} by hand`, override: true };
  }

  const wanted: StatusValue | null = working ? 'In Progress' : started(input) ? 'Paused' : null;

  // An override stands until the Human Lead's value and the computed one agree
  // again; then there is nothing left to disagree about, and the companion
  // resumes without needing to be told.
  if (mark?.overriddenAt !== undefined) {
    if (wanted === null || current !== wanted) {
      return { leave: 'the Human Lead set this Status', override: false };
    }
    return { write: wanted, clearOverride: true };
  }

  if (current === 'Done') {
    return { leave: 'the Human Lead has made the Done call', override: false };
  }
  if (wanted === null) {
    return { leave: 'no session has worked this yet', override: false };
  }
  if (!working && doneCallDue) {
    return { leave: 'it is ready for the Done call', override: false };
  }
  if (current === wanted) return { leave: `it already says ${wanted}`, override: false };
  return { write: wanted, clearOverride: false };
}

/**
 * Whether any session has worked this root.
 *
 * A root the companion has written before has been worked, by definition. So
 * has one whose Status is not `Todo`, which covers the roots that were set by
 * hand before the companion maintained the field at all.
 */
function started(input: ActivityInput): boolean {
  return input.mark !== null || (input.current !== null && input.current !== 'Todo');
}

/** The key of a root, as a status mark holds it. */
export function rootKey(repository: string, number: number): string {
  return `${repository}#${number}`;
}
