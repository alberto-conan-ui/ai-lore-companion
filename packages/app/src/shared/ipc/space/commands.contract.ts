/**
 * The channels of the command panel (phase M9.5, architecture document A.8).
 * The handlers are in `main/space/ipc/commands.ts` and the types in
 * `./commands.types.ts`. This fragment is spread into `CONTRACT`.
 */

import type {
  SpaceCommandCode,
  SpaceCommandExit,
  SpaceCommandRunArg,
  SpaceCommandRunResult,
} from './commands.types.js';
import { invoke, push } from './describe.js';

export const SPACE_COMMANDS_CONTRACT = {
  /**
   * Run one command from `setupCommands()`, by id, in a PTY of this window.
   * Accepted from a window of mode `machine-check`, `setup` or `space` only.
   */
  spaceCommandRun: invoke<[arg: SpaceCommandRunArg], SpaceCommandRunResult>('space:command-run'),
  /** A GitHub one-time code was found in a running command's output. */
  onSpaceCommandCode: push<SpaceCommandCode>('space:command-code'),
  /** A running command's process has exited. */
  onSpaceCommandExit: push<SpaceCommandExit>('space:command-exit'),
} as const;
