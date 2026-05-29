/**
 * An in-process index of file paths for fast, ranked search — the structural
 * core of Focus 3's "path index, not a per-keystroke walk" gate.
 *
 * The old search re-walked every pane root on every keystroke (a full
 * `statSync`-per-file recursion). This index pays that walk **once** (lazily,
 * on the first search) and then answers every subsequent keystroke in memory.
 * The host keeps it fresh by feeding it the existing chokidar watcher's
 * `add` / `unlink` events — no re-walk, ever, after the build.
 *
 * The index stores file paths only (search matches file names, as before).
 * `search` ranks every stored name with {@link fuzzyScore} and returns the top
 * `limit` by score — rank-then-slice, so the cap is a render limit on already-
 * ranked hits, not an arbitrary walk-order cut.
 *
 * Pure data + one fs walk to populate. Off-thread relocation is Phase 2; the
 * pure-data boundary here is what makes that move easy later.
 */
import { basename, sep } from 'node:path';
import { isTreeError, readDirectory } from '../tree/tree.js';
import { fuzzyScore } from './fuzzy.js';

export type SearchHit = { name: string; path: string; score: number };

export class PathIndex {
  /** path → basename. */
  private names = new Map<string, string>();
  /** The roots this index was built over, in the order given. */
  private roots: string[] = [];
  /** True once {@link build} has populated the index. */
  ready = false;

  /** Walk `dirs` (respecting `ignore`) and populate the index, replacing any
   *  prior contents. Synchronous; this is the one-time cost the index amortises. */
  build(dirs: readonly string[], ignore: readonly string[]): void {
    this.names.clear();
    this.roots = [...dirs];
    for (const dir of dirs) this.walk(dir, ignore);
    this.ready = true;
  }

  /** Build the index if it is not yet ready, or if its roots no longer match
   *  `dirs` (a pane re-root). A no-op when already built over the same roots —
   *  so the per-keystroke search path can call it unconditionally. */
  ensureBuilt(dirs: readonly string[], ignore: readonly string[]): void {
    if (!this.ready || !this.coversExactly(dirs)) this.build(dirs, ignore);
  }

  private walk(dir: string, ignore: readonly string[]): void {
    const result = readDirectory(dir, { ignore });
    if (isTreeError(result)) return;
    for (const child of result.children ?? []) {
      if (child.isDir) this.walk(child.path, ignore);
      else this.names.set(child.path, child.name);
    }
  }

  /** True when the index covers exactly `dirs` (same set) — the search path
   *  rebuilds when the pane roots change (e.g. a publishing-shape re-root). */
  coversExactly(dirs: readonly string[]): boolean {
    if (this.roots.length !== dirs.length) return false;
    const a = [...this.roots].sort();
    const b = [...dirs].sort();
    return a.every((d, i) => d === b[i]);
  }

  /** Add a file path (watcher `add`). Ignored if it falls outside the indexed
   *  roots — watcher events span the whole project; the index is scoped to the
   *  pane roots it was built over. */
  add(path: string): void {
    if (!this.underRoot(path)) return;
    this.names.set(path, basename(path));
  }

  /** Remove a file path (watcher `unlink`). A no-op if absent. */
  remove(path: string): void {
    this.names.delete(path);
  }

  private underRoot(path: string): boolean {
    return this.roots.some((r) => path === r || path.startsWith(r + sep));
  }

  /** Reset to an unbuilt, empty state — forces a rebuild on the next search
   *  (used when ignore rules change). */
  clear(): void {
    this.names.clear();
    this.roots = [];
    this.ready = false;
  }

  get size(): number {
    return this.names.size;
  }

  /** Rank every indexed name against `query` and return the top `limit` hits.
   *  An empty (or whitespace-only) query returns no hits. */
  search(query: string, limit: number): SearchHit[] {
    const q = query.trim();
    if (q === '') return [];

    const hits: SearchHit[] = [];
    for (const [path, name] of this.names) {
      const score = fuzzyScore(q, name);
      if (score === null) continue;
      hits.push({ name, path, score });
    }
    hits.sort(
      (a, b) => b.score - a.score || a.name.length - b.name.length || a.path.localeCompare(b.path),
    );
    return hits.slice(0, limit);
  }
}
