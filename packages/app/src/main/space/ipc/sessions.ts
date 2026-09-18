import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of sessions (`shared/ipc/space/sessions.contract.ts`). Empty
 * until phase M4.4 fills it; M4.6 extends it. It is already in the module
 * list, so a handler added here needs no other file changed. Read
 * `deps.space.contextFor(event)` for the Space context, validate every
 * argument with `parseArg` from `./validate.js`, and return a failure as the
 * result.
 */
export const registerSpaceSessions: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
