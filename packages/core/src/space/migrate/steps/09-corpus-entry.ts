/**
 * Step 9: the Space's corpus entry, from the project's name and the
 * description the Human Lead wrote on the plan screen. Setup's corpus-entry
 * step does this; phase M6.3 builds `run` with it.
 */

import { corpusEntryStep as setupCorpusEntryStep } from '../../setup/steps.js';
import { notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';

const TITLE = "Write the Space's corpus entry";

/** Step 9. */
export function corpusEntryStep(): MigrationStep {
  return {
    id: 'corpus-entry',
    number: 9,
    title: TITLE,
    describe: async (ctx) => [
      ...(await setupCorpusEntryStep().describe(ctx.setup)),
      {
        what: `The Space is the migration of the v0.8 project "${ctx.source.project.name}".`,
        from: ctx.source.project.namePath,
        to: ctx.targets.corpusEntry,
      },
    ],
    isDone: (ctx) => setupCorpusEntryStep().isDone(ctx.setup),
    run: async () => notBuiltYet(TITLE),
  };
}
