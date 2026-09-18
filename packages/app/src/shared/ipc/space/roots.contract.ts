/**
 * The channels of roots: the list, changes per root, baselines, reviewed
 * marks, baseline points, the diff, a file at a commit and a file's history.
 * Filled by phase M5.1 with every root channel the later M5 phases use; the
 * handlers are in `main/space/ipc/roots.ts` and the types in
 * `./roots.types.ts`. This fragment is spread into `CONTRACT`.
 *
 * Every invoke returns a `SpaceRootsResult`. A root is named by its id and a
 * file by its path relative to the root; no channel takes an absolute path.
 */

import { invoke, push } from './describe.js';
import type {
  RootBaselinePoints,
  RootBaselineSet,
  RootChangesPayload,
  RootDiff,
  RootFileContent,
  RootFileEventsPayload,
  RootFileHistory,
  RootMarkedReviewed,
  RootSnapshot,
  RootsReloadedPayload,
  SpaceRootArg,
  SpaceRootBaselinePointsArg,
  SpaceRootBlobArg,
  SpaceRootDiffArg,
  SpaceRootFileAtArg,
  SpaceRootFileHistoryArg,
  SpaceRootSetBaselineArg,
  SpaceRootsList,
  SpaceRootsListArg,
  SpaceRootsRefreshArg,
  SpaceRootsResult,
} from './roots.types.js';

export const SPACE_ROOTS_CONTRACT = {
  /** The roots with their baselines and changes. The first call of a Space starts its tracker and watchers. */
  spaceRootsList: invoke<[arg: SpaceRootsListArg], SpaceRootsResult<SpaceRootsList>>(
    'space:roots-list',
  ),
  /**
   * Read again now: one root, or every root. For a window that gains focus.
   * The roots are resolved again, and the tracker is rebuilt when they changed.
   */
  spaceRootsRefresh: invoke<[arg: SpaceRootsRefreshArg], SpaceRootsResult<SpaceRootsList>>(
    'space:roots-refresh',
  ),
  /** The present changes of one root. */
  spaceRootChanges: invoke<[arg: SpaceRootArg], SpaceRootsResult<RootSnapshot>>(
    'space:root-changes',
  ),
  /** Compare a root against `HEAD` or a commit. */
  spaceRootSetBaseline: invoke<[arg: SpaceRootSetBaselineArg], SpaceRootsResult<RootBaselineSet>>(
    'space:root-set-baseline',
  ),
  /** Go back to the root's default baseline: its last reviewed mark, else the first-seen commit. */
  spaceRootResetBaseline: invoke<[arg: SpaceRootArg], SpaceRootsResult<RootBaselineSet>>(
    'space:root-reset-baseline',
  ),
  /** Record the root's present commit as reviewed and compare against it. */
  spaceRootMarkReviewed: invoke<[arg: SpaceRootArg], SpaceRootsResult<RootMarkedReviewed>>(
    'space:root-mark-reviewed',
  ),
  /** The four kinds of baseline point of a root, as a timeline and grouped under sessions. */
  spaceRootBaselinePoints: invoke<
    [arg: SpaceRootBaselinePointsArg],
    SpaceRootsResult<RootBaselinePoints>
  >('space:root-baseline-points'),
  /** The unified diff of one file against the root's baseline, or against a pinned point. */
  spaceRootDiff: invoke<[arg: SpaceRootDiffArg], SpaceRootsResult<RootDiff>>('space:root-diff'),
  /** The content of one file at a commit. */
  spaceRootFileAt: invoke<[arg: SpaceRootFileAtArg], SpaceRootsResult<RootFileContent>>(
    'space:root-file-at',
  ),
  /** The content of a blob a history entry names. */
  spaceRootBlob: invoke<[arg: SpaceRootBlobArg], SpaceRootsResult<RootFileContent>>(
    'space:root-blob',
  ),
  /** The commits that touched one file, newest first, following renames. */
  spaceRootFileHistory: invoke<[arg: SpaceRootFileHistoryArg], SpaceRootsResult<RootFileHistory>>(
    'space:root-file-history',
  ),
  /** The changes of a root moved. Sent to the windows of that Space only. */
  onSpaceRootChanges: push<RootChangesPayload>('space:on-root-changes'),
  /** Files or folders under a root came, went or changed, in batches, for the tree. */
  onSpaceRootFileEvents: push<RootFileEventsPayload>('space:on-root-file-events'),
  /** The roots themselves changed: ask for the list again. */
  onSpaceRootsReloaded: push<RootsReloadedPayload>('space:on-roots-reloaded'),
} as const;
