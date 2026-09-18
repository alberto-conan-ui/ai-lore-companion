/**
 * Argument, result and payload types of the channels of roots. Plain data
 * only; types from core are imported with `import type`, so nothing of core is
 * loaded by the renderer. `shared/ipc.ts` re-exports this file.
 *
 * A root is named by its id (`lore`, `workbench`, `publish:<name>`,
 * `repo:<name>`), never by a path. A file is named by its path relative to the
 * root's folder, with `/`. A baseline is `HEAD` or a commit SHA in hex.
 */

import type {
  BaselinePoints,
  BaselineRow,
  DefaultBaseline,
  ReviewedMark,
  Root,
  RootSnapshot,
} from '@ai-lore-companion/core';

export type {
  BaselinePoint,
  BaselinePoints,
  BaselineRow,
  DefaultBaseline,
  MergedPullRequestsStatus,
  ReviewedMark,
  Root,
  RootChanges,
  RootKind,
  RootSnapshot,
  RootTracking,
} from '@ai-lore-companion/core';

/**
 * Why a channel of roots gave nothing.
 * `not-a-space-window`: the call did not come from a window of an open Space.
 * `invalid-argument`: the argument is not of the channel's form.
 * `roots-unavailable`: the manifest could not be read, so there are no roots.
 * `unknown-root`: no root of the Space has this id.
 * `root-untracked`: the root has no change tracking (the Workbench, a folder in no repository).
 * `path-refused`: the path leaves the root's folder, by its text or through a symbolic link, or enters `.git`.
 * `baseline-missing`: the commit is not in the root's repository.
 * `desk-not-writable`: another running instance of the companion owns the desk; the message is the desk's own.
 * `desk-failed`: the desk's records could not be read or written.
 * `no-commits`: the repository has no commit, so there is nothing to mark.
 * `git-failed`: git could not be asked, or the command failed.
 */
export type SpaceRootsFailureKind =
  | 'not-a-space-window'
  | 'invalid-argument'
  | 'roots-unavailable'
  | 'unknown-root'
  | 'root-untracked'
  | 'path-refused'
  | 'baseline-missing'
  | 'desk-not-writable'
  | 'desk-failed'
  | 'no-commits'
  | 'git-failed';

/** The failure of a channel of roots. `cause` is the kind the failure had in core, when it had one. */
export type SpaceRootsFailure = { kind: SpaceRootsFailureKind; message: string; cause?: string };

/** What every channel of roots returns. A handler never rejects. */
export type SpaceRootsResult<T> = { ok: true; value: T } | { ok: false; error: SpaceRootsFailure };

/** One root, with what the tracker holds for it. */
export type RootSummary = {
  root: Root;
  /** The baseline the root's changes are read against now: `HEAD` or a full SHA. */
  baseline: string;
  /**
   * The root's default baseline, as it was read when the tracker started or
   * after the last mark. `null` for a root with no change tracking and for a
   * root whose default could not be read; `baselineNotice` then says why.
   */
  defaultBaseline: DefaultBaseline | null;
  /** A sentence for the Human Lead about the baseline, or `null`. */
  baselineNotice: string | null;
  /** The changes of the last read. */
  snapshot: RootSnapshot;
  /** `owner/name` on GitHub for a repository root, otherwise `null`. */
  github: string | null;
};

/** The roots of the Space, in the order of `resolveRoots`. */
export type SpaceRootsList = {
  roots: RootSummary[];
  /** Whether this instance may write the desk's records. With false, marking as reviewed is refused. */
  deskWritable: boolean;
  /** Why the desk is not writable or could not be opened, otherwise `null`. */
  deskNotice: string | null;
};

export type SpaceRootsListArg = Record<string, never>;
export type SpaceRootsRefreshArg = { rootId?: string };
export type SpaceRootArg = { rootId: string };
/** `baseline` is `HEAD` or a commit SHA in hex, 7 to 64 characters. */
export type SpaceRootSetBaselineArg = { rootId: string; baseline: string };

