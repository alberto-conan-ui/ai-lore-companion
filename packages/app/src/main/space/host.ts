/**
 * The Space host: what the 1.0 code in main offers to `main/index.ts` and to
 * every 1.0 IPC module, which reads it as `deps.space`.
 *
 * It opens a folder through detection, moves a window between the screens that
 * have no folder, opens the Files window of a Space, carries out "Open in the
 * v0.8 cockpit", and answers which Space context and which 1.0 window an IPC
 * call came from.
 *
 * It imports nothing from Electron. What it needs from the app (a new window,
 * the folder dialog, a terminal for a window, today's way of opening a folder)
 * it is given as `SpaceHostBindings`, by `main/index.ts` in the app and by a
 * test in the headless suite.
 */

import type { CommandRunner, FolderKind, GitPort, detectFolder } from '@ai-lore-companion/core';
import type {
  OpenInFiles,
  RecentSpace,
  SetupStart,
  SpaceNavigateArg,
  SpaceWindowFailure,
  SpaceWindowInitPayload,
  SpaceWindowResult,
} from '../../shared/ipc.js';
import type { PtyService } from '../pty.js';
import { type SpaceContext, type SpaceContextStore, createSpaceContextStore } from './context.js';
import type { SpaceLog } from './log.js';
import {
  type RecentSpaceLookup,
  addRecentSpace,
  loadRecentSpaces,
  removeRecentSpace,
  resolveRecentSpace,
} from './recents.js';
import { type FolderRoute, routeFolder, windowTitleFor } from './routing.js';
import {
  type SpaceWindowBounds,
  boundsConcernFor,
  restoreWindowBounds,
  trackWindowBounds,
} from './window-bounds.js';
import {
  type SpaceWindowLike,
  type SpaceWindowRecord,
  type SpaceWindows,
  createSpaceWindows,
} from './windows.js';

/** The part of an IPC event the host reads: the web contents the call came from. */
export type SpaceIpcEvent = {
  readonly sender: { readonly id: number; readonly mainFrame?: unknown };
  /** The frame the call came from. Electron gives `null` when that frame is gone. */
  readonly senderFrame?: unknown;
};

/**
 * Whether the call came from the top frame of its web contents. A frame inside
 * the page (an `iframe`) has the same web contents id as the window, so the id
 * alone does not tell them apart. A stand-in event of a test carries no frame.
 */
function fromMainFrame(event: SpaceIpcEvent): boolean {
  if (event.senderFrame === undefined || event.sender.mainFrame === undefined) return true;
  return event.senderFrame !== null && event.senderFrame === event.sender.mainFrame;
}

/** What the host is given by the app. */
export type SpaceHostBindings = {
  /** Whether detection routing is on; `isSpaceRoutingOn()` when the app starts. */
  spaceRouting: boolean;
  /** `app.getPath('userData')`. A function, because it is known only once the app is ready. */
  userDataDir: () => string;
  /**
   * The app's own command runner (`createAppCommandRunner`). It alone carries
   * the permission to start `gh`; the permission is not in `process.env`.
   */
  runner: CommandRunner;
  /** Used by detection, for read commands only. */
  git: GitPort;
  log: SpaceLog;
  /** A new window that is loading the renderer, with the `webPreferences` every window has. */
  createWindow: () => SpaceWindowLike;
  /** Ask the Human Lead for a folder; `null` when the dialog was cancelled. */
  pickFolder: (window: SpaceWindowLike | undefined) => Promise<string | null>;
  /**
   * Give the window a terminal rooted at `folder`, through the terminal
   * channels the app has today. Returns the PTY service the window now has.
   */
  attachTerminal: (window: SpaceWindowLike, folder: string) => PtyService;
  /** Tear down what the app holds for the window: its terminals, its browser tabs, its helper. */
  detachWindow: (windowId: number) => Promise<void>;
  /** Bring the cockpit window of `folder` to the front when there is one; true when there was. */
  focusCockpitWindowFor: (folder: string) => boolean;
  /** Open `folder` the way the app does without detection routing, in `window` when it holds nothing. */
  openV08: (window: SpaceWindowLike | undefined, folder: string) => void;
  /** Replaces `detectFolder` in a test. */
  detect?: typeof detectFolder;
  /** The position of a window, for what a Space remembers (M5.7). Without it, positions are not kept. */
  windowBounds?: (window: SpaceWindowLike) => SpaceWindowBounds | undefined;
};

