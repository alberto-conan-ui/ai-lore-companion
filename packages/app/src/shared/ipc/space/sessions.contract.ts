/**
 * The channels of sessions: starting one, its mode, its header. Empty until
 * phase M4.4 fills it, and M4.6 extends it; the handlers go in
 * `main/space/ipc/sessions.ts` and the types in `./sessions.types.ts`. Build
 * entries with `invoke`, `send` and `push` from `./describe.js`, and follow
 * the rules written there. This fragment is already spread into `CONTRACT`, so
 * an entry added here needs no other file changed.
 */

export const SPACE_SESSIONS_CONTRACT = {} as const;
