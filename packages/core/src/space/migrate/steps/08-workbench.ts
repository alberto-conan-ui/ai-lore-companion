/**
 * Step 8: the Workbench. The newest journal handover becomes the first entry
 * of `workbench/journal/`; the product document, its images and the critique
 * note are copied as they are to `workbench/drafts/`, the draft spec of the
 * in-progress focus, except that a relative link in a markdown draft that
 * would break from there is rewritten (`local/links.ts`). Done when the entry
 * is there and every draft has the source's bytes, with only those links
 * rewritten; a draft with no such link has the source's SHA-256.
 */

import { stat } from 'node:fs/promises';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import { inSource, inSpace, isFile } from '../checks.js';
import type { MigrationStep } from '../context.js';
import { describeChanges } from '../local/links.js';
import { recordStepDone, stepStopped, writeBytesAtomic } from '../local/record.js';
import { draftContent, draftInPlace, handoverEntry } from '../local/workbench.js';

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
      // A draft has the source's bytes, except for the links that would break
      // from the drafts folder; `draftInPlace` compares with those bytes.
      for (const draft of drafts) {
        if (!(await draftInPlace(ctx, draft))) return false;
      }
      return true;
    },
    run: async (ctx) => {
      const created: string[] = [];
      const { handover, drafts } = ctx.targets;
      if (handover !== null) {
        created.push(handover.to);
        // Under journal-append-forward an entry is written once: one that is there is left as it is.
        if (!(await isFile(inSpace(ctx, handover.to)))) {
          const entry = await handoverEntry(ctx);
          if (entry !== null) {
            const written = await writeFileAtomic(inSpace(ctx, handover.to), entry.text);
            if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
            created.push(...describeChanges(handover.to, entry.changes));
          }
        }
      }
      for (const draft of drafts) {
        created.push(draft.to);
        const wanted = await draftContent(ctx, draft);
        if (wanted === null) {
          return stepStopped('draft-unreadable', TITLE, `${draft.from} cannot be read`);
        }
        created.push(...describeChanges(draft.to, wanted.changes));
        if (await draftInPlace(ctx, draft)) continue;
        const mode = (await stat(inSource(ctx, draft.from)).catch(() => null))?.mode;
        const written = await writeBytesAtomic(
          inSpace(ctx, draft.to),
          wanted.bytes,
          mode === undefined ? undefined : mode & 0o777,
        );
        if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      }
      return recordStepDone(ctx, 'workbench', created);
    },
  };
}
