/**
 * The root tracker: one per Space, holding for every root its baseline and the
 * changes of its last read, and re-reading a root when something moved.
 *
 * It follows today's changes tracker (`changes/tracker.ts`), keyed by root id
 * where that one has two fixed scopes: a re-read asked through
 * `scheduleRefresh` waits for the debounce (200 ms) so that a burst of file
 * events gives one read; `setBaseline` and `refreshNow` read at once;
 * `onChange` is called only when what was read differs from the last snapshot,
 * except after `setBaseline`, which always reports.
 *
 * Unlike today's tracker it owns its watchers, because the set of folders is
 * not fixed. Per root whose folder exists, one chokidar watcher on the folder,
 * which never enters a `.git` folder and never follows a symbolic link, so
 * nothing outside the root is watched through a link. Per git folder of a
 * tracked root, one watcher that sees `HEAD` and `logs/HEAD` and nothing else
 * of git's internals: a commit appends to `logs/HEAD` and a branch change
 * rewrites `HEAD`. The Lore and a publish area inside the Space share the
 * Space repository's git folder, which is watched once. The window gaining
 * focus is the host's event; the host calls `refreshNow`.
 *
 * Reads are asynchronous. A root has one read at a time; a request that arrives
 * during a read runs one more read after it. `close` stops the timers and the
 * watchers, waits for a read in progress, and nothing is reported after it.
 */

import { existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { runGit } from '../exec/git-port.js';
import { type CommandRunner, runSucceeded } from '../exec/runner.js';
import { errorMessage, fail } from '../result.js';
import { HEAD_BASELINE, type RootChangesResult, readChangesIn } from './changes-in.js';
import {
  ROOT_TRACKER_DEBOUNCE_MS,
  type Root,
  type RootFileEvent,
  type RootSnapshot,
} from './types.js';

/** Options of `attachRootTracker`. */
export type RootTrackerOptions = {
  /** The roots of the Space, from `resolveRoots`. */
  roots: readonly Root[];
  /** Runs git. */
  runner: CommandRunner;
  /** The baseline of each root at the start, by root id. A root not named starts at `'HEAD'`. */
  baselines?: Readonly<Record<string, string>>;
  /** Milliseconds a scheduled re-read waits. Default 200. */
  debounceMs?: number;
  /** The most changes a snapshot holds. Default: the default of `readChangesIn`. */
  limit?: number;
  /** Watch the roots' folders and git folders. Default true. With false, the host schedules every re-read. */
  watch?: boolean;
  /** chokidar ignore globs applied under every root, as the host's ignore rules give them. */
  ignored?: readonly string[];
  /** Called with a root's new snapshot when it differs from the last one, and after every `setBaseline`. */
  onChange: (snapshot: RootSnapshot) => void;
  /** Called for every file and folder event under a root, tracked or not, for the host's tree. */
  onFileEvent?: (event: RootFileEvent) => void;
  /**
   * Called when a watcher reports an error, and when `onChange` or
   * `onFileEvent` throws. The tracker keeps running. What this listener itself
   * throws is dropped.
   */
  onWatcherError?: (message: string) => void;
};

/** The tracker of the roots of one Space. */
export type RootTracker = {
  /** The roots the tracker was given. */
  roots(): Root[];
  /** The present snapshot of a root, or `null` for an id that is not a root. */
  snapshot(rootId: string): RootSnapshot | null;
  /** The present snapshot of every root, in the roots' order. */
  snapshots(): RootSnapshot[];
  /** The present baseline of a root, or `null` for an id that is not a root. */
  baseline(rootId: string): string | null;
  /** Change a root's baseline and read at once. `onChange` is called even when the list is the same. */
  setBaseline(rootId: string, baseline: string): Promise<void>;
  /** Ask for a debounced re-read of a root. Calls inside the debounce window give one read. */
  scheduleRefresh(rootId: string): void;
  /** Read one root, or every root when `rootId` is left out, at once. */
  refreshNow(rootId?: string): Promise<void>;
  /** Stop the timers and the watchers. Nothing is read or reported afterwards. Safe to call twice. */
  close(): Promise<void>;
};

type RootState = {
  root: Root;
  baseline: string;
  snapshot: RootSnapshot;
  serialised: string;
  timer: NodeJS.Timeout | null;
  reading: Promise<void> | null;
  again: boolean;
  force: boolean;
};

function firstSnapshot(root: Root, baseline: string): RootSnapshot {
  if (root.tracking.tracked) return { rootId: root.id, baseline, status: 'unread' };
  const { reason, message } = root.tracking;
  return { rootId: root.id, baseline, status: 'untracked', reason, message };
}

function isFolder(path: string): boolean {
  try {
    return path !== '' && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** How long `attachRootTracker` waits for a watcher's first scan before it goes on without it. */
const WATCHER_READY_TIMEOUT_MS = 10_000;

/**
 * Resolve when the watcher has finished its first scan. A watcher whose folder
 * goes away during the scan may never say so; after the timeout the tracker
 * goes on, and the watcher reports whatever it still sees.
 */
function whenReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolveReady) => {
    const timer = setTimeout(resolveReady, WATCHER_READY_TIMEOUT_MS);
    watcher.once('ready', () => {
      clearTimeout(timer);
      resolveReady();
    });
  });
}

