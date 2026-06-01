import { normalizeUrl } from '@ai-lore-companion/core';
import { BrowserWindow, shell } from 'electron';
import type { RegisterModule } from './types.js';

/** Opening / reloading project windows and opening external URLs. */
export const registerProject: RegisterModule = (reg, deps) => {
  reg.handle('openProject', async (event, path) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    if (typeof path === 'string' && path.length > 0) {
      deps.showProject(win, path);
    } else {
      await deps.promptAndOpenProject(win);
    }
  });

  reg.handle('reload', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await deps.reloadWindow(win);
  });

  reg.handle('recentsRemove', (_event, path) => deps.removeRecent(path));

  reg.handle('openExternal', (_event, url) => shell.openExternal(url));

  // Open a shortcut URL in the external browser. Unlike `openExternal` (which
  // takes an already-valid URL — terminal links, the SDLC site), a shortcut
  // value may be a bare host like `localhost:3000`, so normalise it the same
  // way the address bar does before handing it to the OS.
  reg.on('urlOpenExternal', (_event, url) => {
    const normalized = normalizeUrl(url);
    if (normalized) void shell.openExternal(normalized);
  });
};
