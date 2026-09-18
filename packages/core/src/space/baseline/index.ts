/**
 * Baseline points, the default baseline of a root, and marking a root as
 * reviewed. Owned by phase M2.6.
 *
 * `listBaselinePoints` gives the four kinds of point of one root in one
 * timeline, `defaultBaselineOf` gives what a root compares against when no
 * point was picked, and `markRootReviewed` appends a reviewed mark. Reviewed
 * marks, session closes and first-seen commits are read and written through
 * the desk's functions only. The shapes are in `types.ts`, which imports
 * nothing of Node.
 */

export {
  BASELINE_RECORD_LIMIT,
  DEFAULT_BASELINE_COMMIT_LIMIT,
  DEFAULT_BASELINE_PULL_REQUEST_LIMIT,
  type BaselineFailure,
  type BaselineFailureKind,
  type BaselinePoint,
  type BaselinePointKind,
  type BaselinePoints,
  type BaselineRow,
  type CommitPoint,
  type DefaultBaseline,
  type MarkedAsReviewed,
  type MergedPullRequestPoint,
  type MergedPullRequestRecord,
  type MergedPullRequestSource,
  type MergedPullRequestsStatus,
  type ReviewedMarkPoint,
  type SessionClosePoint,
} from './types.js';
export {
  type SessionTimes,
  assignSessions,
  groupBaselinePoints,
  orderBaselinePoints,
} from './timeline.js';
export { type ListBaselinePointsInput, listBaselinePoints } from './points.js';
export {
  type SessionCloseCommits,
  type SessionCloseCommitsInput,
  readSessionCloseCommits,
} from './session-closes.js';
export {
  type RootBaselineInput,
  defaultBaselineOf,
  markRootReviewed,
} from './default-baseline.js';
