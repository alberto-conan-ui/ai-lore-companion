/**
 * Step 9: the Space's corpus entry, from the project's name and the
 * description the Human Lead wrote on the plan screen. Setup's corpus-entry
 * step does this; phase M6.3 builds `run` with it.
 */

import { basename, dirname } from 'node:path';
import { serializeLoreFrontmatter } from '../../frontmatter/index.js';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import { SPACE_LAYOUT } from '../../layout/space-paths.js';
import { type Result, fail, ok } from '../../result.js';
import { addIndexLine } from '../../setup/lore-writes.js';
import { corpusEntryStep as setupCorpusEntryStep } from '../../setup/steps.js';
import type { StepError } from '../../steps/types.js';
import { inSpace, isFile } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { recordStepDone, stepStopped } from '../local/record.js';
import { ARCHIVE_DIR, ARCHIVE_POINTER } from '../targets.js';

const TITLE = "Write the Space's corpus entry";

/** Step 9. */
export function corpusEntryStep(): MigrationStep {
  return {
    id: 'corpus-entry',
    number: 9,
    title: TITLE,
    describe: async (ctx) => [
      ...(await setupCorpusEntryStep().describe(ctx.setup)),
      {
        what: `The Space is the migration of the v0.8 project "${ctx.source.project.name}".`,
        from: ctx.source.project.namePath,
        to: ctx.targets.corpusEntry,
      },
    ],
    isDone: (ctx) => setupCorpusEntryStep().isDone(ctx.setup),
    run: async (ctx) => {
      const to = ctx.targets.corpusEntry;
      const path = inSpace(ctx, to);
      // An entry that is there is kept as it is, as setup's writer keeps it.
      if (!(await isFile(path))) {
        const text = corpusEntryText(ctx);
        if (!text.ok) return stepStopped(text.error.kind, TITLE, text.error.message);
        const written = await writeFileAtomic(path, text.value);
        if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      }
      const listed = await addIndexLine(
        dirname(path),
        basename(path),
        `the entry for this Space, the migration of the AI-Lore v0.8 project "${ctx.source.project.name}".`,
      );
      if (!listed.ok) return stepStopped(listed.error.kind, TITLE, listed.error.message);
      return recordStepDone(ctx, 'corpus-entry', [to]);
    },
  };
}

/** The description as the card holds it: one kind of line end, and no text that reads as a link. */
function description(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim().replace(/\]\(/g, '] (');
  return trimmed === '' ? 'The Human Lead gave no description of this Space.' : trimmed;
}

/**
 * The Space's corpus entry, in the shape setup writes, with the v0.8
 * project's name and the description the Human Lead wrote on the plan screen.
 */
function corpusEntryText(ctx: MigrationContext): Result<string, StepError> {
  const { name } = ctx.settings;
  const head = serializeLoreFrontmatter({
    type: 'corpus',
    term: name,
    points_at: [SPACE_LAYOUT.manifest, ARCHIVE_POINTER],
  });
  if (!head.ok) return fail('lore-write-failed', head.error.message);
  return ok(
    [
      '---',
      head.value,
      '---',
      '',
      `# ${name}`,
      '',
      '## What it means',
      '',
      `${name} is the name of this Space. It is the migration of the AI-Lore v0.8 project "${ctx.source.project.name}". The Human Lead described it in these words when the migration was planned:`,
      '',
      description(ctx.settings.description),
      '',
      '## Where it is kept',
      '',
      `The Space is the repository \`${ctx.repositoryName}\` on GitHub, and the folder of its clone on each desk. The file \`${SPACE_LAYOUT.manifest}\` names its repository, its Project and its payloads. The v0.8 project's \`memory/\` and \`references/\` are kept as they were in \`${ARCHIVE_DIR}/\`, and \`${ARCHIVE_POINTER}\` says where the v0.8 project and its two repositories are.`,
      '',
      '## What acts on it',
      '',
      'The companion wrote this entry during the migration from AI-Lore v0.8, from the plan the Human Lead confirmed. With the Lore claimed, the Human Lead and the sessions edit it as any other card of the Space.',
      '',
    ].join('\n'),
  );
}
