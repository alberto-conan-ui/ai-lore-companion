import type { IpcMain } from 'electron';
import { registerApps } from './apps.js';
import { registerBrowser } from './browser.js';
import { registerChanges } from './changes.js';
import { registerEngines } from './engines.js';
import { registerHelper } from './helper.js';
import { registerProject } from './project.js';
import { makeRegistrar } from './registrar.js';
import { registerSettings } from './settings.js';
import { registerShortcuts } from './shortcuts.js';
import { registerTerminal } from './terminal.js';
import { registerTree } from './tree.js';
import type { Deps, RegisterModule } from './types.js';

export type { Deps, ProjectContext, Wiring } from './types.js';

/**
 * Every feature module that registers IPC handlers. `registerCockpitIpc`
 * iterates this list — adding a feature is one entry here, not a new block in
 * a 400-line god-function.
 */
const MODULES: readonly RegisterModule[] = [
  registerTree,
  registerProject,
  registerTerminal,
  registerBrowser,
  registerShortcuts,
  registerSettings,
  registerChanges,
  registerApps,
  registerEngines,
  registerHelper,
];

/** Wire every cockpit IPC handler onto `ipcMain`, resolving channels off the contract. */
export function registerCockpitIpc(ipcMain: IpcMain, deps: Deps): void {
  const reg = makeRegistrar(ipcMain);
  for (const register of MODULES) register(reg, deps);
}
