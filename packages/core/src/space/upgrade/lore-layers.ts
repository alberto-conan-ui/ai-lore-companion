/**
 * Bring a Space's `core/` and `default/` folders up to the shipped template.
 *
 * The two layers are defined as replaced as a whole: `lore/corpus/core/lore.md`
 * and the Human Lead's decision on the layers both say that an upgrade of
 * AI-Lore replaces them and that they are never edited in place. Setup copies
 * the template once, at creation (`setup/steps.ts`'s scaffold), and nothing
 * revisits it, so a Space created before a template change keeps the old files
 * for ever.
 *
 * That became load-bearing when contracts gained a `default/` folder. Until it
 * did, contracts was the only part of the Lore with no such folder, so a
 * contract that says how a Space works well — rather than what keeps it safe —
 * had nowhere to live but `core/`, where no Space may replace it. Moving one
 * card is four file operations in the template; for a Space that already
 * exists it is this function, because the card's old path is named in the
 * frontmatter of three corpus entries and `lore-integrity` refuses a Lore
 * whose references do not resolve.
 *
 * What it does not touch is the custom layer: the Space's own files, beside
 * the two folders, are never read, written or removed here. A Space's own
 * contracts survive the upgrade, which is the point of it.
 *
 * It is idempotent. Running it on a Space that is already current writes
 * nothing and reports nothing.
 */

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { LORE_PARTS } from '../lore/card.js';
import { type Failure, type Result, errorCode, fail, ok } from '../result.js';

/** The two folders an upgrade replaces as a whole. */
const LAYERS = ['core', 'default'] as const;

/** What one run changed, each path relative to the Space's folder. */
export type LoreLayerUpgrade = {
  /** Files written into a `core/` or `default/` folder. */
  written: string[];
  /** Files removed from a `core/` or `default/` folder, because the template no longer ships them. */
  removed: string[];
  /** Part indexes that gained a line for a layer folder they did not list. */
  listed: string[];
};

/** What can go wrong. */
export type LoreLayerUpgradeFailure = Failure<'lore-upgrade-failed'>;

/** The text of `path`, or `null` when there is no such file. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (caught) {
    if (errorCode(caught) === 'ENOENT') return null;
    throw caught;
  }
}

/** Whether `path` is a folder. `false` when it does not exist. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The file names directly in `dir`, without the ones that begin with a dot. A missing folder has none. */
async function fileNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Add `- [<layer>/](./<layer>/index.md): <sentence>` to the index of `partDir`
 * when it has no line for that folder. The line goes after the last folder
 * line, so `default/` follows `core/` as it does in every other part, and the
 * Space's own lines keep their place.
 *
 * The index of a part is the Space's own file: it lists the Space's own cards
 * beside the layer folders, so it is edited and never replaced.
 */
async function listLayerFolder(
  partDir: string,
  layer: string,
  sentence: string,
): Promise<Result<boolean, LoreLayerUpgradeFailure>> {
  const indexPath = join(partDir, 'index.md');
  const text = await readText(indexPath);
  if (text === null) return fail('lore-upgrade-failed', `${indexPath} is missing.`);
  const line = `- [${layer}/](./${layer}/index.md): ${sentence}`;
  if (text.includes(`- [${layer}/](./${layer}/index.md)`)) return ok(false);

  const lines = text.split('\n');
  const isFolderLine = (candidate: string) =>
    /^- \[[^\]]+\/\]\(\.\/[^)]+\/index\.md\)/.test(candidate);
  const last = lines.reduce((at, candidate, index) => (isFolderLine(candidate) ? index : at), -1);
  if (last === -1) return fail('lore-upgrade-failed', `${indexPath} lists no layer folder.`);
  lines.splice(last + 1, 0, line);

  const written = await writeFileAtomic(indexPath, lines.join('\n'));
  return written.ok ? ok(true) : fail('lore-upgrade-failed', written.error.message);
}

/**
 * The sentence for a layer folder's line, by part and layer, matching the
 * template's own wording. A combination that is not here is one no upgrade has
 * had to add: the line is then left to the Space, rather than invented from a
 * sentence written for another part.
 */
const LAYER_SENTENCE: Record<string, string> = {
  'contracts/default':
    'the contracts that ship with AI-Lore and that the Space may replace, which say how a Space works well rather than what keeps it safe.',
};

/**
 * Replace every `core/` and `default/` folder of `spaceRoot`'s Lore with the
 * one the template ships, and list a layer folder the part's index does not
 * name yet. The custom layer is not touched.
 */
export async function upgradeLoreLayers(
  spaceRoot: string,
  templateDir: string,
): Promise<Result<LoreLayerUpgrade, LoreLayerUpgradeFailure>> {
  const result: LoreLayerUpgrade = { written: [], removed: [], listed: [] };

  for (const part of LORE_PARTS) {
    const partDir = join(spaceRoot, 'lore', part);
    if (!(await isDirectory(partDir))) continue;

    for (const layer of LAYERS) {
      const fromDir = join(templateDir, 'lore', part, layer);
      // A part the template ships no such layer for is left exactly as it is:
      // `mirrors/` has neither folder, because a mirror describes the Space's
      // own payload and can only be the Space's own file.
      if (!(await isDirectory(fromDir))) continue;
      const intoDir = join(partDir, layer);

      const shipped = await fileNames(fromDir);
      for (const name of shipped) {
        const text = await readText(join(fromDir, name));
        if (text === null)
          return fail('lore-upgrade-failed', `${join(fromDir, name)} cannot be read.`);
        const at = join(intoDir, name);
        if ((await readText(at)) === text) continue;
        const written = await writeFileAtomic(at, text);
        if (!written.ok) return fail('lore-upgrade-failed', written.error.message);
        result.written.push(join('lore', part, layer, name));
      }

      // A file the template no longer ships is removed, which is how a card
      // moves between layers: it is written into the new folder above and
      // taken out of the old one here.
      for (const name of await fileNames(intoDir)) {
        if (shipped.includes(name)) continue;
        await rm(join(intoDir, name), { force: true });
        result.removed.push(join('lore', part, layer, name));
      }

      const sentence = LAYER_SENTENCE[`${part}/${layer}`];
      if (sentence === undefined) continue;
      const listed = await listLayerFolder(partDir, layer, sentence);
      if (!listed.ok) return listed;
      if (listed.value) result.listed.push(join('lore', part, 'index.md'));
    }
  }

  return ok(result);
}
