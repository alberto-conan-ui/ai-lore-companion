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
import { dirname, resolve } from 'node:path';
import { type EngineEntry, dedupEngines, parseEngineEntries } from '@ai-lore-companion/core';
import { type CatalogStoreSpec, loadCatalog, saveCatalog } from './catalog-store.js';
import { projectDataDir } from './project-data.js';

/** Default engines back-filled when their binary resolves on PATH. Ids are
 *  stable so removal is idempotent across sessions. */
const DEFAULT_ENGINES: readonly EngineEntry[] = [
  { id: 'default.claude', name: 'Claude', binary: 'claude' },
  { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
];

const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh';

/** Quote a token for safe single-line shell interpolation in the `-c`
 *  payload. Mirror of `pty.ts`'s `quoteForShell`. */
function shellQuote(token: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** True when `binary` resolves on the user's login shell PATH. Probes via
 *  `zsh -i -l -c 'command -v <binary>'` — the same PATH source the engine
 *  spawn uses in `pty.ts`. `-i` is what sources `~/.zshrc`, where most
 *  users keep their PATH additions (`$HOME/.local/bin`, where Claude
 *  installs); a Finder-launched Electron app's `process.env.PATH` is the
 *  minimal launchd default and would miss them. One source of PATH truth
 *  across seed and spawn — if the user's shell can find it, the cockpit
 *  can find it. */
function binaryResolves(binary: string): boolean {
  try {
    execFileSync(DEFAULT_SHELL, ['-i', '-l', '-c', `command -v ${shellQuote(binary)}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** The engines sidecar-store spec. A default is satisfied by any existing
 *  entry with the same binary (so a user-added `claude` blocks the seed), and
 *  is only seeded when its binary resolves on PATH. The resolved list is
 *  de-duplicated by the engine identity tuple. */
const enginesStore: CatalogStoreSpec<EngineEntry> = {
  fileName: 'engines.json',
  field: 'engines',
  parse: parseEngineEntries,
  idOf: (e) => e.id,
  defaults: DEFAULT_ENGINES,
  isSatisfiedBy: (d, entries) => entries.some((e) => e.binary === d.binary),
  canSeed: (d) => binaryResolves(d.binary),
  dedup: dedupEngines,
};

/** Read the engine list, back-filling resolvable defaults. */
export function loadEngines(userDataDir: string): EngineEntry[] {
  return loadCatalog(enginesStore, userDataDir);
}

/** Replace the engine list. Any default whose id has disappeared is recorded
 *  so it does not respawn on next load. */
export function saveEngines(userDataDir: string, list: readonly EngineEntry[]): void {
  saveCatalog(enginesStore, userDataDir, list);
}

// --- Per-project AI-tab state ----------------------------------------------

/**
 * Per-project state for AI tabs — survives across launches. A flat-JSON
 * sidecar in the project's data folder. Both fields are optional so missing
 * values fall through to the caller's defaults.
 */
type AiStateFile = {
  /** The engine id last picked in this project (Phase B). */
  lastPicked?: string;
  /** The prompts column's width in px in this project's running AI tabs (Phase C). */
  promptsColumnWidth?: number;
  /** The engine id this project's read-only **assistant** uses (AI Helper, CR7)
   *  — chosen in the Assistant panel dropdown, separate from `lastPicked` (the
   *  user's own AI tab). Unset → the helper falls back to Claude. */
  helperEngine?: string;
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
    if (
      typeof parsed.promptsColumnWidth === 'number' &&
      Number.isFinite(parsed.promptsColumnWidth)
    ) {
      out.promptsColumnWidth = parsed.promptsColumnWidth;
    }
    if (typeof parsed.helperEngine === 'string' && parsed.helperEngine.length > 0) {
      out.helperEngine = parsed.helperEngine;
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
