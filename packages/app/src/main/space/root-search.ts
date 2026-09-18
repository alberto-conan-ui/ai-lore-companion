/**
 * Search over the roots of an open Space, as a service of its context. Added
 * by phase M5.6 for the Files window.
 *
 * Each root is searched on its own, by file name and inside files, as the
 * v0.8 search does (`main/ipc/tree.ts`, `searchFiles` and `searchContent`):
 *
 * - File names are ranked by core's `rankPaths` (fuzzy, or a `*` / `?` glob)
 *   over an index of the root's files. The index is built at the first search
 *   of the root, by a walk that reads one folder at a time without blocking
 *   the process, and is then kept current by the file events of the roots'
 *   watchers (`SpaceRoots.onFileEvent`, M5.1): a file added is added, a file
 *   or folder removed is removed. A change of a `.gitignore` file drops the
 *   root's index, which is built again at the next search.
 * - Inside files, ripgrep reads the root's folder at every search, one process
 *   per root, stopped when the search is cancelled or the root's time limit
 *   passes.
 *
 * Ignore rules, the same for both kinds: a `.git` folder is never entered; the
 * default rules of core at the `no-search` level (`node_modules`, `dist`,
 * `out`, ...) are left out; the `.gitignore` files inside the root are
 * followed, and those above the root's folder are not (ripgrep is run with
 * `--no-ignore-parent` and `--no-require-git`, so a root that is not a
 * repository, the Workbench, follows its `.gitignore` too). A symbolic link is
 * indexed only when it leads to a file that `resolveInRoot` accepts; a linked
 * folder is not entered. As in v0.8, ripgrep does not read hidden files, and
 * the index of names holds them.
 *
 * Caps, per root: `ROOT_SEARCH_LIMITS`. Each result says its cap and whether
 * it was reached.
 *
 * Hardening added by the M5.6 tester: a glob query is matched by a function
 * that does not backtrack (core's `globToRegExp` gives a regular expression
 * that a query like `*a*a*a…b` keeps busy for minutes on one long name, and
 * that would block the main process); ripgrep's output is read line by line,
 * and a line longer than `contentLineChars` (a match in a very long line of a
 * file) is skipped instead of filling the buffer; every path sent is checked
 * again with `resolveInRoot`, and one it refuses is dropped.
 */

import { spawn } from 'node:child_process';
import { type Dirent, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import {
  DEFAULT_IGNORE_RULES,
  type RootFileEvent,
  createIgnoreMatcher,
  deriveIgnoreLists,
  errorMessage,
  isGlob,
  rankPaths,
} from '@ai-lore-companion/core';
import {
  ROOT_SEARCH_CONTENT_LIMIT,
  ROOT_SEARCH_NAME_LIMIT,
  type RootSearchContentHit,
  type RootSearchGroup,
  type RootSearchHits,
  type RootSearchNameHit,
} from '../../shared/ipc/space/root-search.types.js';
import { parseRipgrepJson } from '../search/content.js';
import { ripgrepPath } from '../search/ripgrep.js';
import { augmentedPath } from '../spawn-detached.js';
import { type SpaceContext, defineSpaceService } from './context.js';
import { resolveInRoot } from './root-files.js';
import { spaceRoots } from './roots-service.js';

/** The caps of a search, per root. */
export const ROOT_SEARCH_LIMITS = {
  /** File-name hits sent per root, the best ranked first (v0.8 sends 40 over every scope). */
  names: ROOT_SEARCH_NAME_LIMIT,
  /** Lines found inside files sent per root (v0.8 sends 50 over every scope). */
  content: ROOT_SEARCH_CONTENT_LIMIT,
  /** Lines found per file. */
  contentPerFile: 5,
  /** Files the index of names keeps per root; beyond it the walk stops and says so. */
  indexFiles: 100_000,
  /** The longest line of ripgrep output read, in characters; a longer one is skipped. */
  contentLineChars: 64 * 1024,
};

/** Timings a test may shorten. */
export const ROOT_SEARCH_TUNING = {
  /** How long one root is searched before its results are sent as they are. */
  timeLimitMs: 10_000,
};

/** Called at the start of the search of a root, before its index is read. For tests: a root made slow. */
export type RootSearchHook = (rootId: string) => Promise<void> | void;

let searchHook: RootSearchHook | null = null;

/** Replace the hook called at the start of the search of a root. For tests. */
export function setRootSearchHook(hook: RootSearchHook | null): void {
  searchHook = hook;
}

let ripgrepOverride: string | null = null;

/** Replace the ripgrep binary. For tests: a path that does not exist gives `ripgrepMissing`. */
export function setRootSearchRipgrep(path: string | null): void {
  ripgrepOverride = path;
}

const SEARCH_IGNORES = deriveIgnoreLists(DEFAULT_IGNORE_RULES).search;
const isDefaultIgnored = createIgnoreMatcher(SEARCH_IGNORES);

type Matcher = (relPath: string) => boolean;

/** The lines of a `.gitignore` file that core's matcher can take: no comment, no negation. */
function gitignorePatterns(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));
}

