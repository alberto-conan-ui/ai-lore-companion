import type {
  ChainResult,
  ChangeScope,
  ChangesTracker,
  IgnoreLists,
  WatcherHandle,
} from '@ai-lore-companion/core';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { RecentProject, SettingsSnapshot, Shortcut } from '../../shared/ipc.js';
import type { PtyService } from '../pty.js';
import type { SearchService } from '../search/service.js';
import type { SpaceHost } from '../space/host.js';

/** The watcher + changes tracker a valid AI-Lore project window holds. */
export type Wiring = {
  watcher: WatcherHandle;
  changes: ChangesTracker;
  /** Re-read commits for `scope` and push CommitList to the renderer. */
  pushCommits: (scope: ChangeScope) => void;
  /** Re-read the save-point ledger and push it (the global picker's mask). */
  pushSavePoints: () => void;
  /** Re-read both repos' current branch and push it (the header's indicators). */
  pushBranches: () => void;
};

/**
 * Everything `main` holds for one project window — created when the window
 * opens, torn down when it closes. `wiring` is null when the folder is not a
 * valid AI-Lore project (a chain error); the window still gets a chain payload
 * and a terminal.
 */
export type ProjectContext = {
  root: string;
  chain: ChainResult;
  wiring: Wiring | null;
  ptyService: PtyService;
  /** The project's resolved ignore lists — drift / search / hidden patterns. */
  ignoreLists: IgnoreLists;
  /** File-name search, backed by a watcher-fed index. Production runs it in a
   *  `utilityProcess`; tests use the in-process impl. Lazily built on the first
   *  search; patched by the watcher; invalidated when ignore rules change. */
  search: SearchService;
  /** Set for a 1.0 window only. When set, the search channels search these
   *  folders and do not use the `dirs` of their argument, so the renderer of a
   *  1.0 window cannot point a search outside its folder. Unset for a cockpit
   *  window, where the channels use the argument as before. */
  searchDirs?: readonly string[];
  /** Re-read this window's chain and push it if it changed. */
  refreshChain?: () => void;
  /** Teardown for the prompts watcher (chokidar on `<lore>/process/verbs/`). */
  promptsWatcherClose?: () => Promise<void>;
};

/**
 * The shared services an `main/ipc/*` register module needs from the host
 * (`main/index.ts`). Everything else a handler touches it imports directly;
 * `Deps` carries only the window/context state and broadcasts that live in the
 * host's closure.
 */
export type Deps = {
  /** Resolve the project context for the window an IPC call came from. */
  contextFor(event: IpcMainEvent | IpcMainInvokeEvent): ProjectContext | undefined;
  /** `app.getPath('userData')`, resolved once the app is ready. */
  getUserDataDir(): string;
  /** Project context per window, keyed by `BrowserWindow.id`. */
  contexts: Map<number, ProjectContext>;
  /** Build the settings snapshot for a window (registry + resolved + tiers). */
  settingsSnapshot(ctx: ProjectContext | undefined): SettingsSnapshot;
  /** Push a fresh settings snapshot to every window. */
  broadcastSettings(): void;
  /** Push the engines list to every window. */
  broadcastEngines(list: import('@ai-lore-companion/core').EngineEntry[]): void;
  /** Push the (icon-decorated) shortcut list to every window. */
  broadcastShortcuts(list: Shortcut[]): void;
  /** Re-derive + re-apply a window's ignore rules after they changed. */
  reapplyIgnores(win: BrowserWindow): void;
  /** Route an open request — replace a welcome window or open a new one. */
  showProject(win: BrowserWindow | undefined, root: string): void;
  /** Prompt for a folder, then open it. */
  promptAndOpenProject(win: BrowserWindow | undefined): Promise<void>;
  /** Reload a window's folder — re-run detection and re-attach. */
  reloadWindow(win: BrowserWindow): Promise<void>;
  /** Drop one project from the recents list (rebuilds the menu); returns the
   *  updated list for the caller to push back to the renderer. */
  removeRecent(path: string): RecentProject[];
  /**
   * AI-Lore 1.0: the Space host. `space.contextFor(event)` is the Space context
   * of the window a call came from, `space.windowFor(event)` the 1.0 window;
   * the rest opens folders and windows. See `main/space/host.ts`.
   */
  space: SpaceHost;
};

/** The signature every `main/ipc/*` register module exports. */
export type RegisterModule = (reg: import('./registrar.js').Registrar, deps: Deps) => void;
