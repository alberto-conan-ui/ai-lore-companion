/**
 * Step 13: verify. Lore-integrity passes over the new Space; every archived
 * file's hash equals its source's; both source repositories are at the head
 * and status step 1 recorded; the Space repository is pushed; every planned
 * issue exists once. It is never skipped: like the machine check, it asks the
 * state each time. The checks are in `migrate/verify.ts`.
 *
 * A failed verification undoes nothing. Its message lists every check with
 * "Passed" or "Failed" and a sentence, and what to look at.
 *
 * Once verification passes, the step writes the follow-up note (phase M6.7)
 * to `FOLLOW_UP_NOTE_PATH` in the Workbench, before `recordStepDone`, so a
 * failed verification leaves the Space untouched. The note is not committed:
 * the Workbench is gitignored and private to the desk.
 */

import { writeFileAtomic } from '../../fs/atomic-write.js';
import { fail } from '../../result.js';
import { inSpace } from '../checks.js';
import type { MigrationStep } from '../context.js';
import { FOLLOW_UP_NOTE_PATH, followUpNoteText } from '../follow-up.js';
import { recordStepDone, stepStopped } from '../local/record.js';
import { verificationText, verifyMigration } from '../verify.js';

const TITLE = 'Verify the migration';

/** The kind of the failure of a verification that did not pass. */
export const VERIFICATION_FAILED = 'verification-failed';

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
      {
        what: 'Check that the Space repository is committed and pushed.',
        to: ctx.repositoryName,
      },
      {
        what: 'Check that every planned issue is found once by its marker, on the Project.',
        to: ctx.repositoryName,
        count: ctx.issues.length,
      },
    ],
    isDone: async () => false,
    run: async (ctx) => {
      const verification = await verifyMigration(ctx);
      if (!verification.passed) {
        return fail(
          VERIFICATION_FAILED,
          `The verification of the migration failed. Nothing was undone; what the migration made stays in place.\n${verificationText(verification)}`,
        );
      }
      const written = await writeFileAtomic(
        inSpace(ctx, FOLLOW_UP_NOTE_PATH),
        followUpNoteText(ctx),
      );
      if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      return recordStepDone(ctx, 'verify', [
        ...verification.checks.map((one) => `Passed: ${one.title}`),
        FOLLOW_UP_NOTE_PATH,
      ]);
    },
  };
}
