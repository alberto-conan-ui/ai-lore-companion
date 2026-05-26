/**
 * Save-point reader. Save-points are append-only milestone records under
 * `memory/save-points/`, one file per save-point at `<date>_<slug>.save-point.md`,
 * with frontmatter carrying `date`, `lore_commit`, and `payload_commit`
 * (see [memory.md](../../../process/memory.md) § "The components in brief"
 * and § "The file schema").
 *
 * Two things this module surfaces: the parsed list, and the latest entry.
 * The latest entry is what the Companion uses as the diff baseline — Payload
 * files diff against `payload_commit`, Lore files against `lore_commit`.
 */

import { listMemoryDir } from '../frontmatter/index.js';
import type { SavePointFrontmatter } from '../frontmatter/types.js';

/** A save-point projected from its frontmatter, plus locating fields. */
export type SavePoint = {
  /** Absolute path to the save-point file. */
  path: string;
  /** Filename. */
  name: string;
  /** Title from frontmatter. */
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Git commit on the lore repo. */
  loreCommit: string;
  /** Git commit on the Payload repo. */
  payloadCommit: string;
  /** Body of the file — milestone description and any contract-override notes. */
  body: string;
};

function asSavePoint(entry: {
  path: string;
  name: string;
  frontmatter: unknown;
  body: string;
}): SavePoint | null {
  const fm = entry.frontmatter as SavePointFrontmatter | null;
  if (!fm || fm.type !== 'save-point') return null;
  if (typeof fm.date !== 'string' || fm.date.length === 0) return null;
  if (typeof fm.lore_commit !== 'string' || fm.lore_commit.length === 0) return null;
  if (typeof fm.payload_commit !== 'string' || fm.payload_commit.length === 0) return null;
  return {
    path: entry.path,
    name: entry.name,
    title: fm.title,
    date: fm.date,
    loreCommit: fm.lore_commit,
    payloadCommit: fm.payload_commit,
    body: entry.body,
  };
}

/**
 * List save-points in `<lore>/memory/save-points/`, sorted newest first.
 *
 * Ordering: `date` descending, with filename descending as a same-day tiebreak —
 * the file naming convention `<date>_<slug>.save-point.md` makes filename
 * order line up with chronological order for entries recorded on the same day.
 *
 * A missing directory returns `[]`; entries without a usable `type: save-point`
 * frontmatter (missing `date` / `lore_commit` / `payload_commit`) are skipped.
 * The index file is already filtered out by [`listMemoryDir`](../frontmatter/listing.ts).
 */
export function listSavePoints(absSavePointsDir: string): SavePoint[] {
  const out: SavePoint[] = [];
  for (const entry of listMemoryDir(absSavePointsDir)) {
    const sp = asSavePoint(entry);
    if (sp) out.push(sp);
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  });
  return out;
}

/** The most recent save-point, or `null` when no save-points are recorded. */
export function latestSavePoint(absSavePointsDir: string): SavePoint | null {
  const all = listSavePoints(absSavePointsDir);
  return all[0] ?? null;
}

/**
 * Pick the commit a Payload-or-Lore file diffs against, given a save-point.
 *
 * The Companion's diff baseline is per-repo: Payload files diff against the
 * save-point's `payload_commit`, Lore files against its `lore_commit`. This
 * helper centralises the choice so the IPC layer does not re-implement it.
 */
export function baselineCommit(savePoint: SavePoint, scope: 'payload' | 'lore'): string {
  return scope === 'payload' ? savePoint.payloadCommit : savePoint.loreCommit;
}
