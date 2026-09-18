/**
 * The channels of roots: the list, changes per root, baselines, reviewed
 * marks, baseline points, the diff and a file's history. Empty until phase
 * M5.1 fills it; the handlers go in `main/space/ipc/roots.ts` and the types in
 * `./roots.types.ts`. Build entries with `invoke`, `send` and `push` from
 * `./describe.js`, and follow the rules written there. This fragment is
 * already spread into `CONTRACT`, so an entry added here needs no other file
 * changed.
 */

export const SPACE_ROOTS_CONTRACT = {} as const;
