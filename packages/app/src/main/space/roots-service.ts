/**
 * The roots of an open Space, their tracker and their watchers, as a service
 * of its context. Added by phase M5.1.
 *
 * Life: nothing is read or watched when the service is built. The first
 * channel of roots a window of the Space calls starts it (`running`): the
 * roots are resolved, each tracked root gets its default baseline, and core's
 * root tracker is attached with its watchers. The context disposes the service
 * when the last window of the Space closes and when the app quits, which
 * closes the tracker and every watcher. `rootsServiceStats` counts what is
 * open, for the test that looks for a leak.
 *
 * What this file adds to core's tracker, which leaves these to the host:
 * - a maximum wait. The tracker's debounce restarts on every file event, so a
 *   steady stream of events would never give a read. Here the first event of a
 *   stream starts a timer of `ROOTS_TUNING.maxWaitMs`; when it ends and the
 *   debounce is still waiting, the root is read at once.
 * - changes of the index only (`git add`): the tracker watches `HEAD` and
 *   `logs/HEAD` of a git folder; here `index` is watched too. The tracker's
 *   reads never write the index (`--no-optional-locks`), so a read does not
 *   cause another.
 * - heavy ignored folders: the default ignore rules of core (`node_modules`,
 *   build output …) are passed as `ignored`.
 * - a root folder that went away or came back, and a manifest that changed:
 *   `refresh` resolves the roots again and rebuilds the tracker when they
 *   differ. The Files window calls it when it gains focus.
 *
 * One failing root does not stop the others: a default baseline that cannot
 * be read leaves that root at `HEAD` with a notice, and the tracker reports a
 * failed read per root.
 */

import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  DEFAULT_IGNORE_RULES,
  type DefaultBaseline,
  type Desk,
  HEAD_BASELINE,
  ROOT_TRACKER_DEBOUNCE_MS,
  type Root,
  type RootFileEvent,
  type RootSnapshot,
  type RootTracker,
  type SpaceManifest,
  attachRootTracker,
  defaultBaselineOf,
  deriveIgnoreLists,
  errorMessage,
  markRootReviewed,
  readSpaceManifest,
  resolveRoots,
  runGit,
  runSucceeded,
} from '@ai-lore-companion/core';
import chokidar, { type FSWatcher } from 'chokidar';
import { SPACE_ROOTS_CONTRACT } from '../../shared/ipc/space/roots.contract.js';
import type {
  RootBaselineSet,
  RootFileEventEntry,
  RootFileEventsPayload,
  RootMarkedReviewed,
  RootSummary,
  SpaceRootsFailure,
  SpaceRootsList,
  SpaceRootsResult,
} from '../../shared/ipc/space/roots.types.js';
import { type SpaceContext, defineSpaceService } from './context.js';
import { spaceDesk } from './desk-service.js';
import { resolveRootCommit, trackedRoot } from './root-files.js';

/** Timings a test may shorten. */
export const ROOTS_TUNING = {
  /** The longest a root waits for a read after the first event of a stream of events. */
  maxWaitMs: 2000,
  /** How long file events are collected before they are pushed as one batch. */
  fileEventBatchMs: 200,
  /** The most file events of one batch; beyond it the batch is sent as an overflow. */
  fileEventBatchMax: 500,
};

let openTrackers = 0;
let openIndexWatchers = 0;

/** How many trackers and index watchers this process holds open, over every Space. */
export function rootsServiceStats(): { trackers: number; indexWatchers: number } {
  return { trackers: openTrackers, indexWatchers: openIndexWatchers };
}

/** Sends a push to the windows of the service's Space. */
export type RootsPush = (channel: string, payload: unknown) => void;

type DefaultOfRoot = { value: DefaultBaseline | null; notice: string | null };

/** What is held while the tracker runs. */
export type RunningRoots = {
  roots: Root[];
  manifest: SpaceManifest;
  tracker: RootTracker;
  defaults: Map<string, DefaultOfRoot>;
  signature: string;
  indexWatchers: FSWatcher[];
};

