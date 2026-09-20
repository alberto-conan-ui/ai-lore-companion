/**
 * Merging the Human Lead's stored engine list (`engines.json`) with the
 * catalog, so that the catalog engines are always first and are never
 * removed, and so that an engine the Human Lead already had (by id, or by the
 * same binary name re-added under a new id) keeps its place in the catalog.
 */

import { basename, isAbsolute } from 'node:path';
import { defaultParamArgv } from '../../engines/index.js';
import type { EngineEntry, EngineParam } from '../../engines/index.js';
import { ENGINE_CATALOG, type EngineCatalogEntry } from './catalog.js';

/** `basename(binary)`, `.exe` removed, lower case — how a binary is matched to a catalog entry. */
function binaryKey(binary: string): string {
  return basename(binary)
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

type Slot = { entry: EngineCatalogEntry; taken: EngineEntry | null };

/** The catalog entry `stored` merges into: `{ id: engineId, name, binary }`, or the stored shape kept where the rules say so. */
function mergedEntry(slot: Slot): EngineEntry {
  const out: EngineEntry = {
    id: slot.entry.engineId,
    name: slot.entry.name,
    binary: slot.entry.binary,
  };
  const taken = slot.taken;
  if (taken !== null) {
    if (isAbsolute(taken.binary)) out.binary = taken.binary;
    if (taken.model !== undefined) out.model = taken.model;
    if (taken.helperModel !== undefined) out.helperModel = taken.helperModel;
  }
  // Rule 3 (3.4): a catalog entry gets the seed parameters when the stored entry it merges
  // has no `params` field (a new install, or an entry from before M10).
  const params: EngineParam[] | undefined =
    taken?.params !== undefined
      ? taken.params
      : slot.entry.seedParams.length > 0
        ? [...slot.entry.seedParams]
        : undefined;
  if (params !== undefined) {
    out.params = params;
    const argv = defaultParamArgv(params);
    if (argv.length > 0) out.args = argv;
  } else if (taken?.args !== undefined) {
    out.args = taken.args;
  }
  return out;
}

/**
 * The engine list with the catalog entries first, and whether it differs from
 * `stored`. Rules:
 *
 * 1. The result starts with one entry per catalog entry, in catalog order.
 * 2. Each stored entry, in stored order: its `id` is a catalog `engineId`, it
 *    is merged into that catalog entry; otherwise `basename(binary)` (`.exe`
 *    removed, lower case) equals a catalog `binary` whose entry has not taken
 *    a stored entry yet, it is merged there; otherwise it is appended after
 *    the catalog entries as a hand-added engine, unchanged.
 * 3. Merging keeps the stored `params`, `model` and `helperModel`, and keeps
 *    the stored `binary` when it is an absolute path; the `id` and `name` are
 *    the catalog's. A stored entry with no `params` field gets the catalog
 *    entry's `seedParams` when they are non-empty (M10.3). `args` is then
 *    derived from `params` (the arguments of the parameters ticked by
 *    default), or, when there is no `params`, kept from the stored entry.
 * 4. `changed` is true when the result, written as JSON, differs from
 *    `stored` written as JSON.
 */
export function mergeEnginesWithCatalog(stored: readonly EngineEntry[]): {
  engines: EngineEntry[];
  changed: boolean;
} {
  const slots: Slot[] = ENGINE_CATALOG.map((entry) => ({ entry, taken: null }));
  const handAdded: EngineEntry[] = [];

  for (const item of stored) {
    const byId = slots.find((slot) => slot.entry.engineId === item.id);
    if (byId !== undefined) {
      byId.taken = item;
      continue;
    }
    const key = binaryKey(item.binary);
    const byBinary = slots.find(
      (slot) => slot.taken === null && binaryKey(slot.entry.binary) === key,
    );
    if (byBinary !== undefined) {
      byBinary.taken = item;
      continue;
    }
    handAdded.push(item);
  }

  const engines = [...slots.map(mergedEntry), ...handAdded];
  const changed = JSON.stringify(engines) !== JSON.stringify(stored);
  return { engines, changed };
}