/**
 * Build the tracker of `options.roots`, read every tracked root once, start the
 * watchers, and resolve when both are done, so that the first snapshots are
 * there and no event after this point is missed.
 */
export async function attachRootTracker(options: RootTrackerOptions): Promise<RootTracker> {
  const debounceMs = options.debounceMs ?? ROOT_TRACKER_DEBOUNCE_MS;
  const states = new Map<string, RootState>();
  const watchers: FSWatcher[] = [];
  let closed = false;

  for (const root of options.roots) {
    const baseline = options.baselines?.[root.id] ?? HEAD_BASELINE;
    const snapshot = firstSnapshot(root, baseline);
    states.set(root.id, {
      root,
      baseline,
      snapshot,
      serialised: JSON.stringify(snapshot),
      timer: null,
      reading: null,
      again: false,
      force: false,
    });
  }

  const clearTimer = (state: RootState): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  };

  const watcherError = (caught: unknown): void => {
    try {
      options.onWatcherError?.(errorMessage(caught));
    } catch {
      // The host's error listener failed; there is nobody left to tell.
    }
  };

  /** Call a listener of the host. What it throws is reported and goes no further. */
  const notify = (name: string, call: () => void): void => {
    try {
      call();
    } catch (caught) {
      watcherError(`${name} threw: ${errorMessage(caught)}`);
    }
  };

  /** Read a root's changes. A runner that throws gives a failed read, as a runner that reports a failure does. */
  const readRoot = async (
    tracking: Extract<Root['tracking'], { tracked: true }>,
    baseline: string,
  ): Promise<RootChangesResult> => {
    try {
      return await readChangesIn(options.runner, tracking.workTree, baseline, tracking.subPath, {
        limit: options.limit,
      });
    } catch (caught) {
      return fail('command-failed', `the changes could not be read: ${errorMessage(caught)}`);
    }
  };

  const readLoop = async (state: RootState): Promise<void> => {
    const tracking = state.root.tracking;
    if (!tracking.tracked) return;
    do {
      state.again = false;
      const force = state.force;
      state.force = false;
      const baseline = state.baseline;
      const result = await readRoot(tracking, baseline);
      if (closed) return;
      if (baseline !== state.baseline) {
        // The baseline moved during the read: what was read is of no use.
        state.again = true;
        state.force = state.force || force;
        continue;
      }
      const snapshot: RootSnapshot = result.ok
        ? { rootId: state.root.id, baseline, status: 'ok', changes: result.value }
        : { rootId: state.root.id, baseline, status: 'failed', error: result.error };
      const serialised = JSON.stringify(snapshot);
      if (force || serialised !== state.serialised) {
        state.snapshot = snapshot;
        state.serialised = serialised;
        notify('onChange', () => options.onChange(snapshot));
      }
    } while (state.again && !closed);
  };

  const read = (state: RootState, force: boolean): Promise<void> => {
    if (closed || !state.root.tracking.tracked) return Promise.resolve();
    clearTimer(state);
    state.force = state.force || force;
    if (state.reading !== null) {
      state.again = true;
      return state.reading;
    }
    const reading = readLoop(state).finally(() => {
      state.reading = null;
    });
    state.reading = reading;
    return reading;
  };

  const scheduleRefresh = (rootId: string): void => {
    const state = states.get(rootId);
    if (closed || state === undefined || !state.root.tracking.tracked) return;
    clearTimer(state);
    state.timer = setTimeout(() => {
      state.timer = null;
      void read(state, false).catch(() => undefined);
    }, debounceMs);
  };

  /** Watch a root's folder. It never enters `.git` and never follows a symbolic link. */
  const watchRootFolder = (root: Root): FSWatcher => {
    const insideGit = (path: string): boolean =>
      relative(root.path, path).split(sep).includes('.git');
    const watcher = chokidar.watch(root.path, {
      ignored: [insideGit, ...(options.ignored ?? [])],
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    watcher.on('all', (event, absPath) => {
      if (closed) return;
      notify('onFileEvent', () => options.onFileEvent?.({ rootId: root.id, event, absPath }));
      if (event !== 'addDir' && event !== 'unlinkDir') scheduleRefresh(root.id);
    });
    watcher.on('error', watcherError);
    return watcher;
  };

  /** Watch `HEAD` and `logs/HEAD` of a git folder, and nothing else in it. */
  const watchGitFolder = (gitDir: string, rootIds: readonly string[]): FSWatcher => {
    const logs = join(gitDir, 'logs');
    const seen = new Set([gitDir, join(gitDir, 'HEAD'), logs, join(logs, 'HEAD')]);
    const watcher = chokidar.watch(gitDir, {
      ignored: (path: string) => !seen.has(path),
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      depth: 1,
    });
    watcher.on('all', (event) => {
      if (closed || event === 'addDir' || event === 'unlinkDir') return;
      for (const rootId of rootIds) scheduleRefresh(rootId);
    });
    watcher.on('error', watcherError);
    return watcher;
  };

  const gitDirOf = async (workTree: string): Promise<string | null> => {
    const args = ['rev-parse', '--absolute-git-dir'];
    const result = await runGit(options.runner, workTree, args, { readOnly: true });
    const dir = result.stdout.trim();
    return runSucceeded(result) && dir !== '' && existsSync(dir) ? dir : null;
  };

  const startWatchers = async (): Promise<void> => {
    const rootsByGitDir = new Map<string, string[]>();
    // `ready` is listened for the moment a watcher exists. A watcher can be
    // ready while the loop below is still asking git for the next folder, and
    // an event that was emitted before anyone listened is never heard.
    const ready: Promise<void>[] = [];
    const started = (watcher: FSWatcher): void => {
      watchers.push(watcher);
      ready.push(whenReady(watcher));
    };
    for (const { root } of states.values()) {
      if (!isFolder(root.path)) continue;
      started(watchRootFolder(root));
      if (!root.tracking.tracked) continue;
      const gitDir = await gitDirOf(root.tracking.workTree);
      if (gitDir === null) continue;
      rootsByGitDir.set(gitDir, [...(rootsByGitDir.get(gitDir) ?? []), root.id]);
    }
    for (const [gitDir, rootIds] of rootsByGitDir) started(watchGitFolder(gitDir, rootIds));
    await Promise.all(ready);
  };

  const refreshNow = async (rootId?: string): Promise<void> => {
    const chosen = rootId === undefined ? [...states.values()] : [states.get(rootId)];
    await Promise.all(
      chosen.map((state) => (state === undefined ? undefined : read(state, false))),
    );
  };

  const tracker: RootTracker = {
    roots: () => [...options.roots],
    snapshot: (rootId) => states.get(rootId)?.snapshot ?? null,
    snapshots: () => [...states.values()].map((state) => state.snapshot),
    baseline: (rootId) => states.get(rootId)?.baseline ?? null,
    scheduleRefresh,
    refreshNow,
    async setBaseline(rootId, baseline) {
      const state = states.get(rootId);
      if (closed || state === undefined || state.baseline === baseline) return;
      state.baseline = baseline;
      if (state.root.tracking.tracked) return read(state, true);
      state.snapshot = firstSnapshot(state.root, baseline);
      state.serialised = JSON.stringify(state.snapshot);
      const snapshot = state.snapshot;
      notify('onChange', () => options.onChange(snapshot));
    },
    async close() {
      closed = true;
      for (const state of states.values()) clearTimer(state);
      const open = watchers.splice(0);
      await Promise.all(open.map((watcher) => watcher.close()));
      await Promise.allSettled([...states.values()].map((state) => state.reading));
    },
  };

  try {
    if (options.watch !== false) await startWatchers();
    await refreshNow();
  } catch (caught) {
    await tracker.close();
    throw caught;
  }
  return tracker;
}
