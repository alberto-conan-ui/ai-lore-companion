/**
 * Arguments and results of the tree channels of a root (`./root-tree.contract.ts`),
 * added by phase M5.2 for the tree of the Files window. Plain data only.
 *
 * A root is named by its id and a file or folder by its path relative to the
 * root's folder, with `/`; the root's own folder is the empty path. The
 * listing works for every root whose folder is known, tracked by git or not,
 * so that the Workbench has a tree even though it has no changes list.
 */

import type { SpaceRootsResult } from './roots.types.js';

/** Argument of `spaceRootTreeExpand`. `path` left out, or empty, lists the root's own folder. */
export type SpaceRootTreeExpandArg = { rootId: string; path?: string };

/** One file or folder of a listed folder. `path` is relative to the root's folder, with `/`. */
export type RootTreeEntry = { name: string; path: string; isDir: boolean };

/**
 * One level of a root's tree: the children of the folder at `path`, folders
 * first, then files, each group by name, as the v0.8 tree lists them. A `.git`
 * folder is never listed, nor a symbolic link that leads out of the root or
 * into a git folder. At most `limit` entries are sent; `truncated` says that
 * the folder holds more, and `total` how many it holds.
 */
export type RootTreeLevel = {
  rootId: string;
  path: string;
  entries: RootTreeEntry[];
  total: number;
  truncated: boolean;
  limit: number;
};

/** What `spaceRootTreeExpand` returns. */
export type SpaceRootTreeExpandResult = SpaceRootsResult<RootTreeLevel>;

/** Argument of `spaceRootReveal`: a file or folder of a root, relative to it; empty is the root's folder. */
export type SpaceRootRevealArg = { rootId: string; path: string };

/** What `spaceRootReveal` returns: `null` once the Finder was asked to show it. */
export type SpaceRootRevealResult = SpaceRootsResult<null>;
