/**
 * The shapes of the roots of a Space and of the changes per root.
 *
 * This file imports types only and nothing of Node, so that the renderer can
 * take every shape here with `import type`. Every shape is plain data and can
 * cross IPC as it is.
 */

import type { ChangeEntry } from '../../changes/porcelain.js';
import type { GitBranch } from '../exec/git-port.js';
import type { Failure } from '../result.js';

/** The four kinds of root a Space has. */
export type RootKind = 'lore' | 'workbench' | 'publish-area' | 'repository';

/**
 * Why a root has no change tracking.
 * `git-ignored`: the folder is ignored by the repository that holds it. The Workbench always is.
 * `outside-a-repository`: the folder is in no git working tree.
 * `folder-missing`: there is no folder at the root's path.
 * `not-a-repository`: a repository root whose folder is not the top of a working tree of its own.
 * `path-unknown`: a publish area outside the Space whose folder this desk has no record of.
 * `path-refused`: the manifest's path leaves the Space's folder, by its text or through a symbolic link,
 *   or the root's folder is the folder of another root, is inside it or holds it.
 * `git-failed`: git could not be asked (it is not installed, or the command failed).
 */
export type RootUntrackedReason =
  | 'git-ignored'
  | 'outside-a-repository'
  | 'folder-missing'
  | 'not-a-repository'
  | 'path-unknown'
  | 'path-refused'
  | 'git-failed';

/** How the changes of a root are read, or why they are not. */
export type RootTracking =
  | {
      tracked: true;
      /** The top folder of the working tree that holds the root, as git names it. */
      workTree: string;
      /** The root's folder relative to `workTree`, with `/`. Empty for a root that is a whole working tree. */
      subPath: string;
    }
  | {
      tracked: false;
      reason: RootUntrackedReason;
      /** A sentence that can be shown to the Human Lead. */
      message: string;
    };

/** One root of a Space: the Lore, the Workbench, a publish area or a repository. */
export type Root = {
  /** `'lore'`, `'workbench'`, `'publish:<name>'` or `'repo:<name>'`. */
  id: string;
  kind: RootKind;
  /** The payload's name in the manifest; `'lore'` and `'workbench'` for the two fixed roots. */
  name: string;
  /** The root's folder, absolute. Empty when `tracking.reason` is `'path-unknown'`. */
  path: string;
  tracking: RootTracking;
};

/**
 * Why the changes of a root were not read.
 * `invalid-argument`: the baseline is not `HEAD` or a commit SHA, or the sub-path is not a path inside the working tree.
 * `folder-missing`: there is no folder at the working tree's path.
 * `not-a-repository`: the folder is not the top of a git working tree.
 * `baseline-missing`: the baseline commit is not in the repository (a mark whose commit was rebased away and pruned).
 * `change-set-too-large`: git's output passed the command runner's limit, so no list was read.
 * The other kinds are the command runner's.
 */
export type RootChangesFailureKind =
  | 'invalid-argument'
  | 'folder-missing'
  | 'not-a-repository'
  | 'baseline-missing'
  | 'change-set-too-large'
  | 'command-refused'
  | 'command-not-found'
  | 'command-timeout'
  | 'command-failed';

/** The failure of a change read. */
export type RootChangesFailure = Failure<RootChangesFailureKind>;

/**
 * The changes of one root against a baseline.
 *
 * A change is today's `ChangeEntry`: `code` is the two-character status
 * (`' M'`, `'A '`, `'D '`, `'R '`, `'??'`), `path` is relative to the root's
 * folder with `/`, and `oldPath` is the path a renamed file had, also relative
 * to the root.
 */
export type RootChanges = {
  /** The baseline as it was asked for: `'HEAD'` or a commit SHA. */
  baseline: string;
  /** The full SHA the baseline resolved to. `null` for `HEAD` in a repository with no commit. */
  baselineCommit: string | null;
  /**
   * Whether the baseline commit is `HEAD` or one of its ancestors. `false` for
   * a mark left behind by a rebase or a branch change, whose commit is still in
   * the repository. `null` when there is no commit to compare with.
   */
  baselineIsAncestor: boolean | null;
  /** The SHA of `HEAD`, or `null` in a repository with no commit. */
  head: string | null;
  /** The checked-out branch. `detached` is true when `HEAD` names a commit and no branch. */
  branch: GitBranch;
  /** The changed files, tracked changes first and untracked files last, at most `limit` of them. */
  entries: ChangeEntry[];
  /**
   * The paths of `entries` that also differ between `HEAD` and the working
   * tree, untracked files included: the changes not committed. They stay
   * listed after a mark. A path of `entries` not named here was committed
   * since the baseline. Against `HEAD` every path of `entries` is named.
   */
  uncommitted: string[];
  /** How many changed files there are, including those left out of `entries`. */
  total: number;
  /** Whether `entries` was cut at `limit`. */
  truncated: boolean;
  /** The most entries this read returns. */
  limit: number;
};

