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
