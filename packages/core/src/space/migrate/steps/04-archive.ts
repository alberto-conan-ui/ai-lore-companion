/**
 * Step 4: copy `memory/` and `references/` as they are into
 * `publish/archive/v0.8/`, without the Lore repository's `.git` folder. Every
 * file of the working tree is copied, ignored files included (section 10.1,
 * question 3); links that point outside their folder, at a folder or at
 * nothing are not. Done when every file the copy takes has a destination file
 * with the same SHA-256. Phase M6.3 builds `run`.
 */

import { stat } from 'node:fs/promises';
import { copyTree } from '../../fs/copy-tree.js';
import { inSource, inSpace, sameContent } from '../checks.js';
import type { MigrationStep } from '../context.js';
import { recordStepDone, removeLeftoverTemps, stepStopped } from '../local/record.js';
import { ARCHIVE_DIR, archivedPath } from '../targets.js';

const TITLE = 'Copy the v0.8 Lore into the archive';

/** Step 4. */
export function archiveStep(): MigrationStep {
  return {
    id: 'archive',
    number: 4,
    title: TITLE,
    describe: async (ctx) => {
      const { archived, refusedLinks } = ctx.targets;
      const bytes = archived.reduce((sum, file) => sum + file.size, 0);
      const lines = [
        {
          what: `Copy every file of memory/ and references/ as it is (${bytes} bytes), ignored files included, without the .git folder of the Lore repository.`,
          from: ctx.source.archive.roots.join(', '),
          to: ARCHIVE_DIR,
          count: archived.length,
        },
      ];
      if (refusedLinks.length > 0) {
        lines.push({
          what: 'Leave out the links that point outside their folder, at a folder or at nothing.',
          from: refusedLinks.join(', '),
          to: ARCHIVE_DIR,
          count: refusedLinks.length,
        });
      }
      return lines;
    },
    isDone: async (ctx) => {
      for (const file of ctx.targets.archived) {
        if (!(await sameContent(ctx, file.from, file.to, file.sha256))) return false;
      }
      return true;
    },
    run: async (ctx) => {
      const refused = new Set(ctx.targets.refusedLinks);
      for (const root of ctx.source.archive.roots) {
        const from = inSource(ctx, root);
        if ((await stat(from).catch(() => null))?.isDirectory() !== true) continue;
        const to = inSpace(ctx, archivedPath(ctx.source, root));
        await removeLeftoverTemps(to);
        // The source is only read. A file already copied with the same hash is
        // left alone; one with other content is the migration's own copy, and
        // is replaced.
        const copied = await copyTree(from, to, {
          exclude: (relative) =>
            relative.split('/').includes('.git') || refused.has(`${root}/${relative}`),
          onConflict: 'overwrite',
        });
        if (!copied.ok) return stepStopped('archive-failed', TITLE, copied.error.message);
      }
      for (const file of ctx.targets.archived) {
        if (!(await sameContent(ctx, file.from, file.to, file.sha256))) {
          return stepStopped(
            'archive-differs',
            TITLE,
            `${file.to} does not have the SHA-256 the reader computed for ${file.from}; the source may have changed since the plan was made`,
          );
        }
      }
      return recordStepDone(ctx, 'archive', [
        `${ctx.targets.archived.length} files in ${ARCHIVE_DIR}`,
      ]);
    },
  };
}