/** Options of `readChangesIn`. */
export type ReadChangesInOptions = {
  /** The most entries to return. Default `DEFAULT_ROOT_CHANGES_LIMIT`. */
  limit?: number;
  /** Stop each git command after this many milliseconds. Default `ROOT_CHANGES_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * What the tracker knows about one root.
 * `untracked`: the root has no change tracking; `reason` and `message` say why.
 * `unread`: the root is tracked and its first read has not finished.
 * `ok`: the changes of the last read.
 * `failed`: the last read failed; the changes of the read before it are not kept.
 */
export type RootSnapshot = { rootId: string; baseline: string } & (
  | { status: 'untracked'; reason: RootUntrackedReason; message: string }
  | { status: 'unread' }
  | { status: 'ok'; changes: RootChanges }
  | { status: 'failed'; error: RootChangesFailure }
);

/** A file event under a tracked root, as the tracker's watcher reports it. */
export type RootFileEvent = {
  rootId: string;
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  /** The absolute path of the file or folder. */
  absPath: string;
};

/** The most changes a read returns unless the caller asks for another number. */
export const DEFAULT_ROOT_CHANGES_LIMIT = 5000;

/** How long a git command of a change read may run. */
export const ROOT_CHANGES_TIMEOUT_MS = 30_000;

/** How long the tracker waits after `scheduleRefresh` before it reads, as today's tracker does. */
export const ROOT_TRACKER_DEBOUNCE_MS = 200;

// Stage D1: the repository read, without a fetch (architecture document, section 3.2).

/** Where `HEAD` is. */
export type RootHeadState =
  /** On a branch that has a commit. */
  | { kind: 'branch'; branch: string; commit: string }
  /** On a branch whose ref does not exist yet: a repository with no commit. */
  | { kind: 'unborn-branch'; branch: string }
  /** Not on a branch. During a rebase git detaches `HEAD`; `rebasing` then names the branch being rebased. */
  | { kind: 'detached'; commit: string; rebasing: string | null };

/** An operation git records as in progress in its folder, or `null` when there is none. */
export type RootGitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

/**
 * Why the comparison with the tracking branch is not known.
 * `no-remote`: the repository has no remote at all.
 * `no-upstream`: the branch has no tracking branch configured.
 * `upstream-missing`: a tracking branch is configured and its ref is not in this
 *   repository. It has never been fetched, or it was deleted on the remote.
 * `detached-head`: `HEAD` is not on a branch, so there is no tracking branch.
 * `unborn-branch`: the branch has no commit, so there is nothing to compare.
 * `git-failed`: a git command did not answer. `message` carries git's own words.
 */
export type RemoteUnknownReason =
  | 'no-remote'
  | 'no-upstream'
  | 'upstream-missing'
  | 'detached-head'
  | 'unborn-branch'
  | 'git-failed';

/**
 * What one repository's own records say about its remote, read without
 * contacting it. `ahead` and `behind` are both numbers or both `null`; they are
 * never `0` for a fact that could not be established.
 */
export type RootRemoteComparison = {
  /** The remote's name, `origin`, or `null` when there is none to name. */
  remote: string | null;
  /** The tracking branch in its short form, `origin/main`, or `null`. */
  upstream: string | null;
  /** Commits on `HEAD` that the tracking branch does not have, or `null`. */
  ahead: number | null;
  /** Commits on the tracking branch that `HEAD` does not have, or `null`. */
  behind: number | null;
  /** Why `ahead` and `behind` are `null`; `null` when they are known. */
  unknown: { reason: RemoteUnknownReason; message: string } | null;
  /**
   * When git last fetched into this repository, ISO 8601, from the modification
   * time of `FETCH_HEAD` in its git folder. `null` when there is no such file,
   * which is the case in a repository that has been cloned and never fetched.
   */
  lastFetchAt: string | null;
};

/** What one read of a repository established. */
export type RootRepositoryState = {
  /** The top folder of the working tree that was read. */
  workTree: string;
  head: RootHeadState;
  operation: RootGitOperation | null;
  remote: RootRemoteComparison;
  /** When the read ran, ISO 8601. */
  readAt: string;
};

/**
 * Why a repository could not be read at all.
 * `folder-missing`: there is no folder at the working tree's path.
 * `not-a-repository`: the folder is in no git working tree.
 * The other kinds are the command runner's.
 */
export type RootRepositoryFailureKind =
  | 'folder-missing'
  | 'not-a-repository'
  | 'command-refused'
  | 'command-not-found'
  | 'command-timeout'
  | 'command-failed';

export type RootRepositoryFailure = Failure<RootRepositoryFailureKind>;

/** How long a git command of a repository read may run. */
export const ROOT_REPOSITORY_TIMEOUT_MS = 10_000;
