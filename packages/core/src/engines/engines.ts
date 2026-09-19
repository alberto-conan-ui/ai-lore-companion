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

import { type CatalogModel, dedupEntries, parseEntries } from '../catalog/catalog.js';
import { defaultParamArgv, paramsFromArgs } from './params.js';

/**
 * One parameter of an engine, as the Human Lead typed it in Settings
 * (M10.3, `m10-architecture.md` 3.4).
 */
export type EngineParam = {
  /** For example `--dangerously-skip-permissions` or `--model opus`. Split on white space into arguments. */
  text: string;
  /** Ticked on the start control when it opens. */
  defaultOn: boolean;
};

/** One engine entry. `binary` may be an absolute path or a bare name to
 *  resolve on PATH at spawn time. */
export type EngineEntry = {
  /** Stable identifier — surfaces in IPC and the AI-tab `engine` field. */
  id: string;
  /** Display name shown in the `+ AI ▾` popover and Settings list. */
  name: string;
  /** Absolute path or bare name (resolved on PATH at spawn). */
  binary: string;
  /** The parameters, in order. Absent on an entry written by an older build. */
  params?: EngineParam[];
  /**
   * The arguments of the parameters ticked by default, in order, derived from
   * `params` on every parse and save. Kept for the v0.8 AI tab (`main/pty.ts`)
   * and for older builds that read `engines.json`.
   */
  args?: string[];
  /**
   * Optional model the **read-only helper** launches this engine with (AI
   * Helper, CR7) — free-text, since each engine names its own models (Claude:
   * `haiku`/`sonnet`/`opus`; Gemini: `gemini-2.5-flash`/…). The helper-engine
   * adapter maps it to the engine's model flag (`--model`); when unset, the
   * adapter falls back to its own default. Does **not** affect the user's own
   * interactive AI tab — only the app-driven helper.
   */
  helperModel?: string;
};

// A parameter whose text is empty after trimming is a valid shape (`isEngineEntry` accepts
// it) but is dropped by `parseEngineEntry`'s migration, so the entry itself still parses.
function isEngineParam(value: unknown): value is EngineParam {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.text !== 'string' || o.text.length > 1024) return false;
  return typeof o.defaultOn === 'boolean';
}

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
  if (o.params !== undefined) {
    if (!Array.isArray(o.params)) return false;
    if (!o.params.every(isEngineParam)) return false;
  }
  if (o.helperModel !== undefined && typeof o.helperModel !== 'string') return false;
  return true;
}

/**
 * Coerce a raw value into an `EngineEntry`, dropping unknown fields. Applies
 * the parameter migration of rule 2 of `m10-architecture.md` 3.4: an entry
 * without `params` and with a non-empty `args` gets one parameter, ticked by
 * default, holding every argument; `args` is then derived from `params` on
 * every parse (the arguments of the parameters with `defaultOn`), or removed
 * when that is empty.
 */
export function parseEngineEntry(value: unknown): EngineEntry | null {
  if (!isEngineEntry(value)) return null;
  const v = value as Record<string, unknown>;
  const out: EngineEntry = {
    id: v.id as string,
    name: v.name as string,
    binary: v.binary as string,
  };
  let params: EngineParam[] | undefined;
  if (Array.isArray(v.params)) {
    params = (v.params as EngineParam[])
      .map((param) => ({ text: param.text.trim(), defaultOn: param.defaultOn }))
      .filter((param) => param.text.length > 0);
  } else if (Array.isArray(v.args) && v.args.length > 0) {
    params = paramsFromArgs(v.args as string[]);
  }
  if (params !== undefined) {
    out.params = params;
    const argv = defaultParamArgv(params);
    if (argv.length > 0) out.args = argv;
  }
  if (typeof v.helperModel === 'string' && v.helperModel.length > 0) {
    out.helperModel = v.helperModel;
  }
  return out;
}

/** The catalog model for engines — entry coercion + identity tuple
 *  (id, name, binary, params). The generic `parseEntries` / `dedupEntries`
 *  operate off this; the named wrappers below preserve existing call sites. */
export const engineCatalog: CatalogModel<EngineEntry> = {
  parseEntry: parseEngineEntry,
  identity: (e) =>
    `${e.id}|${e.name.toLowerCase()}|${e.binary}|${(e.params ?? [])
      .map((p) => `${p.defaultOn ? '+' : '-'}${p.text}`)
      .join('\u0001')}|${e.helperModel ?? ''}`,
};

/** Parse an array of entries from a raw value, dropping malformed elements. */
export function parseEngineEntries(value: unknown): EngineEntry[] {
  return parseEntries(engineCatalog, value);
}

/** Dedup engine entries by identity tuple — (id, name, binary, args). */
export function dedupEngines(engines: readonly EngineEntry[]): EngineEntry[] {
  return dedupEntries(engineCatalog, engines);
}
