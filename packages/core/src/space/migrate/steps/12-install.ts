/**
 * Step 12: install the Space's Lore into Claude Code, and record where every
 * root starts. Setup's install and first-seen steps do this; phase M6.3
 * builds `run` with them.
 */

import { firstSeenStep, installStep as setupInstallStep } from '../../setup/steps.js';
import { notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';

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
    run: async () => notBuiltYet(TITLE),
  };
}
