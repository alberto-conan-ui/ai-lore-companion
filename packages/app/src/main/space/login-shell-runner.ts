/**
 * The command runner of an open Space, carrying the Human Lead's own `PATH`.
 *
 * A Finder-launched `.app` on macOS inherits launchd's minimal `PATH`
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), which holds neither Homebrew prefix. So
 * `gh`, installed by Homebrew and found by `which gh` in any terminal, is not
 * found by the app: `execFile('gh', …)` fails with `not-found`.
 *
 * The app already answers this in three places — the machine check
 * (`ipc/machine.ts`), Space creation (`ipc/setup.ts`) and migration
 * (`ipc/migration.ts`) each read the login shell's `PATH` and put it on the
 * commands they run. The runner that backs an *open* Space never did, so the
 * machine check could report `gh` as present while every GitHub call the Space
 * made could not find it: the Agents board went unwritten and no handover of
 * the desk reached GitHub. That is the defect of the Space's issue #58.
 *
 * This wrapper closes the gap once, on the runner every open Space is built
 * from, so `spaceGitHub`, the entering-Writing probe and the session board all
 * see the same `PATH` the Human Lead sees.
 *
 * The shell is asked once per run of the app and the answer is kept: the read
 * starts an interactive login shell, which is far too slow to repeat per
 * command. The read goes to the runner this wrapper was given and never
 * through the wrapper itself, so it cannot recurse.
 */

import { type CommandRunner, isTestMode } from '@ai-lore-companion/core';
import { readLoginShellPath, validLoginShell } from './ipc/machine.js';
import { runnerWithPath } from './ipc/setup.js';

/** What {@link createLoginShellRunner} takes from its surroundings. A test replaces them. */
export type LoginShellRunnerOptions = {
  /** The Human Lead's shell. Default: `$SHELL`, or `/bin/zsh`, as `main/pty.ts` has it. */
  shell?: string;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform;
  /** The environment the app was started with. Default: `process.env`. */
  env?: Record<string, string | undefined>;
  /** Whether a path is an existing file, for the validation of `shell`. Default: `statSync`. */
  isFile?: (path: string) => boolean;
};

/**
 * `runner` with the login shell's `PATH` on every command it runs.
 *
 * `runner` itself is returned, unwrapped, when there is no login shell to ask:
 * on Windows, when `$SHELL` is not an absolute path to an existing file, and
 * in a test run, where starting an interactive login shell would be both slow
 * and a reach outside the test's control.
 */
export function createLoginShellRunner(
  runner: CommandRunner,
  options: LoginShellRunnerOptions = {},
): CommandRunner {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const shell = validLoginShell(options.shell ?? env.SHELL ?? '/bin/zsh', options.isFile);
  if (platform === 'win32' || shell === null || isTestMode(env)) return runner;

  // Asked once, on the first command, and kept for the run of the app. A shell
  // that fails or times out answers `null`, and the command then runs with the
  // app's own `PATH` — the behaviour before this wrapper existed.
  let asked: Promise<string | null> | null = null;
  const path = (): Promise<string | null> => {
    asked ??= readLoginShellPath(runner, shell, platform).catch(() => null);
    return asked;
  };

  return {
    run: async (bin, args, opts) => runnerWithPath(runner, await path()).run(bin, args, opts),
  };
}
