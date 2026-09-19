/**
 * The handlers of the command panel (`shared/ipc/space/commands.contract.ts`),
 * phase M9.5, architecture document A.8.
 *
 * A command panel of Set up this computer, of the setup screens, or of a Space
 * window's start control, runs one command of core's `setupCommands()`, by id.
 * The renderer never sends a command line; main looks the id up itself and
 * spawns it in the window's own terminal (`deps.space.commandTerminal`), never
 * a new process outside a PTY the Human Lead can see and answer.
 *
 * Main reads the command's output as it runs: the first GitHub one-time code
 * `parseDeviceCode` finds is pushed once, and the exit code is pushed when the
 * command ends. Output is never logged.
 */

import { parseDeviceCode, setupCommandLine } from '@ai-lore-companion/core';
import { z } from 'zod';
import type { SpaceCommandRunResult } from '../../../shared/ipc.js';
import { SPACE_COMMANDS_CONTRACT } from '../../../shared/ipc/space/commands.contract.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { PtyService } from '../../pty.js';
import type { SpaceWindowLike } from '../windows.js';
import { parseArg } from './validate.js';

const commandRunSchema = z.strictObject({ commandId: z.string().min(1).max(100) });

/** The window modes a command panel may run in. */
const RUNNABLE_MODES: readonly string[] = ['machine-check', 'setup', 'space'];

/** The characters of a running command's output kept for the device-code scan. */
const OUTPUT_BUFFER_LIMIT = 4096;

/** What the register module takes from its surroundings. A headless test gives a fake PTY service. */
export type SpaceCommandsParts = {
  /** The PTY service the command runs in. Default: `deps.space.commandTerminal(window)`. */
  spawn: (window: SpaceWindowLike, deps: Deps) => PtyService | undefined;
};

const DEFAULT_PARTS: SpaceCommandsParts = {
  spawn: (window, deps) => deps.space.commandTerminal(window),
};

const NOT_A_SPACE_WINDOW: SpaceCommandRunResult = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from an AI-Lore 1.0 window.',
  },
};

/**
 * Build the register module of the command panel. `parts` replaces how the
 * PTY service is found, so a headless test can give a fake one without a real
 * terminal.
 */
export function createSpaceCommandsRegister(
  parts: Partial<SpaceCommandsParts> = {},
): RegisterModule {
  const { spawn } = { ...DEFAULT_PARTS, ...parts };
  return (reg, deps) => {
    reg.handle('spaceCommandRun', (event, arg): SpaceCommandRunResult => {
      const record = deps.space.windowFor(event);
      if (!record) return NOT_A_SPACE_WINDOW;
      const parsed = parseArg(commandRunSchema, arg);
      if (!parsed.ok) return parsed;
      if (!RUNNABLE_MODES.includes(record.init.mode)) {
        return {
          ok: false,
          error: {
            kind: 'not-allowed-here',
            message:
              'Commands run from Set up this computer, from the setup screens and from a Space window.',
          },
        };
      }
      const { commandId } = parsed.value;
      const commandLine = setupCommandLine(commandId);
      if (commandLine === null) {
        return {
          ok: false,
          error: {
            kind: 'unknown-command',
            message: `${commandId} is not a command the companion may run.`,
          },
        };
      }
      const pty = spawn(record.window, deps);
      if (!pty) {
        return {
          ok: false,
          error: {
            kind: 'no-terminal',
            message: 'This window has no terminal to run a command in.',
          },
        };
      }
      const { window } = record;
      let buffer = '';
      let codePushed = false;
      deps.space.log.info('setup-command-started', { commandId });
      let ptyId = '';
      ptyId = pty.spawn(undefined, {
        command: commandLine,
        onData: (data) => {
          buffer = (buffer + data).slice(-OUTPUT_BUFFER_LIMIT);
          if (codePushed) return;
          const code = parseDeviceCode(buffer);
          if (code === null) return;
          codePushed = true;
          if (!window.isDestroyed()) {
            window.webContents.send(SPACE_COMMANDS_CONTRACT.onSpaceCommandCode.channel, {
              ptyId,
              code,
            });
          }
        },
        onExit: (exitCode) => {
          deps.space.log.info('setup-command-ended', { commandId, exitCode });
          if (!window.isDestroyed()) {
            window.webContents.send(SPACE_COMMANDS_CONTRACT.onSpaceCommandExit.channel, {
              ptyId,
              commandId,
              exitCode,
            });
          }
        },
      });
      return { ok: true, value: { ptyId, commandId, commandLine } };
    });
  };
}

/** The register module of the command panel, as the module list holds it. */
export const registerSpaceCommands: RegisterModule = createSpaceCommandsRegister();
