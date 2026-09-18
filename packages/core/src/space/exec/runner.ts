/**
 * The command runner port of the 1.0 library.
 *
 * Modules under `core/src/space` start `git`, `gh` and `python3` only through
 * a `CommandRunner` they receive as a parameter. They never import
 * `child_process`. A command is a binary and an argument array; there is no
 * form that takes a shell string. The real implementation is
 * `execFileRunner`; tests pass a scripted runner (`space/testing`).
 */

import type { Failure } from '../result.js';

/**
 * Why a command gave no exit code of its own.
 * `refused`: the live-system guard stopped it before it started.
 * `not-found`: the binary is not on the machine.
 * `timeout`: it ran longer than `timeoutMs` and was stopped.
 * `output-too-large`: its output passed the runner's buffer limit.
 * `killed`: a signal ended it.
 * `spawn-error`: it could not be started for another reason (a missing `cwd`).
 */
export type RunFailureKind =
  | 'refused'
  | 'not-found'
  | 'timeout'
  | 'output-too-large'
  | 'killed'
  | 'spawn-error';

/**
 * What a command produced. `code` is the process's exit code. When the process
 * gave none, `code` is `-1`, `failure` says why, and `stderr` holds the reason
 * as a sentence.
 */
export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  failure?: RunFailureKind;
};

/** Options of one run. */
export type RunOptions = {
  /** The working folder. Default: the process's own. */
  cwd?: string;
  /** Variables added to the process's environment for this run. */
  env?: Record<string, string>;
  /** Text written to the command's standard input, which is then closed. */
  input?: string;
  /** Stop the command after this many milliseconds. Default: no limit. */
  timeoutMs?: number;
};

/**
 * Runs a binary with an argument array and no shell. `run` does not reject: a
 * command that could not start, was refused or timed out resolves with
 * `code: -1` and a `failure`.
 */
export type CommandRunner = {
  run(bin: string, args: readonly string[], opts?: RunOptions): Promise<RunResult>;
};

/** The kinds of `Failure` made from a `RunResult` by `commandFailure`. */
export type CommandFailureKind =
  | 'command-refused'
  | 'command-not-found'
  | 'command-timeout'
  | 'command-failed';

/** Whether the command ran and exited with code 0. */
export function runSucceeded(result: RunResult): boolean {
  return result.code === 0 && result.failure === undefined;
}

/**
 * The `Failure` for a run that did not succeed. The message names the binary
 * and its first argument that is not an option (the subcommand), never the
 * whole argument list, and carries the command's error output.
 */
export function commandFailure(
  bin: string,
  args: readonly string[],
  result: RunResult,
): Failure<CommandFailureKind> {
  const subcommand = args.find((arg) => !arg.startsWith('-'));
  const name = subcommand === undefined ? bin : `${bin} ${subcommand}`;
  const detail = result.stderr.trim() || result.stdout.trim();
  switch (result.failure) {
    case 'refused':
      return { kind: 'command-refused', message: `${name} was refused: ${detail}` };
    case 'not-found':
      return { kind: 'command-not-found', message: `${bin} was not found on this machine` };
    case 'timeout':
      return { kind: 'command-timeout', message: `${name} did not finish in time` };
    case undefined:
      return { kind: 'command-failed', message: `${name} exited ${result.code}: ${detail}` };
    default:
      return { kind: 'command-failed', message: `${name} did not run: ${detail}` };
  }
}
