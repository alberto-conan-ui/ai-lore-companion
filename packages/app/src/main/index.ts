import { existsSync, realpathSync, watch as watchFile } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChainResult,
  type ChangeScope,
  type CommitListEntry,
  DEFAULT_IGNORE_RULES,
  type DirEvent,
  type EngineEntry,
  type IgnoreLists,
  SETTINGS_REGISTRY,
  attachChangesTracker,
  attachWatcher,
  createGitPort,
  deriveIgnoreLists,
  isChainError,
  listSavePoints,
  locateLore,
  mergeIgnoreRules,
  readChain,
  readCommitList,
  readCoreVersion,
  resolveAll,
  resolveSetting,
  versionMeetsMinimum,
} from '@ai-lore-companion/core';
import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  type OpenDialogOptions,
  type Rectangle,
  app,
  dialog,
  ipcMain,
  screen,
} from 'electron';
import { type BaselineModel, buildMilestones, defaultMilestone } from '../shared/baseline.js';
import {
  type AlteredReason,
  CHANNELS,
  type SettingsSnapshot,
  type Shortcut,
} from '../shared/ipc.js';
import { appsWithIcons, runAppsMigrations } from './apps.js';
import { resolveProjectRoot } from './args.js';
import { readBranches } from './branches.js';
import * as browser from './browser.js';
import { disposeAllHelpers, disposeHelperForWindow, startMcpHost } from './helper/index.js';
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
import { addRecent, clearRecents, loadRecents, removeRecent } from './recents.js';
import { type SearchService, WorkerSearchService } from './search/service.js';
import { loadGlobalSettings, loadProjectSettings } from './settings.js';
import { withIcons } from './shortcuts.js';
import { isSpaceBuild, spaceRoutingDecision } from './space/build-marker.js';
import { type SpaceHost, createSpaceHost } from './space/host.js';
import { createAppCommandRunner } from './space/live-github.js';
import { createSpaceLog } from './space/log.js';
import { createLoginShellRunner } from './space/login-shell-runner.js';
import { isSpaceRoutingOn } from './space/routing.js';
import type { SpaceWindowLike } from './space/windows.js';
import { loadWindowBounds, saveWindowBounds } from './window-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimum AI-Lore version the cockpit supports. Older projects open in the
 * altered window with a version-specific banner + terminal so the user can
 * run the upgrade playbook from inside the app.
 */
const MIN_CORE_VERSION = '0.5.1';

/**
 * E2E test mode. When `COCKPIT_E2E=1`, the running-task close/quit confirmation
 * dialogs are bypassed so the Playwright suite can tear windows down unattended
 * — a native modal would otherwise block on a human dismissing it. Read once at
 * startup; production / `dist` builds never set it, so the guard stays for real
 * users. The e2e fixture's `launchApp` sets it.
 */
const E2E_BYPASS_GUARDS = process.env.COCKPIT_E2E === '1';

/**
 * AI-Lore 1.0 — routing by detection. On with either of two inputs:
 * `AI_LORE_SPACE_ROUTING=1`, or the packaged app being the Space build
 * (`electron-builder.space.json`, `space/build-marker.ts`). Either way,
 * every folder goes through `detectFolder` and opens in a 1.0 window (the
 * Space window, the migration screen, the not-a-Space screen), and the
 * welcome window is the 1.0 welcome screen. With neither — the v0.8 build,
 * and this project's default until the switch — every folder is routed
 * exactly as before, through `checkProjectCompatibility`. Read once at
 * startup.
 */
const SPACE_ROUTING = spaceRoutingDecision(isSpaceRoutingOn(), isSpaceBuild());

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

/**
 * Per-window debounce timers for the event-driven chain re-read. A burst of
 * lore writes (a Memory reshape, a save-point) coalesces into one refresh.
 */
const chainRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Per-window tree-update coalescer — re-created at each watcher attach (its
 *  `hidden` set changes with ignore rules), disposed at teardown. */
const treeCoalescers = new Map<number, TreeUpdateCoalescer>();
/** Per-window disposer for the `.git/logs/HEAD` watchers — see {@link watchGitRefs}. */
const gitRefWatchers = new Map<number, () => void>();

