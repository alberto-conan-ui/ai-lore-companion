import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of migration (`shared/ipc/space/migration.contract.ts`). Empty
 * until phase M6.5 fills it. It is already in the module list, so a handler
 * added here needs no other file changed. The folder to migrate is the one
 * main recorded for the window (`deps.space.windowFor(event)?.folder`), never
 * a path from the renderer. Validate every argument with `parseArg` from
 * `./validate.js`, and return a failure as the result.
 */
export const registerSpaceMigration: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
