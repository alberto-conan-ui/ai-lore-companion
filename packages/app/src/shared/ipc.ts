import type {
  ChainError,
  ChainResult,
  ChangeScope,
  QueueEntry,
  QueueEvent,
  TreeNode,
} from '@ai-lore-companion/core';

/**
 * Type-only ChainResult discriminator that does not require importing
 * `@ai-lore-companion/core`'s runtime module — used by the renderer, which
 * cannot bundle core's Node-native dependencies.
 */
export function isChainErrorPayload(chain: ChainResult): chain is ChainError {
  return 'error' in chain;
}

export const IPC = {
  /** Main → renderer: the window's mode — welcome or cockpit — sent once on load. */
  WindowInit: 'cockpit:window-init',
  /** Main → renderer: full chain result (sent once on renderer ready). */
  Chain: 'cockpit:chain',
  /** Main → renderer: persisted entries restored on launch (sent once after Chain). */
  Restore: 'cockpit:restore',
  /** Main → renderer: live queue event (add/replace/ack/clear). */
  Change: 'cockpit:change',

  /** Main → renderer: per-side root trees (sent once after Restore). */
  TreeInit: 'cockpit:tree-init',
  /** Main → renderer: refreshed children for a directory whose contents changed. */
  TreeUpdate: 'cockpit:tree-update',

  /** Renderer → main: ack a single queue entry by id. */
  Ack: 'cockpit:ack',
  /** Renderer → main: ack every queue entry. */
  AckAll: 'cockpit:ack-all',
  /** Renderer → main: ack every queue entry on one side. */
  AckAllScope: 'cockpit:ack-all-scope',
  /** Renderer → main: open a path in the OS default application. */
  OpenPath: 'cockpit:open-path',
  /** Renderer → main: read a directory's children on demand. */
  TreeExpand: 'cockpit:tree-expand',
  /** Renderer → main: recursively search file names under the given directories. */
  FileSearch: 'cockpit:file-search',
  /** Renderer → main: open a project — a given folder, or prompt a folder dialog. */
  OpenProject: 'cockpit:open-project',
  /** Renderer → main: re-run AI-Lore detection on this window's folder. */
  Reload: 'cockpit:reload',
  /** Renderer → main: open a URL in the OS default browser. */
  OpenExternal: 'cockpit:open-external',

  /** Renderer → main: spawn a terminal PTY; resolves to its id. */
  TerminalSpawn: 'terminal:spawn',
  /** Renderer → main: keystrokes for a terminal. */
  TerminalInput: 'terminal:input',
  /** Renderer → main: resize a terminal. */
  TerminalResize: 'terminal:resize',
  /** Renderer → main: kill a terminal. */
  TerminalKill: 'terminal:kill',
  /** Main → renderer: output bytes from a terminal. */
  TerminalData: 'terminal:data',
  /** Main → renderer: a terminal's shell exited on its own. */
  TerminalExit: 'terminal:exit',
  /** Main → renderer: a terminal's foreground status — idle/running + command. */
  TerminalStatus: 'terminal:status',

  /** Renderer → main: create the `WebContentsView` for a browser tab. */
  BrowserCreate: 'browser:create',
  /** Renderer → main: destroy a browser tab's view (the tab was closed). */
  BrowserDestroy: 'browser:destroy',
  /** Renderer → main: show or hide a browser tab's view. */
  BrowserSetVisible: 'browser:set-visible',
  /** Renderer → main: position a browser tab's view within the window. */
  BrowserSetBounds: 'browser:set-bounds',
  /** Renderer → main: load a URL (or search) in a browser tab. */
  BrowserNavigate: 'browser:navigate',
  /** Renderer → main: browser tab back. */
  BrowserGoBack: 'browser:go-back',
  /** Renderer → main: browser tab forward. */
  BrowserGoForward: 'browser:go-forward',
  /** Renderer → main: reload a browser tab. */
  BrowserReload: 'browser:reload',
  /** Renderer → main: switch a browser tab's profile. */
  BrowserSetProfile: 'browser:set-profile',
  /** Renderer → main: hide / restore every browser view in the window so a DOM overlay can sit on top. */
  BrowserSuppressAll: 'browser:suppress-all',
  /** Main → renderer: a browser tab's state — url, nav availability, profile. */
  BrowserState: 'browser:state',

  /** Renderer → main: list configured app-launch shortcuts. */
  ShortcutsList: 'shortcuts:list',
  /** Renderer → main: run a shortcut by id on this window's target folder. */
  ShortcutsRun: 'shortcuts:run',
  /** Renderer → main: show the native app picker; resolves to an app path. */
  ShortcutsPickApp: 'shortcuts:pick-app',
  /** Renderer → main: add a shortcut; resolves to the updated list. */
  ShortcutsAdd: 'shortcuts:add',
  /** Renderer → main: remove a shortcut by id; resolves to the updated list. */
  ShortcutsRemove: 'shortcuts:remove',
  /** Main → renderer: the configured shortcut list changed. */
  ShortcutsChanged: 'shortcuts:changed',
} as const;

export type ChainPayload = ChainResult;
export type RestorePayload = QueueEntry[];
export type ChangePayload = QueueEvent;

/** A project folder the user has opened — an entry in the recents list. */
export type RecentProject = { path: string; openedAt: number };

/**
 * Main → renderer, once per window on load: what the window is. A welcome
 * window carries the recents list; an altered window — a folder that is not an
 * AI-Lore project — carries the folder path for its disclaimer banner.
 */
