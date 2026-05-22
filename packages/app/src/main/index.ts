import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChainResult,
  type ChangeScope,
  DEFAULT_IGNORED,
  type DbHandle,
  type DirEvent,
  type Queue,
  type TreeNode,
  type WatcherHandle,
  attachWatcher,
  createQueue,
  isChainError,
  isTreeError,
  openDb,
  readChain,
  readDirectory,
  readProjectIgnores,
} from '@ai-lore-companion/core';
import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  type OpenDialogOptions,
  app,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import {
  type BrowserBounds,
  type BrowserProfile,
  type CockpitApi,
  type FileSearchArg,
  type FileSearchHit,
  IPC,
  type Shortcut,
  type ShortcutInput,
  type TerminalInputArg,
  type TerminalResizeArg,
  type TreeExpandArg,
} from '../shared/ipc.js';
import { resolveProjectRoot } from './args.js';
import { loadBrowserProfile, saveBrowserProfile } from './browser-prefs.js';
import * as browser from './browser.js';
import { projectDbPath } from './db-path.js';
import { buildAppMenu } from './menu.js';
import { type PtyService, createPtyService } from './pty.js';
import { addRecent, clearRecents, loadRecents } from './recents.js';
import { launchApp, launchUrl, loadShortcuts, saveShortcuts } from './shortcuts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Wiring = {
  dbHandle: DbHandle;
  queue: Queue;
  watcher: WatcherHandle;
};

/**
 * Everything `main` holds for one project window — created when the window
 * opens, torn down when it closes. `wiring` (DB, queue, watcher) is null when
 * the folder is not a valid AI-Lore project — a chain error — in which case the
 * window still gets a chain payload and a terminal, exactly as before V4.
 */
type ProjectContext = {
  root: string;
  chain: ChainResult;
  wiring: Wiring | null;
  ptyService: PtyService;
};

/** Project context per window, keyed by `BrowserWindow.id`. */
const contexts = new Map<number, ProjectContext>();

/** `app.getPath('userData')` — resolved once the app is ready. */
let userDataDir = '';
/** The root this launch was pointed at, or null for a welcome launch. */
let launchRoot: string | null = null;

