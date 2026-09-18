/**
 * The Lore reader: reads `<space>/lore`, resolves the three layers of each
 * part by name, and returns the cards in use together with everything wrong
 * it found.
 *
 * Layer resolution: each part has `core/`, `default/` and the Space's own files
 * beside them. An own card with the file name of a default is used instead of
 * it. A file outside `core/` that has the name of a file in `core/` of the same
 * part is reported and not used.
 *
 * The reader never writes. It never follows a symbolic link out of the Lore
 * folder, and it does not descend into a folder that is a symbolic link. Bad
 * content never makes it throw or stop: a file that cannot be used becomes a
 * `LoreProblem` with the file's path and a sentence, and the rest is read.
 */

import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseLoreFrontmatter } from '../frontmatter/frontmatter-subset.js';
import { isInsideLexically } from '../fs/paths.js';
import { SPACE_LAYOUT, spacePaths } from '../layout/space-paths.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import { LORE_PARTS, readLoreCard } from './card.js';
import { parseLoreIndex } from './index-file.js';
import type {
  LoreCard,
  LoreCardOf,
  LoreEntry,
  LoreLayer,
  LorePart,
  LoreParts,
  LoreProblem,
  LoreProblemKind,
  ResolvedLore,
} from './types.js';

/** The kinds of failure `readLore` returns. Everything else is a `LoreProblem` in the value. */
export type LoreFailureKind =
  /** `<space>/lore` does not exist or cannot be read at all. */
  | 'lore-missing'
  /** `<space>/lore` is a file or a symbolic link, not a folder. */
  | 'lore-not-a-folder';

const INDEX_FILE = 'index.md';

/** What a folder of the Lore holds, as the index convention counts it. */
type FolderListing = {
  dir: string;
  /** Every child that is not a folder, `index.md` excluded. Names that begin with a dot are left out. */
  files: string[];
  /** Every child that is a real folder (not a symbolic link). */
  folders: string[];
  /** The files that can be read: regular files, and symbolic links to a file inside the Lore folder. */
  readable: Set<string>;
  /** The sentence of each child's line in the folder's index, by name. */
  descriptions: Map<string, string>;
};

/** What one run of the reader carries. */
type ReadContext = {
  spaceRoot: string;
  /** The Lore folder with symbolic links resolved, to judge where a link leads. */
  realLoreDir: string;
  listings: Map<string, FolderListing>;
  problems: LoreProblem[];
};

