/**
 * Headless IPC-integration harness — the fast tier that exercises the real
 * `main/ipc/*` register modules without an Electron build.
 *
 * Each module exports `register(reg, deps)` (see `src/main/ipc/types.ts`). In
 * production `reg` is built from `ipcMain`; here it is a capturing stand-in that
 * records each handler by its CONTRACT key, so a test can drive a channel by
 * `invoke('enginesSave', list)` and assert the real handler's result + effects.
 * `deps` is a set of fakes with spies on the broadcasts; the project context,
 * user-data dir, and ptyService are stubs the test configures.
 *
 * This tier covers the four electron-free IPC modules (terminal, changes, apps,
 * engines) and their transitive deps — none import `electron` at runtime, so no
 * stub loader is needed. The electron-coupled modules (tree, project, browser,
 * shortcuts, settings) need a small electron stub and are a later addition.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChainResult, EngineEntry } from '@ai-lore-companion/core';
import type { Registrar } from '../../src/main/ipc/registrar.js';
import type { Deps, ProjectContext, RegisterModule, Wiring } from '../../src/main/ipc/types.js';
import type { PtyService } from '../../src/main/pty.js';
import { InProcessSearchService } from '../../src/main/search/service.js';
import type { SettingsSnapshot, Shortcut } from '../../src/shared/ipc.js';

/** A recording stub — every call's argument tuple is pushed to `.calls`. */
export type Spy<A extends unknown[]> = ((...args: A) => void) & { calls: A[] };
export function spy<A extends unknown[]>(): Spy<A> {
  const calls: A[] = [];
  const fn = ((...args: A) => {
    calls.push(args);
  }) as Spy<A>;
  fn.calls = calls;
  return fn;
}

/** A non-error chain stub. Handlers read `lorePath` / `root`; the rest is filler
 *  that satisfies the type without pretending to be a real chain read. */
export function fakeChain(root: string, lorePath: string): ChainResult {
  return {
    mode: 'execute',
    posture: null,
    dials: null,
    focus: null,
    focusType: null,
    focusStatus: null,
    activeChild: null,
    root,
    lorePath,
    hasSavePoint: false,
    coreVersion: null,
    shape: 'default',
  };
}

/** A no-op ptyService whose four lifecycle methods are spies + a fixed spawn id. */
export type FakePty = PtyService & {
  spawnCalls: {
    engine?: { binary: string; args?: readonly string[] };
    opts?: { infra?: boolean };
  }[];
  write: Spy<[string, string]>;
  resize: Spy<[string, number, number]>;
  kill: Spy<[string]>;
};
export function fakePtyService(spawnId = 'pty-1'): FakePty {
  const spawnCalls: {
    engine?: { binary: string; args?: readonly string[] };
    opts?: { infra?: boolean };
  }[] = [];
  const write = spy<[string, string]>();
  const resize = spy<[string, number, number]>();
  const kill = spy<[string]>();
  return {
    spawn: (engine, opts) => {
      spawnCalls.push({ engine, opts });
      return spawnId;
    },
    write,
    resize,
    kill,
    killAll: () => {},
    hasRunningTask: () => false,
    spawnCalls,
  } as FakePty;
}

/** Everything a headless test drives: a per-test temp userData dir, a configurable
 *  project context, the spied broadcasts, and `invoke` to fire a channel. */
export type Harness = {
  /** Temp `userData` dir — handlers persist catalogs here; removed by `cleanup`. */
  userDataDir: string;
  /** The context `deps.contextFor` returns. Mutate fields per test, or set null. */
  ctx: ProjectContext | undefined;
  setCtx(ctx: ProjectContext | undefined): void;
  deps: Deps;
  broadcasts: {
    settings: Spy<[]>;
    engines: Spy<[EngineEntry[]]>;
    shortcuts: Spy<[Shortcut[]]>;
  };
  /** Spies on the host actions a handler may delegate to (window routing etc.). */
  actions: {
    showProject: Spy<[unknown, string]>;
    promptAndOpenProject: Spy<[unknown]>;
    reloadWindow: Spy<[unknown]>;
    reapplyIgnores: Spy<[unknown]>;
  };
  /** The snapshot `deps.settingsSnapshot` returns (default empty-ish). */
  settingsSnapshot: SettingsSnapshot;
  /** Fire a captured channel handler with a fake event + the given args. */
  invoke(key: string, ...args: unknown[]): unknown;
  cleanup(): void;
};

/** Build a harness around one register module and capture its handlers. */
export function harnessFor(register: RegisterModule): Harness {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cockpit-headless-'));

  const broadcasts = {
    settings: spy<[]>(),
    engines: spy<[EngineEntry[]]>(),
    shortcuts: spy<[Shortcut[]]>(),
  };
  const actions = {
    showProject: spy<[unknown, string]>(),
    promptAndOpenProject: spy<[unknown]>(),
    reloadWindow: spy<[unknown]>(),
    reapplyIgnores: spy<[unknown]>(),
    removeRecent: spy<[string]>(),
  };
  const settingsSnapshot: SettingsSnapshot = {
    registry: [],
    resolved: {},
    global: {} as unknown as SettingsSnapshot['global'],
    project: null,
    defaultIgnores: [],
  };

  let ctx: ProjectContext | undefined;

  const deps: Deps = {
    contextFor: () => ctx,
    getUserDataDir: () => userDataDir,
    contexts: new Map(),
    settingsSnapshot: () => settingsSnapshot,
    broadcastSettings: () => broadcasts.settings(),
    broadcastEngines: (list) => broadcasts.engines(list),
    broadcastShortcuts: (list) => broadcasts.shortcuts(list),
    reapplyIgnores: (win) => actions.reapplyIgnores(win),
    showProject: (win, root) => actions.showProject(win, root),
    promptAndOpenProject: async (win) => actions.promptAndOpenProject(win),
    reloadWindow: async (win) => actions.reloadWindow(win),
    removeRecent: (path) => {
      actions.removeRecent(path);
      return [];
    },
  };

  // Capture handlers by CONTRACT key. In production `reg` wraps `ipcMain`; the
  // shapes are erased at the call boundary, hence the cast.
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

  const fakeEvent = {} as unknown;

  return {
    userDataDir,
    get ctx() {
      return ctx;
    },
    setCtx(next) {
      ctx = next;
    },
    deps,
    broadcasts,
    actions,
    settingsSnapshot,
    invoke(key, ...args) {
      const handler = handlers.get(key);
      if (!handler) throw new Error(`no handler registered for channel "${key}"`);
      return handler(fakeEvent, ...args);
    },
    cleanup() {
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Build a configured project context stub for a temp project + lore root. */
export function fakeContext(opts: {
  root: string;
  lorePath: string;
  wiring?: Wiring | null;
  ptyService?: PtyService;
}): ProjectContext {
  return {
    root: opts.root,
    chain: fakeChain(opts.root, opts.lorePath),
    wiring: opts.wiring ?? null,
    ptyService: opts.ptyService ?? fakePtyService(),
    ignoreLists: { drift: [], search: [], hidden: [] } as unknown as ProjectContext['ignoreLists'],
    search: new InProcessSearchService(),
  };
}
