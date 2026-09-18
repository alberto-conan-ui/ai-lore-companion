/**
 * The channels of the Files window that are not about roots: the tree, reading
 * and writing a file, search grouped by root, what the window remembers. Empty
 * until the M5 phases fill it (M5.2 first, then M5.6 for search); the handlers
 * go in `main/space/ipc/files.ts` and the types in `./files.types.ts`. Build
 * entries with `invoke`, `send` and `push` from `./describe.js`, and follow
 * the rules written there. This fragment is already spread into `CONTRACT`, so
 * an entry added here needs no other file changed.
 */

export const SPACE_FILES_CONTRACT = {} as const;
