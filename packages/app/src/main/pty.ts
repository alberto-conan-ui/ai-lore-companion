import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { type IPty, spawn } from 'node-pty';
import type { TerminalForegroundStatus } from '../shared/ipc.js';
import { PTY_FLOW_PAUSE, PTY_FLOW_RESUME } from '../shared/ipc.js';

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
 * spawns `zsh -i -l -c '<binary> <args...>'` so the engine inherits the user's
 * full PATH (resolving bare names like `claude`) without the cockpit
 * re-implementing shell PATH discovery. The `-i` flag matters: a Finder-launched
 * Electron app gets a minimal PATH, and `zsh -l` alone sources only `.zprofile` —
 * any PATH addition the user keeps in `.zshrc` (e.g. `$HOME/.local/bin`, where
 * Claude installs itself) would be missed.
 */
export type PtySpawnEngine = { binary: string; args?: readonly string[] };

/** Per-spawn options that don't shape the command line. */
export type PtySpawnOpts = {
  /**
   * Infrastructure PTY — excluded from {@link PtyService.hasRunningTask}. The
   * AI Helper's visible read-only session is app-driven and tears down with its
   * window, so a live one must not make the close/quit guard ask "a terminal is
   * still running a task." A user shell/AI tab leaves this false.
   */
  infra?: boolean;
  /**
   * The working directory of this PTY. Default: the service's own `cwd`. A 1.0
   * session passes the Space's folder (phase M4.4).
   */
  cwd?: string;
  /**
   * Variables added to the environment of this PTY, over the app's own.
   * Default: none. A 1.0 session passes its id here. No secret goes here: the
   * environment of a process can be read by other processes of the same user.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * A shell command line run as `$SHELL -i -l -c <command>` instead of a plain
   * shell. Only command lines that are constants of core or main reach it: the
   * setup commands of `setupCommands()`.
   */
  command?: string;
  /**
   * Called with every chunk of output this PTY writes, after the service's own
   * `onData` callback. Default: nothing. The command panel reads a device code
   * out of it (M9.5).
   */
  onData?: (data: string) => void;
  /**
   * Called once when this PTY's process has exited, after the service's own
   * `onExit` callback, with the process's exit code. Default: nothing. A 1.0
   * session ends its record here.
   */
  onExit?: (exitCode: number) => void;
};

export type PtyService = {
  /** Spawn a shell; returns its id. When `engine` is set, the login shell
   *  executes the engine command on first prompt (`zsh -i -l -c '<cmd>'`).
   *  `opts.infra` marks the PTY as app infrastructure (see {@link PtySpawnOpts}). */
  spawn: (engine?: PtySpawnEngine, opts?: PtySpawnOpts) => string;
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
 * `zsh -i -l -c '<binary> <args>'` payload when launching an AI engine — a path
 * containing spaces, or an arg with shell metacharacters, would otherwise be
 * mis-parsed. POSIX single-quote rules: wrap in `'…'`, escape any embedded
 * single quotes by closing-then-`\''`-then-reopening.
 */
export function quoteForShell(token: string): string {
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
  /** App-infrastructure PTY — skipped by `hasRunningTask` (see {@link PtySpawnOpts}). */
  infra: boolean;
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
      if (!pid || !ppid || !stat || !command) continue;
      if (!stat.includes('+')) continue;
      if (Number(pid) === shellPid) continue;
      fg.push({ ppid: Number(ppid), command });
    }
    if (fg.length === 0) return IDLE;
    const top = fg.find((r) => r.ppid === shellPid) ?? fg[0];
    if (!top) return IDLE;
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
    // A poll that nobody stopped must not be the only thing keeping the
    // process alive. Without this, a test that threw before its cleanup left
    // the timer rescheduling for ever: one wrong assertion in
    // `pty-command.test.ts` ran a CI job for six hours instead of failing it.
    pollTimer.unref?.();
  }
  scheduleNext();

  return {
    spawn: (engine?: PtySpawnEngine, spawnOpts?: PtySpawnOpts) => {
      const id = randomUUID();
      // '-l' sources /etc/zprofile + ~/.zprofile so a Finder-launched
      // Electron app picks up the system PATH. For an engine spawn we also
      // pass '-i' so ~/.zshrc is sourced — that's where users typically
      // add `$HOME/.local/bin` etc., and without it a bare `claude`
      // resolves to "command not found". A plain shell tab is already
      // interactive, so -l alone suffices there.
      const args = ['-l'];
      if (engine) {
        args.unshift('-i');
        const tokens = [engine.binary, ...(engine.args ?? [])].map(quoteForShell);
        args.push('-c', `stty -ixon; ${tokens.join(' ')}`);
      } else if (spawnOpts?.command !== undefined) {
        args.unshift('-i');
        args.push('-c', `stty -ixon; ${spawnOpts.command}`);
      }
      const pty = spawn(DEFAULT_SHELL, args, {
        // 'xterm-256color' is what node-pty publishes as $TERM. The legacy
        // 'xterm-color' terminfo entry is 16-colour, so any CLI that probes
        // $TERM (gemini, claude, neovim, htop, ls --color) caps its palette
        // and skips truecolor SGR sequences. COLORTERM=truecolor is the
        // companion convention modern CLIs read to enable their 24-bit paths.
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: spawnOpts?.cwd ?? opts.cwd,
        env: { ...process.env, COLORTERM: 'truecolor', ...(spawnOpts?.env ?? {}) } as Record<
          string,
          string
        >,
        // Backpressure: with flow control on, node-pty pauses reading from the
        // child when it receives `PTY_FLOW_PAUSE` on the input path and
        // resumes on `PTY_FLOW_RESUME`. The renderer sends these as xterm's
        // parse buffer fills/drains, so a flood can't outrun the UI.
        handleFlowControl: true,
        flowControlPause: PTY_FLOW_PAUSE,
        flowControlResume: PTY_FLOW_RESUME,
      });
      ptys.set(id, {
        pty,
        tty: null,
        ttyResolved: false,
        last: IDLE,
        infra: spawnOpts?.infra ?? false,
      });
      pty.onData((data) => {
        opts.onData(id, data);
        spawnOpts?.onData?.(data);
      });
      pty.onExit(({ exitCode }) => {
        ptys.delete(id);
        try {
          opts.onExit(id);
        } finally {
          // A 1.0 session's end must run even when the window's callback throws.
          spawnOpts?.onExit?.(exitCode);
        }
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
        // Infra PTYs (the helper's read-only session) are app-driven and tear
        // down with the window — they never gate close/quit.
        if (entry.infra) continue;
        if (entry.last.status === 'running') return true;
      }
      return false;
    },
  };
}
