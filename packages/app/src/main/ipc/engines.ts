import { isChainError, parseEngineEntries } from '@ai-lore-companion/core';
import {
  loadEngines,
  loadLastEngine,
  loadPromptsColumnWidth,
  saveEngines,
  saveLastEngine,
  savePromptsColumnWidth,
} from '../engines.js';
import { readPrompts } from '../prompts.js';
import type { RegisterModule } from './types.js';

/** AI engines catalog, per-project last-engine + prompts-width, prompts list. */
export const registerEngines: RegisterModule = (reg, deps) => {
  reg.handle('enginesList', () => loadEngines(deps.getUserDataDir()));

  reg.handle('enginesSave', (_event, engines) => {
    const parsed = parseEngineEntries(engines);
    saveEngines(deps.getUserDataDir(), parsed);
    const list = loadEngines(deps.getUserDataDir());
    deps.broadcastEngines(list);
    return list;
  });

  reg.handle('engineLastGet', (event) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return null;
    return loadLastEngine(deps.getUserDataDir(), ctx.root);
  });

  reg.handle('engineLastSet', (event, engineId) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return;
    if (typeof engineId !== 'string' || engineId.length === 0) return;
    saveLastEngine(deps.getUserDataDir(), ctx.root, engineId);
  });

  reg.handle('aiPromptsWidthGet', (event) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return null;
    return loadPromptsColumnWidth(deps.getUserDataDir(), ctx.root);
  });

  reg.handle('aiPromptsWidthSet', (event, width) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return;
    if (typeof width !== 'number' || !Number.isFinite(width)) return;
    savePromptsColumnWidth(deps.getUserDataDir(), ctx.root, width);
  });

  reg.handle('promptsList', (event) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return [];
    return readPrompts(ctx.chain.lorePath);
  });
};
