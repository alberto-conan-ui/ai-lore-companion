/**
 * The channels of the Files window that are not about roots: the tree, reading
 * and writing a file, search grouped by root, what the window remembers. Filled
 * by the M5 phases (M5.2 first, then M5.6 for search); the handlers go in
 * `main/space/ipc/files.ts` and the types in `./files.types.ts`. Build
 * entries with `invoke`, `send` and `push` from `./describe.js`, and follow
 * the rules written there. This fragment is already spread into `CONTRACT`, so
 * an entry added here needs no other file changed.
 *
 * M5.2 keeps its tree listing in a fragment of its own (`./root-tree.contract.ts`),
 * spread here, so that the phases after it edit this file without touching it.
 */

import { SPACE_ROOT_FILE_EDIT_CONTRACT } from './root-file-edit.contract.js';
import { SPACE_ROOT_SEARCH_CONTRACT } from './root-search.contract.js';
import { SPACE_ROOT_TREE_CONTRACT } from './root-tree.contract.js';
import { SPACE_UI_CONTRACT } from './ui.contract.js';

export const SPACE_FILES_CONTRACT = {
  ...SPACE_ROOT_TREE_CONTRACT,
  ...SPACE_ROOT_SEARCH_CONTRACT,
  ...SPACE_ROOT_FILE_EDIT_CONTRACT,
  ...SPACE_UI_CONTRACT,
} as const;