/** What `deps.space` is. */
export type SpaceHost = {
  /** Whether detection routing is on. */
  readonly routingOn: boolean;
  readonly log: SpaceLog;
  /**
   * The command runner every 1.0 module of main uses for `git` and `gh`. A
   * module does not import core's `execFileRunner`: that one may never start `gh`.
   */
  readonly runner: CommandRunner;
  /** `app.getPath('userData')`. */
  userDataDir(): string;
  /**
   * The Space context of the window an IPC call came from. `undefined` when
   * the call did not come from the own web contents of a window of a Space, so
   * a page in an embedded browser tab gets none.
   */
  contextFor(event: SpaceIpcEvent): SpaceContext | undefined;
  /** The 1.0 window an IPC call came from, by the same rule as `contextFor`. */
  windowFor(event: SpaceIpcEvent): SpaceWindowRecord | undefined;
  /** The context of an open Space by its key. */
  contextForKey(key: string): SpaceContext | undefined;
  /** Send a push to every window of the Space at `root`. */
  sendToSpace(root: string, channel: string, payload: unknown): void;
  /**
   * Open `folder` through detection, in `window` when that window shows no
   * folder, otherwise in a new window. A folder that is already open is
   * brought to the front. Main calls this with a path it trusts (the folder
   * dialog, the launch argument, a Space that setup just created); a path
   * from the renderer is checked by the IPC handler first.
   */
  openFolder(window: SpaceWindowLike | undefined, folder: string): Promise<SpaceWindowResult>;
  /** Ask for a folder, then open it. */
  promptAndOpenFolder(window: SpaceWindowLike | undefined): Promise<SpaceWindowResult>;
  /** Show the 1.0 welcome screen, in `window` when it shows no folder, otherwise in a new window. */
  openWelcome(window?: SpaceWindowLike, notice?: string): void;
  /** Open the window a launch calls for: `root` through detection, or the welcome screen. */
  launch(root: string | null): Promise<void>;
  /** Show another screen in the window. See `SpaceNavigateArg` for what is accepted from where. */
  navigate(window: SpaceWindowLike, arg: SpaceNavigateArg): Promise<SpaceWindowResult>;
  /** Open the Files window of an open Space, or show it when it is open, on `open` when given. */
  openFilesWindow(context: SpaceContext, open?: OpenInFiles): void;
  /** "Open in the v0.8 cockpit". Accepted only from the migration screen; uses the window's own folder. */
  openInCockpit(window: SpaceWindowLike): Promise<SpaceWindowResult>;
  /** Run detection again for the window's folder and show what it now is. */
  reload(window: SpaceWindowLike): Promise<void>;
  /** Whether the window is a 1.0 window. */
  owns(windowId: number): boolean;
  /**
   * Whether the window may write what its Space remembers (M5.7): true unless
   * another window of the same Space has the focus. Only the focused window
   * writes, so that the two windows do not overwrite each other; when the app
   * is in the background, no window has the focus and either may write.
   */
  mayRemember(windowId: number): boolean;
  /** The window closed. Its record is dropped and its Space context released. */
  windowClosed(windowId: number): Promise<void>;
  /** The recents of Spaces, newest first. */
  recentSpaces(): RecentSpace[];
  /**
   * The recent Space the renderer named with `folder`: whether it is one, and
   * whether its folder still resolves where it did when it was opened.
   */
  resolveRecentSpace(folder: string): RecentSpaceLookup;
  /** Drop one Space from the recents; returns the updated list. */
  removeRecentSpace(path: string): RecentSpace[];
  /** Tear down every Space context. Called when the app quits. */
  dispose(): Promise<void>;
};

