import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of roots (`shared/ipc/space/roots.contract.ts`). Empty until
 * phase M5.1 fills it. It is already in the module list, so a handler added
 * here needs no other file changed. Read `deps.space.contextFor(event)` for
 * the Space context, and keep the tracker and the watchers as a service of
 * the context (`defineSpaceService` in `../context.js`). Validate every
 * argument with `parseArg` from `./validate.js`, resolve every path against
 * its root with core's `safeJoin`, and return a failure as the result.
 */
export const registerSpaceRoots: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
