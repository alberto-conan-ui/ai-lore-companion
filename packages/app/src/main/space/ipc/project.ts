import type { RegisterModule } from '../../ipc/types.js';

/**
 * The handlers of the Space's GitHub Project
 * (`shared/ipc/space/project.contract.ts`). Empty until phase M7.1 fills it.
 * It is already in the module list, so a handler added here needs no other
 * file changed. Read `deps.space.contextFor(event)` for the Space context,
 * keep the refresh timer as a service of the context (`defineSpaceService` in
 * `../context.js`), and push to both windows of the Space with
 * `deps.space.sendToSpace`. Validate every argument with `parseArg` from
 * `./validate.js`, and return a failure as the result.
 */
export const registerSpaceProject: RegisterModule = (_reg, _deps) => {
  // No channel yet.
};
