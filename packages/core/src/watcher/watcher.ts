/**
 * The project's chokidar watcher — emits file-change events the host
 * subscribes to. v0.6 Phase B simplified the contract: the watcher is now
 * a *trigger*, not a queue producer. The host drives the [git-status
 * tracker](../git-status/tracker.ts) and the [tracker-review reader](../tracker-review/tracker-review.ts)
 * from these events.
 *
 * Removed in v0.6 Phase B:
 *   - The `Queue` parameter and queue pushes.
 *   - Tracker-transition detection inside the watcher (`classifyTrackerFile`,
 *     `parseStatus`, `createTransitionDetector`). Tracker-review is now a
 *     snapshot reader, not a transition log.
 *   - The `isUntrackedFile` filter on index files. Drift is what `git status`
 *     reports — if index files are noisy, they should be `.gitignore`'d.
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

import { relative, sep } from 'node:path';
import chokidar from 'chokidar';

/** Which side of the project a path falls on — Payload or Lore. */
export type WatcherScope = 'payload' | 'lore';

/**
 * A filesystem event that affects the host's tree state. Covers directory
 * add/remove (the listing for the parent gains/loses a folder) and file
 * add/remove (the listing for the containing folder gains/loses a file).
 * Tree events reach the host through `onDirEvent`; file content events
 * reach it through `onFileChange`.
 */
export type DirEvent = {
  event: 'add' | 'unlink' | 'addDir' | 'unlinkDir';
  /** Absolute path of the file or directory that was added or removed. */
  absPath: string;
  scope: WatcherScope;
};

/** A file content event. The host typically debounces these into a `git status` re-read. */
export type FileChangeEvent = {
  event: 'add' | 'change' | 'unlink';
  absPath: string;
  scope: WatcherScope;
};

export type WatcherOptions = {
  root: string;
  lorePath: string;
  ignored?: readonly string[];
  /**
   * Called on every file content event — `add` / `change` / `unlink`. Optional;
   * a host that only cares about tree-shape updates can leave it out.
   */
  onFileChange?: (event: FileChangeEvent) => void;
  /**
   * Called on every directory event (`addDir` / `unlinkDir`) and on file
   * `add` / `unlink` (since those change the parent listing). Optional —
   * when omitted, the watcher does not subscribe to directory events at all.
   */
  onDirEvent?: (event: DirEvent) => void;
};

export type WatcherHandle = {
  close: () => Promise<void>;
};

export function attachWatcher(options: WatcherOptions): WatcherHandle {
  const { root, lorePath } = options;
  const ignored = [...(options.ignored ?? [])];
  const loreRel = relative(root, lorePath);
  const { onFileChange, onDirEvent } = options;

  const watcher = chokidar.watch(root, {
    ignored,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  const handleFile = (chokidarEvent: 'add' | 'change' | 'unlink', absPath: string): void => {
    const rel = relative(root, absPath);
    if (!rel || rel.startsWith('..')) return;
    const scope = classifyScope(rel, loreRel);

    // File adds/removes also shift the parent directory's listing — fire the
    // dir event so the host can refresh the tree. `change` (content-only
    // edit) doesn't change the listing, so it skips this.
    if (chokidarEvent !== 'change' && onDirEvent) {
      onDirEvent({ event: chokidarEvent, absPath, scope });
    }

    if (onFileChange) {
      onFileChange({ event: chokidarEvent, absPath, scope });
    }
  };

  watcher.on('add', (p) => handleFile('add', p));
  watcher.on('change', (p) => handleFile('change', p));
  watcher.on('unlink', (p) => handleFile('unlink', p));

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

function classifyScope(relPath: string, loreRel: string): WatcherScope {
  if (!loreRel) return 'payload';
  const normalized = relPath.split(sep).join('/');
  const lore = loreRel.split(sep).join('/');
  return normalized === lore || normalized.startsWith(`${lore}/`) ? 'lore' : 'payload';
}
