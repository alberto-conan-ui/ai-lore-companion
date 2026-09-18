/**
 * The tree channels of a root, for the tree of the Files window. Added by
 * phase M5.2; the handlers are in `main/space/ipc/root-tree.ts` and the types
 * in `./root-tree.types.ts`. This fragment is spread into the Files window's
 * fragment (`./files.contract.ts`), and so reaches `CONTRACT`.
 */

import { invoke } from './describe.js';
import type {
  SpaceRootRevealArg,
  SpaceRootRevealResult,
  SpaceRootTreeExpandArg,
  SpaceRootTreeExpandResult,
} from './root-tree.types.js';

export const SPACE_ROOT_TREE_CONTRACT = {
  /** One level of a root's tree: the children of one folder inside the root. */
  spaceRootTreeExpand: invoke<[arg: SpaceRootTreeExpandArg], SpaceRootTreeExpandResult>(
    'space:root-tree-expand',
  ),
  /** Reveal in Finder a file or folder of a root, named by the root's id and a relative path. */
  spaceRootReveal: invoke<[arg: SpaceRootRevealArg], SpaceRootRevealResult>('space:root-reveal'),
} as const;
