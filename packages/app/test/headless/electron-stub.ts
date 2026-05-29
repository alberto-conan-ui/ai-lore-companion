/**
 * Minimal `electron` stand-in for the headless tier — only the surface the
 * electron-coupled IPC modules touch (`shell`, `BrowserWindow`), as test
 * doubles. Installed at runtime by `register-electron.mjs`, an ESM resolve hook
 * that maps the bare `electron` specifier to this compiled module. A test
 * imports the same file directly to inspect/reset the spies — node caches by
 * resolved URL, so the module-under-test and the test share one instance.
 */

type Spy = ((...args: unknown[]) => unknown) & { calls: unknown[][] };
function makeSpy(ret?: unknown): Spy {
  const calls: unknown[][] = [];
  const fn = ((...args: unknown[]) => {
    calls.push(args);
    return ret;
  }) as Spy;
  fn.calls = calls;
  return fn;
}

type WebContents = { send: (...args: unknown[]) => void };
export type FakeWindow = { id: number; webContents: WebContents };

/** The window `BrowserWindow.fromWebContents` returns. Tests may swap it to null
 *  (no window) or read `webContents.send`. */
export let fakeWindow: FakeWindow | null = { id: 1, webContents: { send: () => {} } };
export function setFakeWindow(win: FakeWindow | null): void {
  fakeWindow = win;
}

/** Windows `getAllWindows` reports. Empty by default (no broadcast fan-out). */
export let allWindows: FakeWindow[] = [];
export function setAllWindows(wins: FakeWindow[]): void {
  allWindows = wins;
}

export const BrowserWindow = {
  fromWebContents: (_sender: unknown): FakeWindow | null => fakeWindow,
  getAllWindows: (): FakeWindow[] => allWindows,
};

export const shell = {
  openPath: makeSpy(Promise.resolve('')),
  openExternal: makeSpy(Promise.resolve()),
  showItemInFolder: makeSpy(),
};

/** `utilityProcess` is referenced by `main/search/service.ts` (the worker-backed
 *  search). The headless tier uses the in-process service and never forks, so
 *  this only needs to exist for the named import to link. */
export const utilityProcess = {
  fork: () => {
    throw new Error('utilityProcess.fork is not available in the headless tier');
  },
};

/** Clear all recorded calls and restore the default window — call in `beforeEach`. */
export function resetElectronStub(): void {
  shell.openPath.calls.length = 0;
  shell.openExternal.calls.length = 0;
  shell.showItemInFolder.calls.length = 0;
  fakeWindow = { id: 1, webContents: { send: () => {} } };
  allWindows = [];
}
