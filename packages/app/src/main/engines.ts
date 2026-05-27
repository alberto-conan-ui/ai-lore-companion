/**
 * Engines registry — global sidecar `engines.json` under userData.
 *
 * Sibling to `shortcuts.json` / `apps:` in `settings.json`, not part of either —
 * engines are PTY hosts (long-running, interactive), distinct from the Apps
 * catalog (one-shot openers). Format:
 *
 *   {
 *     "engines": EngineEntry[],
 *     "removedDefaults": string[]
 *   }
 *
 * On every load the store is augmented with any default engine whose id was
 * never user-removed and whose binary resolves on the user's PATH (`which`).
 * That mirrors `shortcuts.ts` — a fresh install gets `claude` + `gemini`
 * automatically, and a user who removes one is recorded so the seed doesn't
 * respawn on next launch.
 *
 * Per-project state — which engine was last picked in this project — lives
 * separately in `projectDataDir/engine-state.json`, not on the entries.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type EngineEntry, dedupEngines, parseEngineEntries } from '@ai-lore-companion/core';
import { projectDataDir } from './db-path.js';

type StoreFile = { engines: EngineEntry[]; removedDefaults: string[] };

/** Default engines back-filled when their binary resolves on PATH. Ids are
 *  stable so removal is idempotent across sessions. */
const DEFAULT_ENGINES: readonly EngineEntry[] = [
  { id: 'default.claude', name: 'Claude', binary: 'claude' },
  { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
];

function enginesFile(userDataDir: string): string {
  return join(userDataDir, 'engines.json');
}

function readStore(userDataDir: string): StoreFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(enginesFile(userDataDir), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return { engines: [], removedDefaults: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const engines = parseEngineEntries(obj.engines);
    const removedDefaults = Array.isArray(obj.removedDefaults)
      ? obj.removedDefaults.filter((x): x is string => typeof x === 'string')
      : [];
    return { engines, removedDefaults };
  } catch {
    return { engines: [], removedDefaults: [] };
  }
}

function writeStore(userDataDir: string, store: StoreFile): void {
  const file = enginesFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2));
}

/** Bin directories often missing from a Finder-launched .app's PATH —
 *  mirror of `spawn-detached.ts`'s `EXTRA_PATH_DIRS` so the `which` probe
 *  sees what a real login shell would. */
const EXTRA_PATH_DIRS = ['/usr/local/bin', '/opt/homebrew/bin'];

function augmentedPath(): string {
  const current = process.env.PATH ?? '';
  const segments = current.split(':').filter((s) => s.length > 0);
  const present = new Set(segments);
  const missing = EXTRA_PATH_DIRS.filter((p) => !present.has(p));
  return missing.length ? [...missing, ...segments].join(':') : current;
}

/** True when `binary` resolves on the (augmented) PATH, or is an existing
 *  absolute path. Used only for default-engine seeding — actual spawning
 *  re-resolves at launch through `zsh -l`. */
function binaryResolves(binary: string): boolean {
  try {
    execFileSync('which', [binary], {
      env: { ...process.env, PATH: augmentedPath() },
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** Back-fill any default whose id is absent, was never removed, and whose
 *  binary resolves on PATH. A user-added engine with the same binary is
 *  treated as a hit so a fresh seed does not duplicate. */
function withDefaults(store: StoreFile): StoreFile {
  const have = new Set(store.engines.map((e) => e.id));
  const removed = new Set(store.removedDefaults);
  const binaries = new Set(store.engines.map((e) => e.binary));
  const toAdd: EngineEntry[] = [];
  for (const d of DEFAULT_ENGINES) {
    if (have.has(d.id) || removed.has(d.id) || binaries.has(d.binary)) continue;
    if (!binaryResolves(d.binary)) continue;
    toAdd.push(d);
  }
  if (toAdd.length === 0) return store;
  return { ...store, engines: [...store.engines, ...toAdd] };
}

/** Read the engine list, back-filling resolvable defaults. */
export function loadEngines(userDataDir: string): EngineEntry[] {
  return dedupEngines(withDefaults(readStore(userDataDir)).engines);
}

/** Replace the engine list. Any default whose id has disappeared is recorded
 *  in `removedDefaults` so it does not respawn on next load. */
export function saveEngines(userDataDir: string, list: readonly EngineEntry[]): void {
  const prev = readStore(userDataDir);
  const newIds = new Set(list.map((e) => e.id));
  const removedDefaults = new Set(prev.removedDefaults);
  for (const d of DEFAULT_ENGINES) {
    if (!newIds.has(d.id)) removedDefaults.add(d.id);
  }
  writeStore(userDataDir, { engines: [...list], removedDefaults: [...removedDefaults] });
}

// --- Per-project AI-tab state ----------------------------------------------

/**
 * Per-project state for AI tabs — survives across launches. Sidecar to
 * `cockpit.sqlite`, lives next to the project's data folder. Both fields are
 * optional so missing values fall through to the caller's defaults.
 */
type AiStateFile = {
  /** The engine id last picked in this project (Phase B). */
  lastPicked?: string;
  /** The prompts column's width in px in this project's running AI tabs (Phase C). */
  promptsColumnWidth?: number;
};

function engineStatePath(userDataDir: string, projectRoot: string): string {
  return resolve(projectDataDir(userDataDir, projectRoot), 'engine-state.json');
}

function readAiState(userDataDir: string, projectRoot: string): AiStateFile {
  try {
    const raw = readFileSync(engineStatePath(userDataDir, projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: AiStateFile = {};
    if (typeof parsed.lastPicked === 'string' && parsed.lastPicked.length > 0) {
      out.lastPicked = parsed.lastPicked;
    }
    if (typeof parsed.promptsColumnWidth === 'number' && Number.isFinite(parsed.promptsColumnWidth)) {
      out.promptsColumnWidth = parsed.promptsColumnWidth;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAiState(userDataDir: string, projectRoot: string, next: AiStateFile): void {
  const file = engineStatePath(userDataDir, projectRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2));
}

/** The id of the engine last picked in this project, or `null` if none. */
export function loadLastEngine(userDataDir: string, projectRoot: string): string | null {
  return readAiState(userDataDir, projectRoot).lastPicked ?? null;
}

/** Persist the engine the user just picked in this project. */
export function saveLastEngine(
  userDataDir: string,
  projectRoot: string,
  engineId: string,
): void {
  const prev = readAiState(userDataDir, projectRoot);
  writeAiState(userDataDir, projectRoot, { ...prev, lastPicked: engineId });
}

/** The prompts column's width for this project's AI tabs (Phase C), or null
 *  when none persisted yet — the caller applies its default. */
export function loadPromptsColumnWidth(
  userDataDir: string,
  projectRoot: string,
): number | null {
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