export type SpaceRoots = {
  /**
   * Be told of every file event of the roots' watchers, before it is batched
   * for the windows. Added by phase M5.6: the search keeps its index of file
   * names current with it. Returns the function that stops it.
   */
  onFileEvent(listener: (event: RootFileEvent) => void): () => void;
  /** Where pushes go. The handlers give it on every call; the last one given is used. */
  bind(push: RootsPush): void;
  /** The running tracker, started now when there was none. */
  running(): Promise<SpaceRootsResult<RunningRoots>>;
  /** Resolve the roots again, rebuild the tracker when they changed, otherwise read now. */
  refresh(rootId?: string): Promise<SpaceRootsResult<RunningRoots>>;
  /** The list the renderer gets. */
  list(running: RunningRoots): SpaceRootsList;
  /** One root by its id. */
  root(running: RunningRoots, rootId: string): SpaceRootsResult<Root>;
  setBaseline(rootId: string, baseline: string): Promise<SpaceRootsResult<RootBaselineSet>>;
  resetBaseline(rootId: string): Promise<SpaceRootsResult<RootBaselineSet>>;
  markReviewed(rootId: string): Promise<SpaceRootsResult<RootMarkedReviewed>>;
  /** The open desk, or the failure as a result of a channel. */
  desk(): SpaceRootsResult<Desk>;
  /** Close the tracker and every watcher. Nothing is pushed afterwards. */
  close(): Promise<void>;
};

const failure = <T>(
  kind: SpaceRootsFailure['kind'],
  message: string,
  cause?: string,
): SpaceRootsResult<T> => ({
  ok: false,
  error: cause === undefined ? { kind, message } : { kind, message, cause },
});

/** A failure of core's baseline functions as a failure of a channel. The message is core's, unchanged. */
function baselineFailure<T>(error: {
  kind: string;
  message: string;
  cause?: string;
}): SpaceRootsResult<T> {
  if (error.kind === 'desk-failed') {
    return error.cause === 'not-writable'
      ? failure('desk-not-writable', error.message, error.cause)
      : failure('desk-failed', error.message, error.cause);
  }
  if (error.kind === 'root-untracked' || error.kind === 'no-commits') {
    return failure(error.kind, error.message);
  }
  return failure('git-failed', error.message, error.cause ?? error.kind);
}

function signatureOf(roots: readonly Root[], manifest: SpaceManifest): string {
  return JSON.stringify({
    roots: roots.map((root) => [root, root.path !== '' && existsSync(root.path)]),
    repositories: manifest.repositories.map((entry) => [entry.name, entry.github]),
  });
}

