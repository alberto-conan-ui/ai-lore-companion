/**
 * The channels of the two dialogs a session asks for: Writing and a gate.
 * Empty until phase M4.5 fills it; the handlers go in
 * `main/space/ipc/dialogs.ts` and the types in `./dialogs.types.ts`. Build
 * entries with `invoke`, `send` and `push` from `./describe.js`, and follow
 * the rules written there. This fragment is already spread into `CONTRACT`, so
 * an entry added here needs no other file changed.
 */

export const SPACE_DIALOGS_CONTRACT = {} as const;