/** The parts of the host a test may look at. */
export type SpaceHostInternals = { windows: SpaceWindows; contexts: SpaceContextStore };

const FOLDER_MODES = ['space', 'migration', 'not-a-space'] as const;

function failure(kind: SpaceWindowFailure['kind'], message: string): SpaceWindowResult {
  return { ok: false, error: { kind, message } };
}

function shown(mode: SpaceWindowInitPayload['mode'] | 'cockpit'): SpaceWindowResult {
  return { ok: true, value: { mode } };
}

/** Build the host. */
export function createSpaceHost(bindings: SpaceHostBindings): SpaceHost & SpaceHostInternals {
  const { log } = bindings;
  const windows = createSpaceWindows();
  const contexts = createSpaceContextStore({
    userDataDir: bindings.userDataDir,
    log,
    runner: bindings.runner,
  });
  /** What detection said about the folder each window shows. */
  const detectedByWindow = new Map<number, FolderKind>();

  const usable = (window: SpaceWindowLike | undefined): window is SpaceWindowLike =>
    window !== undefined && !window.isDestroyed();

  /** A window that is a 1.0 window and shows no folder can be given another screen or a folder. */
  const holdsNoFolder = (window: SpaceWindowLike): boolean => {
    const record = windows.recordFor(window.id);
    return record !== undefined && record.folder === null;
  };

  /** Windows whose moves are already followed. */
  const boundsTracked = new Set<number>();

  /**
   * Give a window created for a Space its saved position, and save its moves
   * from now on (M5.7). The concern is read at each move, from what the window
   * shows then.
   */
  const rememberBounds = (
    window: SpaceWindowLike,
    context: SpaceContext,
    concern: 'space-window' | 'files-window',
    restore: boolean,
  ): void => {
    const bounds = bindings.windowBounds?.(window);
    if (!bounds) return;
    if (restore) restoreWindowBounds(bounds, context, concern);
    if (boundsTracked.has(window.id)) return;
    boundsTracked.add(window.id);
    trackWindowBounds(bounds, () => {
      if (window.isDestroyed()) return null;
      const held = contexts.forWindow(window.id);
      const mode = windows.recordFor(window.id)?.init.mode;
      const now = mode === undefined ? null : boundsConcernFor(mode);
      if (!held || now === null || !host.mayRemember(window.id)) return null;
      return { context: held, concern: now };
    });
  };

  const bringToFront = (window: SpaceWindowLike): void => {
    if (window.isMinimized()) window.restore();
    window.focus();
  };

  /** Drop the window's folder: its terminal, its Space context, what detection said. */
  const detachFolder = async (window: SpaceWindowLike): Promise<void> => {
    detectedByWindow.delete(window.id);
    const context = contexts.forWindow(window.id);
    const record = windows.recordFor(window.id);
    if (context && record?.init.mode === 'space') context.ptyService = null;
    await contexts.release(window.id);
    await bindings.detachWindow(window.id);
  };

  /** Show a routed folder in `window`. `fresh` says that the window was created for it. */
  const attachFolder = (
    window: SpaceWindowLike,
    route: Extract<FolderRoute, { route: 'space-window' }>,
    fresh: boolean,
  ): void => {
    const { detected, init } = route;
    detectedByWindow.set(window.id, detected);
    const ptyService = bindings.attachTerminal(window, detected.root);
    if (detected.kind === 'space') {
      const context = contexts.acquire({
        root: detected.root,
        manifest: detected.manifest,
        windowId: window.id,
      });
      context.ptyService = ptyService;
      rememberBounds(window, context, 'space-window', fresh);
      addRecentSpace(bindings.userDataDir(), {
        path: detected.root,
        name: detected.manifest.name,
      });
    }
    window.setTitle(windowTitleFor(init));
    windows.show(window, init, fresh ? 'after-load' : 'reload-then-send');
    log.info('folder-detected', {
      folder: detected.root,
      kind: detected.kind,
      mode: init.mode,
      reason: detected.reason,
    });
  };

  /** Show a screen that has no folder. The window's folder, if it has one, is dropped first. */
  const showScreen = async (
    window: SpaceWindowLike,
    init: Extract<SpaceWindowInitPayload, { mode: 'space-welcome' | 'machine-check' | 'setup' }>,
  ): Promise<void> => {
    const hadFolder = !holdsNoFolder(window) && windows.recordFor(window.id) !== undefined;
    if (hadFolder) await detachFolder(window);
    window.setTitle('AI-Lore');
    // A window that showed a folder is reloaded, so that nothing of its terminal stays in the page.
    windows.show(window, init, hadFolder ? 'reload-then-send' : 'now');
  };

  const welcomeInit = (
    notice?: string,
  ): Extract<SpaceWindowInitPayload, { mode: 'space-welcome' }> => ({
    mode: 'space-welcome',
    recents: loadRecentSpaces(bindings.userDataDir()),
    ...(notice === undefined ? {} : { notice }),
  });

  const host: SpaceHost & SpaceHostInternals = {
    windows,
    contexts,
    routingOn: bindings.spaceRouting,
    log,
    runner: bindings.runner,
    userDataDir: bindings.userDataDir,

    windowFor: (event) =>
      fromMainFrame(event) ? windows.recordForWebContents(event.sender.id) : undefined,
    contextFor(event) {
      const record = host.windowFor(event);
      return record ? contexts.forWindow(record.window.id) : undefined;
    },
    contextForKey: (key) => contexts.forKey(key),
    sendToSpace: (root, channel, payload) => windows.sendToSpace(root, channel, payload),

    async openFolder(window, folder) {
      const route = await routeFolder(folder, {
        spaceRouting: bindings.spaceRouting,
        git: bindings.git,
        detect: bindings.detect,
      });
      if (route.route === 'failed') {
        log.warn('folder-not-detected', { folder, kind: route.error.kind });
        return { ok: false, error: route.error };
      }
      if (route.route === 'v08-routing') {
        bindings.openV08(window, folder);
        return shown('cockpit');
      }
      const open = windows.findByFolder(route.root, FOLDER_MODES);
      if (open) {
        bringToFront(open.window);
        return shown(open.init.mode);
      }
      if (bindings.focusCockpitWindowFor(route.root)) return shown('cockpit');
      if (usable(window) && holdsNoFolder(window)) {
        attachFolder(window, route, false);
      } else {
        attachFolder(bindings.createWindow(), route, true);
      }
      return shown(route.init.mode);
    },

    async promptAndOpenFolder(window) {
      const folder = await bindings.pickFolder(usable(window) ? window : undefined);
      if (folder === null) return failure('cancelled', 'No folder was chosen.');
      return host.openFolder(window, folder);
    },

    openWelcome(window, notice) {
      if (usable(window) && holdsNoFolder(window)) {
        window.setTitle('AI-Lore');
        windows.show(window, welcomeInit(notice), 'now');
        return;
      }
      windows.show(bindings.createWindow(), welcomeInit(notice), 'after-load');
    },

    async launch(root) {
      if (root === null) {
        host.openWelcome();
        return;
      }
      const result = await host.openFolder(undefined, root);
      if (!result.ok) host.openWelcome(undefined, result.error.message);
    },

    async navigate(window, arg) {
      const record = windows.recordFor(window.id);
      if (!record)
        return failure('not-a-space-window', 'This window is not an AI-Lore 1.0 window.');
      const mode = record.init.mode;

      if (arg.to === 'space-files') {
        const context = contexts.forWindow(window.id);
        if (!context || (mode !== 'space' && mode !== 'space-files')) {
          return failure('not-allowed-here', 'The Files window opens from a window of a Space.');
        }
        host.openFilesWindow(context, arg.open);
        return shown('space-files');
      }

      if (mode === 'space' || mode === 'space-files') {
        return failure(
          'not-allowed-here',
          'A window of a Space does not change to another screen.',
        );
      }

      if (arg.to === 'space-welcome') {
        await showScreen(window, welcomeInit());
        return shown('space-welcome');
      }
      if (arg.to === 'machine-check') {
        await showScreen(window, { mode: 'machine-check' });
        return shown('machine-check');
      }

      let start: SetupStart;
      if (arg.start === 'about-this-folder') {
        const detected = detectedByWindow.get(window.id);
        if (mode !== 'not-a-space' || detected?.kind !== 'plain-repository') {
          return failure(
            'not-allowed-here',
            'A Space about a folder is created from the screen of a plain git repository.',
          );
        }
        start = { kind: 'about-repository', folder: detected.root, originUrl: detected.originUrl };
      } else {
        start = { kind: arg.start };
      }
      await showScreen(window, { mode: 'setup', start });
      return shown('setup');
    },

    async openInCockpit(window) {
      const record = windows.recordFor(window.id);
      if (!record || record.init.mode !== 'migration' || record.folder === null) {
        return failure(
          'not-allowed-here',
          'Open in the v0.8 cockpit is an action of the migration screen.',
        );
      }
      const folder = record.folder;
      log.info('open-in-v08-cockpit', { folder });
      await detachFolder(window);
      windows.forget(window.id);
      bindings.openV08(window, folder);
      return shown('cockpit');
    },

    async reload(window) {
      const record = windows.recordFor(window.id);
      if (!record) return;
      if (record.init.mode === 'space-files') {
        const context = contexts.forWindow(window.id);
        if (context) windows.show(window, record.init, 'reload-then-send');
        return;
      }
      if (record.folder === null) {
        const init = record.init.mode === 'space-welcome' ? welcomeInit() : record.init;
        windows.show(window, init, 'reload-then-send');
        return;
      }
      const folder = record.folder;
      await detachFolder(window);
      if (window.isDestroyed()) return;
      const route = await routeFolder(folder, {
        spaceRouting: true,
        git: bindings.git,
        detect: bindings.detect,
      });
      if (window.isDestroyed()) return;
      if (route.route === 'space-window') {
        attachFolder(window, route, false);
        return;
      }
      const reason = route.route === 'failed' ? route.error.message : `${folder} was not read.`;
      log.warn('folder-not-detected', { folder });
      windows.show(
        window,
        { mode: 'not-a-space', folder, plainRepository: false, reason },
        'reload-then-send',
      );
    },

    owns: (windowId) => windows.recordFor(windowId) !== undefined,

    mayRemember(windowId) {
      const context = contexts.forWindow(windowId);
      if (!context) return false;
      return ![...context.windowIds].some(
        (other) => other !== windowId && windows.recordFor(other)?.window.isFocused?.() === true,
      );
    },

    async windowClosed(windowId) {
      const context = contexts.forWindow(windowId);
      if (context && windows.recordFor(windowId)?.init.mode === 'space') context.ptyService = null;
      detectedByWindow.delete(windowId);
      boundsTracked.delete(windowId);
      windows.forget(windowId);
      await contexts.release(windowId);
    },

    recentSpaces: () => loadRecentSpaces(bindings.userDataDir()),
    resolveRecentSpace: (folder) => resolveRecentSpace(bindings.userDataDir(), folder),
    removeRecentSpace: (path) => removeRecentSpace(bindings.userDataDir(), path),

    async dispose() {
      detectedByWindow.clear();
      await contexts.releaseAll();
    },

    openFilesWindow(context: SpaceContext, open?: OpenInFiles): void {
      const space = {
        root: context.root,
        key: context.key,
        name: context.manifest.name,
        manifest: context.manifest,
      };
      const init: SpaceWindowInitPayload = {
        mode: 'space-files',
        space,
        ...(open === undefined ? {} : { open }),
      };
      const existing = windows.findByFolder(context.root, ['space-files']);
      if (existing) {
        windows.show(existing.window, init, 'now');
        bringToFront(existing.window);
        return;
      }
      const window = bindings.createWindow();
      contexts.acquire({ root: context.root, manifest: context.manifest, windowId: window.id });
      rememberBounds(window, context, 'files-window', true);
      window.setTitle(`${space.name === '' ? context.root : space.name} — Files`);
      windows.show(window, init, 'after-load');
      log.info('files-window-opened', { space: context.key });
    },
  };

  return host;
}
