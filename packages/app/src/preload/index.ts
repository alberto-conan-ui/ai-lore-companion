import { contextBridge, ipcRenderer } from 'electron';
import {
  type BrowserStatePayload,
  type ChainPayload,
  type ChangePayload,
  type CockpitApi,
  IPC,
  type RestorePayload,
  type SettingsSnapshot,
  type Shortcut,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type TerminalStatusPayload,
  type TreeInitPayload,
  type TreeUpdatePayload,
  type WindowInitPayload,
} from '../shared/ipc.js';

function makeSubscribe<T>(channel: string) {
  return (handler: (payload: T) => void) => {
    const listener = (_event: unknown, payload: T): void => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: CockpitApi = {
  onWindowInit: makeSubscribe<WindowInitPayload>(IPC.WindowInit),
  onChain: makeSubscribe<ChainPayload>(IPC.Chain),
  onRestore: makeSubscribe<RestorePayload>(IPC.Restore),
  onChange: makeSubscribe<ChangePayload>(IPC.Change),
  onTreeInit: makeSubscribe<TreeInitPayload>(IPC.TreeInit),
  onTreeUpdate: makeSubscribe<TreeUpdatePayload>(IPC.TreeUpdate),
  ack: (id) => ipcRenderer.invoke(IPC.Ack, id),
  ackAll: () => ipcRenderer.invoke(IPC.AckAll),
  ackAllScope: (scope) => ipcRenderer.invoke(IPC.AckAllScope, scope),
  openPath: (path) => ipcRenderer.invoke(IPC.OpenPath, path),
  treeExpand: (arg) => ipcRenderer.invoke(IPC.TreeExpand, arg),
  searchFiles: (arg) => ipcRenderer.invoke(IPC.FileSearch, arg),
  openProject: (path) => ipcRenderer.invoke(IPC.OpenProject, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.OpenExternal, url),
  reload: () => ipcRenderer.invoke(IPC.Reload),
  spawnTerminal: () => ipcRenderer.invoke(IPC.TerminalSpawn),
  sendTerminalInput: (arg) => ipcRenderer.send(IPC.TerminalInput, arg),
  resizeTerminal: (arg) => ipcRenderer.send(IPC.TerminalResize, arg),
  killTerminal: (id) => ipcRenderer.send(IPC.TerminalKill, id),
  onTerminalData: makeSubscribe<TerminalDataPayload>(IPC.TerminalData),
  onTerminalExit: makeSubscribe<TerminalExitPayload>(IPC.TerminalExit),
  onTerminalStatus: makeSubscribe<TerminalStatusPayload>(IPC.TerminalStatus),
  browserCreate: (tabId, initialUrl) => ipcRenderer.send(IPC.BrowserCreate, { tabId, initialUrl }),
  browserDestroy: (tabId) => ipcRenderer.send(IPC.BrowserDestroy, tabId),
  browserGetUrl: (tabId) => ipcRenderer.invoke(IPC.BrowserGetUrl, tabId),
  browserSetVisible: (tabId, visible) =>
    ipcRenderer.send(IPC.BrowserSetVisible, { tabId, visible }),
  browserSetBounds: (tabId, bounds) => ipcRenderer.send(IPC.BrowserSetBounds, { tabId, bounds }),
  browserNavigate: (tabId, url) => ipcRenderer.send(IPC.BrowserNavigate, { tabId, url }),
  browserGoBack: (tabId) => ipcRenderer.send(IPC.BrowserGoBack, tabId),
  browserGoForward: (tabId) => ipcRenderer.send(IPC.BrowserGoForward, tabId),
  browserReload: (tabId) => ipcRenderer.send(IPC.BrowserReload, tabId),
  browserSetProfile: (tabId, profile) =>
    ipcRenderer.send(IPC.BrowserSetProfile, { tabId, profile }),
  browserSuppressAll: (suppress) => ipcRenderer.send(IPC.BrowserSuppressAll, suppress),
  onBrowserState: makeSubscribe<BrowserStatePayload>(IPC.BrowserState),
  shortcutsList: () => ipcRenderer.invoke(IPC.ShortcutsList),
  shortcutsRun: (id) => ipcRenderer.send(IPC.ShortcutsRun, id),
  shortcutsPickApp: () => ipcRenderer.invoke(IPC.ShortcutsPickApp),
  shortcutsAdd: (input) => ipcRenderer.invoke(IPC.ShortcutsAdd, input),
  shortcutsRemove: (id) => ipcRenderer.invoke(IPC.ShortcutsRemove, id),
  onShortcutsChanged: makeSubscribe<Shortcut[]>(IPC.ShortcutsChanged),
  settingsGet: () => ipcRenderer.invoke(IPC.SettingsGet),
  settingsSet: (arg) => ipcRenderer.invoke(IPC.SettingsSet, arg),
  settingsSetIgnores: (arg) => ipcRenderer.invoke(IPC.SettingsSetIgnores, arg),
  settingsSetLayout: (arg) => ipcRenderer.invoke(IPC.SettingsSetLayout, arg),
  onSettingsChanged: makeSubscribe<SettingsSnapshot>(IPC.SettingsChanged),
};

contextBridge.exposeInMainWorld('cockpit', api);
