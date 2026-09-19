/**
 * Argument, result and payload types of the command panel's channels (phase
 * M9.5, architecture document A.8). Plain data only. `shared/ipc.ts` already
 * re-exports this file.
 *
 * A command panel runs one command from core's `setupCommands()`, by id: the
 * renderer never sends a command line, only an id from that fixed list.
 */

/** Argument of `spaceCommandRun`: the id of a command of `setupCommands()`. */
export type SpaceCommandRunArg = { commandId: string };

/** Why `spaceCommandRun` did nothing. `message` can be shown to the Human Lead. */
export type SpaceCommandFailure = {
  kind:
    | 'invalid-argument'
    | 'not-a-space-window'
    | 'not-allowed-here'
    | 'unknown-command'
    | 'no-terminal';
  message: string;
};

/** The result of `spaceCommandRun`: the PTY it now runs in, or why it did not run. */
export type SpaceCommandRunResult =
  | { ok: true; value: { ptyId: string; commandId: string; commandLine: string } }
  | { ok: false; error: SpaceCommandFailure };

/** A GitHub one-time code found in a running command's output. */
export type SpaceCommandCode = { ptyId: string; code: string };

/** A running command's process has exited. */
export type SpaceCommandExit = { ptyId: string; commandId: string; exitCode: number };
