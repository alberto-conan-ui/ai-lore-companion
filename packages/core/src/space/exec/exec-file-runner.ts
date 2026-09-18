/**
 * The real `CommandRunner`: `child_process.execFile` with an argument array
 * and no shell. This is the only file under `core/src/space` that imports
 * `child_process`. Every run passes the live-system guard first.
 */

import { type ExecFileException, execFile, execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { type GuardContext, checkLiveSystemGuard } from './guard.js';
import type { CommandRunner, RunFailureKind, RunOptions, RunResult } from './runner.js';

/** The most output, per stream, a command may produce before it is stopped. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * A command that passes its `timeoutMs` is sent `SIGTERM`, so that git can
 * remove its lock files. One that is still running this long after is killed.
 */
const KILL_GRACE_MS = 2000;

/** Options of `createExecFileRunner`. */
export type ExecFileRunnerOptions = {
  /** Replaces parts of what the guard reads; for tests of the runner itself. */
  guard?: GuardContext;
  /** The most output, per stream, before the command is stopped. Default 64 MiB. */
  maxOutputBytes?: number;
};

/**
 * The addresses of the remotes of the repository at `dir` (or at `gitDir`,
 * when the command names its repository that way), read from its configuration
 * without taking a lock. A branch's `remote` and `pushRemote` and
 * `remote.pushDefault` are listed too, under the key's own name, because git
 * accepts an address where it expects a remote name. An unreadable
 * configuration gives no remotes, and the guard then refuses a remote given by
 * name. The guard has already checked that both folders are under the
 * temporary folder.
 */
function listRemotes(dir: string, gitDir: string | null): Record<string, string[]> {
  const pattern = '^(remote\\..*\\.(push)?url|branch\\..*\\.(push)?remote|remote\\.pushdefault)$';
  let text: string;
  try {
    text = execFileSync(
      'git',
      [
        '--no-optional-locks',
        ...(gitDir === null ? [] : [`--git-dir=${gitDir}`]),
        'config',
        '--get-regexp',
        pattern,
      ],
      {
        cwd: dir,
        env: { ...process.env, GIT_DIR: undefined },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    return {};
  }
  const remotes: Record<string, string[]> = {};
  for (const line of text.split('\n')) {
    const space = line.indexOf(' ');
    if (space === -1) continue;
    const key = line.slice(0, space);
    const isRemoteUrl = key.startsWith('remote.') && /\.(push)?url$/.test(key);
    const name = isRemoteUrl ? key.slice('remote.'.length, key.lastIndexOf('.')) : key;
    const list = remotes[name] ?? [];
    list.push(line.slice(space + 1));
    remotes[name] = list;
  }
  return remotes;
}

function notRun(failure: RunFailureKind, message: string, partial?: Partial<RunResult>): RunResult {
  return {
    code: -1,
    stdout: partial?.stdout ?? '',
    stderr: [partial?.stderr?.trim(), message].filter(Boolean).join('\n'),
    failure,
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function toRunResult(
  bin: string,
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
  timeoutMs: number | undefined,
): RunResult {
  if (error === null) return { code: 0, stdout, stderr };
  if (typeof error.code === 'number') return { code: error.code, stdout, stderr };
  const partial = { stdout, stderr };
  if (error.code === 'ENOENT') return notRun('not-found', `${bin} was not found`, partial);
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return notRun('output-too-large', `${bin} produced too much output`, partial);
  }
  if (error.killed === true && timeoutMs !== undefined) {
    return notRun('timeout', `${bin} was stopped after ${timeoutMs} ms`, partial);
  }
  if (error.signal) return notRun('killed', `${bin} was ended by ${error.signal}`, partial);
  return notRun('spawn-error', `${bin} could not be started: ${error.message}`, partial);
}

/** Build a real runner. `execFileRunner` is the one built with no options. */
export function createExecFileRunner(options: ExecFileRunnerOptions = {}): CommandRunner {
  const guardContext: GuardContext = { listRemotes, ...options.guard };
  return {
    run(bin: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
      const refusal = checkLiveSystemGuard(
        { bin, args, cwd: opts.cwd, env: opts.env },
        guardContext,
      );
      if (refusal !== null) return Promise.resolve(notRun('refused', refusal.message));
      if (opts.cwd !== undefined && !isDirectory(opts.cwd)) {
        return Promise.resolve(notRun('spawn-error', `${opts.cwd} is not a folder`));
      }
      return new Promise<RunResult>((resolvePromise) => {
        let hardStop: NodeJS.Timeout | undefined;
        const child = execFile(
          bin,
          [...args],
          {
            cwd: opts.cwd,
            env: { ...process.env, ...opts.env },
            timeout: opts.timeoutMs,
            maxBuffer: options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
            encoding: 'utf8',
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            clearTimeout(hardStop);
            resolvePromise(toRunResult(bin, error, stdout, stderr, opts.timeoutMs));
          },
        );
        if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
          hardStop = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs + KILL_GRACE_MS);
          hardStop.unref();
        }
        // A command that exits without reading its input closes the pipe early.
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(opts.input ?? '');
      });
    },
  };
}

/** The real runner, guarded by the process's own environment. */
export const execFileRunner: CommandRunner = createExecFileRunner();
