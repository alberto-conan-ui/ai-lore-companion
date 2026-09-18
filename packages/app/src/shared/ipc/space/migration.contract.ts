/**
 * The channels of migration from v0.8: the plan, apply, progress, verify.
 * Empty until phase M6.5 fills it; the handlers go in
 * `main/space/ipc/migration.ts` and the types in `./migration.types.ts`. Build
 * entries with `invoke`, `send` and `push` from `./describe.js`, and follow
 * the rules written there. This fragment is already spread into `CONTRACT`, so
 * an entry added here needs no other file changed.
 *
 * The "Open in the v0.8 cockpit" action of the migration screen is not here;
 * it is `spaceOpenInCockpit` in `./windows.contract.ts`.
 */

export const SPACE_MIGRATION_CONTRACT = {} as const;
