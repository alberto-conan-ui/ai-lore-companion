/**
 * Snapshot reader for *nodes currently at status: Review* across the
 * project's focus and action-tree trees.
 *
 * v0.6 Phase B splits this out of the old drift queue: a tracker-review
 * entry isn't a working-tree change (the file may be perfectly committed),
 * it's a Memory-state signal that the AI session has flagged a node for
 * human review. Its own surface; not part of the git-status drift view.
 *
 * Reader semantics: walk the focus folder (non-recursively — focuses are
 * flat under `memory/status/focus/`) and the action-tree subfolders
 * recursively, parse each tracker file's frontmatter, and list every node
 * whose `status:` is `Review`.
 *
 * Archived focuses (`memory/status/focus/archive/`) and the action-tree
 * `archive/` are skipped — review is about live work, not history.
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseMemoryFileSync } from '../frontmatter/parser.js';
import type { MemoryFrontmatter } from '../frontmatter/types.js';

export type TrackerReviewTrackerOptions = {
  /** Absolute path to the Lore root (`<lorePath>/`). */
  loreRoot: string;
  /** Milliseconds to wait after `scheduleRefresh` before re-reading. */
  debounceMs?: number;
  /** Called when the snapshot moves; identical re-reads are suppressed. */
  onChange: (entries: TrackerReviewEntry[]) => void;
};

export type TrackerReviewTracker = {
  /** The current snapshot. */
  snapshot(): TrackerReviewEntry[];
  /** Schedule a debounced re-read. Multiple calls collapse into one. */
  scheduleRefresh(): void;
  /** Force an immediate re-read. */
  refreshNow(): void;
  /** Cancel any pending timer. */
  close(): void;
};

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Debounced wrapper around [`readTrackerReview`](#readTrackerReview).
 *
 * The host (main) calls [`scheduleRefresh`](#scheduleRefresh) from watcher
 * events on the focus + AT subtrees. The tracker re-reads the snapshot,
 * compares it against the last one, and fires `onChange` only when the
 * set of Review nodes changes. Mirror of the git-status tracker shape.
 */
export function attachTrackerReviewTracker(
  options: TrackerReviewTrackerOptions,
): TrackerReviewTracker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let state: TrackerReviewEntry[] = [];
  let serialised = '[]';
  let timer: NodeJS.Timeout | null = null;

  const reread = (): void => {
    const entries = readTrackerReview(options.loreRoot);
    const next = JSON.stringify(entries);
    if (next === serialised) return;
    state = entries;
    serialised = next;
    options.onChange(entries);
  };

  const scheduleRefresh = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reread();
    }, debounceMs);
  };

  // Seed the snapshot synchronously so the host has data immediately.
  reread();

  return {
    snapshot: () => [...state],
    scheduleRefresh,
    refreshNow: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      reread();
    },
    close: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type TrackerReviewKind = 'focus' | 'at-node';

export type TrackerReviewEntry = {
  /** Absolute path to the tracker file. */
  absPath: string;
  /** Path relative to the Lore root (`<lorePath>/`). */
  lorePath: string;
  /** Whether the file is a focus or an action-tree node. */
  kind: TrackerReviewKind;
  /** Human-readable title from frontmatter — falls back to the basename. */
  title: string;
};

/**
 * List every focus and AT node currently at `status: Review`. Walks under
 * `<loreRoot>/memory/status/focus/` (non-archive only) and
 * `<loreRoot>/memory/action-tree/` (every focus subfolder, non-archive).
 *
 * A missing directory returns an empty list. Files with malformed or
 * absent frontmatter are skipped silently — the walker is forward-compatible
 * by design.
 */
export function readTrackerReview(loreRoot: string): TrackerReviewEntry[] {
  const out: TrackerReviewEntry[] = [];

  // Focuses live flat under `memory/status/focus/`. Skip `archive/`.
  const focusDir = join(loreRoot, 'memory/status/focus');
  for (const name of safeReaddir(focusDir)) {
    if (name === 'archive') continue;
    if (!name.endsWith('.focus.md')) continue;
    const absPath = join(focusDir, name);
    const entry = readReviewEntry(absPath, loreRoot, 'focus');
    if (entry) out.push(entry);
  }

  // Action-tree nodes nest one level under `memory/action-tree/<focus>/`.
  // Skip the top-level `archive/`. Index files (`<container>.index.md`) and
  // phase files (`<name>.phase.md`) are both tracker nodes per
  // [classifier.ts](../tracker/classifier.ts).
  const atDir = join(loreRoot, 'memory/action-tree');
  for (const focusName of safeReaddir(atDir)) {
    if (focusName === 'archive') continue;
    const focusFolder = join(atDir, focusName);
    if (!isDirectory(focusFolder)) continue;
    for (const file of safeReaddir(focusFolder)) {
      if (!file.endsWith('.phase.md') && !file.endsWith('.index.md')) continue;
      const absPath = join(focusFolder, file);
      const entry = readReviewEntry(absPath, loreRoot, 'at-node');
      if (entry) out.push(entry);
    }
  }

  // Stable order: focuses first (alphabetical), then at-nodes
  // (alphabetical by lore-relative path).
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'focus' ? -1 : 1;
    return a.lorePath.localeCompare(b.lorePath);
  });
  return out;
}

function readReviewEntry(
  absPath: string,
  loreRoot: string,
  kind: TrackerReviewKind,
): TrackerReviewEntry | null {
  let parsed: { frontmatter: MemoryFrontmatter | null };
  try {
    parsed = parseMemoryFileSync(absPath);
  } catch {
    return null;
  }
  const fm = parsed.frontmatter;
  if (!fm) return null;
  if (!hasReviewStatus(fm)) return null;
  return {
    absPath,
    lorePath: relative(loreRoot, absPath).split(sep).join('/'),
    kind,
    title: fm.title,
  };
}

function hasReviewStatus(fm: MemoryFrontmatter): boolean {
  if (fm.type === 'focus' || fm.type === 'at-node') {
    return fm.status === 'Review';
  }
  return false;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