/**
 * Watch each repo's `.git/logs/HEAD` — the file git appends to on every commit.
 * The working-tree watcher ignores `.git/`, so a plain `ack` (a commit with no
 * working-tree file write) would otherwise go unseen until the next window
 * focus. This makes recording an ack or save-point refresh the baseline picker
 * and re-read every pane immediately. Debounced; returns a disposer.
 */
function watchGitRefs(repoRoots: readonly string[], onCommit: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onCommit();
    }, 150);
  };
  const watchers = repoRoots.map((r) => {
    const log = join(r, '.git', 'logs', 'HEAD');
    if (!existsSync(log)) return null;
    try {
      return watchFile(log, fire);
    } catch {
      return null;
    }
  });
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w?.close();
  };
}
/** How long a lore write waits before the chain is re-read — long enough to
 *  swallow a multi-file write burst, short enough to feel live. */
const CHAIN_REFRESH_DEBOUNCE_MS = 150;

/**
 * Watcher-driven chain refresh. Replaces the old 5 s poll (Focus 5 — event-
 * driven chain): a lore-side file change schedules a single coalesced re-read
 * via the window's `refreshChain`, which JSON-compares and sends nothing when
 * the edit didn't actually move the chain. No idle reads, no staleness window.
 */
function scheduleChainRefresh(win: BrowserWindow): void {
  const existing = chainRefreshTimers.get(win.id);
  if (existing) clearTimeout(existing);
  chainRefreshTimers.set(
    win.id,
    setTimeout(() => {
      chainRefreshTimers.delete(win.id);
      contexts.get(win.id)?.refreshChain?.();
    }, CHAIN_REFRESH_DEBOUNCE_MS),
  );
}

/** Commits from a `readCommitList` result, or `[]` on failure. */
function okCommits(result: ReturnType<typeof readCommitList>): CommitListEntry[] {
  return result.kind === 'ok' ? result.commits : [];
}

/** Project a core `SavePoint` to the picker's wire shape. */
function toSavePointInfo(sp: {
  name: string;
  title: string;
  date: string;
  payloadCommit: string;
  loreCommit: string;
}): { name: string; title: string; date: string; payloadCommit: string; loreCommit: string } {
  return {
    name: sp.name,
    title: sp.title,
    date: sp.date,
    payloadCommit: sp.payloadCommit,
    loreCommit: sp.loreCommit,
  };
}

/** Build the baseline picker model for a project's two repos. The mask
 *  resolution (save-point → latest ack of its run) lives in the shared module
 *  so main and the renderer compute identical baselines. */
function buildBaselineModel(
  payloadRoot: string,
  loreWorkingTree: string,
  savePointsDir: string,
): BaselineModel {
  return buildMilestones({
    savePoints: listSavePoints(savePointsDir).map(toSavePointInfo),
    payloadCommits: okCommits(readCommitList(payloadRoot, COMMIT_LIST_LIMIT)),
    loreCommits: okCommits(readCommitList(loreWorkingTree, COMMIT_LIST_LIMIT)),
  });
}

/**
 * Re-evaluate the default milestone (latest save-point, resolved to the latest
 * ack in its run) and advance each scope's Changes baseline to it — but only
 * for a scope still *following latest* (the tracker respects a manually-pinned
 * baseline). Fixes the "a new save-point isn't reflected until reload" gap:
 * recording one re-baselines every following pane live, refreshes the commit
 * dropdowns, and re-pushes the save-point ledger. Cheap and idempotent — a
 * no-op when the latest hasn't moved. Called on a save-points-folder write and
 * on window focus (the reconcile safety net).
 */
