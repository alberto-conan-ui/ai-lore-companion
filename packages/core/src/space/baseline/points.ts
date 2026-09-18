/**
 * The baseline points of one root: reviewed marks and session closes from the
 * desk's records, merged pull requests from the source the caller passes, and
 * the newest commits of the root's working tree, merged into one timeline.
 *
 * The read writes nothing. It is bounded: the newest `commitLimit` commits
 * (default 200), the newest 200 reviewed marks and the newest 200 session
 * closes of the root, and `pullRequestLimit` merged pull requests (default 50).
 *
 * The merged pull requests are the one part that needs GitHub. When the source
 * fails or throws, the other three kinds still come back and
 * `mergedPullRequests` says why that kind was left out.
 */

import type { Desk } from '../desk/desk.js';
import { listMarks } from '../desk/marks.js';
import { listSessionCloses } from '../desk/root-commits.js';
import { listSessions } from '../desk/sessions.js';
import type { CommandRunner } from '../exec/runner.js';
import { type Result, errorMessage, ok } from '../result.js';
import type { Root } from '../roots/types.js';
import {
  baselineFailure,
  openRootRepository,
  readCommitPoints,
  resolveCommits,
} from './repository.js';
import { assignSessions, orderBaselinePoints } from './timeline.js';
import {
  BASELINE_RECORD_LIMIT,
  type BaselineFailure,
  type BaselinePoint,
  type BaselinePoints,
  type CommitPoint,
  DEFAULT_BASELINE_COMMIT_LIMIT,
  DEFAULT_BASELINE_PULL_REQUEST_LIMIT,
  type MergedPullRequestPoint,
  type MergedPullRequestSource,
  type MergedPullRequestsStatus,
  type ReviewedMarkPoint,
  type SessionClosePoint,
} from './types.js';

/** What `listBaselinePoints` takes. */
export type ListBaselinePointsInput = {
  runner: CommandRunner;
  desk: Desk;
  root: Root;
  /**
   * Where the merged pull requests come from and the `owner/name` of the
   * root's repository on GitHub. Read only for a repository root; left out or
   * `null`, the points have no merged pull requests.
   */
  pullRequests?: { source: MergedPullRequestSource; repository: string } | null;
  /** The most commits to return. Default `DEFAULT_BASELINE_COMMIT_LIMIT`. */
  commitLimit?: number;
  /** The most merged pull requests to ask for. Default `DEFAULT_BASELINE_PULL_REQUEST_LIMIT`. */
  pullRequestLimit?: number;
};

function wholeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

async function readMergedPullRequests(
  input: ListBaselinePointsInput,
  limit: number,
): Promise<{ points: MergedPullRequestPoint[]; status: MergedPullRequestsStatus }> {
  const from = input.pullRequests ?? null;
  if (from === null || input.root.kind !== 'repository') {
    return { points: [], status: { status: 'not-applicable' } };
  }
  try {
    const answer = await from.source({ repository: from.repository, limit });
    if (!answer.ok) {
      return {
        points: [],
        status: {
          status: 'omitted',
          reason: String(answer.error.kind),
          message: String(answer.error.message),
        },
      };
    }
    const points: MergedPullRequestPoint[] = [];
    let withoutCommit = 0;
    for (const pull of answer.value.slice(0, limit)) {
      if (typeof pull.mergeCommit !== 'string' || pull.mergeCommit === '') {
        withoutCommit += 1;
        continue;
      }
      points.push({
        kind: 'merged-pull-request',
        commit: pull.mergeCommit,
        at: pull.mergedAt,
        number: pull.number,
        title: pull.title,
      });
    }
    return { points, status: { status: 'read', withoutCommit } };
  } catch (caught) {
    return {
      points: [],
      status: { status: 'omitted', reason: 'source-threw', message: errorMessage(caught) },
    };
  }
}

/**
 * Read the baseline points of `root`, newest first (the order is in
 * `timeline.ts`). Commits carry the `sessionId` of the session they are
 * grouped under; `groupBaselinePoints` turns the list into the picker's rows.
 *
 * A reviewed mark, a session close or a merged pull request whose commit is
 * not in the repository is still listed, with `commitMissing`. A recorded
 * short SHA is given as the full SHA it resolves to. A repository with no
 * commit gives the points the desk holds and no commits. A root with no change
 * tracking fails with `root-untracked`: it has no baseline.
 */
export async function listBaselinePoints(
  input: ListBaselinePointsInput,
): Promise<Result<BaselinePoints, BaselineFailure>> {
  const { runner, desk, root } = input;
  const commitLimit = wholeNumber(input.commitLimit, DEFAULT_BASELINE_COMMIT_LIMIT);
  const pullRequestLimit = wholeNumber(input.pullRequestLimit, DEFAULT_BASELINE_PULL_REQUEST_LIMIT);

  const repository = await openRootRepository(runner, root);
  if (!repository.ok) return repository;
  const { workTree, head } = repository.value;

  const marks = listMarks(desk, root.id);
  if (!marks.ok) return baselineFailure('desk-failed', marks.error.message, marks.error.kind);
  const closes = listSessionCloses(desk, root.id);
  if (!closes.ok) return baselineFailure('desk-failed', closes.error.message, closes.error.kind);
  const sessions = listSessions(desk);
  if (!sessions.ok) {
    return baselineFailure('desk-failed', sessions.error.message, sessions.error.kind);
  }

  const markPoints: ReviewedMarkPoint[] = marks.value
    .slice(-BASELINE_RECORD_LIMIT)
    .map((mark) => ({ kind: 'reviewed-mark', commit: mark.commit, at: mark.markedAt }));
  const closePoints: SessionClosePoint[] = closes.value
    .slice(-BASELINE_RECORD_LIMIT)
    .map((close) => ({
      kind: 'session-close',
      commit: close.commit,
      at: close.at,
      sessionId: close.sessionId,
    }));

  let commits: CommitPoint[] = [];
  let commitsTruncated = false;
  if (head !== null) {
    const log = await readCommitPoints(runner, workTree, commitLimit);
    if (!log.ok) return log;
    commits = assignSessions(log.value.commits, closes.value, sessions.value);
    commitsTruncated = log.value.truncated;
  }

  const pulls = await readMergedPullRequests(input, pullRequestLimit);

  const references = [...markPoints, ...pulls.points, ...closePoints];
  const resolved = await resolveCommits(
    runner,
    workTree,
    references.map((point) => point.commit),
  );
  if (!resolved.ok) return resolved;
  const checked = references.map((point): BaselinePoint => {
    const full = resolved.value.get(point.commit);
    return full === undefined ? { ...point, commitMissing: true } : { ...point, commit: full };
  });

  return ok({
    rootId: root.id,
    head,
    points: orderBaselinePoints([...checked, ...commits]),
    mergedPullRequests: pulls.status,
    limits: {
      commits: commitLimit,
      records: BASELINE_RECORD_LIMIT,
      pullRequests: pullRequestLimit,
      commitsTruncated,
      reviewedMarksTruncated: marks.value.length > BASELINE_RECORD_LIMIT,
      sessionClosesTruncated: closes.value.length > BASELINE_RECORD_LIMIT,
    },
  });
}