/** Send a message to one window, unless it has been destroyed. */
function sendToWin(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/** Resolve the project context for the window an IPC call came from. */
function contextFor(event: IpcMainEvent | IpcMainInvokeEvent): ProjectContext | undefined {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? contexts.get(win.id) : undefined;
}

/**
 * What a side's tree read hides. The Payload tree hides only the Lore folder
 * (the Lore has its own pane). Build and scratch folders are NOT hidden — the
 * ignore list (`DEFAULT_IGNORED` + `.ailoreignore`) silences the watcher's
 * drift; it does not hide anything from the tree.
 */
function treeHideFor(chain: ChainResult, scope: ChangeScope): readonly string[] {
  if (scope === 'payload' && !isChainError(chain)) {
    return [`**/${basename(chain.lorePath)}/**`];
  }
  return [];
}

/** Read a directory one level deep; on error, fall back to an empty node. */
function readTreeNode(chain: ChainResult, absPath: string, scope: ChangeScope): TreeNode {
  const result = readDirectory(absPath, { ignore: treeHideFor(chain, scope) });
  if (isTreeError(result)) {
    return { name: basename(absPath), path: absPath, isDir: true, children: [] };
  }
  return result;
}

/**
 * On a watcher directory event, re-read the *parent* of the changed directory
 * — its children list is what changed — and push the fresh list to the owning
 * window. The window ignores updates for paths it has not loaded.
 */
function handleDirEvent(win: BrowserWindow, chain: ChainResult, event: DirEvent): void {
  const parent = dirname(event.absPath);
  const node = readTreeNode(chain, parent, event.scope);
  sendToWin(win, IPC.TreeUpdate, {
    scope: event.scope,
    path: parent,
    children: node.children ?? [],
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'AI-Lore',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.once('closed', () => {
    void teardownContext(win.id);
  });
  // The window title is owned by main — the project name, set per window in
  // `attachProjectContext`. The renderer's <title> must not override it.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Close guard: a window with a running terminal task confirms before closing.
  let closeConfirmed = false;
  win.on('close', (event) => {
    if (closeConfirmed) return;
    if (!contexts.get(win.id)?.ptyService.hasRunningTask()) return;
    event.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Cancel', 'Close window'],
        defaultId: 0,
        cancelId: 0,
        message: 'A terminal is still running a task.',
        detail: 'Closing this window will end it. Close anyway?',
      })
      .then((r) => {
        if (r.response === 1) {
          closeConfirmed = true;
          win.close();
        }
      });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * Build the project context for a window: read the chain, and — when the folder
 * is a valid AI-Lore project — open the DB, queue, and watcher. The PTY service
 * is always created so the window has a terminal regardless of the chain.
 */
function createProjectContext(win: BrowserWindow, root: string): ProjectContext {
  const chain = readChain({ root });
  const userIgnores = readProjectIgnores(root);

  let wiring: Wiring | null = null;
  if (!isChainError(chain)) {
    const dbHandle = openDb(projectDbPath(userDataDir, root));
    const queue = createQueue({ db: dbHandle.db });
    const watcher = attachWatcher(queue, {
      root,
      lorePath: chain.lorePath,
      ignored: userIgnores,
      onDirEvent: (event) => handleDirEvent(win, chain, event),
    });
    wiring = { dbHandle, queue, watcher };
  }

  const ptyService = createPtyService({
    cwd: root,
    onData: (id, data) => sendToWin(win, IPC.TerminalData, { id, data }),
    onExit: (id) => sendToWin(win, IPC.TerminalExit, { id }),
    onStatus: (id, status, command) => sendToWin(win, IPC.TerminalStatus, { id, status, command }),
  });

  return { root, chain, wiring, ptyService };
}

/** Open a welcome window — no project, just Open / Open Recent. */
function openWelcomeWindow(): BrowserWindow {
  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    sendToWin(win, IPC.WindowInit, { mode: 'welcome', recents: loadRecents(userDataDir) });
  });
  return win;
}

/**
 * Give a window a project context and wire its cockpit IPC. A load is always in
 * flight when this runs — a fresh window (`createWindow` started it) or a
 * welcome window being reloaded into a project — so the init sends fire on
 * `did-finish-load`.
 */
function attachProjectContext(win: BrowserWindow, root: string): void {
  const ctx = createProjectContext(win, root);
  contexts.set(win.id, ctx);

  // The title bar shows the project (the folder name) — for a cockpit window
  // and for an altered non-AI-Lore window alike. Welcome windows keep "AI-Lore".
  win.setTitle(basename(ctx.root));

  if (!isChainError(ctx.chain)) {
    addRecent(userDataDir, root);
    rebuildMenu();
  }

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    if (isChainError(ctx.chain)) {
      // Not an AI-Lore project — the window renders the altered mode: a
      // disclaimer banner, a terminal, and a Reload that re-runs detection.
      sendToWin(win, IPC.WindowInit, { mode: 'altered', folder: ctx.root });
      return;
    }
    const chain = ctx.chain;
    sendToWin(win, IPC.WindowInit, { mode: 'cockpit' });
    sendToWin(win, IPC.Chain, chain);
    if (ctx.wiring) {
      sendToWin(win, IPC.Restore, ctx.wiring.queue.snapshot());
    }
    sendToWin(win, IPC.TreeInit, {
      payload: readTreeNode(chain, chain.root, 'payload'),
      // The Lore pane is rooted at memory/ — process/ and upstream/ sit
      // outside memory/, so the pane never lists them.
      lore: readTreeNode(chain, join(chain.lorePath, 'memory'), 'lore'),
    });
  });

  if (ctx.wiring) {
    const off = ctx.wiring.queue.on((event) => sendToWin(win, IPC.Change, event));
    win.once('closed', off);
  }
}

/** Open a folder as a new project window. */
function openProjectWindow(root: string): BrowserWindow {
  const win = createWindow();
  attachProjectContext(win, root);
  return win;
}

/** Replace a welcome window's content with a project — reload, then re-init. */
function loadProjectIntoWindow(win: BrowserWindow, root: string): void {
  win.webContents.reload();
  attachProjectContext(win, root);
}

/**
 * Reload a window's folder — the altered window's Reload. Tears down the
 * window's reduced context, re-runs detection, and re-attaches: a now-valid
 * folder comes back as a cockpit, a still-invalid one stays altered.
 */
async function reloadWindow(win: BrowserWindow): Promise<void> {
  const ctx = contexts.get(win.id);
  if (!ctx) return;
  const root = ctx.root;
  await teardownContext(win.id);
  if (win.isDestroyed()) return;
  win.webContents.reload();
  attachProjectContext(win, root);
}

/**
 * Route an open request. A welcome window — no context — is replaced in place;
 * a project window, or a menu action with no focused window, opens a new one.
 */
function showProject(win: BrowserWindow | undefined, root: string): void {
  if (win && !win.isDestroyed() && !contexts.has(win.id)) {
    loadProjectIntoWindow(win, root);
  } else {
    openProjectWindow(root);
  }
}