/** The index of the file names of one root. */
class RootNameIndex {
  readonly names = new Map<string, string>();
  truncated = false;
  private building: Promise<void> | null = null;
  private built = false;
  private pending: RootFileEvent[] | null = null;
  /** The matcher of the `.gitignore` of each folder read, relative to the root; `null` for none. */
  private readonly gitignores = new Map<string, Matcher | null>();

  constructor(readonly rootPath: string) {}

  /** Built, or being built by the first caller. */
  ready(): Promise<void> {
    if (this.built) return Promise.resolve();
    if (this.building === null) {
      this.pending = [];
      this.building = this.walk('').then(() => {
        this.built = true;
        const events = this.pending ?? [];
        this.pending = null;
        for (const event of events) this.apply(event);
      });
    }
    return this.building;
  }

  private gitignoreOf(folder: string): Matcher | null {
    if (this.gitignores.has(folder)) return this.gitignores.get(folder) ?? null;
    let matcher: Matcher | null = null;
    try {
      const patterns = gitignorePatterns(
        readFileSync(join(this.rootPath, folder, '.gitignore'), 'utf8'),
      );
      if (patterns.length > 0) matcher = createIgnoreMatcher(patterns);
    } catch {
      matcher = null;
    }
    this.gitignores.set(folder, matcher);
    return matcher;
  }

  /** Whether a path relative to the root is left out; a folder is given with a trailing `/`. */
  ignored(rel: string): boolean {
    const segments = rel.split('/').filter((segment) => segment !== '');
    if (segments.some((segment) => segment.toLowerCase() === '.git')) return true;
    if (isDefaultIgnored(rel)) return true;
    for (let depth = 0; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      const matcher = this.gitignoreOf(folder);
      if (matcher === null) continue;
      const below = folder === '' ? rel : rel.slice(folder.length + 1);
      if (matcher(below)) return true;
    }
    return false;
  }

  /** Whether the file at `rel` may be indexed: a file, or a link to a file inside the root. */
  private isIndexableLink(rel: string): boolean {
    const target = resolveInRoot(this.rootPath, rel, 'file');
    if (!target.ok) return false;
    try {
      return statSync(target.value.abs).isFile();
    } catch {
      return false;
    }
  }

  private add(rel: string): void {
    if (this.names.has(rel)) return;
    if (this.names.size >= ROOT_SEARCH_LIMITS.indexFiles) {
      this.truncated = true;
      return;
    }
    this.names.set(rel, basename(rel));
  }

