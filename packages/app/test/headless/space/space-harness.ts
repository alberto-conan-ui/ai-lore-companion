/**
 * Support for the headless tests of the 1.0 code in main.
 *
 * - `fakeSpaceWindow` stands in for an Electron window: it records what it was
 *   sent and lets a test finish its page load.
 * - `testSpaceHost` builds the real Space host (`main/space/host.ts`) on fake
 *   bindings, in a temporary `userData` folder.
 * - `spaceHarnessFor` drives a 1.0 register module the way `harnessFor` of
 *   `../harness.ts` drives a v0.8 one, with a Space host in `deps.space` and an
 *   event whose sender is a window of the test's choice.
 * - `fakeSpaceHost` is the inert host `../harness.ts` puts in `deps.space`, so
 *   that the v0.8 modules' tests build a complete `Deps`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGitPort, execFileRunner } from '@ai-lore-companion/core';
import type { Registrar } from '../../../src/main/ipc/registrar.js';
import type { Deps, RegisterModule } from '../../../src/main/ipc/types.js';
import type { PtyService } from '../../../src/main/pty.js';
import {
  type SpaceHost,
  type SpaceHostBindings,
  type SpaceHostInternals,
  createSpaceHost,
} from '../../../src/main/space/host.js';
import { silentSpaceLog } from '../../../src/main/space/log.js';
import type { SpaceWindowLike } from '../../../src/main/space/windows.js';
import { CHANNELS, type WindowInitPayload } from '../../../src/shared/ipc.js';

/** `packages/spec/lore-1.0`, the template `makeSpaceFixture` scaffolds from. The tests run from `packages/app`. */
export const LORE_TEMPLATE_DIR = resolve(process.cwd(), '../spec/lore-1.0');

/** A window stand-in. */
export type FakeSpaceWindow = SpaceWindowLike & {
  /** Every message sent to the page, in order. */
  sent: { channel: string; payload: unknown }[];
  /** The window-init payloads the page received, in order. */
  inits(): WindowInitPayload[];
  /** The page finished loading: run the listeners that wait for it. */
  finishLoad(): void;
  reloads: number;
  title: string;
  focusCount: number;
  destroy(): void;
};

let nextWindowId = 100;

/** Build a window stand-in. Its web contents id differs from its window id, as in Electron. */
export function fakeSpaceWindow(): FakeSpaceWindow {
  const id = nextWindowId;
  nextWindowId += 1;
  let destroyed = false;
  let loadListeners: (() => void)[] = [];
  const window: FakeSpaceWindow = {
    id,
    sent: [],
    reloads: 0,
    title: '',
    focusCount: 0,
    isDestroyed: () => destroyed,
    isMinimized: () => false,
    restore: () => {},
    focus: () => {
      window.focusCount += 1;
    },
    setTitle: (title) => {
      window.title = title;
    },
    webContents: {
      id: id + 10_000,
      send: (channel, payload) => {
        window.sent.push({ channel, payload });
      },
      once: (_event, listener) => {
        loadListeners.push(listener);
      },
      reload: () => {
        window.reloads += 1;
      },
    },
    inits: () =>
      window.sent
        .filter((message) => message.channel === CHANNELS.onWindowInit)
        .map((message) => message.payload as WindowInitPayload),
    finishLoad: () => {
      const listeners = loadListeners;
      loadListeners = [];
      for (const listener of listeners) listener();
    },
    destroy: () => {
      destroyed = true;
    },
  };
  return window;
}

/** A PTY service that does nothing. */
export function inertPtyService(): PtyService {
  return {
    spawn: () => 'pty-1',
    write: () => {},
    resize: () => {},
    kill: () => {},
    killAll: () => {},
    hasRunningTask: () => false,
  } as PtyService;
}

/** The real host on fake bindings, and what the bindings recorded. */
export type TestSpaceHost = {
  host: SpaceHost & SpaceHostInternals;
  userDataDir: string;
  /** Windows the host asked for, in order. */
  created: FakeSpaceWindow[];
  /** `attachTerminal` calls. */
  terminals: { windowId: number; folder: string }[];
  /** `detachWindow` calls. */
  detached: number[];
  /** `openV08` calls: today's way of opening a folder. */
  openedV08: { windowId: number | undefined; folder: string }[];
  /** The folder the next `pickFolder` gives; `null` is a cancelled dialog. */
  setPickedFolder(folder: string | null): void;
  /** Folders for which `focusCockpitWindowFor` answers true. */
  cockpitFolders: Set<string>;
  cleanup(): void;
};

