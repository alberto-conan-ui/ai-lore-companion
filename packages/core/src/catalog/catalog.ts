/**
 * Catalog contract — the generic spine every user-configured list shares.
 *
 * The cockpit has several "catalogs": user-curated lists of typed entries
 * (engines, apps, app-launch shortcuts) that are parsed tolerantly from JSON,
 * validated entry-by-entry, and de-duplicated by an identity tuple. Before
 * this module each catalog hand-rolled the same array-parse loop and the same
 * dedup loop, differing only in (a) how a single entry is validated/coerced
 * and (b) what makes two entries "the same".
 *
 * A `CatalogModel<T>` captures exactly those two per-catalog facts; the
 * generic `parseEntries` / `dedupEntries` operate off it. A new catalog is
 * then one model — `{ parseEntry, identity }` — plus its registration, not a
 * cloned vertical stack.
 *
 * The companion-side sidecar store (`{ entries, removedDefaults }` with
 * defaults back-fill) builds on the same model — see the app's
 * `catalog-store.ts`.
 */

/** What a catalog needs to know about its entries: how to coerce one raw
 *  value into a clean entry (dropping unknown/malformed input), and how to
 *  key an entry for de-duplication. */
export type CatalogModel<T> = {
  /** Coerce a raw value into a clean entry, or `null` when it is not shaped
   *  like one. Callers filter the list — a malformed element is dropped, not
   *  fatal. */
  parseEntry: (raw: unknown) => T | null;
  /** A stable identity string for an entry — two entries with the same
   *  identity are duplicates. */
  identity: (entry: T) => string;
};

/** Parse an array of raw values into clean entries, dropping every element
 *  that does not parse. Non-array input yields `[]`. */
export function parseEntries<T>(model: CatalogModel<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const raw of value) {
    const parsed = model.parseEntry(raw);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** De-duplicate entries by their model identity, order-preserving — the first
 *  occurrence of each identity wins. */
export function dedupEntries<T>(model: CatalogModel<T>, entries: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = model.identity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
