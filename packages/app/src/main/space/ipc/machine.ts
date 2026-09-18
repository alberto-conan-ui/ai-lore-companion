/**
 * The handlers of the machine check (`shared/ipc/space/machine.contract.ts`).
 *
 * The check is core's `checkMachine`, run through the app's own command runner
 * (`deps.space.runner`) with the engines of the app's registry. The companion
 * checks and guides; this module installs nothing and signs in nowhere.
 *
 * The `PATH` of the check's commands is the `PATH` of the Human Lead's login
 * shell. An app started from the Finder has the short `PATH` of launchd, which
 * lacks the folders a shell profile adds (`~/.local/bin`, Homebrew). The
 * existing app reaches the same `PATH` by starting `$SHELL -i -l -c <command>`
 * (`main/pty.ts` for an engine, `main/engines.ts` for the registry's seed);
 * this module starts the same shell with the same flags, once per check, and
 * reads `$PATH` from it. The `PATH` is read again at every check, because
 * editing a shell profile is one of the things the guidance leads to.
 */

import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { CommandRunner, EngineEntry } from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  MachineCheckReport,
  MachinePathSource,
  SpaceMachineCheckResult,
} from '../../../shared/ipc.js';
import { loadEngines } from '../../engines.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import { checkMachineOfApp } from '../e2e-machine.js';
import { parseArg } from './validate.js';

const checkSchema = z.strictObject({ fresh: z.boolean() });

/** How long the login shell may take to print its `PATH`, in milliseconds. */
export const LOGIN_SHELL_PATH_TIMEOUT_MS = 10_000;

const PATH_START = '__AI_LORE_PATH_START__';
const PATH_END = '__AI_LORE_PATH_END__';

/**
 * The fixed command the login shell runs. The markers separate `$PATH` from
 * anything a shell profile prints. No value from outside this file reaches
 * the string.
 */
export const LOGIN_SHELL_PATH_COMMAND = `printf '${PATH_START}%s${PATH_END}' "$PATH"`;

/** The arguments of the login shell: interactive and login, as `main/pty.ts` starts it. */
export const LOGIN_SHELL_ARGS = ['-i', '-l', '-c', LOGIN_SHELL_PATH_COMMAND] as const;

/**
 * The `PATH` between the markers of the login shell's output, or `null` when
 * there is none. The last start marker is taken, so a line a shell profile
 * prints before the command cannot stand in for the answer.
 */
export function parseLoginShellPath(stdout: string): string | null {
  const start = stdout.lastIndexOf(PATH_START);
  if (start === -1) return null;
  const end = stdout.indexOf(PATH_END, start);
  if (end === -1) return null;
  const path = stdout.slice(start + PATH_START.length, end).trim();
  if (path.length === 0 || CONTROL_CHARACTER.test(path)) return null;
  return path;
}

/** A `PATH` with a control character in it is not given to a command. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the test is for control characters.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The shell to start, or `null` when `candidate` cannot be one. `$SHELL` comes
 * from the environment the app was started with, so it is accepted only as an
 * absolute path to an existing file. A bare name would be looked up on the
 * app's `PATH`, and a relative path against the app's working folder.
 */
export function validLoginShell(
  candidate: string,
  isFile: (path: string) => boolean = isExistingFile,
): string | null {
  if (candidate.includes('\0') || !isAbsolute(candidate)) return null;
  return isFile(candidate) ? candidate : null;
}

/**
 * Read the `PATH` of the login shell through `runner`. `null` on a platform
 * with no login shell of this form (Windows), and when the shell did not
 * answer; the check then runs with the app's own `PATH`.
 */
export async function readLoginShellPath(
  runner: CommandRunner,
  shell: string | null,
  platform: NodeJS.Platform,
): Promise<string | null> {
  if (platform === 'win32' || shell === null) return null;
  const result = await runner.run(shell, LOGIN_SHELL_ARGS, {
    timeoutMs: LOGIN_SHELL_PATH_TIMEOUT_MS,
  });
  return parseLoginShellPath(result.stdout);
}

/** What the handlers take from their surroundings. A headless test replaces them. */
export type SpaceMachineParts = {
  /** The engines of the app's registry. Default: `loadEngines` of `main/engines.ts`. */
  engines: (userDataDir: string) => readonly EngineEntry[];
  /** The runner of the check. Default: `deps.space.runner`. */
  runner: (deps: Deps) => CommandRunner;
  /** The Human Lead's shell. Default: `$SHELL`, or `/bin/zsh`, as `main/pty.ts` has it. */
  shell: string;
  /** Whether a path is an existing file, for the validation of `shell`. Default: `statSync`. */
  isFile: (path: string) => boolean;
  /** Default: `process.platform`. */
  platform: NodeJS.Platform;
  /** The clock. Default: `Date.now`. */
  now: () => number;
};

const DEFAULT_PARTS: SpaceMachineParts = {
  engines: loadEngines,
  runner: (deps) => deps.space.runner,
  shell: process.env.SHELL ?? '/bin/zsh',
  isFile: isExistingFile,
  platform: process.platform,
  now: Date.now,
};

/**
 * Build the register module of the machine check. The last report is kept for
 * this run of the app, so that the welcome screen does not start the commands
 * again each time it is shown; it is kept here and not in a Space service,
 * because the screens that ask have no Space. Two requests at the same time
 * share one run.
 */
export function createSpaceMachineRegister(parts: Partial<SpaceMachineParts> = {}): RegisterModule {
  const all = { ...DEFAULT_PARTS, ...parts };
  const { engines, runner: runnerOf, platform, now } = all;
  return (reg, deps) => {
    let last: MachineCheckReport | null = null;
    let running: Promise<MachineCheckReport> | null = null;

    async function check(): Promise<MachineCheckReport> {
      const runner = runnerOf(deps);
      const shell = validLoginShell(all.shell, all.isFile);
      if (shell === null && platform !== 'win32') deps.space.log.warn('login-shell-not-valid');
      const path = await readLoginShellPath(runner, shell, platform);
      const pathSource: MachinePathSource = path === null ? 'app-environment' : 'login-shell';
      if (path === null && platform !== 'win32') deps.space.log.warn('login-shell-path-not-read');
      const result = await checkMachineOfApp(runner, engines(deps.space.userDataDir()), {
        platform,
        ...(path === null ? {} : { env: { PATH: path } }),
      });
      const report: MachineCheckReport = { check: result, checkedAt: now(), pathSource };
      deps.space.log.info('machine-checked', {
        ready: result.ready,
        states: result.requirements.map((requirement) => requirement.state.kind).join(','),
        pathSource,
      });
      return report;
    }

    reg.handle('spaceMachineCheck', async (event, arg): Promise<SpaceMachineCheckResult> => {
      if (!deps.space.windowFor(event)) {
        return {
          ok: false,
          error: {
            kind: 'not-a-space-window',
            message: 'The request did not come from an AI-Lore 1.0 window.',
          },
        };
      }
      const parsed = parseArg(checkSchema, arg);
      if (!parsed.ok) return parsed;
      if (!parsed.value.fresh && last !== null) return { ok: true, value: last };
      try {
        running ??= check().finally(() => {
          running = null;
        });
        last = await running;
        return { ok: true, value: last };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        deps.space.log.warn('machine-check-failed', { message });
        return {
          ok: false,
          error: { kind: 'check-failed', message: `The machine check did not run: ${message}` },
        };
      }
    });
  };
}

/** The register module of the machine check, as the module list holds it. */
export const registerSpaceMachine: RegisterModule = createSpaceMachineRegister();