/** Build the real host for a test. */
export function testSpaceHost(
  options: { spaceRouting: boolean } & Partial<Pick<SpaceHostBindings, 'detect' | 'log'>>,
): TestSpaceHost {
  const userDataDir = mkdtempSync(join(tmpdir(), 'space-headless-'));
  const created: FakeSpaceWindow[] = [];
  const terminals: TestSpaceHost['terminals'] = [];
  const detached: number[] = [];
  const openedV08: TestSpaceHost['openedV08'] = [];
  const cockpitFolders = new Set<string>();
  let picked: string | null = null;
  const host = createSpaceHost({
    spaceRouting: options.spaceRouting,
    userDataDir: () => userDataDir,
    runner: execFileRunner,
    git: createGitPort(execFileRunner),
    log: options.log ?? silentSpaceLog,
    detect: options.detect,
    createWindow: () => {
      const window = fakeSpaceWindow();
      created.push(window);
      return window;
    },
    pickFolder: async () => picked,
    attachTerminal: (window, folder) => {
      terminals.push({ windowId: window.id, folder });
      return inertPtyService();
    },
    detachWindow: async (windowId) => {
      detached.push(windowId);
    },
    focusCockpitWindowFor: (folder) => cockpitFolders.has(folder),
    openV08: (window, folder) => {
      openedV08.push({ windowId: window?.id, folder });
    },
  });
  return {
    host,
    userDataDir,
    created,
    terminals,
    detached,
    openedV08,
    cockpitFolders,
    setPickedFolder: (folder) => {
      picked = folder;
    },
    cleanup: () => rmSync(userDataDir, { recursive: true, force: true }),
  };
}

/** A host whose every action does nothing and that knows no window. For `Deps` of a v0.8 module's test. */
export function fakeSpaceHost(): SpaceHost {
  const refused = {
    ok: false,
    error: { kind: 'not-a-space-window', message: 'no Space host in this test' },
  } as const;
  return {
    routingOn: false,
    log: silentSpaceLog,
    runner: execFileRunner,
    userDataDir: () => '',
    contextFor: () => undefined,
    windowFor: () => undefined,
    contextForKey: () => undefined,
    sendToSpace: () => {},
    openFolder: async () => refused,
    promptAndOpenFolder: async () => refused,
    openWelcome: () => {},
    launch: async () => {},
    navigate: async () => refused,
    openFilesWindow: () => {},
    openInCockpit: async () => refused,
    reload: async () => {},
    owns: () => false,
    mayRemember: () => false,
    windowClosed: async () => {},
    commandTerminal: () => undefined,
    recentSpaces: () => [],
    resolveRecentSpace: () => ({ status: 'unknown' }),
    removeRecentSpace: () => [],
    dispose: async () => {},
  };
}

/** What a test of a 1.0 register module drives. */
export type SpaceHarness = {
  space: TestSpaceHost;
  deps: Deps;
  /** Fire a handler as if the call came from the own web contents of `sender`. */
  invoke(
    key: string,
    sender: SpaceWindowLike | { webContentsId: number; frame?: 'inside-the-page' | 'gone' },
    arg: unknown,
  ): unknown;
  cleanup(): void;
};

/**
 * Capture the handlers of one 1.0 register module. `deps.space` is the real
 * host on fake bindings; the v0.8 fields of `Deps` are inert, because a 1.0
 * module reads only `deps.space`.
 */
export function spaceHarnessFor(
  register: RegisterModule,
  options: { spaceRouting?: boolean } = {},
): SpaceHarness {
  const space = testSpaceHost({ spaceRouting: options.spaceRouting ?? true });
  const deps: Deps = {
    contextFor: () => undefined,
    getUserDataDir: () => space.userDataDir,
    contexts: new Map(),
    settingsSnapshot: () => {
      throw new Error('a 1.0 module does not read the v0.8 settings snapshot');
    },
    broadcastSettings: () => {},
    broadcastEngines: () => {},
    broadcastShortcuts: () => {},
    reapplyIgnores: () => {},
    showProject: () => {},
    promptAndOpenProject: async () => {},
    reloadWindow: async () => {},
    removeRecent: () => [],
    space: space.host,
  };
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const reg = {
    handle(key: string, handler: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(key, handler);
    },
    on(key: string, handler: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(key, handler);
    },
  } as unknown as Registrar;
  register(reg, deps);
  return {
    space,
    deps,
    invoke(key, sender, arg) {
      const handler = handlers.get(key);
      if (!handler) throw new Error(`no handler registered for channel "${key}"`);
      const id = 'webContentsId' in sender ? sender.webContentsId : sender.webContents.id;
      if ('webContentsId' in sender && sender.frame !== undefined) {
        // As Electron gives it: the top frame of the web contents, and the frame that called.
        const mainFrame = { name: 'main frame' };
        const senderFrame = sender.frame === 'gone' ? null : { name: 'a frame inside the page' };
        return handler({ sender: { id, mainFrame }, senderFrame }, arg);
      }
      return handler({ sender: { id } }, arg);
    },
    cleanup: () => space.cleanup(),
  };
}
