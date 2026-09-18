/**
 * Step 3: clone the payload repository fresh from its origin address into
 * `repos/<name>`. The source checkout is only read. Setup's clone step does
 * this; phase M6.3 builds `run` with it.
 */

import { cloneRepositoryStep } from '../../setup/steps.js';
import { notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';

const TITLE = 'Clone the payload repository';

/** Step 3. */
export function clonePayloadStep(): MigrationStep {
  return {
    id: 'clone-payload',
    number: 3,
    title: TITLE,
    describe: (ctx) => cloneRepositoryStep(ctx.payload).describe(ctx.setup),
    isDone: (ctx) => cloneRepositoryStep(ctx.payload).isDone(ctx.setup),
    run: async () => notBuiltYet(TITLE),
  };
}
