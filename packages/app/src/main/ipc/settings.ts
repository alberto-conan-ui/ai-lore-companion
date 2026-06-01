import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  SETTINGS_REGISTRY,
  isChainError,
  isIgnoreRule,
  isValidValue,
  parseMemoryFileSync,
  parseMemorySections,
  updateFrontmatterFieldInFile,
} from '@ai-lore-companion/core';
import { BrowserWindow } from 'electron';
import type {
  FocusReadArg,
  FocusReadResult,
  SetRegisterArg,
  SettingsSetArg,
  SettingsSetIgnoresArg,
  SettingsSetLayoutArg,
} from '../../shared/ipc.js';
import {
  saveGlobalIgnores,
  saveGlobalSetting,
  saveProjectIgnores,
  saveProjectLayout,
  saveProjectSetting,
} from '../settings.js';
import type { RegisterModule } from './types.js';

/** Settings store, ignore rules, the conversational register, and focus reads. */
export const registerSettings: RegisterModule = (reg, deps) => {
  reg.handle('settingsGet', (event) => deps.settingsSnapshot(deps.contextFor(event)));

  reg.handle('settingsSet', (event, arg: SettingsSetArg) => {
    const ctx = deps.contextFor(event);
    const def = SETTINGS_REGISTRY.find((d) => d.key === arg.key);
    // Reject an unknown key, a value that fails its declared type, or a
    // project-tier write from a window with no AI-Lore project.
    if (def && isValidValue(def, arg.value)) {
      if (arg.tier === 'global') {
        saveGlobalSetting(deps.getUserDataDir(), arg.key, arg.value);
        deps.broadcastSettings();
      } else if (ctx && !isChainError(ctx.chain)) {
        saveProjectSetting(deps.getUserDataDir(), ctx.root, arg.key, arg.value);
        deps.broadcastSettings();
      }
    }
    return deps.settingsSnapshot(ctx);
  });

  reg.handle('settingsSetIgnores', (event, arg: SettingsSetIgnoresArg) => {
    const ctx = deps.contextFor(event);
    const rules = arg.rules.filter(isIgnoreRule);
    if (arg.tier === 'global') {
      saveGlobalIgnores(deps.getUserDataDir(), rules);
      for (const win of BrowserWindow.getAllWindows()) deps.reapplyIgnores(win);
    } else if (ctx && !isChainError(ctx.chain)) {
      saveProjectIgnores(deps.getUserDataDir(), ctx.root, rules);
      const root = ctx.root;
      for (const win of BrowserWindow.getAllWindows()) {
        if (deps.contexts.get(win.id)?.root === root) deps.reapplyIgnores(win);
      }
    }
    deps.broadcastSettings();
    return deps.settingsSnapshot(ctx);
  });

  reg.handle('settingsSetLayout', (event, arg: SettingsSetLayoutArg) => {
    const ctx = deps.contextFor(event);
    // Layouts are per-project only — a window with no AI-Lore project has
    // nowhere to store one, so the write is a silent no-op. No broadcast:
    // the snapshot is the writing window's own state, with no other consumer.
    if (ctx && !isChainError(ctx.chain)) {
      saveProjectLayout(deps.getUserDataDir(), ctx.root, arg.layout);
    }
  });

  reg.handle('setRegister', (event, arg: SetRegisterArg) => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) return;
    const statusPath = join(ctx.chain.lorePath, 'memory/status/status.index.md');
    const dotPath = arg.field === 'posture' ? 'posture' : `dials.${arg.field}`;
    const written = updateFrontmatterFieldInFile(statusPath, dotPath, arg.value);
    if (!written) return;
    // Push the new chain immediately — the 5s poll's `lastSent` would
    // catch up eventually, but the chip should reflect the click now.
    ctx.refreshChain?.();
  });

  reg.handle('focusRead', (event, arg: FocusReadArg): FocusReadResult => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) {
      return { error: 'no project context' };
    }
    const abs = isAbsolute(arg.path) ? arg.path : resolve(ctx.root, arg.path);
    // Refuse paths that escape this window's project — the renderer should
    // never read a file outside the project's tree.
    const rel = relative(ctx.root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { error: 'path is outside the project' };
    }
    try {
      const parsed = parseMemoryFileSync(abs);
      return {
        path: abs,
        frontmatter: parsed.frontmatter,
        sections: parseMemorySections(parsed.body),
      };
    } catch (err) {
      return { error: `cannot read focus file: ${(err as Error).message}` };
    }
  });
};
