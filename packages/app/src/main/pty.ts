import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { type IPty, spawn } from 'node-pty';
import type { TerminalForegroundStatus } from '../shared/ipc.js';

const execFileP = promisify(execFile);

/** Per-id callbacks the host wires to IPC. */
export type PtyServiceCallbacks = {
  onData: (id: string, data: string) => void;
  onExit: (id: string) => void;
  /** Fired when a terminal's foreground status changes (idle/running + command). */
  onStatus: (id: string, status: TerminalForegroundStatus, command: string) => void;
};

/**
 * Optional engine to run inside the PTY's login shell. When set, the PTY
 * spawns `zsh -l -c '<binary> <args...>'` so the engine inherits the user's
 * full PATH (resolving bare names like `claude`) without the cockpit
 * re-implementing shell PATH discovery.
 */
export type PtySpawnEngine = { binary: string; args?: readonly string[] };

export type PtyService = {
  /** Spawn a shell; returns its id. When `engine` is set, the login shell
   *  executes the engine command on first prompt (`zsh -l -c '<cmd>'`). */
  spawn: (engine?: PtySpawnEngine) => string;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  /** Kill every live PTY and stop polling — call on app teardown. */
  killAll: () => void;
  /**
   * True when any live PTY is running a foreground task — read from the same
   * per-terminal foreground feed that drives the tab status indicators.
   */
  hasRunningTask: () => boolean;
};

const DEFAULT_SHELL = process.env.SHELL ?? '/bin/zsh';

/**
 * Quote a token for safe single-line shell interpolation. Used to build the
 * `zsh -l -c '<binary> <args>'` payload when launching an AI engine — a path
 * containing spaces, or an arg with shell metacharacters, would otherwise be
 * mis-parsed. POSIX single-quote rules: wrap in `'…'`, escape any embedded
 * single quotes by closing-then-`\''`-then-reopening.
 */
function quoteForShell(token: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** How often each live PTY's foreground process is polled. */
const POLL_MS = 1000;

/** What a single foreground probe found. */
type Probe = { status: TerminalForegroundStatus; command: string };

const IDLE: Probe = { status: 'idle', command: '' };

/** Bookkeeping for one live PTY — the shell, its tty, and last seen status. */
type PtyEntry = {
  pty: IPty;
  /** The PTY's controlling tty (e.g. `ttys003`), resolved lazily once. */
  tty: string | null;
  ttyResolved: boolean;
  /** Last status pushed to the renderer — dedupes the poll feed. */
  last: Probe;
};

/** Resolve the controlling tty of a process id via `ps`; null when it has none. */
async function ttyForPid(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ps', ['-o', 'tty=', '-p', String(pid)]);
    const tty = stdout.trim();
    // `ps` prints `??` for a process with no controlling terminal.
    return tty && tty !== '??' ? tty : null;
  } catch {
    return null;
  }
}

/**
 * Probe a tty for its foreground task. `ps -t` lists every process on the
 * terminal; the foreground process group carries a `+` in its STAT flags. The
 * login shell itself (`shellPid`) is excluded — what is left, if anything, is
 * the running command. The command launched directly by the shell is
 * preferred so a pipeline or a subprocess does not mask the real task.
 */
async function probeForeground(shellPid: number, tty: string): Promise<Probe> {
  try {
    const { stdout } = await execFileP('ps', ['-t', tty, '-o', 'pid=,ppid=,stat=,command=']);
    const fg: { ppid: number; command: string }[] = [];
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const [, pid, ppid, stat, command] = m;
      if (!stat.includes('+')) continue;
      if (Number(pid) === shellPid) continue;
      fg.push({ ppid: Number(ppid), command });
    }
    if (fg.length === 0) return IDLE;
    const top = fg.find((r) => r.ppid === shellPid) ?? fg[0];
    return { status: 'running', command: top.command };
  } catch {
    return IDLE;
  }
}

/**
 * Tracks live `node-pty` shells by id. App-main infrastructure — kept out of
 * `packages/core/`, which stays headless. The host wires `onData` / `onExit` /
 * `onStatus` to IPC and calls `killAll` from the app's teardown.
 *
 * Each live PTY's foreground process is polled (~1s) so the renderer can show
 * whether a terminal is idle or running a task, and what that task is.
 */
export function createPtyService(opts: { cwd: string } & PtyServiceCallbacks): PtyService {
  const ptys = new Map<string, PtyEntry>();

  let pollTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  /** Probe every live PTY once and push status changes to the renderer. */
  async function pollOnce(): Promise<void> {
    for (const [id, entry] of ptys) {
      if (!entry.ttyResolved) {
        entry.tty = await ttyForPid(entry.pty.pid);
        entry.ttyResolved = true;
      }
      const probe = entry.tty ? await probeForeground(entry.pty.pid, entry.tty) : IDLE;
      if (probe.status !== entry.last.status || probe.command !== entry.last.command) {
        entry.last = probe;
        opts.onStatus(id, probe.status, probe.command);
      }
    }
  }

  /** Self-rescheduling poll — a fresh tick is only queued after the last one
   *  settles, so a slow `ps` cannot stack overlapping probes. */
  function scheduleNext(): void {
    pollTimer = setTimeout(() => {
      void pollOnce().finally(() => {
        if (!stopped) scheduleNext();
      });
    }, POLL_MS);
  }
  scheduleNext();

  return {
    spawn: (engine?: PtySpawnEngine) => {
      const id = randomUUID();
      // A login shell ('-l') sources the full profile chain — /etc/zprofile
      // (path_helper), ~/.zprofile, ~/.zshrc — so the terminal has the same
      // PATH and environment as Terminal.app. Without it, a Finder-launched
      // app inherits only macOS's minimal env and tools like `docker` or
      // Homebrew binaries are missing.
      //
      // When `engine` is set, the login shell additionally runs the engine
      // command via `-c`. The user sees the engine launching (its banner,
      // its prompt) directly — no intermediate shell prompt. If the engine
      // exits, the PTY exits too; the AI tab UI reverts to its empty state.
      const args = ['-l'];
      if (engine) {
        const tokens = [engine.binary, ...(engine.args ?? [])].map(quoteForShell);
        args.push('-c', tokens.join(' '));
      }
      const pty = spawn(DEFAULT_SHELL, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: opts.cwd,
        env: process.env as Record<string, string>,
      });
      ptys.set(id, { pty, tty: null, ttyResolved: false, last: IDLE });
      pty.onData((data) => opts.onData(id, data));
      pty.onExit(() => {
        ptys.delete(id);
        opts.onExit(id);
      });
      return id;
    },
    write: (id, data) => {
      ptys.get(id)?.pty.write(data);
    },
    resize: (id, cols, rows) => {
      const entry = ptys.get(id);
      if (entry) entry.pty.resize(cols, rows);
    },
    kill: (id) => {
      const entry = ptys.get(id);
      if (entry) {
        entry.pty.kill();
        ptys.delete(id);
      }
    },
    killAll: () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      for (const entry of ptys.values()) {
        try {
          entry.pty.kill();
        } catch {
          // Already exited — nothing to kill.
        }
      }
      ptys.clear();
    },
    hasRunningTask: () => {
      for (const entry of ptys.values()) {
        if (entry.last.status === 'running') return true;
      }
      return false;
    },
  };
}