function report(ctx: ReadContext, kind: LoreProblemKind, path: string, message: string): void {
  ctx.problems.push({ kind, path, message });
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A file name for the comparison with the names of `core/`: without regard to
 * upper and lower case and to the Unicode form, as the lore-integrity check
 * script compares them, because the Human Lead's disk may not tell them apart.
 */
const foldName = (name: string): string => name.normalize('NFC').toLowerCase();

/** A card or an index is a few kilobytes. A larger file is reported and not read. */
const LORE_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** The text of a file, or `null` with a problem when it cannot be read as UTF-8. */
async function readText(ctx: ReadContext, path: string): Promise<string | null> {
  try {
    const { size } = await stat(path);
    if (size > LORE_FILE_MAX_BYTES) {
      report(
        ctx,
        'unreadable',
        path,
        `the file has ${size} bytes and was not read; a file of the Lore has at most ${LORE_FILE_MAX_BYTES}`,
      );
      return null;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch (caught) {
    const reason = caught instanceof TypeError ? 'it is not UTF-8 text' : errorMessage(caught);
    report(ctx, 'unreadable', path, `the file cannot be read: ${reason}`);
    return null;
  }
}

/** Whether the symbolic link at `path` can be read as a file. Reports the link when it cannot. */
async function isReadableLink(ctx: ReadContext, path: string): Promise<boolean> {
  let target: string;
  try {
    target = await realpath(path);
  } catch (caught) {
    report(
      ctx,
      'symlink',
      path,
      `the symbolic link cannot be resolved and was not read: ${errorMessage(caught)}`,
    );
    return false;
  }
  if (!isInsideLexically(ctx.realLoreDir, target)) {
    report(
      ctx,
      'symlink',
      path,
      'the symbolic link points outside the Lore folder and was not followed',
    );
    return false;
  }
  try {
    if ((await stat(target)).isFile()) return true;
  } catch (caught) {
    report(ctx, 'symlink', path, `the symbolic link was not read: ${errorMessage(caught)}`);
    return false;
  }
  report(ctx, 'symlink', path, 'the symbolic link points to a folder and was not followed');
  return false;
}

/** Compare what the folder's index lists with what the folder holds, and keep the sentences. */
async function readIndexOf(ctx: ReadContext, listing: FolderListing): Promise<void> {
  const indexPath = join(listing.dir, INDEX_FILE);
  if (!listing.readable.has(INDEX_FILE)) {
    report(ctx, 'index-missing', listing.dir, 'the folder has no index.md');
    return;
  }
  const text = await readText(ctx, indexPath);
  if (text === null) return;

  const parsed = parseLoreFrontmatter(text);
  if (!parsed.ok) {
    report(ctx, 'frontmatter', indexPath, parsed.error.message);
  } else {
    const keys = Object.keys(parsed.value.data);
    if (keys.length !== 1 || parsed.value.data.type !== 'index') {
      report(
        ctx,
        'frontmatter',
        indexPath,
        'the frontmatter of an index.md has the one key type, with the value index',
      );
    }
  }

  // The lines are read even when the frontmatter is wrong, so that one fault does not hide the others.
  const index = parseLoreIndex(parsed.ok ? parsed.value.body : text);
  for (const sentence of index.malformed) report(ctx, 'index-line', indexPath, sentence);

  for (const [what, isFolder, actual] of [
    ['file', false, listing.files],
    ['folder', true, listing.folders],
  ] as const) {
    const listed = index.lines.filter((line) => line.isFolder === isFolder);
    const listedNames = listed.map((line) => line.name);
    for (const name of actual) {
      if (!listedNames.includes(name)) {
        report(ctx, 'index-omits', indexPath, `the index has no line for the ${what} ${name}`);
      }
    }
    for (const name of [...new Set(listedNames)].sort(byText)) {
      if (!actual.includes(name)) {
        report(
          ctx,
          'index-over-lists',
          indexPath,
          `the index lists the ${what} ${name}, which is not in the folder`,
        );
      }
      if (listedNames.filter((other) => other === name).length > 1) {
        report(
          ctx,
          'index-duplicate',
          indexPath,
          `the index lists the ${what} ${name} more than once`,
        );
      }
    }
    for (const line of listed) {
      if (!listing.descriptions.has(line.name)) {
        listing.descriptions.set(line.name, line.description);
      }
    }
  }
}

/** List `dir`, check its index, and do the same for every real folder below it. */
async function readFolder(ctx: ReadContext, dir: string): Promise<void> {
  const listing: FolderListing = {
    dir,
    files: [],
    folders: [],
    readable: new Set(),
    descriptions: new Map(),
  };
  ctx.listings.set(dir, listing);

  let names: { name: string; kind: 'folder' | 'file' | 'link' | 'other' }[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory()
          ? ('folder' as const)
          : entry.isFile()
            ? ('file' as const)
            : entry.isSymbolicLink()
              ? ('link' as const)
              : ('other' as const),
      }))
      .sort((a, b) => byText(a.name, b.name));
  } catch (caught) {
    report(ctx, 'unreadable', dir, `the folder cannot be read: ${errorMessage(caught)}`);
    return;
  }

  for (const { name, kind } of names) {
    if (kind === 'folder') {
      listing.folders.push(name);
      continue;
    }
    // Anything that is not a real folder counts as a file of the folder, as the
    // lore-integrity check script counts it; only what can be read is read.
    if (name !== INDEX_FILE) listing.files.push(name);
    if (kind === 'file' || (kind === 'link' && (await isReadableLink(ctx, join(dir, name))))) {
      listing.readable.add(name);
    }
  }

  await readIndexOf(ctx, listing);
  for (const name of listing.folders) await readFolder(ctx, join(dir, name));
}

/**
 * The absolute path of the script that a card's frontmatter names (`check` of a
 * contract, `generator` of a mirror), or `null` with a problem when the path is
 * not a file inside the Lore folder.
 */
async function resolveScript(
  ctx: ReadContext,
  cardPath: string,
  key: string,
  spaceRelative: string,
): Promise<string | null> {
  const absolute = resolve(ctx.spaceRoot, ...spaceRelative.split('/'));
  try {
    const real = await realpath(absolute);
    if (isInsideLexically(ctx.realLoreDir, real) && (await stat(real)).isFile()) return absolute;
  } catch {
    // Reported below with the other reasons: the path does not lead to a file.
  }
  report(
    ctx,
    'script-missing',
    cardPath,
    `the key ${key} names "${spaceRelative}", which is not a file inside the Lore folder`,
  );
  return null;
}

/** Read the cards of one layer of a part. A file that cannot be used is reported and left out. */
async function readLayer(
  ctx: ReadContext,
  part: LorePart,
  layer: LoreLayer,
  listing: FolderListing | undefined,
  coreNames: ReadonlySet<string>,
  defaultNames: ReadonlySet<string>,
): Promise<LoreEntry[]> {
  const entries: LoreEntry[] = [];
  if (listing === undefined) return entries;
  for (const fileName of listing.files) {
    const path = join(listing.dir, fileName);
    if (layer !== 'core' && coreNames.has(foldName(fileName))) {
      report(
        ctx,
        'core-name-taken',
        path,
        `the file has the name of the core file ${SPACE_LAYOUT.lore}/${part}/core/${fileName}; no file may take the name of a core file, so it was not used`,
      );
      continue;
    }
    if (!fileName.endsWith('.md') || !listing.readable.has(fileName)) continue;

    const text = await readText(ctx, path);
    if (text === null) continue;
    const parsed = parseLoreFrontmatter(text);
    if (!parsed.ok) {
      report(ctx, 'frontmatter', path, `${parsed.error.message}; the card was not used`);
      continue;
    }
    const card = readLoreCard(parsed.value.data, part, fileName);
    if (!card.ok) {
      for (const sentence of card.error) {
        report(ctx, 'card', path, `${sentence}; the card was not used`);
      }
      continue;
    }

    let script: string | null = null;
    if (card.value.kind === 'contract' && card.value.check !== null) {
      script = await resolveScript(ctx, path, 'check', card.value.check);
    } else if (card.value.kind === 'mirror') {
      script = await resolveScript(ctx, path, 'generator', card.value.generator);
    }

    entries.push({
      card: card.value,
      part,
      layer,
      name: fileName.slice(0, -'.md'.length),
      path,
      description: listing.descriptions.get(fileName) ?? null,
      replacesDefault: layer === 'own' && defaultNames.has(fileName),
      script,
    });
  }
  return entries;
}

