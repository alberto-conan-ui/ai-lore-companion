/**
 * Step 8: the Workbench. The newest journal handover becomes the first entry
 * of `workbench/journal/`; the product document, its images and the critique
 * note are copied as they are to `workbench/drafts/`, the draft spec of the
 * in-progress focus. Done when the entry is there and every draft has the
 * source's SHA-256. Phase M6.3 builds `run`.
 */

import { inSpace, isFile, notBuiltYet, sameContent } from '../checks.js';
import type { MigrationStep } from '../context.js';

const TITLE = 'Fill the Workbench';

const ROLE_WORDS = {
  'product-document': 'the product document',
  'product-image': 'an image of the product document',
  'critique-note': 'the critique note',
} as const;

/** Step 8. */
export function workbenchStep(): MigrationStep {
  return {
    id: 'workbench',
    number: 8,
    title: TITLE,
    describe: async (ctx) => {
      const { handover, drafts } = ctx.targets;
      const lines = [];
      if (handover !== null) {
        lines.push({
          what: `Write the section "${handover.heading}" of the newest journal entry that has one as the first journal entry.`,
          from: handover.from,
          to: handover.to,
        });
      }
      for (const draft of drafts) {
        lines.push({
          what: `Copy ${ROLE_WORDS[draft.role]} as it is into the drafts.`,
          from: draft.from,
          to: draft.to,
        });
      }
      return lines;
    },
    isDone: async (ctx) => {
      const { handover, drafts } = ctx.targets;
      if (handover !== null && !(await isFile(inSpace(ctx, handover.to)))) return false;
      for (const draft of drafts) {
        if (!(await sameContent(ctx, draft.from, draft.to, draft.sha256))) return false;
      }
      return true;
    },
    run: async () => notBuiltYet(TITLE),
  };
}
