/**
 * Step 5: write the pointer to the old folder and the two old repository
 * addresses, in `publish/archive/index.md`, outside `v0.8/`, so the archive
 * folder stays identical to its source (section 10.1, question 9). Done when
 * the file names the old folder and every origin address the source has.
 * Phase M6.3 builds `run`.
 */

import { notBuiltYet, spaceFileHolds } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { ARCHIVE_POINTER } from '../targets.js';

const TITLE = 'Point to the old folder and repositories';

/** What the pointer file must name: the old folder and the origin of each source repository that has one. */
export function pointerTexts(ctx: MigrationContext): string[] {
  const texts = [ctx.source.root];
  for (const repository of [ctx.source.payloadRepository, ctx.source.loreRepository]) {
    if (repository.originUrl !== null) texts.push(repository.originUrl);
  }
  return texts;
}

/** Step 5. */
export function pointerStep(): MigrationStep {
  return {
    id: 'pointer',
    number: 5,
    title: TITLE,
    describe: async (ctx) => [
      {
        what: `Write where the v0.8 project was: its folder and the addresses of its two repositories (${pointerTexts(ctx).slice(1).join(', ') || 'none has an origin'}).`,
        from: ctx.source.root,
        to: ARCHIVE_POINTER,
      },
    ],
    isDone: (ctx) => spaceFileHolds(ctx, ARCHIVE_POINTER, pointerTexts(ctx)),
    run: async () => notBuiltYet(TITLE),
  };
}
