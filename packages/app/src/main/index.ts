import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChainResult,
  type ChangeScope,
  DEFAULT_IGNORE_RULES,
  type DirEvent,
  type EngineEntry,
  type IgnoreLists,
  SETTINGS_REGISTRY,
  attachChangesTracker,
  attachWatcher,
  deriveIgnoreLists,
  isChainError,
  latestSavePoint,
  listSavePoints,
  locateLore,
  mergeIgnoreRules,
  readChain,
  readCommitList,
  readCoreVersion,
  resolveAll,
  versionMeetsMinimum,
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
} from 'electron';
import {
  type AlteredReason,
  CHANNELS,
  type SettingsSnapshot,
  type Shortcut,
} from '../shared/ipc.js';
import { appsWithIcons, runAppsMigrations } from './apps.js';
import { resolveProjectRoot } from './args.js';
import * as browser from './browser.js';
import { type Deps, type ProjectContext, type Wiring, registerCockpitIpc } from './ipc/index.js';
import { buildAppMenu } from './menu.js';
import {
  COMMIT_LIST_LIMIT,
  attachSavePointBadges,
  projectRelativise,
  readTreeNode,
} from './path-mapping.js';
import { watchPrompts } from './prompts.js';
import { createPtyService } from './pty.js';
import { addRecent, clearRecents, loadRecents } from './recents.js';
import { loadGlobalSettings, loadProjectSettings } from './settings.js';
import { withIcons } from './shortcuts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimum AI-Lore version the cockpit supports. Older projects open in the
 * altered window with a version-specific banner + terminal so the user can
 * run the upgrade playbook from inside the app.
 */
const MIN_CORE_VERSION = '0.5.1';

/**
 * Decide whether a folder should open as a cockpit. Returns `null` when the
 * project is compatible (`createProjectContext` proceeds), or an
 * `AlteredReason` when the window should render the altered view instead.
 */
function checkProjectCompatibility(root: string): AlteredReason | null {
  const lore = locateLore(root);
  if ('error' in lore) return { kind: 'not-ai-lore' };
  const currentVersion = readCoreVersion(lore.lorePath);
  if (!currentVersion || !versionMeetsMinimum(currentVersion, MIN_CORE_VERSION)) {
    return { kind: 'version-too-old', currentVersion, minimumVersion: MIN_CORE_VERSION };
  }
  return null;
}

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
 * On a watcher directory event, re-read the *parent* of the changed directory
 * — its children list is what changed — and push the fresh list to the owning
 * window. The window ignores updates for paths it has not loaded.
 */
