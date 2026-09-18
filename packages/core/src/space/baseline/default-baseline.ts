/**
 * The default baseline of a root, and marking a root as reviewed.
 *
 * The default baseline of a root is its last reviewed mark. A root that was
 * never marked compares against the commit it had the first time the companion
 * saw it: `defaultBaselineOf` writes that first-seen record when the root has
 * none, and the desk keeps one per root, so it is written once.
 *
 * Marking as reviewed records the present commit of the root's working tree.
 * The mark is a commit, so afterwards the changes against the default baseline
 * hold no committed work, and files that are changed and not committed, and
 * untracked files, stay listed.
 *
 * A root with no change tracking (the Workbench, a folder in no repository)
 * has no baseline: both functions fail with `root-untracked` and write nothing.
 */

import type { Desk } from '../desk/desk.js';
import { addMark, listMarks } from '../desk/marks.js';
import { getFirstSeen, recordFirstSeen } from '../desk/root-commits.js';
import type { CommandRunner } from '../exec/runner.js';
import { type Result, ok } from '../result.js';
import { HEAD_BASELINE } from '../roots/changes-in.js';
import type { Root } from '../roots/types.js';
import { baselineFailure, openRootRepository, resolveCommits } from './repository.js';
import {
  BASELINE_RECORD_LIMIT,
  type BaselineFailure,
  type DefaultBaseline,
  type MarkedAsReviewed,
} from './types.js';

/** What `defaultBaselineOf` and `markRootReviewed` take. */
export type RootBaselineInput = { runner: CommandRunner; desk: Desk; root: Root };

/**
 * The default baseline of `root`: the newest reviewed mark whose commit is in
 * the repository, else the first-seen commit, else `HEAD`.
 *
 * - A root with no mark and no first-seen record gets its first-seen record
 *   here, at the present commit. A repository with no commit has nothing to
 *   record: the baseline is `HEAD` and the record is written by a later call,
 *   once there is a commit.
 * - A mark whose commit is gone (rebased away and pruned) is passed over and
 *   listed in `missing`; the next older mark is tried, of the newest 200. The
 *   same holds for a first-seen commit that is gone. With nothing left the
 *   baseline is `HEAD`, and `notice` says so.
 * - A mark whose commit is in the repository and is not an ancestor of `HEAD`
 *   is used as it is; `readChangesIn` reports it with `baselineIsAncestor: false`.
 * - On a desk this instance does not own, the first-seen record cannot be
 *   written: the present commit is returned as the baseline, not recorded.
 */
export async function defaultBaselineOf(
  input: RootBaselineInput,
): Promise<Result<DefaultBaseline, BaselineFailure>> {
  const { runner, desk, root } = input;
  const repository = await openRootRepository(runner, root);
  if (!repository.ok) return repository;
  const { workTree, head } = repository.value;

  const marks = listMarks(desk, root.id);
  if (!marks.ok) return baselineFailure('desk-failed', marks.error.message, marks.error.kind);
  const seen = getFirstSeen(desk, root.id);
  if (!seen.ok) return baselineFailure('desk-failed', seen.error.message, seen.error.kind);

  const newestMarks = marks.value.slice(-BASELINE_RECORD_LIMIT).reverse();
  const recorded = [
    ...newestMarks.map((mark) => mark.commit),
    ...(seen.value ? [seen.value.commit] : []),
  ];
  const resolved = await resolveCommits(runner, workTree, recorded);
  if (!resolved.ok) return resolved;

  const base = { rootId: root.id, firstSeenRecorded: false };
  const missing: DefaultBaseline['missing'] = [];
  for (const mark of newestMarks) {
    const commit = resolved.value.get(mark.commit);
    if (commit === undefined) {
      missing.push({ kind: 'reviewed-mark', commit: mark.commit, at: mark.markedAt });
      continue;
    }
    const notice =
      missing.length === 0
        ? null
        : 'The commit of the last reviewed mark is not in the repository any more, so an earlier mark is compared against.';
    return ok({
      ...base,
      baseline: commit,
      source: 'reviewed-mark',
      at: mark.markedAt,
      missing,
      notice,
    });
  }

  if (seen.value !== null) {
    const commit = resolved.value.get(seen.value.commit);
    if (commit !== undefined) {
      const notice =
        missing.length === 0
          ? null
          : 'The commits of the reviewed marks are not in the repository any more, so the commit this root had when it was first seen is compared against.';
      return ok({
        ...base,
        baseline: commit,
        source: 'first-seen',
        at: seen.value.at,
        missing,
        notice,
      });
    }
    missing.push({ kind: 'first-seen', commit: seen.value.commit, at: seen.value.at });
    return ok({
      ...base,
      baseline: HEAD_BASELINE,
      source: 'head',
      at: null,
      missing,
      notice:
        'The commits recorded for this root are not in the repository any more, so the present commit is compared against.',
    });
  }

  if (head === null) {
    return ok({
      ...base,
      baseline: HEAD_BASELINE,
      source: 'head',
      at: null,
      missing,
      notice: 'This repository has no commit yet, so every file in it is listed.',
    });
  }

  // Another call may have written the record during the awaits above. The desk is read again
  // here, with no await before the write, so `firstSeenRecorded` is true for one caller only.
  const already = getFirstSeen(desk, root.id);
  const written = recordFirstSeen(desk, root.id, head);
  if (written.ok) {
    // When another call wrote the record first, the desk returns that record.
    return ok({
      ...base,
      baseline: written.value.commit,
      source: 'first-seen',
      at: written.value.at,
      firstSeenRecorded: already.ok && already.value === null,
      missing,
      notice:
        missing.length === 0
          ? null
          : 'The commits of the reviewed marks are not in the repository any more, so the present commit was recorded to compare against.',
    });
  }
  if (written.error.kind === 'not-writable') {
    return ok({
      ...base,
      baseline: head,
      source: 'head',
      at: null,
      missing,
      notice:
        'Another instance of the companion owns this desk, so the commit this root is first seen at was not recorded.',
    });
  }
  return baselineFailure('desk-failed', written.error.message, written.error.kind);
}

/**
 * Mark `root` as reviewed: append a reviewed mark at the present commit of its
 * working tree. The mark becomes the root's default baseline, and `baseline`
 * is what the caller gives `RootTracker.setBaseline`.
 *
 * Committed work leaves the root's changes. Files that are changed and not
 * committed, and untracked files, stay listed, because the mark is a commit.
 * A repository with no commit fails with `no-commits`: there is nothing to
 * record. On a desk this instance does not own, the failure is `desk-failed`
 * with the cause `not-writable`.
 */
export async function markRootReviewed(
  input: RootBaselineInput,
): Promise<Result<MarkedAsReviewed, BaselineFailure>> {
  const { runner, desk, root } = input;
  const repository = await openRootRepository(runner, root);
  if (!repository.ok) return repository;
  const { head } = repository.value;
  if (head === null) {
    return baselineFailure(
      'no-commits',
      `${root.name} has no commit yet, so there is nothing to mark as reviewed`,
    );
  }
  const mark = addMark(desk, root.id, head);
  if (!mark.ok) return baselineFailure('desk-failed', mark.error.message, mark.error.kind);
  return ok({ mark: mark.value, baseline: head });
}