function reconcileSavePoints(win: BrowserWindow): void {
  const ctx = contexts.get(win.id);
  if (!ctx?.wiring || isChainError(ctx.chain)) return;
  const loreWorkingTree = join(ctx.chain.lorePath, 'memory');
  const savePointsDir = resolve(ctx.chain.lorePath, 'memory/save-points');
  const def = defaultMilestone(buildBaselineModel(ctx.root, loreWorkingTree, savePointsDir));
  if (!def) return;
  ctx.wiring.changes.advanceToLatest('payload', def.payloadBaseline);
  ctx.wiring.changes.advanceToLatest('lore', def.loreBaseline);
  ctx.wiring.pushCommits('payload');
  ctx.wiring.pushCommits('lore');
  ctx.wiring.pushSavePoints();
}

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
 * Coalesces a burst of watcher directory events into one tree re-read per
 * affected parent folder (Focus 5 — bounded update churn). Each dir event
 * means a parent's children list changed; the fix used to re-read and push
 * that parent immediately, per event. A branch switch or a build fires
 * hundreds of add/unlink events, so the renderer's store took hundreds of
 * `patchTree` calls — each a full index rebuild + re-render. The coalescer
 * collects the unique (scope, parent) pairs over a short window and sends one
 * update per parent. The window ignores updates for paths it has not loaded.
 */
type TreeUpdateCoalescer = {
  schedule: (event: DirEvent) => void;
  dispose: () => void;
};

/** How long dir events accumulate before the coalesced tree re-read fires.
 *  Long enough to swallow a flood, short enough that a single rename feels
 *  instant. Pairs with chokidar's 100 ms `awaitWriteFinish` on file content. */
const TREE_UPDATE_COALESCE_MS = 100;

function makeTreeUpdateCoalescer(
  win: BrowserWindow,
  chain: ChainResult,
  hidden: readonly string[],
): TreeUpdateCoalescer {
  const pending = new Map<DirEvent['scope'], Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    if (win.isDestroyed()) {
      pending.clear();
      return;
    }
    for (const [scope, parents] of pending) {
      for (const parent of parents) {
        const node = readTreeNode(chain, parent, scope, hidden);
        sendToWin(win, CHANNELS.onTreeUpdate, {
          scope,
          path: parent,
          children: node.children ?? [],
        });
      }
    }
    pending.clear();
  };
  return {
    schedule: (event) => {
      const parent = dirname(event.absPath);
      let set = pending.get(event.scope);
      if (!set) {
        set = new Set();
        pending.set(event.scope, set);
      }
      set.add(parent);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, TREE_UPDATE_COALESCE_MS);
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}

/**
 * Keep the file-search index in step with the filesystem. File `add`/`unlink`
 * patch it in place — no re-walk. Directory events need no handling: chokidar
 * emits a file `add`/`unlink` for every file under a folder it adds or removes.
 * The service ignores patches before its first build (the lazy build reads the
 * live tree anyway). The watcher ignores the `drift` set, and `search ⊆ drift`,
 * so an `add` here is always a search-valid path.
 */
function patchSearch(search: SearchService, event: DirEvent): void {
  if (event.event === 'add') search.add(event.absPath);
  else if (event.event === 'unlink') search.remove(event.absPath);
}

/** Whether a stored window rect still lands on a connected display — guards
 *  against restoring onto a monitor that has since been unplugged (the window
 *  would open off-screen). True when the rect's centre sits in some display's
 *  work area. */
function boundsOnScreen(b: Rectangle): boolean {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return cx >= w.x && cx <= w.x + w.width && cy >= w.y && cy <= w.y + w.height;
  });
}

/** Whether layout restore (panels + window bounds) is enabled for a project —
 *  the `workspace.restoreLayout` toggle, resolved across global + project. */