function handleDirEvent(
  win: BrowserWindow,
  chain: ChainResult,
  hidden: readonly string[],
  event: DirEvent,
): void {
  const parent = dirname(event.absPath);
  const node = readTreeNode(chain, parent, event.scope, hidden);
  sendToWin(win, CHANNELS.onTreeUpdate, {
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
 * is a valid AI-Lore project — attach the watcher + git-status tracker +
 * tracker-review tracker. The PTY service is always created so the window has
 * a terminal regardless of the chain.
 *
 * v0.6 Phase B replaced the v0.5 SQLite queue with a live `git status`
 * reader. The watcher is now a debounced *trigger*; it no longer owns
 * drift state.
 */
function createProjectContext(win: BrowserWindow, root: string): ProjectContext {
  const chain = readChain({ root });

  // Ignore rules: the built-in defaults, then the global tier, then this
  // project's tier — each layer overriding the last by pattern. The three
  // derived lists feed the watcher, the file search, and the tree reader.
  let ignoreLists: IgnoreLists = { drift: [], search: [], hidden: [] };
  let wiring: Wiring | null = null;
  if (!isChainError(chain)) {
    const globalRules = mergeIgnoreRules(
      DEFAULT_IGNORE_RULES,
      loadGlobalSettings(userDataDir).ignores,
    );
    const rules = mergeIgnoreRules(globalRules, loadProjectSettings(userDataDir, root).ignores);
    ignoreLists = deriveIgnoreLists(rules);

    const hidden = ignoreLists.hidden;
    const loreWorkingTree = join(chain.lorePath, 'memory');
    const savePointsDir = resolve(chain.lorePath, 'memory/save-points');
    const pushCommits = (scope: ChangeScope): void => {
      const repoRoot = scope === 'payload' ? root : loreWorkingTree;
      const result = readCommitList(repoRoot, COMMIT_LIST_LIMIT);
      const commits = result.kind === 'ok' ? result.commits : [];
      const savePoints = listSavePoints(savePointsDir);
      sendToWin(win, CHANNELS.onCommitList, {
        scope,
        commits: attachSavePointBadges(commits, savePoints, scope),
      });
    };
    // Per the v0.6 Phase B gate: when a save-point is recorded, the default
    // baseline is the latest one — what differs between the working tree and
    // the last marked milestone. HEAD is the fallback when no save-points
    // exist. Both scopes derive from the same save-point (each picking its
    // own commit field) so the two panes start aligned to the same milestone.
    const latestSp = latestSavePoint(savePointsDir);
    const initialBaselineByScope = latestSp
      ? { payload: latestSp.payloadCommit, lore: latestSp.loreCommit }
      : undefined;
    const changes = attachChangesTracker({
      payloadRoot: root,
      loreRoot: loreWorkingTree,
      baselineByScope: initialBaselineByScope,
      onChange: (scope, entries, baseline) => {
        sendToWin(win, CHANNELS.onChanges, {
          scope,
          entries: projectRelativise(scope, entries, root, loreWorkingTree),
          baseline,
        });
        // Commits also move on `git status` ticks — the commit list dropdown
        // reflects them without a window reload.
        pushCommits(scope);
      },
    });
    const watcher = attachWatcher({
      root,
      lorePath: chain.lorePath,
      ignored: ignoreLists.drift,
      onFileChange: (event) => changes.scheduleRefresh(event.scope),
      onDirEvent: (event) => handleDirEvent(win, chain, hidden, event),
    });
    wiring = { watcher, changes, pushCommits };
  }

  const ptyService = createPtyService({
    cwd: root,
    onData: (id, data) => sendToWin(win, CHANNELS.onTerminalData, { id, data }),
    onExit: (id) => sendToWin(win, CHANNELS.onTerminalExit, { id }),
    onStatus: (id, status, command) =>
      sendToWin(win, CHANNELS.onTerminalStatus, { id, status, command }),
  });

  // Phase D — watch the vendored verbs folder so methodology upgrades surface
  // new verbs in any live AI tab without an app restart. The renderer
  // re-fetches via `PromptsList` on each `PromptsChanged` push.
  const promptsWatcherClose = isChainError(chain)
    ? undefined
    : watchPrompts(chain.lorePath, () => {
        sendToWin(win, CHANNELS.onPromptsChanged, undefined);
      });

  return { root, chain, wiring, ptyService, ignoreLists, promptsWatcherClose };
}

/** Open a welcome window — no project, just Open / Open Recent. */
function openWelcomeWindow(): BrowserWindow {
  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    sendToWin(win, CHANNELS.onWindowInit, { mode: 'welcome', recents: loadRecents(userDataDir) });
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
    const incompatible = checkProjectCompatibility(ctx.root);
    if (incompatible) {
      // Either not an AI-Lore project, or on a version older than the
      // cockpit supports — both render the altered mode (banner + terminal
      // + Reload) so the user can bootstrap / upgrade in place.
      sendToWin(win, CHANNELS.onWindowInit, {
        mode: 'altered',
        folder: ctx.root,
        reason: incompatible,
      });
      return;
    }
    if (isChainError(ctx.chain)) {
      // Compatible version but the chain couldn't be walked (malformed
      // status / focus files). Surface as "not an AI-Lore project" — the
      // chain error message is too internal for the user to act on.
      sendToWin(win, CHANNELS.onWindowInit, {
        mode: 'altered',
        folder: ctx.root,
        reason: { kind: 'not-ai-lore' },
      });
      return;
    }
    const chain = ctx.chain;
    sendToWin(win, CHANNELS.onWindowInit, { mode: 'cockpit' });
    sendToWin(win, CHANNELS.onChain, chain);
    if (ctx.wiring) {
      // Seed the renderer with both repos' drift snapshots. Subsequent
      // updates push from the tracker's `onChange` callback (wired in
      // `createProjectContext`). The baseline travels with the entries so
      // the renderer dropdown lands on the tracker-seeded default (latest
      // save-point, or HEAD) on first paint without an extra round-trip.
      const seed = ctx.wiring.changes.snapshot();
      const seedBaselines = ctx.wiring.changes.baselines();
      const loreWorkingTree = join(chain.lorePath, 'memory');
      sendToWin(win, CHANNELS.onChanges, {
        scope: 'payload',
        entries: projectRelativise('payload', seed.payload, ctx.root, loreWorkingTree),
        baseline: seedBaselines.payload,
      });
      sendToWin(win, CHANNELS.onChanges, {
        scope: 'lore',
        entries: projectRelativise('lore', seed.lore, ctx.root, loreWorkingTree),
        baseline: seedBaselines.lore,
      });
      // Seed the baseline dropdown for both repos.
      ctx.wiring.pushCommits('payload');
      ctx.wiring.pushCommits('lore');
    }
    sendToWin(win, CHANNELS.onTreeInit, buildTreeInitPayload(chain, ctx.ignoreLists.hidden));
  });

  // Re-read the chain on a slow interval so the header reflects status / focus
  // / active-child edits without requiring a window reload. The chain is small
  // (status + focus + active-child paths and titles) and cheap to walk — 5s is
  // a good balance between liveness and noise. We compare via JSON to skip the
  // IPC send when nothing changed. The same logic is exposed on the context as
  // `refreshChain` so mutations (e.g. setRegister) can push the new state to
  // the renderer immediately without waiting for the next poll tick.
  if (!isChainError(ctx.chain)) {
    let lastSent = JSON.stringify(ctx.chain);
    const refreshChain = (): void => {
      if (win.isDestroyed()) return;
      const next = readChain({ root });
      if (isChainError(next)) return;
      const serialised = JSON.stringify(next);
      if (serialised === lastSent) return;
      lastSent = serialised;
      ctx.chain = next;
      sendToWin(win, CHANNELS.onChain, next);
    };
    ctx.refreshChain = refreshChain;
    const id = setInterval(refreshChain, 5_000);
    win.once('closed', () => clearInterval(id));
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

/** Push the shortcut list to every window so all header menus stay in sync.
 *  Icons are extracted (cached) before broadcast so the renderer never sees
 *  a list without its icon decorations. */
function broadcastShortcuts(list: Shortcut[]): void {
  const decorated = withIcons(list);
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWin(win, CHANNELS.onShortcutsChanged, decorated);
  }
}

/**
 * Build the settings snapshot for a window: the registry, the resolved value
 * of every setting, and the raw tier files. A window with no AI-Lore project
 * (welcome or altered) has no project tier — `project` is null.
 */
function settingsSnapshot(ctx: ProjectContext | undefined): SettingsSnapshot {
  const rawGlobal = loadGlobalSettings(userDataDir);
  // Decorate Apps catalog entries with `iconUrl` extracted from `.app`
  // bundles — the renderer's *Open with* menu shows the real bundle icon.
  const global = rawGlobal.apps ? { ...rawGlobal, apps: appsWithIcons(rawGlobal.apps) } : rawGlobal;
  const project =
    ctx && !isChainError(ctx.chain) ? loadProjectSettings(userDataDir, ctx.root) : null;
  return {
    registry: SETTINGS_REGISTRY,
    resolved: resolveAll(SETTINGS_REGISTRY, global, project),
    global,
    project,
    defaultIgnores: DEFAULT_IGNORE_RULES,
  };
}

/** Push a fresh settings snapshot to every window — each gets its own tiers. */
function broadcastSettings(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWin(win, CHANNELS.onSettingsChanged, settingsSnapshot(contexts.get(win.id)));
  }
}

/** Push the engines list to every window — engines are user-wide. */
function broadcastEngines(list: EngineEntry[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWin(win, CHANNELS.onEnginesChanged, list);
  }
}

/**
 * Re-apply a window's ignore rules after they changed: re-derive the three
 * lists, re-attach the watcher with the new drift filter, and re-send the
 * trees with the new hidden set. The file search reads `ctx.ignoreLists` live,
 * so it needs nothing further.
 */
function reapplyIgnores(win: BrowserWindow): void {
  const ctx = contexts.get(win.id);
  if (!ctx || isChainError(ctx.chain) || !ctx.wiring) return;
  const chain = ctx.chain;
  const wiring = ctx.wiring;
  const globalRules = mergeIgnoreRules(
    DEFAULT_IGNORE_RULES,
    loadGlobalSettings(userDataDir).ignores,
  );
  const rules = mergeIgnoreRules(globalRules, loadProjectSettings(userDataDir, ctx.root).ignores);
  ctx.ignoreLists = deriveIgnoreLists(rules);
  const { hidden, drift } = ctx.ignoreLists;

  // Re-attach the watcher so its drift filter reflects the new rules.
  void wiring.watcher.close().then(() => {
    if (contexts.get(win.id) !== ctx) return;
    wiring.watcher = attachWatcher({
      root: ctx.root,
      lorePath: chain.lorePath,
      ignored: drift,
      onFileChange: (event) => wiring.changes.scheduleRefresh(event.scope),
      onDirEvent: (event) => handleDirEvent(win, chain, hidden, event),
    });
  });

  // Re-send the trees with the new hidden set — a clear, visible refresh.
  sendToWin(win, CHANNELS.onTreeInit, buildTreeInitPayload(chain, hidden));
}

/**
 * Build the TreeInit payload for a project. Default-shape projects get
 * the existing `payload` + `lore` trees; publishing-shape projects also
 * carry a `publish` tree rooted at `<project>/publish/`.
 */
function buildTreeInitPayload(
  chain: import('@ai-lore-companion/core').ChainSuccess,
  hidden: readonly string[],
): import('../shared/ipc.js').TreeInitPayload {
  // v0.8 Phase C — in publishing shape the Payload tree roots at
  // `<project>/payload/` (the workshop) rather than the project root.
  const payloadRoot = chain.shape === 'publishing' ? join(chain.root, 'payload') : chain.root;
  // The Lore tree carries two first-class children of `<lore>/`: `memory/`
  // (always) and `references/` (when present). A synthetic root at
  // `chain.lorePath` lets pane sub-roots walk to either side — `memory/...`
  // for the Status / Memory panes' synthetic children, and `references` for
  // the v0.5 Phase D references registry surfaced inside the Status pane.
  const memoryNode = readTreeNode(chain, join(chain.lorePath, 'memory'), 'lore', hidden);
  const referencesPath = join(chain.lorePath, 'references');
  const referencesNode = existsSync(referencesPath)
    ? readTreeNode(chain, referencesPath, 'lore', hidden)
    : null;
  const loreTree: import('@ai-lore-companion/core').TreeNode = {
    name: 'lore',
    path: chain.lorePath,
    isDir: true,
    children: referencesNode ? [memoryNode, referencesNode] : [memoryNode],
  };
  const out: import('../shared/ipc.js').TreeInitPayload = {
    payload: readTreeNode(chain, payloadRoot, 'payload', hidden),
    lore: loreTree,
  };
  if (chain.shape === 'publishing' && chain.publish) {
    const publishRoot = join(chain.root, chain.publish.path);
    out.publish = readTreeNode(chain, publishRoot, 'lore', hidden);
  }
  return out;
}

/** Tear down one window's context — kill its PTYs, close its watcher + trackers. */
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
    ctx.wiring.changes.close();
  }
  if (ctx.promptsWatcherClose) {
    try {
      await ctx.promptsWatcherClose();
    } catch {
      // Best-effort — chokidar may already be torn down.
    }
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

/**
 * The shared services the `main/ipc/*` register modules need from this host —
 * window/context state and the cross-window broadcasts that live in this
 * file's closure. Everything else a handler touches it imports directly.
 */
const ipcDeps: Deps = {
  contextFor,
  getUserDataDir: () => userDataDir,
  contexts,
  settingsSnapshot,
  broadcastSettings,
  broadcastEngines,
  broadcastShortcuts,
  reapplyIgnores,
  showProject,
  promptAndOpenProject,
  reloadWindow,
};

app.whenReady().then(() => {
  userDataDir = app.getPath('userData');
  // v0.6 Phase A — bring the Apps catalog to the current schema version
  // before any window reads settings. v1 folds in legacy folder shortcuts;
  // v2 cleans labels + dedups. Idempotent + version-gated.
  runAppsMigrations(userDataDir);
  registerCockpitIpc(ipcMain, ipcDeps);
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
