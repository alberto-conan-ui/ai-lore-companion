/**
 * Argument, result and payload types of the channels of the Space's GitHub
 * Project (phase M7.1). Plain data only; types from core are imported with
 * `import type`. `shared/ipc.ts` already re-exports this file.
 */

import type {
  DashboardModel,
  DormantAggregate,
  MovingPartition,
  NextAction,
  OpenPullRequest,
  ProjectCacheFailure,
  ProjectSnapshot,
  PullRequestSummary,
  SpaceStats,
} from '@ai-lore-companion/core';

/**
 * How current the shown snapshot is.
 *
 * - `fresh`: the last refresh succeeded.
 * - `offline`: the last refresh could not reach GitHub; the cache is shown as it was.
 * - `stale`: no refresh has succeeded since the app opened the Space, or the
 *   last one failed for another reason (rate limit, a Project not found,
 *   signed out); `failure` says which.
 */
export type SpaceProjectFreshness = 'fresh' | 'stale' | 'offline';

/** What the Dashboard receives, by push and as the result of its requests. */
export type SpaceProjectState = {
  /**
   * The number of this state among the states the Space's refresh service has
   * given, pushed or answered: a later state has a higher number. Measured in
   * the end-to-end test of phase M7.5, the push sent when a refresh starts can
   * reach the window after the push sent when it ended, so the Dashboard keeps
   * the state with the highest number it has received.
   */
  version: number;
  /** The cached snapshot, or `null` when no refresh has ever succeeded for this Space. */
  snapshot: ProjectSnapshot | null;
  /** When the snapshot was read from GitHub, ISO 8601, or `null`. */
  fetchedAt: string | null;
  state: SpaceProjectFreshness;
  /** The last refresh that failed, with its time, or `null` when the last one succeeded. */
  failure: ProjectCacheFailure | null;
  /** Whether a refresh is running now. */
  refreshing: boolean;
  /**
   * The Dashboard's model of the snapshot, the desk's sessions and the pending
   * gates at the time of the push; `null` when there is no snapshot.
   */
  model: DashboardModel | null;
  pullRequests: OpenPullRequest[];
  /** A failed PR read retains the last list without marking a good Project read stale. */
  pullRequestsFailure: ProjectCacheFailure | null;
  /** Counts and copy for the waiting PR panel, computed with the Project state. */
  pullRequestSummary?: PullRequestSummary;
  nextActions: NextAction[];
  moving: MovingPartition;
  dormant: DormantAggregate;
  stats: SpaceStats;
};

/** Argument of every channel of the Project: nothing. The Space is the window's. */
export type SpaceProjectArg = Record<string, never>;

/** Why a request of the Project was not served. `message` can be shown as it is. */
export type SpaceProjectFailure = {
  kind: 'invalid-argument' | 'not-a-space-window';
  message: string;
};

/** Result of `spaceProjectState` and `spaceProjectRefresh`. */
export type SpaceProjectStateResult =
  | { ok: true; value: SpaceProjectState }
  | { ok: false; error: SpaceProjectFailure };
