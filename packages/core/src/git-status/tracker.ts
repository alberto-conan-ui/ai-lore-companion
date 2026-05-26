/**
 * The debounced git-status tracker — the cockpit's "what is dirty" data
 * source under v0.6's *git is the truth* model. One tracker per project
 * window, observing two working trees (the Payload repo at the project
 * root and the Lore repo at `<lorePath>/memory/`).
 *
 * The host (main) calls [`scheduleRefresh(scope)`](#scheduleRefresh) from
 * watcher events. The tracker debounces them and re-reads `git status`;
 * when the snapshot moves, `onChange(scope, entries)` fires. Idle cost is
 * zero — nothing polls.
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

import { readGitStatus } from './git-status.js';
import type { PorcelainEntry } from './porcelain.js';

/** Which repo a porcelain snapshot reflects. */
export type GitStatusScope = 'payload' | 'lore';

export type GitStatusSnapshot = {
  payload: PorcelainEntry[];
  lore: PorcelainEntry[];
};

export type GitStatusTrackerOptions = {
  /** Absolute path to the Payload repo working-tree root (the project root). */
  payloadRoot: string;
  /** Absolute path to the Lore repo working-tree root (`<lorePath>/memory/`). */
  loreRoot: string;
  /** Milliseconds to wait after a `scheduleRefresh` before re-reading. */
  debounceMs?: number;
  /**
   * Called when the snapshot for a side changes. Equality is checked via the
   * serialised entries — re-emits do not fire when a re-read returned the
   * same dirty set.
   */
  onChange: (scope: GitStatusScope, entries: PorcelainEntry[]) => void;
};

export type GitStatusTracker = {
  /** The current snapshot for both repos. */
  snapshot(): GitStatusSnapshot;
  /**
   * Schedule a debounced re-read of `scope`. Multiple calls within the
   * debounce window collapse into one read.
   */
  scheduleRefresh(scope: GitStatusScope): void;
  /** Force an immediate (non-debounced) re-read of both repos. */
  refreshNow(): void;
  /** Cancel any pending timers. */
  close(): void;
};

const DEFAULT_DEBOUNCE_MS = 200;

export function attachGitStatusTracker(options: GitStatusTrackerOptions): GitStatusTracker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const state: GitStatusSnapshot = { payload: [], lore: [] };
  const serialised: { payload: string; lore: string } = { payload: '[]', lore: '[]' };
  const timers: { payload: NodeJS.Timeout | null; lore: NodeJS.Timeout | null } = {
    payload: null,
    lore: null,
  };

  const reread = (scope: GitStatusScope): void => {
    const root = scope === 'payload' ? options.payloadRoot : options.loreRoot;
    const result = readGitStatus(root);
    const entries = result.kind === 'ok' ? result.entries : [];
    const nextSerialised = JSON.stringify(entries);
    if (nextSerialised === serialised[scope]) return;
    state[scope] = entries;
    serialised[scope] = nextSerialised;
    options.onChange(scope, entries);
  };

  const scheduleRefresh = (scope: GitStatusScope): void => {
    if (timers[scope]) clearTimeout(timers[scope]);
    timers[scope] = setTimeout(() => {
      timers[scope] = null;
      reread(scope);
    }, debounceMs);
  };

  const refreshNow = (): void => {
    if (timers.payload) {
      clearTimeout(timers.payload);
      timers.payload = null;
    }
    if (timers.lore) {
      clearTimeout(timers.lore);
      timers.lore = null;
    }
    reread('payload');
    reread('lore');
  };

  // Seed both snapshots once on attach so the host has data without waiting
  // for the first watcher event.
  refreshNow();

  return {
    snapshot: () => ({ payload: [...state.payload], lore: [...state.lore] }),
    scheduleRefresh,
    refreshNow,
    close: () => {
      if (timers.payload) clearTimeout(timers.payload);
      if (timers.lore) clearTimeout(timers.lore);
      timers.payload = null;
      timers.lore = null;
    },
  };
}
