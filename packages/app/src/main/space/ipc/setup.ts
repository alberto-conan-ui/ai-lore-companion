import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of creating a Space (`shared/ipc/space/setup.contract.ts`).
 * Empty until phase M3.7 fills it. It is already in the module list, so a
 * handler added here needs no other file changed. Read `deps.space` for the
 * Space host, validate every argument with `parseArg` from `./validate.js`,
 * and return a failure as the result.
 */
export const registerSpaceSetup: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