function layoutRestoreOn(root: string): boolean {
  const def = SETTINGS_REGISTRY.find((d) => d.key === 'workspace.restoreLayout');
  if (!def) return false;
  return (
    resolveSetting(def, loadGlobalSettings(userDataDir), loadProjectSettings(userDataDir, root)) ===
    true
  );
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

  // Persist the window's bounds (per project), debounced, so reopening restores
  // the size/position the user left. Reads the live context at save time, so a
  // single listener follows whatever project the window currently holds; a
  // welcome window (no context) saves nothing.
  let boundsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveBounds = (): void => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      // A 1.0 window keeps nothing in the v0.8 project-data files; what 1.0
      // persists goes under `<userData>/spaces/`.
      if (spaceHost.owns(win.id)) return;
      const root = contexts.get(win.id)?.root;
      if (root && layoutRestoreOn(root)) saveWindowBounds(userDataDir, root, win.getBounds());
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.once('ready-to-show', () => win.show());
  const winId = win.id;
  win.once('closed', () => {
    void teardownContext(winId);
    // A 1.0 window also drops its record and releases its Space context.
    void spaceHost.windowClosed(winId);
  });
  // The window title is owned by main — the project name, set per window in
  // `attachProjectContext`. The renderer's <title> must not override it.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Reconcile safety net: the live model is best-effort watcher-driven, with no
  // full re-sync except this. On regaining focus, force-refresh the cheap,
  // staleness-prone surfaces — the chain (header), the changes/drift snapshot,
  // and the latest-save-point baseline — so anything a missed event left stale
  // self-heals without a window reload. The lazily-expanded file tree is left
  // to the watcher (re-initing it would collapse expanded subtrees).
  win.on('focus', () => {
    const ctx = contexts.get(win.id);
    if (!ctx?.wiring) return;
    ctx.refreshChain?.();
    ctx.wiring.changes.refreshNow();
    reconcileSavePoints(win);
    ctx.wiring.pushBranches();
  });

  // Close guard: a window with a running terminal task confirms before closing.
  let closeConfirmed = false;
  win.on('close', (event) => {
    if (closeConfirmed) return;
    if (E2E_BYPASS_GUARDS) return;
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

  // The file-search service, kept fresh by this window's watcher. The worker
  // is forked lazily on the first search (see `service.ts`) so window open
  // pays nothing.
  const search: SearchService = new WorkerSearchService();

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
    // The global baseline picker's source of truth — the save-point ledger,
    // both repos paired. The renderer builds its milestone list from this plus
    // the two commit lists.
    const pushSavePoints = (): void => {
      sendToWin(win, CHANNELS.onSavePoints, {
        savePoints: listSavePoints(savePointsDir).map(toSavePointInfo),
      });
    };
    // The header's branch indicators — both repos, re-read and pushed on the
    // same triggers that already cover a checkout (`.git/logs/HEAD` watcher +
    // the window-focus reconcile).
    const pushBranches = (): void => {
      sendToWin(win, CHANNELS.onBranches, readBranches(root, loreWorkingTree));
    };
    // The default baseline is the latest save-point, *resolved to the latest
    // ack in its run* — the mask mechanic. So both panes start at "what changed
    // since the last acknowledged state." HEAD-equivalent (`undefined`) is the
    // fallback when no save-points/acks exist. Both scopes derive from one
    // logical milestone so the panes start aligned.
    const def = defaultMilestone(buildBaselineModel(root, loreWorkingTree, savePointsDir));
    const initialBaselineByScope = def
      ? { payload: def.payloadBaseline, lore: def.loreBaseline }
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
    treeCoalescers.get(win.id)?.dispose();
    const treeCoalescer = makeTreeUpdateCoalescer(win, chain, hidden);
    treeCoalescers.set(win.id, treeCoalescer);
    const watcher = attachWatcher({
      root,
      lorePath: chain.lorePath,
      ignored: ignoreLists.drift,
      onFileChange: (event) => {
        changes.scheduleRefresh(event.scope);
        if (event.scope === 'lore') {
          // A lore write may have moved the focus chain — re-read it, debounced.
          scheduleChainRefresh(win);
          // A new save-point should re-baseline following panes live.
          if (event.absPath.startsWith(savePointsDir)) reconcileSavePoints(win);
        }
      },
      onDirEvent: (event) => {
        patchSearch(search, event);
        treeCoalescer.schedule(event);
      },
    });
    // Refresh on commit (ack or save-point) even when no working-tree file
    // changes — the `.git` watcher the working-tree watcher can't provide.
    gitRefWatchers.get(win.id)?.();
    gitRefWatchers.set(
      win.id,
      watchGitRefs([root, loreWorkingTree], () => {
        changes.refreshNow();
        reconcileSavePoints(win);
        // `.git/logs/HEAD` also moves on a checkout — the branch may have changed.
        pushBranches();
      }),
    );
    wiring = { watcher, changes, pushCommits, pushSavePoints, pushBranches };
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

  return { root, chain, wiring, ptyService, ignoreLists, search, promptsWatcherClose };
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

  // Restore the project's last window bounds before the window is first shown
  // (so there's no resize flash). Only for a not-yet-visible window — reusing a
  // visible window for another project should not make it jump. Gated by the
  // same toggle as the in-window layout restore.
  if (!win.isVisible() && !isChainError(ctx.chain) && layoutRestoreOn(root)) {
    const bounds = loadWindowBounds(userDataDir, root);
    if (bounds && boundsOnScreen(bounds)) win.setBounds(bounds);
    else if (bounds) win.setSize(bounds.width, bounds.height); // off-screen pos → size only
  }

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
      // Seed the baseline dropdown for both repos, plus the save-point ledger
      // the global picker masks over.
      ctx.wiring.pushCommits('payload');
      ctx.wiring.pushCommits('lore');
      ctx.wiring.pushSavePoints();
      ctx.wiring.pushBranches();
    }
    sendToWin(win, CHANNELS.onTreeInit, buildTreeInitPayload(chain, ctx.ignoreLists.hidden));
  });

  // Re-read the chain so the header reflects status / focus / active-child
  // edits without a window reload. Event-driven (Focus 5): the window's lore
  // watcher calls this (debounced) on a lore write — no polling. The chain is
  // small (status + focus + active-child paths and titles) and cheap to walk;
  // we compare via JSON to skip the IPC send when nothing changed. Exposed on
  // the context as `refreshChain` so the watcher trigger and main-side
  // mutations both push the new state to the renderer immediately.
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
  // A 1.0 window runs detection again and shows what its folder now is.
  if (spaceHost.owns(win.id)) {
    await spaceHost.reload(win);
    return;
  }
  const ctx = contexts.get(win.id);
  if (!ctx) return;
  const root = ctx.root;
  await teardownContext(win.id);
  if (win.isDestroyed()) return;
  win.webContents.reload();
  attachProjectContext(win, root);
}

