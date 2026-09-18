/**
 * Step 12: install the Space's Lore into Claude Code, and record where every
 * root starts. Setup's install and first-seen steps do this; phase M6.3
 * builds `run` with them.
 */

import { deskPaths } from '../../layout/desk-paths.js';
import { firstSeenStep, installStep as setupInstallStep } from '../../setup/steps.js';
import type { MigrationStep } from '../context.js';
import { recordStepDone, stepStopped } from '../local/record.js';

const TITLE = 'Install into Claude Code';

/** Step 12. */
export function installStep(): MigrationStep {
  return {
    id: 'install',
    number: 12,
    title: TITLE,
    describe: async (ctx) => [
      ...(await setupInstallStep().describe(ctx.setup)),
      ...(await firstSeenStep().describe(ctx.setup)),
    ],
    isDone: async (ctx) =>
      (await setupInstallStep().isDone(ctx.setup)) && (await firstSeenStep().isDone(ctx.setup)),
    run: async (ctx) => {
      // Both write only to the desk: the install folder and the first-seen records.
      for (const step of [setupInstallStep(), firstSeenStep()]) {
        if (await step.isDone(ctx.setup)) continue;
        const done = await step.run(ctx.setup);
        if (!done.ok) return stepStopped(done.error.kind, TITLE, done.error.message);
      }
      return recordStepDone(ctx, 'install', [
        deskPaths(ctx.deps.userDataDir, ctx.spaceRoot).install,
        'the first-seen commit of every root',
      ]);
    },
  };
}