/** Prompt for a folder, then open it. */
async function promptAndOpenProject(win: BrowserWindow | undefined): Promise<void> {
  const opts: OpenDialogOptions = {
    title: 'Open AI-Lore Project',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const [folder] = result.filePaths;
  if (result.canceled || !folder) return;
  showProject(win, folder);
}

/** (Re)build the application menu from the current recents list. */
function rebuildMenu(): void {
  Menu.setApplicationMenu(
    buildAppMenu(loadRecents(userDataDir), {
      onOpen: (win) => {
        void promptAndOpenProject(win);
      },
      onOpenRecent: (win, path) => showProject(win, path),
      onClearRecents: () => {
        clearRecents(userDataDir);
        rebuildMenu();
      },
    }),
  );
}

/** Push the shortcut list to every window so all header menus stay in sync. */
function broadcastShortcuts(list: Shortcut[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWin(win, IPC.ShortcutsChanged, list);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.Ack, (event, id: string): ReturnType<CockpitApi['ack']> => {
    const ctx = contextFor(event);
    return Promise.resolve(ctx?.wiring ? ctx.wiring.queue.ack(id) : false);
  });
  ipcMain.handle(IPC.AckAll, (event): ReturnType<CockpitApi['ackAll']> => {
    const ctx = contextFor(event);
    return Promise.resolve(ctx?.wiring ? ctx.wiring.queue.ackAll() : 0);
  });
  ipcMain.handle(
    IPC.AckAllScope,
    (event, scope: ChangeScope): ReturnType<CockpitApi['ackAllScope']> => {
      const ctx = contextFor(event);
      return Promise.resolve(ctx?.wiring ? ctx.wiring.queue.ackAllScope(scope) : 0);
    },
  );
  ipcMain.handle(IPC.OpenPath, (_event, path: string): ReturnType<CockpitApi['openPath']> => {
    return shell.openPath(path);
  });
  ipcMain.handle(
    IPC.TreeExpand,
    (event, arg: TreeExpandArg): ReturnType<CockpitApi['treeExpand']> => {
      const ctx = contextFor(event);
      if (!ctx) return Promise.resolve([]);
      const result = readDirectory(arg.path, {
        ignore: treeHideFor(ctx.chain, arg.scope),
      });
      return Promise.resolve(isTreeError(result) ? [] : (result.children ?? []));
    },
  );
  ipcMain.handle(IPC.FileSearch, (event, arg: FileSearchArg): FileSearchHit[] => {
    const ctx = contextFor(event);
    if (!ctx) return [];
    const query = arg.query.trim().toLowerCase();
    if (query.length === 0) return [];
    // Skip build/scratch dirs (node_modules, .git, dist, …) and the Lore
    // folder — both for walk speed and so the results stay sensible.
    const ignore = [...DEFAULT_IGNORED, ...treeHideFor(ctx.chain, 'payload')];
    const LIMIT = 40;
    const hits: FileSearchHit[] = [];
    const walk = (dir: string): void => {
      if (hits.length >= LIMIT) return;
      const result = readDirectory(dir, { ignore });
      if (isTreeError(result)) return;
      for (const child of result.children ?? []) {
        if (hits.length >= LIMIT) break;
        if (child.isDir) walk(child.path);
        else if (child.name.toLowerCase().includes(query)) {
          hits.push({ name: child.name, path: child.path });
        }
      }
    };
    for (const dir of arg.dirs) walk(dir);
    return hits;
  });

  ipcMain.handle(IPC.OpenProject, async (event, path?: string): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    if (typeof path === 'string' && path.length > 0) {
      showProject(win, path);
    } else {
      await promptAndOpenProject(win);
    }
  });

  ipcMain.handle(IPC.Reload, async (event): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) await reloadWindow(win);
  });
  ipcMain.handle(IPC.OpenExternal, (_event, url: string): Promise<void> => {
    return shell.openExternal(url);
  });

  ipcMain.handle(IPC.TerminalSpawn, (event): ReturnType<CockpitApi['spawnTerminal']> => {
    const ctx = contextFor(event);
    return Promise.resolve(ctx ? ctx.ptyService.spawn() : '');
  });
  ipcMain.on(IPC.TerminalInput, (event, arg: TerminalInputArg) => {
    contextFor(event)?.ptyService.write(arg.id, arg.data);
  });
  ipcMain.on(IPC.TerminalResize, (event, arg: TerminalResizeArg) => {
    contextFor(event)?.ptyService.resize(arg.id, arg.cols, arg.rows);
  });
  ipcMain.on(IPC.TerminalKill, (event, id: string) => {
    contextFor(event)?.ptyService.kill(id);
  });

  ipcMain.on(IPC.BrowserCreate, (event, tabId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) browser.create(win, tabId, loadBrowserProfile(userDataDir));
  });
  ipcMain.on(IPC.BrowserDestroy, (_event, tabId: string) => {
    browser.destroy(tabId);
  });
  ipcMain.on(IPC.BrowserSetVisible, (_event, arg: { tabId: string; visible: boolean }) => {
    browser.setVisible(arg.tabId, arg.visible);
  });
  ipcMain.on(IPC.BrowserSetBounds, (_event, arg: { tabId: string; bounds: BrowserBounds }) => {
    browser.setBounds(arg.tabId, arg.bounds);
  });
  ipcMain.on(IPC.BrowserNavigate, (_event, arg: { tabId: string; url: string }) => {
    browser.navigate(arg.tabId, arg.url);
  });
  ipcMain.on(IPC.BrowserGoBack, (_event, tabId: string) => {
    browser.goBack(tabId);
  });
  ipcMain.on(IPC.BrowserGoForward, (_event, tabId: string) => {
    browser.goForward(tabId);
  });
  ipcMain.on(IPC.BrowserReload, (_event, tabId: string) => {
    browser.reload(tabId);
  });
  ipcMain.on(IPC.BrowserSetProfile, (_event, arg: { tabId: string; profile: BrowserProfile }) => {
    saveBrowserProfile(userDataDir, arg.profile);
    browser.setProfile(arg.tabId, arg.profile);
  });
  ipcMain.on(IPC.BrowserSuppressAll, (event, suppress: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) browser.suppressAll(win.id, suppress);
  });

  ipcMain.handle(IPC.ShortcutsList, (): Shortcut[] => loadShortcuts(userDataDir));
  ipcMain.on(IPC.ShortcutsRun, (event, id: string) => {
    const shortcut = loadShortcuts(userDataDir).find((s) => s.id === id);
    if (!shortcut) return;
    if (shortcut.target === 'url') {
      if (shortcut.url) launchUrl(shortcut.url);
      return;
    }
    const ctx = contextFor(event);
    if (!ctx) return;
    // "project" → the window's root; "lore" → its Lore folder, if it has one.
    const folder =
      shortcut.target === 'lore' ? (isChainError(ctx.chain) ? null : ctx.chain.lorePath) : ctx.root;
    if (folder && shortcut.app) launchApp(shortcut.app, folder);
  });
  ipcMain.handle(IPC.ShortcutsPickApp, async (event): Promise<string | null> => {
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
  ipcMain.handle(IPC.ShortcutsAdd, (_event, input: ShortcutInput): Shortcut[] => {
    const list = [...loadShortcuts(userDataDir), { id: randomUUID(), ...input }];
    saveShortcuts(userDataDir, list);
    broadcastShortcuts(list);
    return list;
  });
  ipcMain.handle(IPC.ShortcutsRemove, (_event, id: string): Shortcut[] => {
    const list = loadShortcuts(userDataDir).filter((s) => s.id !== id);
    saveShortcuts(userDataDir, list);
    broadcastShortcuts(list);
    return list;
  });
}

/** Tear down one window's context — kill its PTYs, close its watcher and DB. */
async function teardownContext(winId: number): Promise<void> {
  // Browser tabs are per-window but live outside ProjectContext — tear them
  // all down regardless of whether a cockpit context was ever built.
  browser.destroyForWindow(winId);

  const ctx = contexts.get(winId);
  if (!ctx) return;
  contexts.delete(winId);

  ctx.ptyService.killAll();
  if (ctx.wiring) {
    try {
      await ctx.wiring.watcher.close();
    } catch {
      // Best-effort — chokidar may already be torn down.
    }
    ctx.wiring.dbHandle.close();
  }
}

/** Tear down every remaining context — called on quit. */
async function teardownAll(): Promise<void> {
  await Promise.all([...contexts.keys()].map((id) => teardownContext(id)));
}

/** Open the window this launch (or dock re-activation) calls for. */
function openLaunchWindow(): void {
  if (launchRoot) {
    openProjectWindow(launchRoot);
  } else {
    openWelcomeWindow();
  }
}

app.whenReady().then(() => {
  userDataDir = app.getPath('userData');
  registerIpcHandlers();
  rebuildMenu();

  launchRoot = resolveProjectRoot(process.argv);
  openLaunchWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openLaunchWindow();
    }
  });
});

let teardownDone = false;
let quitConfirmed = false;
app.on('before-quit', (event) => {
  if (teardownDone) return;
  event.preventDefault();

  // Quit guard: one confirmation if any window is running a terminal task.
  if (!quitConfirmed) {
    const anyRunning = [...contexts.values()].some((c) => c.ptyService.hasRunningTask());
    if (anyRunning) {
      void dialog
        .showMessageBox({
          type: 'question',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0,
          cancelId: 0,
          message: 'Terminals are still running tasks.',
          detail: 'Quitting AI-Lore will end them. Quit anyway?',
        })
        .then((r) => {
          if (r.response === 1) {
            quitConfirmed = true;
            app.quit();
          }
        });
      return;
    }
  }

  teardownAll().finally(() => {
    teardownDone = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
