import { readFileSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import chokidar from 'chokidar';
import { isUntrackedFile } from '../ignore.js';
import type { Queue } from '../queue/queue.js';
import type { ChangeScope, ChangeType } from '../queue/types.js';
import { classifyTrackerFile } from '../tracker/classifier.js';
import { createTransitionDetector } from '../tracker/detector.js';
import { parseStatus, parseTitle } from '../tracker/parser.js';

/**
 * A directory-level filesystem event surfaced to the host. Directory events
 * are not queue entries — they drive tree-state updates, not notifications —
 * so they bypass the queue and reach the host through `onDirEvent`.
 */
export type DirEvent = {
  event: 'addDir' | 'unlinkDir';
  /** Absolute path of the directory that was added or removed. */
  absPath: string;
  scope: ChangeScope;
};

export type WatcherOptions = {
  root: string;
  lorePath: string;
  ignored?: readonly string[];
  /**
   * Called on every `addDir` / `unlinkDir` event. Optional — when omitted, the
   * watcher does not subscribe to directory events at all.
   */
  onDirEvent?: (event: DirEvent) => void;
};

export type WatcherHandle = {
  close: () => Promise<void>;
};

export function attachWatcher(queue: Queue, options: WatcherOptions): WatcherHandle {
  const { root, lorePath } = options;

  // An older build may have queued index-file drift before such files were
  // untracked. Prune it on attach so the rule holds for the existing queue,
  // not just events from here on.
  for (const entry of queue.snapshot()) {
    if (isUntrackedFile(basename(entry.path))) queue.ack(entry.id);
  }

  // The full ignore list is the caller's to assemble — `main` passes the
  // `drift` list derived from the project's ignore rules (defaults included).
  const ignored = [...(options.ignored ?? [])];
  const loreRel = relative(root, lorePath);
  const detector = createTransitionDetector();

  const watcher = chokidar.watch(root, {
    ignored,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  const handle = (chokidarEvent: 'add' | 'change' | 'unlink', absPath: string): void => {
    const rel = relative(root, absPath);
    if (!rel || rel.startsWith('..')) return;
    // AI-Lore index files churn constantly as Memory is reshaped — noise, not
    // drift. They stay in the tree and search; they just never reach the queue.
    if (isUntrackedFile(basename(absPath))) return;
    const scope = classifyScope(rel, loreRel);

    const loreRelPath = scope === 'lore' && loreRel ? relative(lorePath, absPath) : null;
    const trackerKind = loreRelPath ? classifyTrackerFile(loreRelPath) : null;
    const ts = Date.now();

    // Non-tracker files (or tracker unlinks) always emit a normal change event.
    if (!trackerKind) {
      queue.push({ path: rel, type: chokidarEvent satisfies ChangeType, scope, ts });
      return;
    }
    if (chokidarEvent === 'unlink') {
      detector.forget(absPath);
      queue.push({ path: rel, type: 'unlink', scope, ts });
      return;
    }

    // Tracker file change — try to detect a Status transition.
    let text: string;
    try {
      text = readFileSync(absPath, 'utf8');
    } catch {
      // File vanished between event and read; fall back to a normal event.
      queue.push({ path: rel, type: chokidarEvent, scope, ts });
      return;
    }

    const status = parseStatus(text);
    const result = detector.observe({ key: absPath, status });

    if (result.kind === 'transition') {
      const title = parseTitle(text) ?? rel;
      queue.push({
        path: rel,
        type: 'tracker-review',
        scope,
        ts,
        subject: { kind: trackerKind, title },
      });
      return;
    }

    queue.push({ path: rel, type: chokidarEvent, scope, ts });
  };

  watcher.on('add', (p) => handle('add', p));
  watcher.on('change', (p) => handle('change', p));
  watcher.on('unlink', (p) => handle('unlink', p));

  // Directory events bypass `handle` (the queue-push path) entirely — they
  // drive tree-state updates, not queue notifications.
  const onDirEvent = options.onDirEvent;
  if (onDirEvent) {
    const emitDir = (event: 'addDir' | 'unlinkDir', absPath: string): void => {
      const rel = relative(root, absPath);
      if (!rel || rel.startsWith('..')) return;
      onDirEvent({ event, absPath, scope: classifyScope(rel, loreRel) });
    };
    watcher.on('addDir', (p) => emitDir('addDir', p));
    watcher.on('unlinkDir', (p) => emitDir('unlinkDir', p));
  }

  return {
    close: () => watcher.close(),
  };
}

function classifyScope(relPath: string, loreRel: string): ChangeScope {
  if (!loreRel) return 'payload';
  const normalized = relPath.split(sep).join('/');
  const lore = loreRel.split(sep).join('/');
  return normalized === lore || normalized.startsWith(`${lore}/`) ? 'lore' : 'payload';
}
