/**
 * Step 13: verify. Lore-integrity passes over the new Space; every archived
 * file's hash equals its source's; both source repositories are at the head
 * and status step 1 recorded. It is never skipped: like the machine check, it
 * asks the state each time. Phase M6.6 builds `run`, with `migrate/verify.ts`.
 */

import { notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';

const TITLE = 'Verify the migration';

/** Step 13. */
export function verifyStep(): MigrationStep {
  return {
    id: 'verify',
    number: 13,
    title: TITLE,
    describe: async (ctx) => [
      { what: 'Run the check lore-integrity over the Lore of the new Space.', to: 'lore' },
      {
        what: "Compare every archived file's SHA-256 with its source's.",
        to: ctx.targets.archiveDir,
        count: ctx.targets.archived.length,
      },
      {
        what: 'Check that both source repositories are at the head commit and status recorded in step 1.',
        from: `${ctx.source.payloadRepository.path}, ${ctx.source.loreRepository.path}`,
        count: 2,
      },
    ],
    isDone: async () => false,
    run: async () => notBuiltYet(TITLE),
  };
}
