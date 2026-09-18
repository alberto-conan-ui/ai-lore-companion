/**
 * Step 5: write the pointer to the old folder and the two old repository
 * addresses, in `publish/archive/index.md`, outside `v0.8/`, so the archive
 * folder stays identical to its source (section 10.1, question 9). Done when
 * the file names the old folder and every origin address the source has.
 * Phase M6.3 builds `run`.
 */

import { writeFileAtomic } from '../../fs/atomic-write.js';
import { inSpace, spaceFileHolds } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { recordStepDone, stepStopped } from '../local/record.js';
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
    run: async (ctx) => {
      if (!(await spaceFileHolds(ctx, ARCHIVE_POINTER, pointerTexts(ctx)))) {
        const written = await writeFileAtomic(inSpace(ctx, ARCHIVE_POINTER), pointerText(ctx));
        if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      }
      return recordStepDone(ctx, 'pointer', [ARCHIVE_POINTER]);
    },
  };
}

function origin(repository: MigrationContext['source']['payloadRepository']): string {
  if (!repository.present) return 'it is not a git repository of its own';
  return repository.originUrl === null
    ? 'it has no origin address'
    : `its origin address is \`${repository.originUrl}\``;
}

/** The pointer file: a markdown file of the publish area, so it has no frontmatter. */
function pointerText(ctx: MigrationContext): string {
  const { source } = ctx;
  return [
    '# The AI-Lore v0.8 archive',
    '',
    `This Space was migrated from the AI-Lore v0.8 project "${source.project.name}". The folder \`v0.8/\` beside this file holds a copy of that project's \`memory/\` and \`references/\` folders as they were when the migration ran, without the \`.git\` folder of the Lore repository. The copy is a record: its links are left as they were written, and nothing in it is updated.`,
    '',
    'The migration did not change, move or remove anything of the v0.8 project. It is still in these places:',
    '',
    `- The old folder: \`${source.root}\`.`,
    `- The payload repository, the folder \`${source.payloadRepository.path}\` of the old folder: ${origin(source.payloadRepository)}.`,
    `- The Lore repository, the folder \`${source.loreRepository.path}\` of the old folder: ${origin(source.loreRepository)}.`,
    '',
  ].join('\n');
}
