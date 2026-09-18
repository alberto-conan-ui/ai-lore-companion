import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of the two dialogs (`shared/ipc/space/dialogs.contract.ts`).
 * Empty until phase M4.5 fills it. It is already in the module list, so a
 * handler added here needs no other file changed. A dialog's answer is
 * accepted only when `deps.space.windowFor(event)` gives a window of the
 * Space: that is the check by the sender's id that keeps a page in an embedded
 * browser tab from answering. Validate every argument with `parseArg` from
 * `./validate.js`, and return a failure as the result.
 */
export const registerSpaceDialogs: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
