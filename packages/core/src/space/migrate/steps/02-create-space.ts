/**
 * Step 2: create the Space, with the steps of "create a Space" that setup
 * already has (section 5.8): the machine check, the Space repository, the
 * Project and its layout, and the scaffold. The payload's clone, its mirror,
 * the corpus entry, the commit and the install are steps 3, 7, 9, 10 and 12.
 * Phase M6.3 builds `run`, by running `createSpaceSubSteps` with the runner.
 */

import {
  type CreateSpaceContext,
  machineCheckStep,
  projectLayoutStep,
  projectStep,
  scaffoldStep,
  spaceRepositoryStep,
} from '../../setup/steps.js';
import type { Step } from '../../steps/types.js';
import { notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';
import { ledgerHasStep } from '../ledger.js';

const TITLE = 'Create the Space';

/** The setup steps step 2 is made of, in order. They run on `ctx.setup`. */
export function createSpaceSubSteps(): Step<CreateSpaceContext>[] {
  return [
    machineCheckStep(),
    spaceRepositoryStep(),
    projectStep(),
    projectLayoutStep(),
    scaffoldStep(),
  ];
}

/** Step 2. */
export function createSpaceStep(): MigrationStep {
  return {
    id: 'create-space',
    number: 2,
    title: TITLE,
    describe: async (ctx) => {
      const lines = [];
      for (const step of createSpaceSubSteps()) lines.push(...(await step.describe(ctx.setup)));
      return lines;
    },
    isDone: async (ctx) => {
      // The machine check and the Project's layout are never done by their own
      // `isDone`, since they are asked again each time; only the ledger can say
      // step 2 finished them. The ledger alone is not enough: the repository,
      // the Project and the scaffold must be there as well.
      if (!ledgerHasStep(ctx, 'create-space')) return false;
      for (const step of createSpaceSubSteps()) {
        if (step.id === 'machine-check' || step.id === 'project-layout') continue;
        if (!(await step.isDone(ctx.setup))) return false;
      }
      return true;
    },
    run: async () => notBuiltYet(TITLE),
  };
}
