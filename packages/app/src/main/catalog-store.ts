/**
 * Catalog sidecar store — the generic JSON-file store every user-curated
 * catalog shares (engines, app-launch shortcuts). Each lives in its own
 * `<userData>/<name>.json` as `{ <field>: T[], removedDefaults: string[] }`,
 * back-fills a set of default entries on load, and records a removed default
 * so the seed does not respawn.
 *
 * Before this module `engines.ts` and `shortcuts.ts` carried byte-for-byte
 * the same read / write / back-fill / save loops, differing only in the
 * per-catalog facts a `CatalogStoreSpec` now captures: the file name and
 * array field, how to parse an entry, the entry id, the default seed, and a
 * few optional predicates (when a default is already satisfied, whether it
 * can be seeded at all, an optional load-time dedup, legacy-array tolerance).
 *
 * A new sidecar catalog is then one spec, not a cloned vertical stack —
 * the gate of the Composable Core's catalog contract.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The on-disk shape: the entry array under a named field, plus the ids of
 *  defaults the user has removed (so they don't respawn). */
type StoreFile<T> = { entries: T[]; removedDefaults: string[] };

/** The per-catalog facts the generic store needs. */
export type CatalogStoreSpec<T> = {
  /** Sidecar file name under userData, e.g. `engines.json`. */
  fileName: string;
  /** The JSON field holding the entry array, e.g. `engines` / `shortcuts`. */
  field: string;
  /** Coerce a raw value into a clean entry list, dropping malformed elements. */
  parse: (raw: unknown) => T[];
  /** Stable id of an entry — keys back-fill and removal. */
  idOf: (entry: T) => string;
  /** Default entries back-filled when absent and never user-removed. */
  defaults: readonly T[];
  /**
   * Optional: a default is *already satisfied* by an existing entry beyond the
   * id check (e.g. a user engine with the same binary, or a shortcut with the
   * same target+app) — so the seed does not duplicate it.
   */
  isSatisfiedBy?: (def: T, entries: readonly T[]) => boolean;
  /**
   * Optional gate on whether a default may be seeded at all — e.g. its binary
   * resolves on PATH. Defaults that fail are simply not added (and not
   * recorded as removed).
   */
  canSeed?: (def: T) => boolean;
  /** Optional load-time de-duplication of the resolved list. */
  dedup?: (entries: readonly T[]) => T[];
  /** When true, a top-level JSON array is accepted as the legacy file shape. */
  legacyArray?: boolean;
};

function filePath<T>(spec: CatalogStoreSpec<T>, userDataDir: string): string {
  return join(userDataDir, spec.fileName);
}

/** Read + parse the store file, tolerant of a missing/corrupt file. */
function readStore<T>(spec: CatalogStoreSpec<T>, userDataDir: string): StoreFile<T> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath(spec, userDataDir), 'utf8'));
    if (spec.legacyArray && Array.isArray(parsed)) {
      return { entries: spec.parse(parsed), removedDefaults: [] };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { entries: [], removedDefaults: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const entries = spec.parse(obj[spec.field]);
    const removedDefaults = Array.isArray(obj.removedDefaults)
      ? obj.removedDefaults.filter((x): x is string => typeof x === 'string')
      : [];
    return { entries, removedDefaults };
  } catch {
    return { entries: [], removedDefaults: [] };
  }
}

function writeStore<T>(spec: CatalogStoreSpec<T>, userDataDir: string, store: StoreFile<T>): void {
  const file = filePath(spec, userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { [spec.field]: store.entries, removedDefaults: store.removedDefaults },
      null,
      2,
    ),
  );
}

/** Back-fill any default whose id is absent, was never removed, is not already
 *  satisfied by an existing entry, and may be seeded. */
function withDefaults<T>(spec: CatalogStoreSpec<T>, store: StoreFile<T>): StoreFile<T> {
  const have = new Set(store.entries.map(spec.idOf));
  const removed = new Set(store.removedDefaults);
  const toAdd: T[] = [];
  for (const d of spec.defaults) {
    if (have.has(spec.idOf(d)) || removed.has(spec.idOf(d))) continue;
    if (spec.isSatisfiedBy?.(d, store.entries)) continue;
    if (spec.canSeed && !spec.canSeed(d)) continue;
    toAdd.push(d);
  }
  if (toAdd.length === 0) return store;
  return { ...store, entries: [...store.entries, ...toAdd] };
}

/** Load the catalog list, back-filling resolvable defaults (and de-duplicating
 *  when the spec asks for it). */
export function loadCatalog<T>(spec: CatalogStoreSpec<T>, userDataDir: string): T[] {
  const resolved = withDefaults(spec, readStore(spec, userDataDir)).entries;
  return spec.dedup ? spec.dedup(resolved) : resolved;
}

/** Replace the catalog list. Any default whose id has disappeared from `list`
 *  is recorded in `removedDefaults` so it does not respawn on the next load. */
export function saveCatalog<T>(
  spec: CatalogStoreSpec<T>,
  userDataDir: string,
  list: readonly T[],
): void {
  const prev = readStore(spec, userDataDir);
  const newIds = new Set(list.map(spec.idOf));
  const removedDefaults = new Set(prev.removedDefaults);
  for (const d of spec.defaults) {
    if (!newIds.has(spec.idOf(d))) removedDefaults.add(spec.idOf(d));
  }
  writeStore(spec, userDataDir, { entries: [...list], removedDefaults: [...removedDefaults] });
}
