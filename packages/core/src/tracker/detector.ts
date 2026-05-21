import type { TrackerStatus } from './parser.js';

export type DetectorObservation = {
  /** Stable key for the tracker file. Usually the absolute or canonical path. */
  key: string;
  /** Current status word read from the file, or null if absent / unparseable. */
  status: TrackerStatus | null;
};

export type DetectorResult =
  | { kind: 'seeded' } // first observation — just stores, no event
  | { kind: 'transition'; prev: TrackerStatus | null; next: TrackerStatus }
  | { kind: 'no-change' };

/**
 * In-memory snapshot of last-seen status per tracker file. A transition is
 * emitted only when:
 *   1. The file has been observed before (not the first sighting),
 *   2. The new status is `Review`, and
 *   3. The previous status was not `Review`.
 *
 * Forgetting a key (e.g. when a tracker file is unlinked) clears it from the
 * snapshot — the next observation re-seeds rather than firing a spurious event.
 */
export function createTransitionDetector(): {
  observe: (obs: DetectorObservation) => DetectorResult;
  forget: (key: string) => void;
  size: () => number;
} {
  const snapshot = new Map<string, TrackerStatus | null>();

  return {
    observe({ key, status }) {
      if (!snapshot.has(key)) {
        snapshot.set(key, status);
        return { kind: 'seeded' };
      }
      const prev = snapshot.get(key) ?? null;
      snapshot.set(key, status);
      if (status === 'Review' && prev !== 'Review') {
        return { kind: 'transition', prev, next: status };
      }
      return { kind: 'no-change' };
    },
    forget(key) {
      snapshot.delete(key);
    },
    size() {
      return snapshot.size;
    },
  };
}
