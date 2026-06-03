/**
 * The assistant **activity log** — a tiny shared store so what the read-only
 * assistant is doing is **visible in the app**, not buried in a terminal only a
 * developer can see (HL, 2026-06-03). Both engines report here uniformly: Claude
 * and Gemini ride the same Channel-C stream, so the dashboard pushes one entry
 * per turn fired and one per event/answer/error. The {@link ./ActivityConsole}
 * renders it with copy buttons so the HL can paste a raw response or an error
 * straight back.
 *
 * Deliberately framework-free (a module singleton + listeners) so any surface can
 * read or append without prop-drilling.
 */

export type ActivityKind = 'turn' | 'status' | 'answer' | 'error';

export type ActivityEntry = {
  id: number;
  /** Wall-clock HH:MM:SS for the log line. */
  at: string;
  kind: ActivityKind;
  /** The one-line summary shown in the log. */
  text: string;
  /** The full payload (a raw answer, a full error, the prompt) — copyable. */
  detail?: string;
};

const MAX = 200;
let seq = 0;
const entries: ActivityEntry[] = [];
const listeners = new Set<() => void>();

function clock(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

/** Append a log line and notify subscribers. `detail` carries the full,
 *  copyable payload (e.g. the raw model output, or the complete error). */
export function pushActivity(kind: ActivityKind, text: string, detail?: string): void {
  entries.push({ id: ++seq, at: clock(), kind, text, detail });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  for (const l of listeners) l();
}

export function clearActivity(): void {
  entries.length = 0;
  for (const l of listeners) l();
}

/** The current entries, oldest-first. */
export function getActivity(): readonly ActivityEntry[] {
  return entries;
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
