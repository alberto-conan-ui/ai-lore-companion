import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of the Files window that are not about roots
 * (`shared/ipc/space/files.contract.ts`). Empty until the M5 phases fill it.
 * It is already in the module list, so a handler added here needs no other
 * file changed. Read `deps.space.contextFor(event)` for the Space context.
 * Validate every argument with `parseArg` from `./validate.js`, resolve every
 * path against its root with core's `safeJoin`, and return a failure as the
 * result.
 */
export const registerSpaceFiles: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
