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

  reg.handle('openExternal', (_event, url) => shell.openExternal(url));
};