/** What setting or resetting a baseline gives: the baseline as it is held (a full SHA or `HEAD`) and the new changes. */
export type RootBaselineSet = { rootId: string; baseline: string; snapshot: RootSnapshot };

/** What marking a root as reviewed gives. The mark's commit is the root's baseline from now on. */
export type RootMarkedReviewed = {
  rootId: string;
  mark: ReviewedMark;
  baseline: string;
  snapshot: RootSnapshot;
};

export type SpaceRootBaselinePointsArg = {
  rootId: string;
  /** The most commits to return, 1 to 1000. Default 200. */
  commitLimit?: number;
};

/**
 * The baseline points of a root. `points.mergedPullRequests` says whether the
 * merged pull requests were read, do not apply, or were left out and why
 * (`omitted` with the reason `unreachable`, `not-signed-in`, `rate-limited` …).
 * `rows` is the same points with commits and session closes grouped under their session.
 */
export type RootBaselinePoints = { points: BaselinePoints; rows: BaselineRow[] };

/** `baseline` left out: the root's present baseline. With it, the diff is pinned to that point and the root's baseline does not move. */
export type SpaceRootDiffArg = {
  rootId: string;
  path: string;
  /** The path a renamed file had, so that the diff is read as a rename. */
  oldPath?: string;
  baseline?: string;
};

/** The unified diff of one file between a baseline and the working tree. An unchanged file gives an empty text. */
export type RootDiff =
  | { kind: 'text'; baseline: string; text: string }
  | { kind: 'binary'; baseline: string }
  | { kind: 'too-large'; baseline: string; bytes: number; limit: number };

/** `commit` is `HEAD` or a commit SHA in hex. */
export type SpaceRootFileAtArg = { rootId: string; path: string; commit: string };
/** `blob` is a blob SHA in hex, as a history entry gives it. */
export type SpaceRootBlobArg = { rootId: string; blob: string };

/** The content of a file at a commit, or of a blob. `absent`: the commit has no file at the path. */
export type RootFileContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; bytes: number }
  | { kind: 'too-large'; bytes: number; limit: number }
  | { kind: 'absent' };

export type SpaceRootFileHistoryArg = {
  rootId: string;
  path: string;
  /** The most commits to return, 1 to 1000. Default 200. */
  limit?: number;
};

/**
 * One commit that touched the file, with the fields of the v0.8
 * `FileHistoryEntry`: `timestamp` is epoch milliseconds, `blob` the file's
 * blob at the commit, `prevBlob` its blob before it (all zero when added),
 * `change` git's raw status (`A`, `M`, `D`, `R…`, `C…`). `oldPath` and
 * `newPath` are given for a rename or a copy, relative to the root; a path
 * outside the root's folder is left out.
 */
export type RootFileHistoryEntry = {
  sha: string;
  subject: string;
  author: string;
  body: string;
  timestamp: number;
  blob: string;
  prevBlob: string;
  change: string;
  oldPath?: string;
  newPath?: string;
};

/** The history of one file, newest first, following renames. */
export type RootFileHistory = {
  entries: RootFileHistoryEntry[];
  truncated: boolean;
  limit: number;
};

/** Pushed when the changes of a root differ from the last read, and after every change of its baseline. */
export type RootChangesPayload = { snapshot: RootSnapshot };

/** One file or folder event under a root. `path` is relative to the root's folder, with `/`. */
export type RootFileEventEntry = {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
};

/**
 * Pushed for the tree, at most once per batch window. With `overflow`, more
 * events arrived than a batch holds and `events` is empty: read the tree again.
 */
export type RootFileEventsPayload = {
  rootId: string;
  events: RootFileEventEntry[];
  overflow: boolean;
};

/** Pushed when the roots themselves changed (the manifest, a folder that came or went): ask for the list again. */
export type RootsReloadedPayload = { reason: 'roots-changed' };