  private async walk(folder: string): Promise<void> {
    if (this.truncated) return;
    let dirents: Dirent[];
    try {
      dirents = await readdir(join(this.rootPath, folder), { withFileTypes: true });
    } catch {
      return;
    }
    const folders: string[] = [];
    for (const dirent of dirents) {
      const rel = folder === '' ? dirent.name : `${folder}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (!this.ignored(`${rel}/`)) folders.push(rel);
      } else if (dirent.isFile()) {
        if (!this.ignored(rel)) this.add(rel);
      } else if (dirent.isSymbolicLink()) {
        if (!this.ignored(rel) && this.isIndexableLink(rel)) this.add(rel);
      }
    }
    for (const child of folders) await this.walk(child);
  }

  /** Follow one file event of the root's watcher. */
  onEvent(event: RootFileEvent): void {
    if (this.pending !== null) {
      this.pending.push(event);
      return;
    }
    if (this.built) this.apply(event);
  }

  private apply(event: RootFileEvent): void {
    const rel = relative(this.rootPath, event.absPath).split(sep).join('/');
    if (rel === '' || rel.startsWith('..')) return;
    if (event.event === 'add') {
      if (!this.ignored(rel) && this.isIndexableLink(rel)) this.add(rel);
    } else if (event.event === 'unlink') {
      this.names.delete(rel);
    } else if (event.event === 'unlinkDir') {
      const prefix = `${rel}/`;
      for (const path of [...this.names.keys()]) {
        if (path.startsWith(prefix)) this.names.delete(path);
      }
    }
  }

  /** The best `limit` names for `query`, and whether there were more. */
  search(query: string, limit: number): { hits: RootSearchNameHit[]; truncated: boolean } {
    const ranked = rankNames(this.names, query, limit + 1);
    return {
      hits: ranked.slice(0, limit).map((hit) => ({ name: hit.name, path: hit.path })),
      truncated: ranked.length > limit,
    };
  }
}

/**
 * Whether `name` matches the glob `pattern` (`*` any run, `?` one character),
 * whole name, ignoring case. The greedy match with one saved star: at most
 * the length of the name times the length of the pattern steps.
 */
export function globMatches(pattern: string, name: string): boolean {
  const p = [...pattern.toLowerCase()];
  const s = [...name.toLowerCase()];
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === '?' || (p[i] !== '*' && p[i] === s[j]))) {
      i += 1;
      j += 1;
    } else if (i < p.length && p[i] === '*') {
      star = i;
      mark = j;
      i += 1;
    } else if (star !== -1) {
      i = star + 1;
      mark += 1;
      j = mark;
    } else {
      return false;
    }
  }
  while (i < p.length && p[i] === '*') i += 1;
  return i === p.length;
}

/** Core's `rankPaths`, with a glob query matched by `globMatches` and ordered as `rankPaths` orders it. */
function rankNames(
  names: Map<string, string>,
  query: string,
  limit: number,
): { name: string; path: string }[] {
  const q = query.trim();
  if (!isGlob(q)) return rankPaths(names, q, limit);
  const hits: { name: string; path: string }[] = [];
  for (const [path, name] of names) {
    if (globMatches(q, name)) hits.push({ name, path });
  }
  hits.sort((a, b) => a.name.length - b.name.length || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

/** Whether `path`, relative to the root, is a file inside it by the rules of `resolveInRoot`. */
function containedFile(rootPath: string, path: string): boolean {
  return !path.startsWith('/') && !path.includes('\\') && resolveInRoot(rootPath, path, 'file').ok;
}

/** Search inside the files of a root with ripgrep. Never rejects. */
function searchContentIn(
  rootPath: string,
  query: string,
  signal: AbortSignal,
): Promise<{ hits: RootSearchContentHit[]; truncated: boolean; ripgrepMissing: boolean }> {
  const limit = ROOT_SEARCH_LIMITS.content;
  const args = [
    '--json',
    '--fixed-strings',
    '--smart-case',
    '--no-ignore-parent',
    '--no-require-git',
    '--max-count',
    String(ROOT_SEARCH_LIMITS.contentPerFile),
    '--glob',
    '!.git',
    ...SEARCH_IGNORES.flatMap((glob) => ['--glob', `!${glob}`]),
    '--',
    query,
    '.',
  ];
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: {
      hits: RootSearchContentHit[];
      truncated: boolean;
      ripgrepMissing: boolean;
    }): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    if (signal.aborted) {
      done({ hits: [], truncated: false, ripgrepMissing: false });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ripgrepOverride ?? ripgrepPath(), args, {
        cwd: rootPath,
        env: { ...process.env, PATH: augmentedPath() },
        stdio: ['ignore', 'pipe', 'ignore'],
        signal,
      });
    } catch {
      done({ hits: [], truncated: false, ripgrepMissing: true });
      return;
    }
    const hits: RootSearchContentHit[] = [];
    let truncated = false;
    // The line being read, and whether it is being skipped for its length.
    let partial = '';
    let skipping = false;
    const take = (line: string): void => {
      if (truncated) return;
      for (const hit of parseRipgrepJson(line, 1)) {
        const path = hit.path.replace(/^\.\//, '').split(sep).join('/');
        if (!containedFile(rootPath, path)) continue;
        if (hits.length >= limit) {
          truncated = true;
          child.kill();
          return;
        }
        hits.push({ ...hit, path, name: basename(path) });
      }
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => {
      let start = 0;
      for (;;) {
        const end = text.indexOf('\n', start);
        if (!skipping) {
          partial += end === -1 ? text.slice(start) : text.slice(start, end);
          if (partial.length > ROOT_SEARCH_LIMITS.contentLineChars) {
            partial = '';
            skipping = true;
          }
        }
        if (end === -1) break;
        if (!skipping) take(partial);
        partial = '';
        skipping = false;
        start = end + 1;
      }
    });
    child.on('error', (caught: NodeJS.ErrnoException) => {
      done({ hits: [], truncated: false, ripgrepMissing: caught.code === 'ENOENT' });
    });
    child.on('close', () => {
      if (!skipping && partial !== '') take(partial);
      done({ hits, truncated, ripgrepMissing: false });
    });
  });
}

function emptyHits<T>(limit: number): RootSearchHits<T> {
  return { hits: [], limit, truncated: false, finished: false };
}

export type SpaceRootSearch = {
  /**
   * Search the root `rootId`, whose folder is `rootPath`. Resolves when both
   * kinds of search ended, the root's time limit passed, or `signal` aborted;
   * never rejects.
   */
  search(
    rootId: string,
    rootPath: string,
    query: string,
    signal: AbortSignal,
  ): Promise<RootSearchGroup>;
  /** Start a search of window `senderId` for `rootId`, stopping the one it had running for that root. */
  begin(senderId: number, rootId: string): AbortController;
  /** The search is over; forget its controller. */
  end(senderId: number, rootId: string, controller: AbortController): void;
  /** Stop every running search of window `senderId`. Returns how many were stopped. */
  cancelAll(senderId: number): number;
  /** How many roots have an index of names. For tests. */
  indexedRoots(): number;
  close(): void;
};

function createSpaceRootSearch(context: SpaceContext): SpaceRootSearch {
  const indexes = new Map<string, RootNameIndex>();
  const running = new Map<string, AbortController>();
  const keyOf = (senderId: number, rootId: string): string => `${senderId} ${rootId}`;

  const unsubscribe = context.service(spaceRoots).onFileEvent((event) => {
    const index = indexes.get(event.rootId);
    if (index === undefined) return;
    // A changed ignore file can add or remove any number of files: build again at the next search.
    if (basename(event.absPath) === '.gitignore') {
      indexes.delete(event.rootId);
      return;
    }
    index.onEvent(event);
  });

  const indexFor = (rootId: string, rootPath: string): RootNameIndex => {
    const existing = indexes.get(rootId);
    if (existing !== undefined && existing.rootPath === rootPath) return existing;
    const created = new RootNameIndex(rootPath);
    indexes.set(rootId, created);
    return created;
  };

  return {
    async search(rootId, rootPath, query, signal) {
      const group: RootSearchGroup = {
        rootId,
        query,
        outcome: 'done',
        timeLimitMs: ROOT_SEARCH_TUNING.timeLimitMs,
        names: emptyHits(ROOT_SEARCH_LIMITS.names),
        content: emptyHits(ROOT_SEARCH_LIMITS.content),
        indexTruncated: false,
        indexLimit: ROOT_SEARCH_LIMITS.indexFiles,
        ripgrepMissing: false,
      };
      const stop = new AbortController();
      const onAbort = (): void => stop.abort();
      signal.addEventListener('abort', onAbort);

      const names = (async () => {
        if (searchHook) await searchHook(rootId);
        if (stop.signal.aborted) return;
        const index = indexFor(rootId, rootPath);
        await index.ready();
        if (stop.signal.aborted) return;
        const found = index.search(query, ROOT_SEARCH_LIMITS.names);
        const hits = found.hits.filter((hit) => containedFile(rootPath, hit.path));
        group.names = { ...group.names, hits, truncated: found.truncated, finished: true };
        group.indexTruncated = index.truncated;
      })();
      const content = (async () => {
        const found = await searchContentIn(rootPath, query, stop.signal);
        if (stop.signal.aborted) return;
        group.content = {
          hits: found.hits,
          limit: ROOT_SEARCH_LIMITS.content,
          truncated: found.truncated,
          finished: true,
        };
        group.ripgrepMissing = found.ripgrepMissing;
      })();

      let timer: NodeJS.Timeout | null = null;
      const limit = new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), ROOT_SEARCH_TUNING.timeLimitMs);
      });
      const aborted = new Promise<'cancelled'>((resolve) => {
        if (signal.aborted) resolve('cancelled');
        else signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
      });
      try {
        const first = await Promise.race([
          Promise.all([names, content]).then(() => 'done' as const),
          limit,
          aborted,
        ]);
        group.outcome = signal.aborted ? 'cancelled' : first;
      } catch (caught) {
        context.log.warn('root-search-failed', {
          space: context.key,
          root: rootId,
          message: errorMessage(caught),
        });
        group.outcome = 'done';
      } finally {
        if (timer !== null) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        stop.abort();
      }
      return group;
    },
    begin(senderId, rootId) {
      const key = keyOf(senderId, rootId);
      running.get(key)?.abort();
      const controller = new AbortController();
      running.set(key, controller);
      return controller;
    },
    end(senderId, rootId, controller) {
      const key = keyOf(senderId, rootId);
      if (running.get(key) === controller) running.delete(key);
    },
    cancelAll(senderId) {
      let count = 0;
      const prefix = `${senderId} `;
      for (const [key, controller] of [...running]) {
        if (!key.startsWith(prefix)) continue;
        controller.abort();
        running.delete(key);
        count += 1;
      }
      return count;
    },
    indexedRoots: () => indexes.size,
    close() {
      unsubscribe();
      for (const controller of running.values()) controller.abort();
      running.clear();
      indexes.clear();
    },
  };
}

/** The search of the roots of the Space of a context. Read it with `context.service(spaceRootSearch)`. */
export const spaceRootSearch = defineSpaceService<SpaceRootSearch>({
  id: 'root-search',
  create: createSpaceRootSearch,
  dispose: (service) => service.close(),
});
