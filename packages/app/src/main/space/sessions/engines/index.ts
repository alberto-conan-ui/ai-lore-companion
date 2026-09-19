/**
 * The engine adapters (phase M10.5, `m10-architecture.md` 3.2): one per
 * catalog engine, plus Claude Code for a hand-added entry.
 *
 * `optionsFor` moved here from `engine-options.ts` (a fallback this phase's
 * specification allows): an adapter file imports its engine's `EngineOptions`
 * constant from `engine-options.ts` as a value used at module load time, so
 * `engine-options.ts` cannot also import `adapterFor` from here — that would
 * be a circular ES module dependency, and the constant a `claude-code.ts`-like
 * file reads would still be in its temporal dead zone the first time the cycle
 * is entered. Keeping `optionsFor` here, where it can depend on every adapter
 * file, avoids the cycle.
 */

import { type EngineEntry, catalogEntryFor, isClaudeEngine } from '@ai-lore-companion/core';
import type { EngineOptions } from '../engine-options.js';
import { antigravityAdapter } from './antigravity.js';
import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import type { EngineAdapter } from './types.js';

const ADAPTERS: Record<EngineAdapter['catalogId'], EngineAdapter> = {
  'claude-code': claudeCodeAdapter,
  antigravity: antigravityAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
};

/**
 * The adapter of `engine`: by its catalog id, or the Claude Code adapter for a
 * hand-added Claude Code (`isClaudeEngine`); `null` for any other engine.
 */
export function adapterFor(engine: EngineEntry): EngineAdapter | null {
  const catalog = catalogEntryFor(engine);
  if (catalog !== null) return ADAPTERS[catalog.catalogId];
  if (isClaudeEngine(engine)) return claudeCodeAdapter;
  return null;
}

/**
 * The options of `engine` (M10.3, `m10-architecture.md` 3.5), moved here in
 * M10.5: `adapterFor(engine)?.options ?? null`.
 */
export function optionsFor(engine: EngineEntry): EngineOptions | null {
  return adapterFor(engine)?.options ?? null;
}
