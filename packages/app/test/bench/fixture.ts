/**
 * A deterministic on-disk file tree for search benchmarks and (later) the
 * "fast on a 10k-file fixture, measured" gate of Focus 3.
 *
 * Reused by `search.bench.ts` today; the index + fuzzy-ranking work will reuse
 * it as the regression fixture so the "before" and "after" numbers measure the
 * same tree. Deterministic — no randomness — so a re-run produces the identical
 * layout and the timings stay comparable across sessions.
 *
 * The tree is balanced: leaf directories are addressed by the base-`fanout`
 * digits of their index, which gives a nested structure (depth grows with the
 * file count) without per-node bookkeeping. Files are spread evenly across the
 * leaves. A minority of files carry recognisable names (`index.ts`,
 * `Component.tsx`, …) so a benchmark query can land on a realistic mix; the
 * bulk are filler so the walk cost reflects a real repo's long tail.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Fixture = {
  /** Absolute path to the fixture root — pass as a search `dir`. */
  root: string;
  /** Total files written. */
  fileCount: number;
  /** Total directories created (excluding the root). */
  dirCount: number;
  /** Remove the whole tree. */
  cleanup(): void;
};

export type FixtureOptions = {
  /** Target number of files. Default 10_000. */
  files?: number;
  /** Files per leaf directory. Default 16. */
  filesPerDir?: number;
  /** Branching factor of the directory tree. Default 8. */
  fanout?: number;
};

/** File extensions sprinkled across the tree, in a fixed cycle. */
const EXTENSIONS = ['ts', 'tsx', 'js', 'json', 'md', 'css', 'txt'] as const;

/** Recognisable basenames, placed as the first file in every Nth leaf dir so a
 *  query like "component" or "index" lands on a realistic, sparse set. */
const NAMED = [
  'index.ts',
  'Component.tsx',
  'helpers.ts',
  'README.md',
  'styles.css',
  'config.json',
] as const;

/** The base-`fanout` digits of `n`, most-significant first, at least one digit. */
function digits(n: number, fanout: number): number[] {
  if (n === 0) return [0];
  const out: number[] = [];
  let v = n;
  while (v > 0) {
    out.push(v % fanout);
    v = Math.floor(v / fanout);
  }
  return out.reverse();
}

export function buildFixture(opts: FixtureOptions = {}): Fixture {
  const files = opts.files ?? 10_000;
  const filesPerDir = opts.filesPerDir ?? 16;
  const fanout = opts.fanout ?? 8;

  const root = mkdtempSync(join(tmpdir(), 'cockpit-search-fixture-'));
  const leafCount = Math.ceil(files / filesPerDir);

  const createdDirs = new Set<string>();
  let fileCount = 0;

  for (let leaf = 0; leaf < leafCount && fileCount < files; leaf++) {
    // The leaf dir's path is `d<digit>/d<digit>/...` from this leaf's digits;
    // shared prefixes collapse into shared ancestor dirs.
    const segments = digits(leaf, fanout).map((d) => `d${d}`);
    const dir = join(root, ...segments);
    mkdirSync(dir, { recursive: true });
    // Record every ancestor segment so the dir count is honest.
    for (let i = 1; i <= segments.length; i++) {
      createdDirs.add(segments.slice(0, i).join('/'));
    }

    for (let k = 0; k < filesPerDir && fileCount < files; k++) {
      let name: string;
      if (k === 0 && leaf % 7 === 0) {
        // One recognisable name per 7th leaf dir.
        name = NAMED[Math.floor(leaf / 7) % NAMED.length] ?? 'index.ts';
      } else {
        const ext = EXTENSIONS[fileCount % EXTENSIONS.length] ?? 'txt';
        name = `file${fileCount}.${ext}`;
      }
      // Body content is irrelevant to a name-only walk; keep it tiny. Content
      // search (ripgrep) lands later and will want real bodies — a follow-up.
      writeFileSync(join(dir, name), '\n');
      fileCount++;
    }
  }

  return {
    root,
    fileCount,
    dirCount: createdDirs.size,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
