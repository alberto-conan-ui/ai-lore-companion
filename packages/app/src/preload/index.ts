import { contextBridge, ipcRenderer } from 'electron';
import type { EngineEntry } from '@ai-lore-companion/core';
import {
  type BrowserStatePayload,
  type ChainPayload,
  type ChangesPayload,
  type CockpitApi,
  type CommitListPayload,
  IPC,
  type SettingsSnapshot,
  type Shortcut,
  type ShortcutTerminalPayload,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type TerminalStatusPayload,
  type TreeInitPayload,
  type TreeUpdatePayload,
  type WindowInitPayload,
} from '../shared/ipc.js';

function makeVoidSubscribe(channel: string) {
  return (handler: () => void) => {
    const listener = (): void => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

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
  onChanges: makeSubscribe<ChangesPayload>(IPC.Changes),
  onCommitList: makeSubscribe<CommitListPayload>(IPC.CommitList),
  setBaseline: (arg) => ipcRenderer.invoke(IPC.SetBaseline, arg),
  diffText: (arg) => ipcRenderer.invoke(IPC.DiffText, arg),
  onTreeInit: makeSubscribe<TreeInitPayload>(IPC.TreeInit),
  onTreeUpdate: makeSubscribe<TreeUpdatePayload>(IPC.TreeUpdate),
  openPath: (path) => ipcRenderer.invoke(IPC.OpenPath, path),
  revealInFinder: (path) => ipcRenderer.send(IPC.RevealInFinder, path),
  treeExpand: (arg) => ipcRenderer.invoke(IPC.TreeExpand, arg),
  searchFiles: (arg) => ipcRenderer.invoke(IPC.FileSearch, arg),
  openProject: (path) => ipcRenderer.invoke(IPC.OpenProject, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.OpenExternal, url),
  reload: () => ipcRenderer.invoke(IPC.Reload),
  spawnTerminal: () => ipcRenderer.invoke(IPC.TerminalSpawn),
  spawnTerminalEngine: (arg) => ipcRenderer.invoke(IPC.TerminalSpawnEngine, arg),
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
  onOpenTerminalShortcut: makeSubscribe<ShortcutTerminalPayload>(IPC.ShortcutOpenTerminal),
  settingsGet: () => ipcRenderer.invoke(IPC.SettingsGet),
  settingsSet: (arg) => ipcRenderer.invoke(IPC.SettingsSet, arg),
  settingsSetIgnores: (arg) => ipcRenderer.invoke(IPC.SettingsSetIgnores, arg),
  onSettingsChanged: makeSubscribe<SettingsSnapshot>(IPC.SettingsChanged),
  onSettingsOpen: makeSubscribe<void>(IPC.SettingsOpen),
  onSelectCockpitTab: makeSubscribe<number>(IPC.SelectCockpitTab),
  onFocusGlobalSearch: makeSubscribe<void>(IPC.FocusGlobalSearch),
  setRegister: (arg) => ipcRenderer.invoke(IPC.SetRegister, arg),
  focusRead: (arg) => ipcRenderer.invoke(IPC.FocusRead, arg),
  openDiff: (arg) => ipcRenderer.invoke(IPC.OpenDiff, arg),
  appsSave: (apps) => ipcRenderer.invoke(IPC.AppsSave, apps),
  appsInvoke: (arg) => ipcRenderer.invoke(IPC.AppsInvoke, arg),
  enginesList: () => ipcRenderer.invoke(IPC.EnginesList),
  enginesSave: (engines) => ipcRenderer.invoke(IPC.EnginesSave, engines),
  onEnginesChanged: makeSubscribe<EngineEntry[]>(IPC.EnginesChanged),
  engineLastGet: () => ipcRenderer.invoke(IPC.EngineLastGet),
  engineLastSet: (engineId) => ipcRenderer.invoke(IPC.EngineLastSet, engineId),
  aiPromptsWidthGet: () => ipcRenderer.invoke(IPC.AiPromptsWidthGet),
  aiPromptsWidthSet: (width) => ipcRenderer.invoke(IPC.AiPromptsWidthSet, width),
  promptsList: () => ipcRenderer.invoke(IPC.PromptsList),
  onPromptsChanged: makeVoidSubscribe(IPC.PromptsChanged),
};

contextBridge.exposeInMainWorld('cockpit', api);
