/**
 * The channels of the Space's GitHub Project: the cached snapshot, its refresh
 * and the Dashboard's actions. Empty until phase M7.1 fills it; the handlers
 * go in `main/space/ipc/project.ts` and the types in `./project.types.ts`.
 * Build entries with `invoke`, `send` and `push` from `./describe.js`, and
 * follow the rules written there. This fragment is already spread into
 * `CONTRACT`, so an entry added here needs no other file changed.
 */

export const SPACE_PROJECT_CONTRACT = {} as const;
