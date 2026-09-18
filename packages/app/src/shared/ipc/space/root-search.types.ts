/**
 * Arguments and results of the search channels of the Files window
 * (`./root-search.contract.ts`), added by phase M5.6. Plain data only.
 *
 * The renderer searches one root per call, so that each root's results arrive
 * on their own and a slow or failing root does not hold back the others. A
 * root is named by its id; every path in a result is relative to the root's
 * folder, with `/`.
 */

import type { SpaceRootsResult } from './roots.types.js';

/** The most file-name hits sent per root. Main's cap; the Files window states it. */
export const ROOT_SEARCH_NAME_LIMIT = 40;

/** The most lines found inside files sent per root. Main's cap; the Files window states it. */
export const ROOT_SEARCH_CONTENT_LIMIT = 50;

/** Argument of `spaceRootSearch`: the text to look for in the root `rootId`. */
export type SpaceRootSearchArg = { rootId: string; query: string };

/** A file whose name matches. `path` is relative to the root's folder. */
export type RootSearchNameHit = { name: string; path: string };

/** A line of a file that holds the text. `line` and `column` start at 1. */
export type RootSearchContentHit = {
  name: string;
  path: string;
  line: number;
  column: number;
  snippet: string;
};

/**
 * The hits of one kind of search in one root. At most `limit` hits are sent;
 * `truncated` says that there were more. `finished` is false when the search
 * of this kind did not end before the root's time limit or was cancelled.
 */
export type RootSearchHits<T> = {
  hits: T[];
  limit: number;
  truncated: boolean;
  finished: boolean;
};

/**
 * The results of one root for one query.
 * `outcome`: `done` when both kinds of search ended; `timed-out` when the
 * root's time limit (`timeLimitMs`) passed first, and the kinds that ended are
 * still sent; `cancelled` when a newer search of the same window for the same
 * root, or `spaceRootSearchCancel`, stopped it.
 * `indexTruncated`: the root holds more files than the index of file names
 * keeps (`indexLimit`), so a name search does not see every file.
 * `ripgrepMissing`: ripgrep (`rg`) was not found, so no file was searched inside.
 */
export type RootSearchGroup = {
  rootId: string;
  query: string;
  outcome: 'done' | 'timed-out' | 'cancelled';
  timeLimitMs: number;
  names: RootSearchHits<RootSearchNameHit>;
  content: RootSearchHits<RootSearchContentHit>;
  indexTruncated: boolean;
  indexLimit: number;
  ripgrepMissing: boolean;
};

/** What `spaceRootSearch` returns. */
export type SpaceRootSearchResult = SpaceRootsResult<RootSearchGroup>;

/** What `spaceRootSearchCancel` returns: how many running searches of the window were stopped. */
export type SpaceRootSearchCancelResult = SpaceRootsResult<{ cancelled: number }>;