/** Canonicalise a project root for identity comparison — resolve symlinks and
 *  on-disk case via `realpath`, falling back to a plain resolve when the path
 *  can't be stat'd (e.g. it has since moved). */
function canonicalRoot(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return resolve(root);
  }
}

/** An already-open window showing this project root, if any — matched by
 *  canonical path so symlinked / differently-cased spellings still collapse. */
function windowForRoot(root: string): BrowserWindow | null {
  const target = canonicalRoot(root);
  for (const [winId, ctx] of contexts) {
    if (canonicalRoot(ctx.root) !== target) continue;
    const win = BrowserWindow.fromId(winId);
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

/**
 * Route an open request. If the project is already open in a window, that
 * window is brought to the foreground (no duplicate). Otherwise a welcome
 * window — no context — is replaced in place; a project window, or a menu
 * action with no focused window, opens a new one.
 *
 * With detection routing on (`AI_LORE_SPACE_ROUTING=1`) the request goes to the
 * Space host, which runs `detectFolder` and opens a 1.0 window. Without it the
 * request is routed as before, by {@link showProjectV08}.
 */
function showProject(win: BrowserWindow | undefined, root: string): void {
  if (SPACE_ROUTING) {
    void spaceHost.openFolder(win, root).catch((caught: unknown) => {
      spaceLog.error('open-folder-failed', {
        folder: root,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    });
    return;
  }
  showProjectV08(win, root);
}

/** Today's routing, unchanged: no detection, `checkProjectCompatibility` decides
 *  between the cockpit and the altered window. Also the path of the migration
 *  screen's "Open in the v0.8 cockpit". */
function showProjectV08(win: BrowserWindow | undefined, root: string): void {
  const existing = windowForRoot(root);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
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
      onRemoveRecent: (path) => {
        removeRecent(userDataDir, path);
        rebuildMenu();
      },
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
  const reattachSavePointsDir = resolve(chain.lorePath, 'memory/save-points');
  const globalRules = mergeIgnoreRules(
    DEFAULT_IGNORE_RULES,
    loadGlobalSettings(userDataDir).ignores,
  );
  const rules = mergeIgnoreRules(globalRules, loadProjectSettings(userDataDir, ctx.root).ignores);
  ctx.ignoreLists = deriveIgnoreLists(rules);
  const { hidden, drift } = ctx.ignoreLists;

  // The search-ignore set may have changed — drop the index so the next search
  // rebuilds it against the new rules.
  ctx.search.invalidate();

  // Re-attach the watcher so its drift filter reflects the new rules.
  void wiring.watcher.close().then(() => {
    if (contexts.get(win.id) !== ctx) return;
    // Rebuild the coalescer with the new hidden set (it bakes `hidden` in).
    treeCoalescers.get(win.id)?.dispose();
    const treeCoalescer = makeTreeUpdateCoalescer(win, chain, hidden);
    treeCoalescers.set(win.id, treeCoalescer);
    wiring.watcher = attachWatcher({
      root: ctx.root,
      lorePath: chain.lorePath,
      ignored: drift,
      onFileChange: (event) => {
        wiring.changes.scheduleRefresh(event.scope);
        if (event.scope === 'lore') {
          scheduleChainRefresh(win);
          if (event.absPath.startsWith(reattachSavePointsDir)) reconcileSavePoints(win);
        }
      },
      onDirEvent: (event) => {
        patchSearch(ctx.search, event);
        treeCoalescer.schedule(event);
      },
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
  // The read-only helper (AI Helper) is likewise app infra keyed by window —
  // kill its PTY + drop its temp dir even if no cockpit context was built.
  disposeHelperForWindow(winId);

  const ctx = contexts.get(winId);
  if (!ctx) return;
  contexts.delete(winId);

  const pendingChainRefresh = chainRefreshTimers.get(winId);
  if (pendingChainRefresh) {
    clearTimeout(pendingChainRefresh);
    chainRefreshTimers.delete(winId);
  }
  treeCoalescers.get(winId)?.dispose();
  treeCoalescers.delete(winId);
  gitRefWatchers.get(winId)?.();
  gitRefWatchers.delete(winId);

  ctx.ptyService.killAll();
  ctx.search.dispose();
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
  // AI-Lore 1.0 — dispose every open Space's services (watchers, timers).
  await spaceHost.dispose();
  // Close the shared helper middleman server too — per-window teardown above
  // killed each helper PTY, but the singleton HTTP ingress is app-wide.
  await disposeAllHelpers();
}

/** Open the window this launch (or dock re-activation) calls for. */
function openLaunchWindow(): void {
  if (SPACE_ROUTING) {
    void spaceHost.launch(launchRoot);
    return;
  }
  if (launchRoot) {
    openProjectWindow(launchRoot);
  } else {
    openWelcomeWindow();
  }
}

/** The Electron window behind a 1.0 window handle, unless it has been destroyed. */
function browserWindowOf(window: SpaceWindowLike | undefined): BrowserWindow | undefined {
  if (!window) return undefined;
  const win = BrowserWindow.fromId(window.id);
  return win && !win.isDestroyed() ? win : undefined;
}

/**
 * Give a 1.0 window a terminal rooted at `folder`. The window gets the same
 * reduced context an altered window has — no chain, no watcher, no trackers,
 * a PTY service — so the existing terminal, browser-tab and settings channels
 * serve it unchanged, the close guard sees its running tasks, and
 * `teardownContext` kills its PTYs when it closes.
 */
function attachTerminalContext(window: SpaceWindowLike, folder: string): ProjectContext {
  // `sendToWin` drops a message for a window that has been destroyed.
  const win = BrowserWindow.fromId(window.id);
  const send = (channel: string, payload: unknown): void => {
    if (win) sendToWin(win, channel, payload);
  };
  const ptyService = createPtyService({
    cwd: folder,
    onData: (id, data) => send(CHANNELS.onTerminalData, { id, data }),
    onExit: (id) => send(CHANNELS.onTerminalExit, { id }),
    onStatus: (id, status, command) => send(CHANNELS.onTerminalStatus, { id, status, command }),
  });
  const ctx: ProjectContext = {
    root: folder,
    chain: { error: 'This window is an AI-Lore 1.0 window; it reads no v0.8 tracker chain.' },
    wiring: null,
    ptyService,
    ignoreLists: { drift: [], search: [], hidden: [] },
    search: new WorkerSearchService(),
    // The search channels of a 1.0 window search this folder only.
    searchDirs: [folder],
  };
  contexts.set(window.id, ctx);
  return ctx;
}

/** The log of the 1.0 code: JSON lines under `<userData>/logs/`, and the console. */
const spaceLog = createSpaceLog({ logsDir: () => join(userDataDir, 'logs') });

/**
 * The command runner of the 1.0 code (`git`, `gh`). Whether it may start `gh`
 * is an option of the runner, not a variable in `process.env`, so no terminal
 * the app starts inherits the permission; an end-to-end or test run may not
 * reach live GitHub. Built before any terminal exists.
 */
const appCommands = createAppCommandRunner(process.env);

/**
 * The same runner, carrying the Human Lead's own `PATH`. A Finder-launched app
 * inherits a minimal `PATH` that holds no Homebrew prefix, so `gh` is not found
 * without this (`space/login-shell-runner.ts`).
 */
const spaceRunner = createLoginShellRunner(appCommands.runner);

/**
 * The Space host — everything AI-Lore 1.0 adds to main: routing by detection,
 * the 1.0 windows, one Space context per open Space. It gets its windows from
 * {@link createWindow}, so a 1.0 window has the same `webPreferences` (preload,
 * sandbox, context isolation, no Node integration), close guard and title rule
 * as every other window.
 */
const spaceHost: SpaceHost = createSpaceHost({
  spaceRouting: SPACE_ROUTING,
  userDataDir: () => userDataDir,
  runner: spaceRunner,
  git: createGitPort(spaceRunner),
  log: spaceLog,
  createWindow,
  pickFolder: async (window) => {
    const opts: OpenDialogOptions = {
      title: 'Open a folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const win = browserWindowOf(window);
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const [folder] = result.filePaths;
    return result.canceled || !folder ? null : folder;
  },
  attachTerminal: (window, folder) => attachTerminalContext(window, folder).ptyService,
  detachWindow: teardownContext,
  focusCockpitWindowFor: (folder) => {
    const existing = windowForRoot(folder);
    if (!existing) return false;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return true;
  },
  openV08: (window, folder) => showProjectV08(browserWindowOf(window), folder),
  // What a Space remembers of its windows' positions (M5.7), kept under `<userData>/spaces/`.
  windowBounds: (window) => {
    const win = browserWindowOf(window);
    if (!win) return undefined;
    return {
      get: () =>
        win.isDestroyed() || win.isMinimized() || win.isMaximized() || win.isFullScreen()
          ? null
          : win.getBounds(),
      set: (rect) => {
        // A position on a display that is no longer connected keeps only the size.
        if (boundsOnScreen(rect)) win.setBounds(rect);
        else win.setSize(rect.width, rect.height);
      },
      onChange: (listener) => {
        win.on('move', listener);
        win.on('resize', listener);
        win.on('close', listener);
      },
    };
  },
});

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
  removeRecent: (path: string) => {
    const next = removeRecent(userDataDir, path);
    rebuildMenu();
    return next;
  },
  space: spaceHost,
};

app.whenReady().then(() => {
  userDataDir = app.getPath('userData');
  if (SPACE_ROUTING) {
    spaceLog.info('app-started', { spaceRouting: true, liveGitHub: appCommands.liveGitHub });
  }
  // v0.6 Phase A — bring the Apps catalog to the current schema version
  // before any window reads settings. v1 folds in legacy folder shortcuts;
  // v2 cleans labels + dedups. Idempotent + version-gated.
  runAppsMigrations(userDataDir);
  registerCockpitIpc(ipcMain, ipcDeps);
  rebuildMenu();

  // CR10 — bring the local MCP host up at boot so it is ready before any
  // Connect ("provide an MCP locally as soon as you start up"). Fire-and-forget:
  // binding is non-fatal and the rest of boot must not wait on it.
  void startMcpHost();

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
  if (!quitConfirmed && !E2E_BYPASS_GUARDS) {
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
