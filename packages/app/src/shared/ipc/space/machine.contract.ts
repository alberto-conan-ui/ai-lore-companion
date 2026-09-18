/**
 * The channels of the machine check. Empty until phase M3.6 fills it; the
 * handlers go in `main/space/ipc/machine.ts` and the types in
 * `./machine.types.ts`. Build entries with `invoke`, `send` and `push` from
 * `./describe.js`, and follow the rules written there. This fragment is
 * already spread into `CONTRACT`, so an entry added here needs no other file
 * changed.
 */

export const SPACE_MACHINE_CONTRACT = {} as const;
