/**
 * Step 7: the mirror of the payload repository in `lore/mirrors/`, with a
 * skeleton generated fresh (setup's mirror step) and the prose of the v0.8
 * mirror nodes carried into it. Done when the mirror is there, listed, and
 * holds the prose of every node as it is, except for the links that would
 * not resolve from `lore/mirrors/` (`local/links.ts`).
 */

import { parseLoreFrontmatter } from '../../frontmatter/index.js';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import { repositoryMirrorStep } from '../../setup/steps.js';
import { inSpace, spaceFileHolds, spaceText } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { type LinkChange, describeChanges, rewriteLinks } from '../local/links.js';
import { recordStepDone, stepStopped } from '../local/record.js';

const TITLE = "Carry the mirror's prose";

/** One v0.8 mirror node's prose as the new mirror holds it. */
type CarriedNode = { target: string; prose: string; changes: LinkChange[] };

/**
 * The prose of each v0.8 mirror node that has any, trimmed, with each link
 * that would not resolve from the new mirror rewritten to the carried file,
 * or set as inline code when the file is carried nowhere.
 */
async function carriedNodes(ctx: MigrationContext): Promise<CarriedNode[]> {
  const nodes: CarriedNode[] = [];
  for (const node of ctx.source.mirror) {
    const prose = node.prose.trim();
    if (prose === '') continue;
    const place = { from: node.path, to: ctx.targets.mirror.to };
    const carried = await rewriteLinks(ctx, prose, place, 'code');
    nodes.push({ target: node.target, prose: carried.text, changes: carried.changes });
  }
  return nodes;
}

/** What the new mirror must hold: the prose of every node, as `carriedNodes` gives it. */
export async function carriedProse(ctx: MigrationContext): Promise<string[]> {
  return (await carriedNodes(ctx)).map((node) => node.prose);
}

/** The heading of the section that holds the carried prose. */
const CARRIED_HEADING = '## What the v0.8 mirror said';

/** The sentence setup writes when the mirror has no description yet, which the migration replaces. */
const SETUP_SENTENCE =
  'The companion wrote this mirror at setup with a first skeleton and no description. What the repository holds, and where things go in it, is written here by the Human Lead and the sessions.';

function withCarriedProse(text: string, nodes: readonly CarriedNode[]): string {
  const section = [
    CARRIED_HEADING,
    '',
    'The migration from AI-Lore v0.8 carried the prose below from the v0.8 mirror, one part per node, as it was written there. The folder trees that the v0.8 nodes drew are left out, because the skeleton of this mirror replaces them.',
    '',
    ...nodes.flatMap((node) => [`### \`${node.target}\``, '', node.prose, '']),
  ].join('\n');
  let body = text.replace(
    SETUP_SENTENCE,
    'The companion wrote this mirror during the migration from AI-Lore v0.8, with a skeleton generated fresh from the clone of the repository and the prose of the v0.8 mirror, which the next section holds. The Human Lead and the sessions keep it true from here.',
  );
  // An earlier section of carried prose is replaced whole, so a second run does not add another.
  const start = body.indexOf(`\n${CARRIED_HEADING}\n`);
  const skeleton = body.indexOf('\n## The skeleton\n');
  if (start >= 0) {
    const end = skeleton > start ? skeleton : body.length;
    body = `${body.slice(0, start + 1)}${body.slice(end + 1)}`;
  }
  const at = body.indexOf('\n## The skeleton\n');
  if (at < 0) return `${body.replace(/\n*$/, '\n')}\n${section}`;
  return `${body.slice(0, at + 1)}${section}\n${body.slice(at + 1)}`;
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
      (await spaceFileHolds(ctx, ctx.targets.mirror.to, await carriedProse(ctx))),
    run: async (ctx) => {
      // The skeleton, generated fresh from the clone in `repos/`, with setup's writer.
      const mirror = repositoryMirrorStep(ctx.payload);
      if (!(await mirror.isDone(ctx.setup))) {
        const written = await mirror.run(ctx.setup);
        if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      }
      const nodes = await carriedNodes(ctx);
      const to = ctx.targets.mirror.to;
      const wanted = nodes.map((node) => node.prose);
      if (nodes.length > 0 && !(await spaceFileHolds(ctx, to, wanted))) {
        const text = await spaceText(ctx, to);
        if (text === null) return stepStopped('lore-write-failed', TITLE, `${to} cannot be read`);
        const carried = withCarriedProse(text, nodes);
        if (!parseLoreFrontmatter(carried).ok) {
          return stepStopped(
            'lore-write-failed',
            TITLE,
            `the frontmatter of ${to} does not read back`,
          );
        }
        const written = await writeFileAtomic(inSpace(ctx, to), carried);
        if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
      }
      return recordStepDone(ctx, 'mirror', [
        to,
        ...nodes.flatMap((node) => describeChanges(to, node.changes)),
      ]);
    },
  };
}
