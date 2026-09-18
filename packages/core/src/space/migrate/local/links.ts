/**
 * The relative markdown links of a text that moves from the v0.8 project into
 * the new Space: the prose of a contract or a mirror node, a draft, the
 * handover. A link is rewritten only where it would otherwise break: when the
 * file it points to is carried to a place the link, read from the text's new
 * place, does not reach. Everything else is left as it is written.
 *
 * Where a v0.8 path is carried: a draft to `workbench/drafts/`, a file or
 * folder of `memory/` or `references/` to the archive, and any other path
 * outside the Lore folder, which is the payload repository's, to its fresh
 * clone `repos/<name>/`. Reads the disk of the Space only to ask whether a
 * destination is there; writes nothing.
 */

import { stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { inSpace } from '../checks.js';
import type { MigrationContext } from '../context.js';
import { archivedPath } from '../targets.js';

/** Where a text was in the v0.8 project and where it is in the Space. */
export type LinkPlace = {
  /** Source-relative. */
  from: string;
  /** Space-relative. */
  to: string;
};

/**
 * What to do with a link whose file is not carried and that does not resolve
 * from its new place. `keep` leaves it as it is (the Workbench, which no check
 * reads). `code` turns it into its text followed by the address in inline
 * code, so the Lore has no reference that does not resolve.
 */
export type UnresolvedLinks = 'keep' | 'code';

/** One link that was changed: as it was written, and as it is now. */
export type LinkChange = { before: string; after: string };

export type RewrittenText = { text: string; changes: LinkChange[] };

const LINK = /(!?)\[([^\]\n]*)\]\(([^()\s]+)((?:\s+"[^"\n]*")?)\)/g;
const FENCE = /^\s*(```|~~~)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

async function exists(ctx: MigrationContext, spaceRelative: string): Promise<boolean> {
  if (spaceRelative === '..' || spaceRelative.startsWith('../')) return false;
  return (await stat(inSpace(ctx, spaceRelative)).catch(() => null)) !== null;
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Where the source-relative `path` is in the Space, Space-relative, and
 * whether it is a draft (written by the step that writes the drafts, so it is
 * counted as there). `null` when the path is not carried.
 */
function destinationOf(ctx: MigrationContext, path: string): { to: string; draft: boolean } | null {
  const draft = ctx.targets.drafts.find((candidate) => candidate.from === path);
  if (draft !== undefined) return { to: draft.to, draft: true };
  const lore = ctx.source.loreFolder;
  if (ctx.source.archive.roots.some((root) => isUnder(path, root))) {
    return { to: archivedPath(ctx.source, path), draft: false };
  }
  if (isUnder(path, lore)) return null;
  const checkout = ctx.targets.payloadCheckout;
  return { to: path === '' ? checkout : `${checkout}/${path}`, draft: false };
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function rewriteOne(
  ctx: MigrationContext,
  place: LinkPlace,
  unresolved: UnresolvedLinks,
  whole: string,
  bang: string,
  label: string,
  address: string,
  title: string,
): Promise<string> {
  if (SCHEME.test(address) || address.startsWith('#') || address.startsWith('/')) return whole;
  const cut = address.search(/[?#]/);
  const pathPart = cut < 0 ? address : address.slice(0, cut);
  const suffix = cut < 0 ? '' : address.slice(cut);
  if (pathPart === '') return whole;
  const path = decoded(pathPart);
  const trailing = path.endsWith('/') ? '/' : '';
  const strip = (value: string): string => value.replace(/\/+$/, '');
  const inSource = strip(posix.normalize(posix.join(posix.dirname(place.from), path)));
  const asWritten = strip(posix.normalize(posix.join(posix.dirname(place.to), path)));
  const outside = inSource === '..' || inSource.startsWith('../');
  const target = outside ? null : destinationOf(ctx, inSource === '.' ? '' : inSource);

  if (target !== null && target.to === asWritten) return whole;
  if (target !== null && (target.draft || (await exists(ctx, target.to)))) {
    const relative = posix.relative(posix.dirname(place.to), target.to) || '.';
    const written = `${relative.replace(/ /g, '%20')}${trailing}${suffix}`;
    return `${bang}[${label}](${written}${title})`;
  }
  if (unresolved === 'code' && !(await exists(ctx, asWritten))) {
    return `${label} (\`${address}\`)`;
  }
  return whole;
}

async function rewritePlain(
  ctx: MigrationContext,
  text: string,
  place: LinkPlace,
  unresolved: UnresolvedLinks,
  changes: LinkChange[],
): Promise<string> {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, bang = '', label = '', address = '', title = ''] = match;
    const at = match.index ?? 0;
    const after = await rewriteOne(ctx, place, unresolved, whole, bang, label, address, title);
    if (after !== whole) changes.push({ before: whole, after });
    out += text.slice(last, at) + after;
    last = at + whole.length;
  }
  return out + text.slice(last);
}

/**
 * Rewrite the relative links of `text`, which was at `place.from` and is
 * written at `place.to`. Text in fenced code blocks and in inline code is left
 * alone, as lore-integrity does not read it.
 */
export async function rewriteLinks(
  ctx: MigrationContext,
  text: string,
  place: LinkPlace,
  unresolved: UnresolvedLinks,
): Promise<RewrittenText> {
  const changes: LinkChange[] = [];
  const lines = text.split('\n');
  let fenced = false;
  const out: string[] = [];
  for (const line of lines) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced || !line.includes('](')) {
      out.push(line);
      continue;
    }
    // Odd pieces are inline code.
    const pieces = line.split(/(`+[^`]*`+)/);
    let rebuilt = '';
    for (const [index, piece] of pieces.entries()) {
      rebuilt +=
        index % 2 === 1 ? piece : await rewritePlain(ctx, piece, place, unresolved, changes);
    }
    out.push(rebuilt);
  }
  return { text: out.join('\n'), changes };
}

/** The ledger's words for the links changed in one file. */
export function describeChanges(to: string, changes: readonly LinkChange[]): string[] {
  return changes.map((change) => `${to}: the link ${change.before} became ${change.after}`);
}
