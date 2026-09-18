/**
 * Step 3: clone the payload repository fresh from its origin address into
 * `repos/<name>`. The source checkout is only read. Setup's clone step does
 * this; phase M6.3 builds `run` with it.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathInside } from '../../fs/paths.js';
import { fail } from '../../result.js';
import { cloneRepositoryStep } from '../../setup/steps.js';
import type { MigrationStep } from '../context.js';
import { recordStepDone, stepStopped } from '../local/record.js';

const TITLE = 'Clone the payload repository';

/**
 * Whether `address`, when it names a folder on this machine (a path or a
 * `file://` address), is the source's folder or inside it. A clone from there
 * would read the source's checkout, which step 3 never does.
 */
export function addressIsInSource(address: string, sourceRoot: string): boolean {
  let path: string;
  if (address.startsWith('file://')) {
    try {
      path = fileURLToPath(address);
    } catch {
      return false;
    }
  } else if (isAbsolute(address) || address.startsWith('.')) {
    path = resolve(sourceRoot, address);
  } else {
    return false;
  }
  const inside = isPathInside(sourceRoot, path);
  return !inside.ok || inside.value;
}

/** Step 3. */
export function clonePayloadStep(): MigrationStep {
  return {
    id: 'clone-payload',
    number: 3,
    title: TITLE,
    describe: (ctx) => cloneRepositoryStep(ctx.payload).describe(ctx.setup),
    isDone: (ctx) => cloneRepositoryStep(ctx.payload).isDone(ctx.setup),
    run: async (ctx) => {
      if (ctx.payload.cloneAddress === '') {
        return fail(
          'payload-has-no-origin',
          `The payload repository of ${ctx.source.root} has no origin address, so it was not cloned into ${ctx.targets.payloadCheckout}. Nothing was cloned.`,
        );
      }
      if (addressIsInSource(ctx.payload.cloneAddress, ctx.source.root)) {
        return fail(
          'origin-is-source',
          `The origin address of the payload repository, ${ctx.payload.cloneAddress}, is inside the v0.8 project's folder ${ctx.source.root}, so it was not cloned: the migration does not read the source's checkout. Nothing was cloned.`,
        );
      }
      const step = cloneRepositoryStep(ctx.payload);
      if (!(await step.isDone(ctx.setup))) {
        // A fresh clone from the origin address: the source's checkout is not read.
        const cloned = await step.run(ctx.setup);
        if (!cloned.ok) return stepStopped(cloned.error.kind, TITLE, cloned.error.message);
      }
      return recordStepDone(ctx, 'clone-payload', [ctx.targets.payloadCheckout]);
    },
  };
}
