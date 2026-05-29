/**
 * The file-search service — the seam that lets search run off the main thread
 * (Focus 3 Phase 2) while staying trivially testable.
 *
 * The {@link PathIndex} is pure data; this seam decides *where* it lives:
 *
 *   - {@link InProcessSearchService} holds the index in this process. It is the
 *     headless-test and fallback path — search is synchronous under the hood,
 *     wrapped in a resolved promise to match the async interface.
 *   - {@link WorkerSearchService} hands the index to an Electron `utilityProcess`
 *     so neither the one-time build walk nor a large-repo scan ever blocks the
 *     main thread's IPC/UI. This is the production path.
 *
 * Both speak the same {@link SearchService} contract; `main/ipc/tree.ts` awaits
 * it without knowing which is wired. The worker owns its own `PathIndex` and
 * runs the identical `ensureBuilt` → `search` orchestration in the child — the
 * pure-data boundary is what makes that relocation a message-passing wrapper
 * rather than a rewrite.
 */
import { join } from 'node:path';
import { PathIndex } from '@ai-lore-companion/core';
import { type UtilityProcess, utilityProcess } from 'electron';
import type { FileSearchHit } from '../../shared/ipc.js';

/** A search request: the pane roots to cover, the ignore globs to build with,
 *  the query, and the render cap on ranked hits. */
export type SearchRequest = {
  dirs: string[];
  ignore: string[];
  query: string;
  limit: number;
};

export interface SearchService {
  /** Build the index if needed, then return the top `limit` ranked hits. */
  search(req: SearchRequest): Promise<FileSearchHit[]>;
  /** Patch a newly-created file into the index (watcher `add`). */
  add(path: string): void;
  /** Drop a deleted file from the index (watcher `unlink`). */
  remove(path: string): void;
  /** Drop the index so the next search rebuilds (ignore rules changed). */
  invalidate(): void;
  /** Release resources — kills the worker, if any. */
  dispose(): void;
}

/** Map ranked hits down to the wire shape (the score is internal until content
 *  search widens it in Phase 3). Shared by both implementations. */
function toHits(index: PathIndex, query: string, limit: number): FileSearchHit[] {
  return index.search(query, limit).map(({ name, path }) => ({ name, path }));
}

/** In-process search — the index lives here. Used by tests and as a fallback. */
export class InProcessSearchService implements SearchService {
  private readonly index = new PathIndex();

  async search(req: SearchRequest): Promise<FileSearchHit[]> {
    if (req.query.trim().length === 0) return [];
    this.index.ensureBuilt(req.dirs, req.ignore);
    return toHits(this.index, req.query, req.limit);
  }
  add(path: string): void {
    this.index.add(path);
  }
  remove(path: string): void {
    this.index.remove(path);
  }
  invalidate(): void {
    this.index.clear();
  }
  dispose(): void {}
}

// --- Worker protocol (parent ⇄ utilityProcess child) -----------------------

/** Parent → child. */
export type WorkerRequest =
  | ({ type: 'search'; id: number } & SearchRequest)
  | { type: 'add'; path: string }
  | { type: 'remove'; path: string }
  | { type: 'invalidate' };

/** Child → parent. */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; hits: FileSearchHit[] };

/**
 * Worker-backed search — the index lives in an Electron `utilityProcess`. The
 * child is forked lazily on the first search (so window open pays nothing) and
 * killed on dispose. Messages sent before the child signals `ready` are queued
 * and flushed in order, so a first search that races the fork still lands.
 */
export class WorkerSearchService implements SearchService {
  private child: UtilityProcess | null = null;
  private ready = false;
  private readonly outbox: WorkerRequest[] = [];
  private readonly pending = new Map<number, (hits: FileSearchHit[]) => void>();
  private nextId = 1;

  private ensureChild(): void {
    if (this.child) return;
    const child = utilityProcess.fork(join(__dirname, 'search-worker.js'));
    child.on('message', (msg: WorkerResponse) => {
      if (msg.type === 'ready') {
        this.ready = true;
        for (const queued of this.outbox.splice(0)) child.postMessage(queued);
        return;
      }
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg.hits);
      }
    });
    // A crashed worker must not hang awaiting callers — fail them empty and
    // reset so the next search re-forks.
    child.on('exit', () => {
      for (const resolve of this.pending.values()) resolve([]);
      this.pending.clear();
      this.child = null;
      this.ready = false;
    });
    this.child = child;
  }

  private send(msg: WorkerRequest): void {
    this.ensureChild();
    if (this.ready && this.child) this.child.postMessage(msg);
    else this.outbox.push(msg);
  }

  search(req: SearchRequest): Promise<FileSearchHit[]> {
    if (req.query.trim().length === 0) return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'search', id, ...req });
    });
  }
  add(path: string): void {
    this.send({ type: 'add', path });
  }
  remove(path: string): void {
    this.send({ type: 'remove', path });
  }
  invalidate(): void {
    this.send({ type: 'invalidate' });
  }
  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.ready = false;
    this.outbox.length = 0;
    for (const resolve of this.pending.values()) resolve([]);
    this.pending.clear();
  }
}
