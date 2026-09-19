/**
 * Engines registry — global sidecar `engines.json` under userData.
 *
 * Sibling to `shortcuts.json` / `apps:` in `settings.json`, not part of either —
 * engines are PTY hosts (long-running, interactive), distinct from the Apps
 * catalog (one-shot openers). Format: `{ "engines": EngineEntry[] }`.
 *
 * Phase M9.4: the store is no longer seeded from what resolves on PATH.
 * Every load and save merges the stored list with core's engine catalog
 * (`mergeEnginesWithCatalog`, phase M9.3), which always puts the four catalog
 * engines first — a catalog entry cannot be removed, only kept out of date on
 * disk until the next load or save writes it back. The v0.8 `removedDefaults`
 * field (which recorded a catalog engine the Human Lead had removed) is
 * dropped on the first load, since a catalog entry can no longer be removed.
 *
 * Per-project state — which engine was last picked in this project — lives
 * separately in `projectDataDir/engine-state.json`, not on the entries.
 */

import { join, resolve } from 'node:path';
import {
  type EngineEntry,
  mergeEnginesWithCatalog,
  parseEngineEntries,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import { readJsonFile, writeJsonFileAtomic } from './json-file.js';
import { projectDataDir } from './project-data.js';

function enginesFilePath(userDataDir: string): string {
  return join(userDataDir, 'engines.json');
}

/** The `engines` array of the raw file, and whether the file (if any) still
 *  carries the v0.8 `removedDefaults` field. */
function readEnginesFile(userDataDir: string): {
  stored: EngineEntry[];
  hasRemovedDefaults: boolean;
} {
  const raw = readJsonFile(enginesFilePath(userDataDir));
  if (typeof raw !== 'object' || raw === null) return { stored: [], hasRemovedDefaults: false };
  const obj = raw as Record<string, unknown>;
  return {
    stored: parseEngineEntries(obj.engines),
    hasRemovedDefaults: 'removedDefaults' in obj,
  };
}

/**
 * Read the engine list: the catalog engines first, merged once with the
 * Human Lead's stored list (`mergeEnginesWithCatalog`). When the merge
 * differs from what was stored, or the file still carries a v0.8
 * `removedDefaults` field, the merged list is written back — dropping
 * `removedDefaults` — so a later load does not merge again.
 */
export function loadEngines(userDataDir: string): EngineEntry[] {
  const { stored, hasRemovedDefaults } = readEnginesFile(userDataDir);
  const { engines, changed } = mergeEnginesWithCatalog(stored);
  if (changed || hasRemovedDefaults) {
    writeJsonFileAtomic(enginesFilePath(userDataDir), { engines }, { pretty: true });
  }
  return engines;
}

/** Replace the engine list. `mergeEnginesWithCatalog` puts the catalog
 *  engines first, so a catalog entry missing from `list` comes back. */
export function saveEngines(userDataDir: string, list: readonly EngineEntry[]): void {
  const { engines } = mergeEnginesWithCatalog(list);
  writeJsonFileAtomic(enginesFilePath(userDataDir), { engines }, { pretty: true });
}

// --- Per-project AI-tab state ----------------------------------------------

/**
 * Per-project state for AI tabs — survives across launches. A flat-JSON
 * sidecar in the project's data folder. Both fields are optional so missing
 * values fall through to the caller's defaults.
 */
const aiStateSchema = z.object({
  /** The engine id last picked in this project (Phase B). */
  lastPicked: z.string().min(1).optional().catch(undefined),
  /** The prompts column's width in px in this project's running AI tabs (Phase C). */
  promptsColumnWidth: z.number().finite().optional().catch(undefined),
  /** The engine id this project's read-only **assistant** uses (AI Helper, CR7)
   *  — chosen in the Assistant panel dropdown, separate from `lastPicked` (the
   *  user's own AI tab). Unset → the helper falls back to Claude. */
  helperEngine: z.string().min(1).optional().catch(undefined),
});
type AiStateFile = z.infer<typeof aiStateSchema>;

function engineStatePath(userDataDir: string, projectRoot: string): string {
  return resolve(projectDataDir(userDataDir, projectRoot), 'engine-state.json');
}

/** Field-tolerant read: a malformed field falls back to unset (the per-field
 *  `catch`), a malformed file reads as empty. */
function readAiState(userDataDir: string, projectRoot: string): AiStateFile {
  const parsed = aiStateSchema.safeParse(readJsonFile(engineStatePath(userDataDir, projectRoot)));
  return parsed.success ? parsed.data : {};
}

function writeAiState(userDataDir: string, projectRoot: string, next: AiStateFile): void {
  writeJsonFileAtomic(engineStatePath(userDataDir, projectRoot), next, { pretty: true });
}

/** The id of the engine last picked in this project, or `null` if none. */
export function loadLastEngine(userDataDir: string, projectRoot: string): string | null {
  return readAiState(userDataDir, projectRoot).lastPicked ?? null;
}

/** Persist the engine the user just picked in this project. */
export function saveLastEngine(userDataDir: string, projectRoot: string, engineId: string): void {
  const prev = readAiState(userDataDir, projectRoot);
  writeAiState(userDataDir, projectRoot, { ...prev, lastPicked: engineId });
}

/** The prompts column's width for this project's AI tabs (Phase C), or null
 *  when none persisted yet — the caller applies its default. */
export function loadPromptsColumnWidth(userDataDir: string, projectRoot: string): number | null {
  return readAiState(userDataDir, projectRoot).promptsColumnWidth ?? null;
}

/** Persist the prompts column width after the user finishes a drag. */
export function savePromptsColumnWidth(
  userDataDir: string,
  projectRoot: string,
  width: number,
): void {
  const prev = readAiState(userDataDir, projectRoot);
  writeAiState(userDataDir, projectRoot, { ...prev, promptsColumnWidth: width });
}

/** The engine id this project's assistant (helper) uses, or `null` when unset
 *  — the caller falls back to Claude (AI Helper, CR7). */
export function loadHelperEngine(userDataDir: string, projectRoot: string): string | null {
  return readAiState(userDataDir, projectRoot).helperEngine ?? null;
}

/** Persist the assistant engine the user picked for this project. */
export function saveHelperEngine(userDataDir: string, projectRoot: string, engineId: string): void {
  const prev = readAiState(userDataDir, projectRoot);
  writeAiState(userDataDir, projectRoot, { ...prev, helperEngine: engineId });
}