export type WindowInitPayload =
  | { mode: 'welcome'; recents: RecentProject[] }
  | { mode: 'cockpit' }
  | { mode: 'altered'; folder: string };

/** Per-side root trees, each populated one level deep. */
export type TreeInitPayload = { payload: TreeNode; lore: TreeNode };
/** Refreshed children for `path` on the given side. */
export type TreeUpdatePayload = { scope: ChangeScope; path: string; children: TreeNode[] };
/** Argument to a `tree-expand` request. */
export type TreeExpandArg = { scope: ChangeScope; path: string };

/** A global file-search request — absolute directories to walk, and the query. */
export type FileSearchArg = { dirs: string[]; query: string };
/** One file matched by a search — its base name and absolute path. */
export type FileSearchHit = { name: string; path: string };

/** Keystrokes (or pasted text) bound for a terminal's PTY. */
export type TerminalInputArg = { id: string; data: string };
/** A terminal resize request, in character cells. */
export type TerminalResizeArg = { id: string; cols: number; rows: number };
/** Output bytes streamed from a terminal's PTY. */
export type TerminalDataPayload = { id: string; data: string };
/** A terminal whose shell process exited. */
export type TerminalExitPayload = { id: string };

/** A terminal's foreground state: its shell is idle, or it is running a task. */
export type TerminalForegroundStatus = 'idle' | 'running';
/**
 * Main → renderer: a terminal's foreground status. `command` is the full
 * command line of the running task while `running`, and `''` while `idle`.
 */
export type TerminalStatusPayload = {
  id: string;
  status: TerminalForegroundStatus;
  command: string;
};

/** Pixel bounds for the browser companion view, in window content coordinates. */
export type BrowserBounds = { x: number; y: number; width: number; height: number };

/** The named, session-isolated browser profiles the companion offers. */
export const BROWSER_PROFILES = ['Default', 'Work', 'Personal'] as const;
export type BrowserProfile = (typeof BROWSER_PROFILES)[number];

/** Main → renderer: a browser tab's current state, for its toolbar. */
export type BrowserStatePayload = {
  tabId: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  profile: BrowserProfile;
};

/** What an app-launch shortcut opens: a folder in an app, or a URL in Chrome. */
export type ShortcutTarget = 'project' | 'lore' | 'url';

/**
 * A configured shortcut. `project` / `lore` targets carry `app` (a macOS app
 * path passed to `open -a` on the folder); a `url` target carries `url`,
 * opened in Chrome.
 */
export type Shortcut = {
  id: string;
  label: string;
  target: ShortcutTarget;
  app?: string;
  url?: string;
};

/** The fields needed to create a shortcut; `main` assigns the id. */
export type ShortcutInput = {
  label: string;
  target: ShortcutTarget;
  app?: string;
  url?: string;
};

export type Unsubscribe = () => void;

export type CockpitApi = {
  onWindowInit: (handler: (payload: WindowInitPayload) => void) => Unsubscribe;
  onChain: (handler: (chain: ChainPayload) => void) => Unsubscribe;
  onRestore: (handler: (entries: RestorePayload) => void) => Unsubscribe;
  onChange: (handler: (event: ChangePayload) => void) => Unsubscribe;
  onTreeInit: (handler: (payload: TreeInitPayload) => void) => Unsubscribe;
  onTreeUpdate: (handler: (payload: TreeUpdatePayload) => void) => Unsubscribe;
  ack: (id: string) => Promise<boolean>;
  ackAll: () => Promise<number>;
  ackAllScope: (scope: ChangeScope) => Promise<number>;
  openPath: (path: string) => Promise<string>;
  treeExpand: (arg: TreeExpandArg) => Promise<TreeNode[]>;
  searchFiles: (arg: FileSearchArg) => Promise<FileSearchHit[]>;
  openProject: (path?: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  spawnTerminal: () => Promise<string>;
  sendTerminalInput: (arg: TerminalInputArg) => void;
  resizeTerminal: (arg: TerminalResizeArg) => void;
  killTerminal: (id: string) => void;
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => Unsubscribe;
  onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => Unsubscribe;
  onTerminalStatus: (handler: (payload: TerminalStatusPayload) => void) => Unsubscribe;
  browserCreate: (tabId: string) => void;
  browserDestroy: (tabId: string) => void;
  browserSetVisible: (tabId: string, visible: boolean) => void;
  browserSetBounds: (tabId: string, bounds: BrowserBounds) => void;
  browserNavigate: (tabId: string, url: string) => void;
  browserGoBack: (tabId: string) => void;
  browserGoForward: (tabId: string) => void;
  browserReload: (tabId: string) => void;
  browserSetProfile: (tabId: string, profile: BrowserProfile) => void;
  /** Hide every browser view in this window (`true`) or restore them (`false`). */
  browserSuppressAll: (suppress: boolean) => void;
  onBrowserState: (handler: (state: BrowserStatePayload) => void) => Unsubscribe;
  shortcutsList: () => Promise<Shortcut[]>;
  shortcutsRun: (id: string) => void;
  shortcutsPickApp: () => Promise<string | null>;
  shortcutsAdd: (input: ShortcutInput) => Promise<Shortcut[]>;
  shortcutsRemove: (id: string) => Promise<Shortcut[]>;
  onShortcutsChanged: (handler: (list: Shortcut[]) => void) => Unsubscribe;
};

declare global {
  interface Window {
    cockpit: CockpitApi;
  }
}
