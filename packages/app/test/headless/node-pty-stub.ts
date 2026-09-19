/**
 * Minimal `node-pty` stand-in for the headless tier. The real native module is
 * built for Electron's ABI and cannot load under plain Node, which is what the
 * headless suite runs on — so `register-electron.mjs`'s resolve hook maps the
 * bare `node-pty` specifier to this compiled module, the same way it maps
 * `electron` to `electron-stub.js`.
 *
 * `spawn` never starts a real shell: it records the call and gives back a fake
 * `IPty` a test drives by hand, with `feedData` and `finish` standing in for
 * what a real child process would do.
 */

type DataListener = (data: string) => void;
type ExitListener = (event: { exitCode: number; signal?: number }) => void;

/** A test's handle on one fake PTY: the real `IPty` surface `pty.ts` uses, plus two levers. */
export type FakePty = {
  readonly pid: number;
  onData(listener: DataListener): void;
  onExit(listener: ExitListener): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Test-only: push data as if the child process wrote it. */
  feedData(data: string): void;
  /** Test-only: end the process. */
  finish(exitCode: number, signal?: number): void;
};

/** One `spawn` call this stub recorded. */
export type SpawnCall = { file: string; args: string[]; options: Record<string, unknown> };

let nextPid = 1000;

/** Every `spawn` call made since the last `resetPtyStub`, in order. */
export const calls: SpawnCall[] = [];
/** Every fake PTY `spawn` made since the last `resetPtyStub`, in order. */
export const ptys: FakePty[] = [];

/** Clear what the stub recorded. A test calls this before it spawns anything. */
export function resetPtyStub(): void {
  calls.length = 0;
  ptys.length = 0;
}

/** The stand-in for `node-pty`'s own `spawn`. */
export function spawn(file: string, args: string[], options: Record<string, unknown>): FakePty {
  calls.push({ file, args: [...args], options });
  const dataListeners: DataListener[] = [];
  const exitListeners: ExitListener[] = [];
  const pty: FakePty = {
    pid: nextPid++,
    onData: (listener) => {
      dataListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    write: () => {},
    resize: () => {},
    kill: () => {
      pty.finish(0);
    },
    feedData: (data) => {
      for (const listener of dataListeners) listener(data);
    },
    finish: (exitCode, signal) => {
      for (const listener of exitListeners) listener({ exitCode, signal });
    },
  };
  ptys.push(pty);
  return pty;
}
