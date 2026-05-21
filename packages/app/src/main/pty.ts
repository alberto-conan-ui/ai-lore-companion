import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { type IPty, spawn } from 'node-pty';

/** Per-id callbacks the host wires to IPC. */
export type PtyServiceCallbacks = {
  onData: (id: string, data: string) => void;
  onExit: (id: string) => void;
};

export type PtyService = {
  /** Spawn a shell; returns its id. */
  spawn: () => string;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  /** Kill every live PTY — call on app teardown. */
  killAll: () => void;
  /**
   * True when any live PTY has a foreground process other than the login
   * shell — a heuristic for "a terminal is running a task". A process named
   * like the shell, or a backgrounded job, is the fuzzy edge.
   */
  hasRunningTask: () => boolean;
};

const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh';

/**
 * Tracks live `node-pty` shells by id. App-main infrastructure — kept out of
 * `packages/core/`, which stays headless. The host wires `onData` / `onExit`
 * to IPC and calls `killAll` from the app's teardown.
 */
export function createPtyService(opts: { cwd: string } & PtyServiceCallbacks): PtyService {
  const ptys = new Map<string, IPty>();

  return {
    spawn: () => {
      const id = randomUUID();
      const pty = spawn(DEFAULT_SHELL, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: opts.cwd,
        env: process.env as Record<string, string>,
      });
      ptys.set(id, pty);
      pty.onData((data) => opts.onData(id, data));
      pty.onExit(() => {
        ptys.delete(id);
        opts.onExit(id);
      });
      return id;
    },
    write: (id, data) => {
      ptys.get(id)?.write(data);
    },
    resize: (id, cols, rows) => {
      const pty = ptys.get(id);
      if (pty) pty.resize(cols, rows);
    },
    kill: (id) => {
      const pty = ptys.get(id);
      if (pty) {
        pty.kill();
        ptys.delete(id);
      }
    },
    killAll: () => {
      for (const pty of ptys.values()) {
        try {
          pty.kill();
        } catch {
          // Already exited — nothing to kill.
        }
      }
      ptys.clear();
    },
    hasRunningTask: () => {
      const shellName = basename(DEFAULT_SHELL);
      for (const pty of ptys.values()) {
        // `node-pty` reports the foreground process; a login shell may carry a
        // leading '-'. Anything that is not the shell counts as a task.
        const fg = (pty.process || '').replace(/^-/, '');
        if (fg && fg !== shellName) return true;
      }
      return false;
    },
  };
}
