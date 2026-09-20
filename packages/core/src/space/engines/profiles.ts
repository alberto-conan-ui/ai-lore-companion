/**
 * The profile shape (M14.1): a named profile — an engine, a model, and the
 * parameters a session can start with. In 1.0 there is one profile per
 * engine, and a profile is the engine entry of `engines.json` read as one.
 * `EngineEntry` survives, unchanged, as the stored shape; `Profile` is what
 * that entry is read as.
 *
 * A profile's id is the id its engine already has in `engines.json`. Nothing
 * already stored is migrated (`profile-shape-architecture.md` 3.2).
 */

import { basename } from 'node:path';
import { defaultParamArgv } from '../../engines/index.js';
import type { EngineEntry, EngineParam } from '../../engines/index.js';
import { type EngineCatalogId, catalogEntryFor } from './catalog.js';

/**
 * A named profile: an engine, a model, and the parameters a session can start
 * with. In 1.0 there is one profile per engine, and it is the engine entry of
 * `engines.json` read as a profile.
 */
export type Profile = {
  /** Stable identifier. It is the `id` of the entry in `engines.json` (section 3.2). */
  id: string;
  /** Display name. */
  name: string;
  /** The engine the profile runs: a catalog id, or `null` for a hand-added engine. */
  engine: EngineCatalogId | null;
  /** The binary: an absolute path, or a bare name resolved on PATH at spawn. */
  binary: string;
  /**
   * The model the profile runs, in the engine's own naming (Claude: `opus`;
   * Gemini: `gemini-2.5-flash`). Absent: the engine's own default.
   */
  model?: string;
  /** The parameters, in order. Empty when the profile has none. */
  params: EngineParam[];
};

/** The profile an engine entry is read as. */
export function profileOf(entry: EngineEntry): Profile {
  const profile: Profile = {
    id: entry.id,
    name: entry.name,
    engine: catalogEntryFor(entry)?.catalogId ?? null,
    binary: entry.binary,
    params: entry.params ?? [],
  };
  if (entry.model !== undefined) profile.model = entry.model;
  return profile;
}

/** The engine entry a profile is stored as. `args` is derived as `parseEngineEntry` derives it. */
export function entryOf(profile: Profile): EngineEntry {
  const entry: EngineEntry = {
    id: profile.id,
    name: profile.name,
    binary: profile.binary,
  };
  if (profile.params.length > 0) {
    entry.params = profile.params;
    const argv = defaultParamArgv(profile.params);
    if (argv.length > 0) entry.args = argv;
  }
  if (profile.model !== undefined) {
    entry.model = profile.model;
    entry.helperModel = profile.model;
  }
  return entry;
}

/** The profile of `id` in `profiles`, or `null`. */
export function profileById(profiles: readonly Profile[], id: string): Profile | null {
  return profiles.find((profile) => profile.id === id) ?? null;
}

/**
 * How the profile's engine is named in a stored record: its catalog id, or,
 * for a hand-added engine, the file name of its binary in lower case with
 * `.exe` removed (the same key `merge.ts` matches binaries by).
 */
export function engineNameOf(profile: Profile): string {
  if (profile.engine !== null) return profile.engine;
  return basename(profile.binary)
    .replace(/\.exe$/i, '')
    .toLowerCase();
}
