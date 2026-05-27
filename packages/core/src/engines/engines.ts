/**
 * Engines registry — user-configured list of long-running AI engines the
 * cockpit can launch in an AI tab's PTY (Phase B). Distinct from the Apps
 * catalog: Apps are one-shot openers (`open -a`, single CLI invocation);
 * engines are PTY hosts the user drives interactively.
 *
 * The store is global — engines are user-wide, the same across all projects.
 * Per-project state (which engine the user last picked here) lives separately,
 * not on the entry itself.
 */

/** One engine entry. `binary` may be an absolute path or a bare name to
 *  resolve on PATH at spawn time. */
export type EngineEntry = {
  /** Stable identifier — surfaces in IPC and the AI-tab `engine` field. */
  id: string;
  /** Display name shown in the `+ AI ▾` popover and Settings list. */
  name: string;
  /** Absolute path or bare name (resolved on PATH at spawn). */
  binary: string;
  /** Optional argv passed to the engine on Start. */
  args?: string[];
};

/** Shape-check a raw value as an `EngineEntry`. Tolerant of extra fields. */
export function isEngineEntry(value: unknown): value is EngineEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (typeof o.name !== 'string' || o.name.length === 0) return false;
  if (typeof o.binary !== 'string' || o.binary.length === 0) return false;
  if (o.args !== undefined) {
    if (!Array.isArray(o.args)) return false;
    if (!o.args.every((a) => typeof a === 'string')) return false;
  }
  return true;
}

/** Coerce a raw value into an `EngineEntry`, dropping unknown fields. */
export function parseEngineEntry(value: unknown): EngineEntry | null {
  if (!isEngineEntry(value)) return null;
  const v = value as Record<string, unknown>;
  const out: EngineEntry = {
    id: v.id as string,
    name: v.name as string,
    binary: v.binary as string,
  };
  if (Array.isArray(v.args)) out.args = (v.args as string[]).slice();
  return out;
}

/** Parse an array of entries from a raw value, dropping malformed elements. */
export function parseEngineEntries(value: unknown): EngineEntry[] {
  if (!Array.isArray(value)) return [];
  const out: EngineEntry[] = [];
  for (const raw of value) {
    const parsed = parseEngineEntry(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Dedup engine entries by identity tuple — (id, name, binary, args). */
export function dedupEngines(engines: readonly EngineEntry[]): EngineEntry[] {
  const seen = new Set<string>();
  const out: EngineEntry[] = [];
  for (const e of engines) {
    const key = `${e.id}|${e.name.toLowerCase()}|${e.binary}|${(e.args ?? []).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
