/**
 * The roots of a Space and the changes per root. Owned by phase M2.5.
 *
 * `resolveRoots` gives the roots from the manifest, `readChangesIn` reads the
 * changes of one root against a baseline, and `attachRootTracker` keeps a
 * snapshot per root up to date. The shapes are in `types.ts`, which imports
 * nothing of Node.
 */

export {
  DEFAULT_ROOT_CHANGES_LIMIT,
  ROOT_CHANGES_TIMEOUT_MS,
  ROOT_TRACKER_DEBOUNCE_MS,
  type ReadChangesInOptions,
  type Root,
  type RootChanges,
  type RootChangesFailure,
  type RootChangesFailureKind,
  type RootFileEvent,
  type RootKind,
  type RootSnapshot,
  type RootTracking,
  type RootUntrackedReason,
} from './types.js';
export {
  LORE_ROOT_ID,
  WORKBENCH_ROOT_ID,
  type ResolveRootsInput,
  type ResolveRootsResult,
  resolveRoots,
  rootIdOf,
} from './resolve-roots.js';
export {
  HEAD_BASELINE,
  type RootChangesResult,
  entriesRelativeTo,
  parseDiffNameStatusZ,
  parseStatusZ,
  readChangesIn,
} from './changes-in.js';
export {
  type RootTracker,
  type RootTrackerOptions,
  attachRootTracker,
} from './root-tracker.js';
