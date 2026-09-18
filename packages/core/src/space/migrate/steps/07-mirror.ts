/**
 * Step 7: the mirror of the payload repository in `lore/mirrors/`, with a
 * skeleton generated fresh (setup's mirror step) and the prose of the v0.8
 * mirror nodes carried into it. Done when the mirror is there, listed, and
 * holds the prose of every node as it is. Phase M6.3 builds `run`.
 */

import { repositoryMirrorStep } from '../../setup/steps.js';
import { notBuiltYet, spaceFileHolds } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';

const TITLE = "Carry the mirror's prose";

/** The prose of each v0.8 mirror node that has any, trimmed: what the new mirror must hold. */
export function carriedProse(ctx: MigrationContext): string[] {
  return ctx.source.mirror.map((node) => node.prose.trim()).filter((prose) => prose !== '');
}

/** Step 7. */
export function mirrorStep(): MigrationStep {
  return {
    id: 'mirror',
    number: 7,
    title: TITLE,
    describe: async (ctx) => [
      ...(await repositoryMirrorStep(ctx.payload).describe(ctx.setup)),
      {
        what: "Carry the prose of the v0.8 mirror's nodes into it; their folder trees are replaced by the fresh skeleton.",
        from: ctx.targets.mirror.from.join(', '),
        to: ctx.targets.mirror.to,
        count: ctx.targets.mirror.from.length,
      },
    ],
    isDone: async (ctx) =>
      (await repositoryMirrorStep(ctx.payload).isDone(ctx.setup)) &&
      (await spaceFileHolds(ctx, ctx.targets.mirror.to, carriedProse(ctx))),
    run: async () => notBuiltYet(TITLE),
  };
}
