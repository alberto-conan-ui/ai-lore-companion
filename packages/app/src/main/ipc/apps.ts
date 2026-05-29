import { parseAppEntries } from '@ai-lore-companion/core';
import type { AppsInvokeArg, AppsInvokeResult } from '../../shared/ipc.js';
import { loadGlobalSettings, saveGlobalApps } from '../settings.js';
import { spawnDetached } from '../spawn-detached.js';
import type { RegisterModule } from './types.js';

/** The Apps catalog — save the list, invoke an app on a path. */
export const registerApps: RegisterModule = (reg, deps) => {
  reg.handle('appsSave', (event, apps) => {
    saveGlobalApps(deps.getUserDataDir(), parseAppEntries(apps));
    deps.broadcastSettings();
    return deps.settingsSnapshot(deps.contextFor(event));
  });

  reg.handle('appsInvoke', (_event, arg: AppsInvokeArg): AppsInvokeResult => {
    const apps = loadGlobalSettings(deps.getUserDataDir()).apps ?? [];
    const app = apps.find((a) => a.id === arg.appId);
    if (!app) return { kind: 'not-found' };
    if (app.kind === 'app') {
      if (!app.appPath) return { kind: 'failed', message: 'app entry missing appPath' };
      // `open -a` is the canonical macOS way to target a specific app; the
      // path argument is passed as argv, never shell-interpolated.
      return spawnDetached('open', ['-a', app.appPath, arg.path]);
    }
    // kind === 'cli'
    if (!app.cliPath || !app.argvTemplate) {
      return { kind: 'failed', message: 'cli entry missing cliPath or argvTemplate' };
    }
    // Single-path template — `{path}` is the one placeholder for non-diff
    // CLIs. Diff entries do not come through this path.
    const argv = app.argvTemplate
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => (t === '{path}' ? arg.path : t));
    return spawnDetached(app.cliPath, argv);
  });
};
