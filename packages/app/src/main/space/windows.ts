/**
 * The 1.0 windows: which windows main has told to be a 1.0 window, what each
 * was told, and how it is told.
 *
 * 1.0 adds windows, not processes. Every 1.0 window loads the same renderer
 * bundle as the cockpit window and differs by its `WindowInitPayload`. A 1.0
 * window is not built here: it comes from the factory the host is given, which
 * in the app is `createWindow` of `main/index.ts`. So a 1.0 window has the same
 * `webPreferences` as every other window (the preload script, `sandbox` on,
 * `contextIsolation` on, `nodeIntegration` off), the same close guard and the
 * same title rule, and there is one place where those are set.
 *
 * This file imports nothing from Electron. `SpaceWindowLike` is the part of
 * `BrowserWindow` it uses, so a headless test passes a stand-in.
 */

import { CHANNELS, type SpaceWindowInitPayload } from '../../shared/ipc.js';
import { canonicalFolder } from './folders.js';

/** The part of Electron's `BrowserWindow` the 1.0 window code uses. */
export type SpaceWindowLike = {
  readonly id: number;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  /** Whether the window has the focus. A stand-in without it is taken as not focused. */
  isFocused?(): boolean;
  setTitle(title: string): void;
  readonly webContents: {
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
    once(event: 'did-finish-load', listener: () => void): unknown;
    reload(): void;
  };
};

/** What main recorded for one 1.0 window. */
export type SpaceWindowRecord = {
  readonly window: SpaceWindowLike;
  /** What the window was last told it is. */
  init: SpaceWindowInitPayload;
  /** The folder the window shows, resolved; `null` for a screen with no folder. */
  folder: string | null;
};

/**
 * How the payload reaches the window. `after-load`: the window is loading, or
 * is reloaded here first, and the payload is sent when the page has loaded,
 * as the cockpit window does. `now`: the page is loaded and only the screen
 * changes, so the payload is sent at once.
 */
export type SpaceWindowDelivery = 'after-load' | 'reload-then-send' | 'now';

/** The folder a payload is about, or `null`. */
export function folderOfInit(init: SpaceWindowInitPayload): string | null {
  switch (init.mode) {
    case 'space':
    case 'space-files':
      return init.space.root;
    case 'migration':
    case 'not-a-space':
      return init.folder;
    default:
      return null;
  }
}

/** The registry of 1.0 windows. */
export type SpaceWindows = {
  /** Record `init` for the window and deliver it. */
  show(window: SpaceWindowLike, init: SpaceWindowInitPayload, delivery: SpaceWindowDelivery): void;
  /** The record of a window, when it is a 1.0 window. */
  recordFor(windowId: number): SpaceWindowRecord | undefined;
  /** The record whose window's own web contents has this id. An embedded browser tab has another id. */
  recordForWebContents(webContentsId: number): SpaceWindowRecord | undefined;
  /** The window is no longer a 1.0 window (it closed, or it became a cockpit window). */
  forget(windowId: number): void;
  /** The open window that shows `folder` in one of `modes`, compared after symbolic links are resolved. */
  findByFolder(
    folder: string,
    modes: readonly SpaceWindowInitPayload['mode'][],
  ): SpaceWindowRecord | undefined;
  /** The open window shown in `mode`, if there is one. */
  findByMode(mode: SpaceWindowInitPayload['mode']): SpaceWindowRecord | undefined;
  /** Every open 1.0 window. */
  all(): SpaceWindowRecord[];
  /** Send a push to every window that shows the Space at `root` (the Space window and the Files window). */
  sendToSpace(root: string, channel: string, payload: unknown): void;
};

/** Build the registry. */
export function createSpaceWindows(): SpaceWindows {
  const records = new Map<number, SpaceWindowRecord>();

  const send = (window: SpaceWindowLike, channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const live = (): SpaceWindowRecord[] =>
    [...records.values()].filter((record) => !record.window.isDestroyed());

  return {
    show(window, init, delivery) {
      if (init.mode === 'space' || init.mode === 'space-files') {
        const title = init.space.name || init.space.root.split('/').pop() || 'Space';
        let h = 0;
        for (let i = 0; i < title.length; i += 1) h = (h * 31 + title.charCodeAt(i)) | 0;
        const hue = ((h % 360) + 360) % 360;
        init.spaceTitle = title;
        init.colorScheme = hue.toString();
      }
      const record: SpaceWindowRecord = { window, init, folder: folderOfInit(init) };
      records.set(window.id, record);
      if (delivery === 'now') {
        send(window, CHANNELS.onWindowInit, init);
        return;
      }
      if (delivery === 'reload-then-send') window.webContents.reload();
      window.webContents.once('did-finish-load', () => {
        // The window may have been told something else while the page loaded; what it
        // was told last is what it is. A window that was forgotten is told nothing.
        const current = records.get(window.id);
        if (current) send(window, CHANNELS.onWindowInit, current.init);
      });
    },
    recordFor: (windowId) => records.get(windowId),
    recordForWebContents: (webContentsId) =>
      live().find((record) => record.window.webContents.id === webContentsId),
    forget(windowId) {
      records.delete(windowId);
    },
    findByFolder(folder, modes) {
      const target = canonicalFolder(folder);
      return live().find(
        (record) =>
          record.folder !== null &&
          modes.includes(record.init.mode) &&
          canonicalFolder(record.folder) === target,
      );
    },
    findByMode: (mode) => live().find((record) => record.init.mode === mode),
    all: live,
    sendToSpace(root, channel, payload) {
      const target = canonicalFolder(root);
      for (const record of live()) {
        const isSpaceWindow = record.init.mode === 'space' || record.init.mode === 'space-files';
        if (isSpaceWindow && record.folder !== null && canonicalFolder(record.folder) === target) {
          send(record.window, channel, payload);
        }
      }
    },
  };
}
