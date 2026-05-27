/**
 * The debounced changes tracker — the cockpit's "what differs from a
 * baseline I picked" data source under v0.6's Phase B *Changes panel*.
 * One tracker per project window, observing two working trees (the
 * Payload repo at the project root and the Lore repo at `<lorePath>/memory/`).
 *
 * Each scope carries its own baseline; the renderer can flip them
 * independently through `setBaseline(scope, baseline)`. A baseline change
 * triggers an immediate non-debounced re-read for that scope — the file
 * list refreshes instantly to reflect the new baseline. File-event-driven
 * re-reads stay debounced (200 ms default) — typing churn shouldn't fan out.
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

import { readChanges } from './changes.js';
import type { ChangeEntry } from './porcelain.js';

/** Which repo a changes snapshot reflects. */
export type ChangeScope = 'payload' | 'lore';

export type ChangesSnapshot = {
  payload: ChangeEntry[];
  lore: ChangeEntry[];
};

export type ChangesTrackerOptions = {
  /** Absolute path to the Payload repo working-tree root (the project root). */
  payloadRoot: string;
  /** Absolute path to the Lore repo working-tree root (`<lorePath>/memory/`). */
  loreRoot: string;
  /**
   * Initial baseline per scope. Each is either `'HEAD'` (default behaviour:
   * working-tree-vs-HEAD, the v0.5 drift shape) or any commit SHA. The
   * renderer can flip per-scope via `setBaseline`.
   */
  baselineByScope?: { payload: string; lore: string };
  /** Milliseconds to wait after a `scheduleRefresh` before re-reading. */
  debounceMs?: number;
  /**
   * Called when the snapshot for a side changes. Equality is checked via the
   * serialised entries — re-emits do not fire when a re-read returned the
   * same dirty set. The current baseline for `scope` is passed alongside so
   * the host can ship it to its UI without re-querying.
   */
  onChange: (scope: ChangeScope, entries: ChangeEntry[], baseline: string) => void;
};

export type ChangesTracker = {
  /** The current snapshot for both repos. */
  snapshot(): ChangesSnapshot;
  /** The current baseline for both repos. */
  baselines(): { payload: string; lore: string };
  /**
   * Schedule a debounced re-read of `scope`. Multiple calls within the
   * debounce window collapse into one read.
   */
  scheduleRefresh(scope: ChangeScope): void;
  /** Force an immediate (non-debounced) re-read of both repos. */
  refreshNow(): void;
  /**
   * Flip the baseline for `scope`. Triggers an immediate non-debounced
   * re-read so the next snapshot reflects the new baseline.
   */
  setBaseline(scope: ChangeScope, baseline: string): void;
  /** Cancel any pending timers. */
  close(): void;
};

const DEFAULT_DEBOUNCE_MS = 200;

export function attachChangesTracker(options: ChangesTrackerOptions): ChangesTracker {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const baselines: { payload: string; lore: string } = {
    payload: options.baselineByScope?.payload ?? 'HEAD',
    lore: options.baselineByScope?.lore ?? 'HEAD',
  };
  const state: ChangesSnapshot = { payload: [], lore: [] };
  const serialised: { payload: string; lore: string } = { payload: '[]', lore: '[]' };
  const timers: { payload: NodeJS.Timeout | null; lore: NodeJS.Timeout | null } = {
    payload: null,
    lore: null,
  };

  const reread = (scope: ChangeScope, force = false): void => {
    const root = scope === 'payload' ? options.payloadRoot : options.loreRoot;
    const result = readChanges(root, baselines[scope]);
    const entries = result.kind === 'ok' ? result.entries : [];
    const nextSerialised = JSON.stringify(entries);
    if (!force && nextSerialised === serialised[scope]) return;
    state[scope] = entries;
    serialised[scope] = nextSerialised;
    options.onChange(scope, entries, baselines[scope]);
  };

  const scheduleRefresh = (scope: ChangeScope): void => {
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

  const setBaseline = (scope: ChangeScope, baseline: string): void => {
    if (baselines[scope] === baseline) return;
    baselines[scope] = baseline;
    if (timers[scope]) {
      clearTimeout(timers[scope]);
      timers[scope] = null;
    }
    // Force-fire onChange — the renderer needs the snapshot for the new
    // baseline even when its serialised shape matches the old one (e.g.
    // both empty, or both happen to list the same files).
    reread(scope, true);
  };

  // Seed both snapshots once on attach so the host has data without waiting
  // for the first watcher event.
  refreshNow();

  return {
    snapshot: () => ({ payload: [...state.payload], lore: [...state.lore] }),
    baselines: () => ({ ...baselines }),
    scheduleRefresh,
    refreshNow,
    setBaseline,
    close: () => {
      if (timers.payload) clearTimeout(timers.payload);
      if (timers.lore) clearTimeout(timers.lore);
      timers.payload = null;
      timers.lore = null;
    },
  };
}
