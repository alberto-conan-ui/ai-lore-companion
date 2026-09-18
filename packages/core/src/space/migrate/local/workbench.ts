/**
 * What step 8 writes into the Workbench, computed from the source and the
 * Space without writing: the first journal entry, from the newest v0.8
 * handover, and the bytes of each draft. A draft is copied as it is, except
 * that in a markdown draft a relative link that would break from
 * `workbench/drafts/` is rewritten (see `links.ts`); a link that was already
 * broken in the v0.8 project is left as it was.
 */

import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { inSource, inSpace } from '../checks.js';
import type { MigrationContext } from '../context.js';
import { type DraftFile, archivedPath, loreRelative } from '../targets.js';
import { type LinkChange, rewriteLinks } from './links.js';

/** The bytes a draft must have in the Space, and the links changed in it. */
export type DraftContent = { bytes: Buffer; changes: LinkChange[] };

/** The bytes of `draft` as the Workbench holds it, or `null` when the source cannot be read. */
export async function draftContent(
  ctx: MigrationContext,
  draft: DraftFile,
): Promise<DraftContent | null> {
  const bytes = await readFile(inSource(ctx, draft.from)).catch(() => null);
  if (bytes === null) return null;
  if (posix.extname(draft.from).toLowerCase() !== '.md') return { bytes, changes: [] };
  const place = { from: draft.from, to: draft.to };
  const rewritten = await rewriteLinks(ctx, bytes.toString('utf8'), place, 'keep');
  if (rewritten.changes.length === 0) return { bytes, changes: [] };
  return { bytes: Buffer.from(rewritten.text, 'utf8'), changes: rewritten.changes };
}

/** Whether the Workbench holds `draft` with the bytes `draftContent` gives. Reads only. */
export async function draftInPlace(ctx: MigrationContext, draft: DraftFile): Promise<boolean> {
  const wanted = await draftContent(ctx, draft);
  if (wanted === null) return false;
  const held = await readFile(inSpace(ctx, draft.to)).catch(() => null);
  return held?.equals(wanted.bytes) === true;
}

/** The first journal entry: the handover section of the newest v0.8 entry that has one. */
export async function handoverEntry(
  ctx: MigrationContext,
): Promise<{ text: string; changes: LinkChange[] } | null> {
  const found = ctx.source.journal.newestHandover;
  const target = ctx.targets.handover;
  if (found === null || target === null) return null;
  const place = { from: found.path, to: target.to };
  const body = await rewriteLinks(ctx, found.text.trim(), place, 'keep');
  const heading = found.heading.replace(/^#+\s*/, '');
  const text = [
    '# The handover from AI-Lore v0.8',
    '',
    `The migration from AI-Lore v0.8 wrote this entry, the first of this journal. It holds the section "${heading}" of the v0.8 journal entry \`${loreRelative(ctx.source, found.path)}\`, as it was written there. The whole v0.8 entry is kept in the archive, at \`${archivedPath(ctx.source, found.path)}\`.`,
    '',
    `## ${heading}`,
    '',
    body.text,
    '',
  ].join('\n');
  return { text, changes: body.changes };
}
