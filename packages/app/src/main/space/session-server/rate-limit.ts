/**
 * A count of events per key inside a sliding window. Used for the tool calls
 * and the dialog requests of one session.
 */

export type RateLimit = {
  /** Count one event for `key`. `false` when the key has used its share of the window; the event is then not counted. */
  take(key: string): boolean;
  /** Forget `key`. */
  forget(key: string): void;
  clear(): void;
};

export function createRateLimit(options: {
  max: number;
  windowMs: number;
  now: () => number;
}): RateLimit {
  const times = new Map<string, number[]>();
  return {
    take(key) {
      const from = options.now() - options.windowMs;
      const kept = (times.get(key) ?? []).filter((time) => time > from);
      const allowed = kept.length < options.max;
      if (allowed) kept.push(options.now());
      times.set(key, kept);
      return allowed;
    },
    forget: (key) => {
      times.delete(key);
    },
    clear: () => times.clear(),
  };
}
