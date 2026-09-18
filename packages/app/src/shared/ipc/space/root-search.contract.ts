/**
 * The search channels of the Files window, added by phase M5.6; the handlers
 * are in `main/space/ipc/root-search.ts` and the types in
 * `./root-search.types.ts`. This fragment is spread into the Files window's
 * fragment (`./files.contract.ts`), and so reaches `CONTRACT`.
 */

import { invoke } from './describe.js';
import type {
  SpaceRootSearchArg,
  SpaceRootSearchCancelResult,
  SpaceRootSearchResult,
} from './root-search.types.js';

export const SPACE_ROOT_SEARCH_CONTRACT = {
  /** Search one root of the Space by file name and inside files. */
  spaceRootSearch: invoke<[arg: SpaceRootSearchArg], SpaceRootSearchResult>('space:root-search'),
  /** Stop every running search of the calling window. */
  spaceRootSearchCancel: invoke<[], SpaceRootSearchCancelResult>('space:root-search-cancel'),
} as const;