/** Put an entry in the list of its part. The card's kind fixes the part, so no cast is needed. */
function place(parts: LoreParts, entry: LoreEntry): void {
  const card: LoreCard = entry.card;
  switch (card.kind) {
    case 'corpus':
      parts.corpus.push({ ...entry, card });
      return;
    case 'verb':
      parts.verbs.push({ ...entry, card });
      return;
    case 'process':
      parts.processes.push({ ...entry, card });
      return;
    case 'contract':
      parts.contracts.push({ ...entry, card });
      return;
    case 'mirror':
      parts.mirrors.push({ ...entry, card });
      return;
  }
}

/**
 * Read the Lore of the Space whose folder is `spaceRoot`.
 *
 * The value holds, per part, the cards in use after layer resolution, each with
 * the sentence of its index line as `description`; the defaults that an own
 * card replaces; and the problems found, each with the path of the file or
 * folder and a sentence. Problems are found in cards (frontmatter outside the
 * subset, keys that do not fit the kind, a core name taken, a script that does
 * not exist), in indexes of every folder under `lore/` (missing, a child with
 * no line, a line with no child, a line out of form) and in symbolic links.
 *
 * Fails only when there is no Lore folder to read. `lore/space.md` is the
 * manifest and is read by `manifest/`, not here.
 */
export async function readLore(
  spaceRoot: string,
): Promise<Result<ResolvedLore, Failure<LoreFailureKind>>> {
  const paths = spacePaths(spaceRoot);
  let realLoreDir: string;
  try {
    const info = await lstat(paths.lore);
    if (!info.isDirectory()) {
      return fail(
        'lore-not-a-folder',
        `${paths.lore} is not a folder; the Lore is the folder ${SPACE_LAYOUT.lore}/ of the Space`,
      );
    }
    realLoreDir = await realpath(paths.lore);
  } catch (caught) {
    const reason = errorCode(caught) === 'ENOENT' ? 'it does not exist' : errorMessage(caught);
    return fail('lore-missing', `the Lore folder ${paths.lore} cannot be read: ${reason}`);
  }

  const ctx: ReadContext = {
    spaceRoot: paths.root,
    realLoreDir,
    listings: new Map(),
    problems: [],
  };
  await readFolder(ctx, paths.lore);

  const parts: LoreParts = { corpus: [], verbs: [], processes: [], contracts: [], mirrors: [] };
  const replaced: LoreEntry[] = [];
  for (const part of LORE_PARTS) {
    const partDir = join(paths.lore, part);
    const own = ctx.listings.get(partDir);
    if (own === undefined) {
      report(ctx, 'part-missing', partDir, `the Lore has no folder ${SPACE_LAYOUT.lore}/${part}/`);
      continue;
    }
    const core = ctx.listings.get(join(partDir, 'core'));
    const defaults = ctx.listings.get(join(partDir, 'default'));
    const coreNames = new Set((core?.files ?? []).map(foldName));
    const defaultNames = new Set(defaults?.files ?? []);

    const coreEntries = await readLayer(ctx, part, 'core', core, coreNames, defaultNames);
    const defaultEntries = await readLayer(ctx, part, 'default', defaults, coreNames, defaultNames);
    const ownEntries = await readLayer(ctx, part, 'own', own, coreNames, defaultNames);

    const ownNames = new Set(ownEntries.map((entry) => entry.name));
    const inUse = [...coreEntries, ...ownEntries];
    for (const entry of defaultEntries) {
      if (ownNames.has(entry.name)) replaced.push(entry);
      else inUse.push(entry);
    }
    for (const entry of inUse.sort((a, b) => byText(a.name, b.name))) place(parts, entry);
  }

  return ok({
    spaceRoot: paths.root,
    loreDir: paths.lore,
    parts,
    replaced,
    problems: ctx.problems,
  });
}

/** The card in use with the name `name` (the file name without `.md`) in `part`, or `null`. */
export function findLoreEntry<P extends LorePart>(
  lore: ResolvedLore,
  part: P,
  name: string,
): LoreEntry<LoreCardOf[P]> | null {
  const entries: readonly LoreEntry<LoreCardOf[P]>[] = lore.parts[part];
  return entries.find((entry) => entry.name === name) ?? null;
}
