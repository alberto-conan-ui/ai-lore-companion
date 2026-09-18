import type { RegisterModule } from '../../ipc/types.js';
import { registerSpaceRootFileEdit } from './root-file-edit.js';
import { registerSpaceRootSearch } from './root-search.js';
import { registerSpaceRootTree } from './root-tree.js';
import { registerSpaceUi } from './ui.js';

/**
 * The handlers of the Files window that are not about roots
 * (`shared/ipc/space/files.contract.ts`). Filled by the M5 phases. It is
 * already in the module list, so a handler added here needs no other file
 * changed. Read `deps.space.contextFor(event)` for the Space context.
 * Validate every argument with `parseArg` from `./validate.js`, resolve every
 * path against its root with core's `safeJoin`, and return a failure as the
 * result.
 *
 * M5.2's tree listing is registered from its own file, `./root-tree.ts`, and
 * M5.6's search from `./root-search.ts`.
 */
export const registerSpaceFiles: RegisterModule = (reg, deps) => {
  registerSpaceRootTree(reg, deps);
  registerSpaceRootSearch(reg, deps);
  registerSpaceRootFileEdit(reg, deps);
  registerSpaceUi(reg, deps);
};
