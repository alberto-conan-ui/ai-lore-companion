import { randomUUID } from 'node:crypto';
import { isChainError } from '@ai-lore-companion/core';
import { BrowserWindow, type OpenDialogOptions, dialog } from 'electron';
import { CHANNELS } from '../../shared/ipc.js';
import { launchApp, launchUrl, loadShortcuts, saveShortcuts, withIcons } from '../shortcuts.js';
import type { RegisterModule } from './types.js';

/** App-launch shortcuts — list, run, pick-app dialog, add, remove. */
export const registerShortcuts: RegisterModule = (reg, deps) => {
  reg.handle('shortcutsList', () => withIcons(loadShortcuts(deps.getUserDataDir())));

  reg.on('shortcutsRun', (event, id) => {
    const shortcut = loadShortcuts(deps.getUserDataDir()).find((s) => s.id === id);
    if (!shortcut) return;
    if (shortcut.target === 'url') {
      if (shortcut.url) launchUrl(shortcut.url);
      return;
    }
    if (shortcut.target === 'terminal') {
      if (!shortcut.command) return;
      event.sender.send(CHANNELS.onOpenTerminalShortcut, {
        label: shortcut.label,
        command: shortcut.command,
      });
      return;
    }
    const ctx = deps.contextFor(event);
    if (!ctx) return;
    // "project" → the window's root; "lore" → its Lore folder, if it has one.
    const folder =
      shortcut.target === 'lore' ? (isChainError(ctx.chain) ? null : ctx.chain.lorePath) : ctx.root;
    if (folder && shortcut.app) launchApp(shortcut.app, folder);
  });

  reg.handle('shortcutsPickApp', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts: OpenDialogOptions = {
      title: 'Choose an application',
      defaultPath: '/Applications',
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  reg.handle('shortcutsAdd', (_event, input) => {
    const list = [...loadShortcuts(deps.getUserDataDir()), { id: randomUUID(), ...input }];
    saveShortcuts(deps.getUserDataDir(), list);
    deps.broadcastShortcuts(list);
    return withIcons(list);
  });

  reg.handle('shortcutsRemove', (_event, id) => {
    const list = loadShortcuts(deps.getUserDataDir()).filter((s) => s.id !== id);
    saveShortcuts(deps.getUserDataDir(), list);
    deps.broadcastShortcuts(list);
    return withIcons(list);
  });
};
