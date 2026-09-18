/**
 * Whether this run of the app may start `gh`, and the command runner that
 * carries the answer.
 *
 * Core's command runner refuses `gh` unless it is told that live GitHub is
 * allowed, so that no test reaches live GitHub by accident. The app tells its
 * own runner, through the `allowLiveGitHub` option of core's guard. It does
 * not put `AI_LORE_ALLOW_LIVE_GITHUB` in `process.env`: every terminal the app
 * starts gets a copy of `process.env` (`main/pty.ts`), so a test suite or a
 * session run in one of the app's terminals would inherit the permission. A
 * value the app itself inherited from the shell that started it is removed
 * for the same reason.
 *
 * Live GitHub is not allowed for an end-to-end run (`COCKPIT_E2E=1`) or in
 * test mode (`NODE_ENV=test` or `AI_LORE_TEST=1`); such a run uses the fake
 * GitHub or gets a refusal.
 */

import {
  ALLOW_LIVE_GITHUB_ENV,
  type CommandRunner,
  createExecFileRunner,
  isTestMode,
} from '@ai-lore-companion/core';

/** Whether a run with this environment may reach live GitHub. It changes nothing. */
export function liveGitHubAllowed(env: Record<string, string | undefined>): boolean {
  return env.COCKPIT_E2E !== '1' && !isTestMode(env);
}

/** The app's own command runner, and whether it may start `gh`. */
export type AppCommandRunner = { runner: CommandRunner; liveGitHub: boolean };

/**
 * Build the runner every 1.0 module of main uses for `git` and `gh`
 * (`deps.space.runner`). `env` is the app's `process.env`; the variable is
 * removed from it, never set in it. The key is deleted, not set to
 * `undefined`: `process.env` would keep the text "undefined".
 */
export function createAppCommandRunner(
  env: Record<string, string | undefined> = process.env,
): AppCommandRunner {
  const liveGitHub = liveGitHubAllowed(env);
  Reflect.deleteProperty(env, ALLOW_LIVE_GITHUB_ENV);
  return {
    runner: createExecFileRunner({ guard: { allowLiveGitHub: liveGitHub } }),
    liveGitHub,
  };
}
