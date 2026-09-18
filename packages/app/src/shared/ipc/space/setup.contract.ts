/**
 * The channels of creating a Space. Empty until phase M3.7 fills it; the
 * handlers go in `main/space/ipc/setup.ts` and the types in `./setup.types.ts`.
 * Build entries with `invoke`, `send` and `push` from `./describe.js`, and
 * follow the rules written there. This fragment is already spread into
 * `CONTRACT`, so an entry added here needs no other file changed.
 */

export const SPACE_SETUP_CONTRACT = {} as const;
