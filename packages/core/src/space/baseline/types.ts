/**
 * The shapes of the baseline points of a root, of a root's default baseline
 * and of marking a root as reviewed.
 *
 * This file imports types only and nothing of Node, so that the renderer can
 * take every shape here with `import type`. Every shape is plain data and can
 * cross IPC as it is.
 */

import type { ReviewedMark } from '../desk/types.js';
import type { Failure, Result } from '../result.js';

/**
 * A reviewed mark: the commit a root had when the Human Lead marked it as
 * reviewed. `at` is when it was marked. `commitMissing` is set when the commit
 * is not in the repository any more (rebased away and pruned); such a point
 * cannot be compared against.
 */
export type ReviewedMarkPoint = {
  kind: 'reviewed-mark';
  commit: string;
  at: string;
  commitMissing?: true;
};

/**
 * A merged pull request of a repository root: its merge commit, and when it
 * was merged. `commitMissing` is set when the merge commit is not in the local
 * repository, which is the case until it is fetched.
 */
export type MergedPullRequestPoint = {
  kind: 'merged-pull-request';
  commit: string;
  at: string;
  number: number;
  title: string;
  commitMissing?: true;
};

/** A session close: the commit a session left on the root when it left Writing, and when. */
export type SessionClosePoint = {
  kind: 'session-close';
  commit: string;
  at: string;
  sessionId: string;
  commitMissing?: true;
};

/** A commit of the root's working tree. `at` is the committer date. `sessionId` names the session it is grouped under. */
export type CommitPoint = {
  kind: 'commit';
  commit: string;
  at: string;
  subject: string;
  sessionId?: string;
};

/** One point of the baseline picker's timeline. There are four kinds. `at` is ISO 8601. */
export type BaselinePoint =
  | ReviewedMarkPoint
  | MergedPullRequestPoint
  | SessionClosePoint
  | CommitPoint;

/** The kind of a baseline point. */
export type BaselinePointKind = BaselinePoint['kind'];

/** What a merged pull request source gives for one pull request. `GitHubPort`'s `MergedPullRequest` fits. */
export type MergedPullRequestRecord = {
  number: number;
  title: string;
  /** ISO 8601. */
  mergedAt: string;
  /** The SHA of the merge commit, or `null` when there is none to give. */
  mergeCommit: string | null;
};

/**
 * Where the merged pull requests of a repository come from. The app passes
 * `GitHubPort.mergedPullRequests`; a test passes a function of its own. The
 * answer is newest first, at most `limit`. A failure, or a source that throws,
 * leaves the merged pull requests out of the points and is reported beside them.
 */
export type MergedPullRequestSource = (arg: {
  /** `owner/name`. */
  repository: string;
  limit: number;
}) => Promise<Result<readonly MergedPullRequestRecord[], Failure>>;

/**
 * What happened to the merged pull requests of a read.
 * `read`: the source answered. `withoutCommit` counts the pull requests left
 *   out because the source gave no merge commit for them.
 * `not-applicable`: the root is not a repository root, or the caller gave no source.
 * `omitted`: the source failed. `reason` is the source's failure kind
 *   (`unreachable`, `not-signed-in`, `rate-limited` …), or `source-threw`.
 */
export type MergedPullRequestsStatus =
  | { status: 'read'; withoutCommit: number }
  | { status: 'not-applicable' }
  | { status: 'omitted'; reason: string; message: string };

/** The baseline points of one root. */
export type BaselinePoints = {
  rootId: string;
  /** The SHA of the working tree's `HEAD`, or `null` in a repository with no commit. */
  head: string | null;
  /** Every point, newest first. */
  points: BaselinePoint[];
  mergedPullRequests: MergedPullRequestsStatus;
  /** The most points of each kind a read returns, and whether a kind was cut there. */
  limits: {
    commits: number;
    records: number;
    pullRequests: number;
    commitsTruncated: boolean;
    reviewedMarksTruncated: boolean;
    sessionClosesTruncated: boolean;
  };
};

/**
 * A row of the baseline picker when commits are grouped under their session.
 * A `session` row stands where the newest of its members stands in the
 * timeline; `closes` and `commits` are newest first.
 */
export type BaselineRow =
  | { kind: 'point'; point: BaselinePoint }
  | {
      kind: 'session';
      sessionId: string;
      /** The `at` of the newest member. */
      at: string;
      closes: SessionClosePoint[];
      commits: CommitPoint[];
    };

/**
 * The default baseline of a root: what `RootTracker.setBaseline` is given when
 * the Human Lead has picked no other point.
 *
 * `source` says where it came from:
 * `reviewed-mark`: the newest reviewed mark whose commit is still in the repository.
 * `first-seen`: the root was never marked (or no mark's commit is left); the
 *   commit the root had the first time the companion saw it.
 * `head`: there is nothing recorded to compare with, so the working tree is
 *   compared with the present commit: a repository with no commit, or a root
 *   whose recorded commits are all gone.
 */
export type DefaultBaseline = {
  rootId: string;
  /** `'HEAD'` or a full commit SHA. */
  baseline: string;
  source: 'reviewed-mark' | 'first-seen' | 'head';
  /** When the mark or the first-seen record was written. `null` for `head`. */
  at: string | null;
  /** Whether this call wrote the root's first-seen record. */
  firstSeenRecorded: boolean;
  /** Recorded commits that were passed over because they are not in the repository any more, newest first. */
  missing: { kind: 'reviewed-mark' | 'first-seen'; commit: string; at: string }[];
  /** A sentence for the Human Lead when the baseline is not the one the records name, otherwise `null`. */
  notice: string | null;
};

/** What marking a root as reviewed did. */
export type MarkedAsReviewed = {
  mark: ReviewedMark;
  /** The full SHA the mark holds, which is the root's new default baseline. */
  baseline: string;
};

/**
 * Why a baseline operation gave nothing.
 * `root-untracked`: the root has no change tracking (the Workbench, a folder in
 *   no repository), so it has no baseline, no points and cannot be marked.
 * `folder-missing`: there is no folder at the working tree's path.
 * `not-a-repository`: the working tree's folder is in no git repository any more.
 * `no-commits`: the repository has no commit, so there is nothing to mark.
 * `git-failed`: git could not be asked. `cause` is the command runner's kind.
 * `desk-failed`: the desk's records could not be read or written. `cause` is
 *   the desk's kind (`not-writable` on a desk another instance owns).
 */
export type BaselineFailureKind =
  | 'root-untracked'
  | 'folder-missing'
  | 'not-a-repository'
  | 'no-commits'
  | 'git-failed'
  | 'desk-failed';

/** The failure of a baseline operation. */
export type BaselineFailure = Failure<BaselineFailureKind> & { cause?: string };

/** The most commits a read of baseline points returns unless the caller asks for another number. */
export const DEFAULT_BASELINE_COMMIT_LIMIT = 200;

/** The most reviewed marks, and the most session closes, a read returns: the newest ones. */
export const BASELINE_RECORD_LIMIT = 200;

/** The most merged pull requests a read asks the source for unless the caller asks for another number. */
export const DEFAULT_BASELINE_PULL_REQUEST_LIMIT = 50;