function createSpaceRoots(context: SpaceContext): SpaceRoots {
  const { runner, log } = context;
  let push: RootsPush = () => undefined;
  let closed = false;
  let current: RunningRoots | null = null;
  /** Starts, refreshes and the close run one after the other. */
  let queue: Promise<unknown> = Promise.resolve();
  /** Baselines the Human Lead picked, kept over a rebuild of the tracker. */
  const picked = new Map<string, string>();
  const maxWaitTimers = new Map<string, NodeJS.Timeout>();
  const lastEventAt = new Map<string, number>();
  const batches = new Map<string, { events: RootFileEventEntry[]; overflow: boolean }>();
  let batchTimer: NodeJS.Timeout | null = null;
  const fileListeners = new Set<(event: RootFileEvent) => void>();

  const send = (channel: string, payload: unknown): void => {
    if (closed) return;
    try {
      push(channel, payload);
    } catch (caught) {
      log.warn('roots-push-failed', { space: context.key, message: errorMessage(caught) });
    }
  };

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const openDesk = (): SpaceRootsResult<Desk> => {
    const opened = context.service(spaceDesk).open();
    if (opened.ok) return opened;
    return failure('desk-failed', opened.error.message, opened.error.kind);
  };

  const flushBatches = (): void => {
    batchTimer = null;
    for (const [rootId, batch] of batches) {
      const payload: RootFileEventsPayload = batch.overflow
        ? { rootId, events: [], overflow: true }
        : { rootId, events: batch.events, overflow: false };
      send(SPACE_ROOTS_CONTRACT.onSpaceRootFileEvents.channel, payload);
    }
    batches.clear();
  };

  const onFileEvent = (tracker: () => RootTracker | null, event: RootFileEvent): void => {
    if (closed) return;
    for (const listener of fileListeners) {
      try {
        listener(event);
      } catch (caught) {
        log.warn('roots-file-listener-failed', {
          space: context.key,
          message: errorMessage(caught),
        });
      }
    }
    const root = current?.roots.find((candidate) => candidate.id === event.rootId);
    // The maximum wait: see this file's header.
    lastEventAt.set(event.rootId, Date.now());
    if (!maxWaitTimers.has(event.rootId)) {
      const timer = setTimeout(() => {
        maxWaitTimers.delete(event.rootId);
        const quietFor = Date.now() - (lastEventAt.get(event.rootId) ?? 0);
        if (closed || quietFor >= ROOT_TRACKER_DEBOUNCE_MS) return;
        void tracker()
          ?.refreshNow(event.rootId)
          .catch(() => undefined);
      }, ROOTS_TUNING.maxWaitMs);
      maxWaitTimers.set(event.rootId, timer);
    }
    if (root === undefined) return;
    const path = relative(root.path, event.absPath).split(sep).join('/');
    if (path === '' || path.startsWith('..')) return;
    const batch = batches.get(event.rootId) ?? { events: [], overflow: false };
    batches.set(event.rootId, batch);
    if (batch.events.length >= ROOTS_TUNING.fileEventBatchMax) {
      batch.overflow = true;
      batch.events = [];
    } else if (!batch.overflow) {
      batch.events.push({ event: event.event, path });
    }
    if (batchTimer === null) batchTimer = setTimeout(flushBatches, ROOTS_TUNING.fileEventBatchMs);
  };

  const defaultsOf = async (
    roots: readonly Root[],
    desk: SpaceRootsResult<Desk>,
  ): Promise<Map<string, DefaultOfRoot>> => {
    const entries = await Promise.all(
      roots.map(async (root): Promise<[string, DefaultOfRoot]> => {
        if (!root.tracking.tracked) return [root.id, { value: null, notice: null }];
        if (!desk.ok) return [root.id, { value: null, notice: desk.error.message }];
        try {
          const read = await defaultBaselineOf({ runner, desk: desk.value, root });
          if (read.ok) return [root.id, { value: read.value, notice: read.value.notice }];
          log.warn('root-default-baseline-failed', {
            space: context.key,
            root: root.id,
            kind: read.error.kind,
          });
          return [root.id, { value: null, notice: read.error.message }];
        } catch (caught) {
          return [root.id, { value: null, notice: errorMessage(caught) }];
        }
      }),
    );
    return new Map(entries);
  };

  /** Watch `index` of every git folder of the tracked roots, which core's tracker does not. */
  const watchIndexes = async (
    roots: readonly Root[],
    tracker: RootTracker,
  ): Promise<FSWatcher[]> => {
    const rootsByGitDir = new Map<string, string[]>();
    const gitDirByWorkTree = new Map<string, string | null>();
    for (const root of roots) {
      if (!root.tracking.tracked) continue;
      const { workTree } = root.tracking;
      if (!gitDirByWorkTree.has(workTree)) {
        let gitDir: string | null = null;
        try {
          const asked = await runGit(runner, workTree, ['rev-parse', '--absolute-git-dir'], {
            readOnly: true,
          });
          const dir = asked.stdout.trim();
          gitDir = runSucceeded(asked) && dir !== '' && existsSync(dir) ? dir : null;
        } catch {
          gitDir = null;
        }
        gitDirByWorkTree.set(workTree, gitDir);
      }
      const gitDir = gitDirByWorkTree.get(workTree) ?? null;
      if (gitDir === null) continue;
      rootsByGitDir.set(gitDir, [...(rootsByGitDir.get(gitDir) ?? []), root.id]);
    }
    const watchers: FSWatcher[] = [];
    for (const [gitDir, rootIds] of rootsByGitDir) {
      const index = join(gitDir, 'index');
      const watcher = chokidar.watch(gitDir, {
        ignored: (path: string) => path !== gitDir && path !== index,
        ignoreInitial: true,
        persistent: true,
        followSymlinks: false,
        depth: 0,
      });
      watcher.on('all', (_event, path) => {
        if (closed || path !== index) return;
        for (const rootId of rootIds) tracker.scheduleRefresh(rootId);
      });
      watcher.on('error', (caught) => {
        log.warn('roots-index-watcher-error', {
          space: context.key,
          message: errorMessage(caught),
        });
      });
      watchers.push(watcher);
      openIndexWatchers += 1;
    }
    return watchers;
  };

  const resolve = async (): Promise<
    SpaceRootsResult<{ roots: Root[]; manifest: SpaceManifest; signature: string }>
  > => {
    const manifest = await readSpaceManifest(context.root);
    if (!manifest.ok) {
      return failure('roots-unavailable', manifest.error.message, manifest.error.kind);
    }
    const roots = await resolveRoots({
      spaceRoot: context.root,
      runner,
      manifest: manifest.value,
    });
    if (!roots.ok) return failure('roots-unavailable', roots.error.message, roots.error.kind);
    return {
      ok: true,
      value: {
        roots: roots.value,
        manifest: manifest.value,
        signature: signatureOf(roots.value, manifest.value),
      },
    };
  };

  const start = async (resolved: {
    roots: Root[];
    manifest: SpaceManifest;
    signature: string;
  }): Promise<RunningRoots> => {
    const { roots, manifest, signature } = resolved;
    const defaults = await defaultsOf(roots, openDesk());
    const baselines: Record<string, string> = {};
    for (const root of roots) {
      baselines[root.id] =
        picked.get(root.id) ?? defaults.get(root.id)?.value?.baseline ?? HEAD_BASELINE;
    }
    let tracker: RootTracker | null = null;
    tracker = await attachRootTracker({
      roots,
      runner,
      baselines,
      ignored: deriveIgnoreLists(DEFAULT_IGNORE_RULES).drift,
      onChange: (snapshot) => send(SPACE_ROOTS_CONTRACT.onSpaceRootChanges.channel, { snapshot }),
      onFileEvent: (event) => onFileEvent(() => tracker, event),
      onWatcherError: (message) => log.warn('roots-watcher-error', { space: context.key, message }),
    });
    openTrackers += 1;
    const indexWatchers = await watchIndexes(roots, tracker);
    log.info('roots-tracker-started', { space: context.key, roots: roots.length });
    return { roots, manifest, tracker, defaults, signature, indexWatchers };
  };

  const stop = async (running: RunningRoots): Promise<void> => {
    for (const timer of maxWaitTimers.values()) clearTimeout(timer);
    maxWaitTimers.clear();
    if (batchTimer !== null) clearTimeout(batchTimer);
    batchTimer = null;
    batches.clear();
    for (const watcher of running.indexWatchers) {
      try {
        await watcher.close();
      } catch {
        // A watcher that fails to close holds nothing we can release another way.
      }
      openIndexWatchers -= 1;
    }
    running.indexWatchers.length = 0;
    try {
      await running.tracker.close();
    } finally {
      openTrackers -= 1;
    }
    log.info('roots-tracker-closed', { space: context.key });
  };

  const CLOSED = 'The Space is closed.';

  const running = (): Promise<SpaceRootsResult<RunningRoots>> =>
    enqueue(async () => {
      if (closed) return failure<RunningRoots>('roots-unavailable', CLOSED);
      if (current !== null) return { ok: true as const, value: current };
      const resolved = await resolve();
      if (!resolved.ok) return resolved;
      const started = await start(resolved.value);
      current = started;
      return { ok: true as const, value: started };
    });

  const summaryOf = (held: RunningRoots, root: Root): RootSummary => {
    const baseline = held.tracker.baseline(root.id) ?? HEAD_BASELINE;
    const snapshot: RootSnapshot = held.tracker.snapshot(root.id) ?? {
      rootId: root.id,
      baseline,
      status: 'unread',
    };
    const held_default = held.defaults.get(root.id);
    const github =
      root.kind === 'repository'
        ? (held.manifest.repositories.find((entry) => entry.name === root.name)?.github ?? '')
        : '';
    return {
      root,
      baseline,
      defaultBaseline: held_default?.value ?? null,
      baselineNotice: held_default?.notice ?? null,
      snapshot,
      github: github === '' ? null : github,
    };
  };

  const trackedById = (held: RunningRoots, rootId: string) => {
    const root = held.roots.find((candidate) => candidate.id === rootId);
    if (root === undefined) return failure<never>('unknown-root', 'The Space has no such root.');
    return trackedRoot(root);
  };

  /** Give the tracker a baseline and wait for the read. The tracker does nothing for a baseline it already has. */
  const applyBaseline = async (
    held: RunningRoots,
    rootId: string,
    baseline: string,
  ): Promise<RootSnapshot> => {
    if (held.tracker.baseline(rootId) === baseline) await held.tracker.refreshNow(rootId);
    else await held.tracker.setBaseline(rootId, baseline);
    return held.tracker.snapshot(rootId) ?? { rootId, baseline, status: 'unread' };
  };

  return {
    onFileEvent(listener) {
      fileListeners.add(listener);
      return () => {
        fileListeners.delete(listener);
      };
    },
    bind(next) {
      push = next;
    },
    running,
    refresh: (rootId) =>
      enqueue(async () => {
        if (closed) return failure<RunningRoots>('roots-unavailable', CLOSED);
        const resolved = await resolve();
        if (!resolved.ok) return resolved;
        if (current !== null && current.signature === resolved.value.signature) {
          await current.tracker.refreshNow(rootId);
          return { ok: true as const, value: current };
        }
        const before = current;
        current = null;
        if (before !== null) await stop(before);
        const started = await start(resolved.value);
        current = started;
        if (before !== null) {
          send(SPACE_ROOTS_CONTRACT.onSpaceRootsReloaded.channel, { reason: 'roots-changed' });
        }
        return { ok: true as const, value: started };
      }),
    list(held) {
      const desk = openDesk();
      let deskNotice: string | null = null;
      if (!desk.ok) deskNotice = desk.error.message;
      else if (!desk.value.writable) {
        deskNotice = `The desk is held by another running instance of the companion (process ${desk.value.owner.pid}), so this one does not write its records.`;
      }
      return {
        roots: held.roots.map((root) => summaryOf(held, root)),
        deskWritable: desk.ok && desk.value.writable,
        deskNotice,
      };
    },
    root(held, rootId) {
      const root = held.roots.find((candidate) => candidate.id === rootId);
      if (root === undefined) return failure('unknown-root', 'The Space has no such root.');
      return { ok: true, value: root };
    },
    desk: openDesk,
    async setBaseline(rootId, baseline) {
      const held = await running();
      if (!held.ok) return held;
      const root = trackedById(held.value, rootId);
      if (!root.ok) return root;
      let resolved = HEAD_BASELINE;
      if (baseline !== HEAD_BASELINE) {
        const commit = await resolveRootCommit(runner, root.value, baseline);
        if (commit === null) {
          return failure('baseline-missing', 'The commit is not in the repository of this root.');
        }
        resolved = commit;
      }
      picked.set(rootId, resolved);
      const snapshot = await applyBaseline(held.value, rootId, resolved);
      return { ok: true, value: { rootId, baseline: resolved, snapshot } };
    },
    async resetBaseline(rootId) {
      const held = await running();
      if (!held.ok) return held;
      const root = trackedById(held.value, rootId);
      if (!root.ok) return root;
      const desk = openDesk();
      if (!desk.ok) return desk;
      const read = await defaultBaselineOf({ runner, desk: desk.value, root: root.value });
      if (!read.ok) return baselineFailure(read.error);
      picked.delete(rootId);
      held.value.defaults.set(rootId, { value: read.value, notice: read.value.notice });
      const snapshot = await applyBaseline(held.value, rootId, read.value.baseline);
      return { ok: true, value: { rootId, baseline: read.value.baseline, snapshot } };
    },
    async markReviewed(rootId) {
      const held = await running();
      if (!held.ok) return held;
      const root = trackedById(held.value, rootId);
      if (!root.ok) return root;
      const desk = openDesk();
      if (!desk.ok) return desk;
      const marked = await markRootReviewed({ runner, desk: desk.value, root: root.value });
      if (!marked.ok) {
        log.warn('root-mark-reviewed-refused', {
          space: context.key,
          root: rootId,
          kind: marked.error.kind,
          cause: marked.error.cause,
        });
        return baselineFailure(marked.error);
      }
      const { mark, baseline } = marked.value;
      picked.delete(rootId);
      held.value.defaults.set(rootId, {
        value: {
          rootId,
          baseline,
          source: 'reviewed-mark',
          at: mark.markedAt,
          firstSeenRecorded: false,
          missing: [],
          notice: null,
        },
        notice: null,
      });
      log.info('root-marked-reviewed', { space: context.key, root: rootId, commit: baseline });
      const snapshot = await applyBaseline(held.value, rootId, baseline);
      return { ok: true, value: { rootId, mark, baseline, snapshot } };
    },
    close() {
      closed = true;
      return enqueue(async () => {
        const held = current;
        current = null;
        if (held !== null) await stop(held);
      });
    },
  };
}

/** The roots of the Space of a context. Read it with `context.service(spaceRoots)`. */
export const spaceRoots = defineSpaceService<SpaceRoots>({
  id: 'roots',
  create: createSpaceRoots,
  dispose: (service) => service.close(),
});
