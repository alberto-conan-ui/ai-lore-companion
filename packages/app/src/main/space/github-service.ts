/**
 * The GitHub port of the app, and the port of an open Space as a service of
 * its context. Added by phase M5.1, which was the first part of the app to
 * read GitHub for a Space.
 *
 * Which port is built (architecture document, section 5.3), by
 * `createAppGitHubPort`:
 * - in an end-to-end run (`COCKPIT_E2E=1`) with `AI_LORE_FAKE_GITHUB=<state
 *   file>`, in an app that is not packaged (`isFakeMachineRun` of
 *   `e2e-machine.ts`), core's `FakeGitHub` on that file. A packaged app
 *   started with both variables gets the unreachable port below. It is loaded from core's testing
 *   entry at that moment only, so a normal run never loads it. While a file at
 *   `fakeUnreachableSwitch(<state file>)` exists, the fake answers
 *   `unreachable` (the end-to-end test of the Dashboard offline). This is the same
 *   switch as the app's existing end-to-end mode (`E2E_BYPASS_GUARDS` in
 *   `main/index.ts`), read from the environment the app was started with; the
 *   app never sets it, and a terminal or session the app starts cannot change
 *   the app's own environment. The fake never reaches GitHub;
 * - in a run that may not reach live GitHub (an end-to-end run without the
 *   fake, or test mode), a port whose every call answers `unreachable`;
 * - otherwise `gh` through the runner given, which is the app's own runner
 *   (`deps.space.runner`), the only one that was told `allowLiveGitHub`.
 *
 * A Space's service (`spaceGitHub`) builds its port with that function on the
 * first call; a test replaces it with `use`. A window that has no Space yet
 * (setup) calls `createAppGitHubPort` itself.
 */

import { existsSync } from 'node:fs';
import {
  type CommandRunner,
  type GitHubError,
  type GitHubPort,
  createGhCliGitHub,
} from '@ai-lore-companion/core';
import { withCommandLog } from './command-log.js';
import { defineSpaceService } from './context.js';
import { isFakeMachineRun } from './e2e-machine.js';
import { liveGitHubAllowed } from './live-github.js';
import type { SpaceLog } from './log.js';

/** How long one call of `gh` may take before it counts as unreachable (architecture document A.6). */
export const GH_CALL_TIMEOUT_MS = 20_000;

export type SpaceGitHub = {
  /** The port of this Space. Built on the first call. */
  port(): Promise<GitHubPort>;
  /** Replace the port. For a test, which gives core's `createFakeGitHub()`. */
  use(port: GitHubPort): void;
};

/**
 * A port that never starts `gh`: every call answers `unreachable`. A plain
 * object with the port's methods and nothing else, so that it has no `then`
 * and can be the value of a promise.
 */
export function unreachableGitHub(message: string): GitHubPort {
  const error: GitHubError = { kind: 'unreachable', message };
  const answer = async (): Promise<{ ok: false; error: GitHubError }> => ({ ok: false, error });
  return {
    auth: answer,
    findRepository: answer,
    createRepository: answer,
    branchHeads: answer,
    listSpaceRepositories: answer,
    findProject: answer,
    createProject: answer,
    ensureSingleSelectField: answer,
    ensureProjectView: answer,
    linkProjectToRepository: answer,
    ensureLabels: answer,
    findIssueByMarker: answer,
    findIssuesByMarkers: answer,
    findAllIssuesByMarkers: answer,
    createIssue: answer,
    updateIssue: answer,
    addSubIssue: answer,
    addIssueToProject: answer,
    setSingleSelect: answer,
    comment: answer,
    closeIssue: answer,
    developBranch: answer,
    readProject: answer,
    mergedPullRequests: answer,
    openPullRequests: answer,
  };
}

/**
 * The switch of the end-to-end fake (phase M7.5): while a file at this path
 * exists, every call of the fake answers `unreachable`. It is read only by the
 * fake's port, which only an end-to-end run of an unpackaged app gets
 * (`isFakeMachineRun`), so it changes nothing in any other run.
 */
export function fakeUnreachableSwitch(stateFile: string): string {
  return `${stateFile}.unreachable`;
}

/**
 * The fake's port, which before each call sets the fake unreachable or
 * reachable from `fakeUnreachableSwitch(stateFile)`. A plain object with the
 * port's methods only, as `unreachableGitHub` is.
 */
function withUnreachableSwitch(
  fake: GitHubPort & { setUnreachable(on: boolean): void },
  stateFile: string,
): GitHubPort {
  const path = fakeUnreachableSwitch(stateFile);
  const port = {} as Record<keyof GitHubPort, unknown>;
  for (const name of Object.keys(unreachableGitHub('')) as (keyof GitHubPort)[]) {
    const method = fake[name] as (...args: unknown[]) => unknown;
    port[name] = (...args: unknown[]) => {
      fake.setUnreachable(existsSync(path));
      return method.apply(fake, args);
    };
  }
  return port as GitHubPort;
}

/** What `createAppGitHubPort` needs. */
export type AppGitHubPortOptions = {
  /** The app's own command runner (`deps.space.runner`), which alone may start `gh`. */
  runner: CommandRunner;
  /** The environment the app was started with. Default: `process.env`. It is read, never changed. */
  env?: Record<string, string | undefined>;
  /** Whether this is a packaged app, which never gets the fake. Default: `isPackagedApp()`. */
  packaged?: boolean;
  /** Where the choice is logged, when given. */
  log?: SpaceLog;
  /** Named in the log line. */
  space?: string;
};

/**
 * The GitHub port of this run of the app: the end-to-end fake, the unreachable
 * port, or `gh` through `runner`, in that order (see this file's header). It
 * needs no Space, so the setup window uses it as the Space service does.
 */
export async function createAppGitHubPort(options: AppGitHubPortOptions): Promise<GitHubPort> {
  const { runner, log } = options;
  const env = options.env ?? process.env;
  const fields = options.space === undefined ? {} : { space: options.space };
  const stateFile = env.AI_LORE_FAKE_GITHUB;
  if (stateFile !== undefined && isFakeMachineRun(env, options.packaged)) {
    const testing = await import('@ai-lore-companion/core/testing');
    log?.info('github-port', { ...fields, port: 'fake' });
    return withUnreachableSwitch(testing.createFakeGitHub({ stateFile }), stateFile);
  }
  if (!liveGitHubAllowed(env)) {
    log?.info('github-port', { ...fields, port: 'unreachable' });
    return unreachableGitHub('GitHub is not reached in a test run.');
  }
  log?.info('github-port', { ...fields, port: 'gh' });
  return createGhCliGitHub(withCommandLog(runner, log, 'gh'), { timeoutMs: GH_CALL_TIMEOUT_MS });
}

/** The GitHub port of an open Space, shared by every part of the app that reads GitHub for it. */
export const spaceGitHub = defineSpaceService<SpaceGitHub>({
  id: 'github',
  create: (context) => {
    let port: GitHubPort | null = null;
    let creating: Promise<GitHubPort> | null = null;
    return {
      async port() {
        if (port !== null) return port;
        if (creating === null) {
          creating = createAppGitHubPort({
            runner: context.runner,
            log: context.log,
            space: context.key,
          });
        }
        const pending = creating;
        try {
          const created = await pending;
          // `use` may replace the port while the default is being built. Do not
          // let that in-flight build put its stale port back in service.
          if (port === null) port = created;
          return port;
        } finally {
          // A rejected build must be retryable. The identity check keeps an
          // older waiter from clearing a newer build if that ever changes.
          if (creating === pending) creating = null;
        }
      },
      use(replacement) {
        port = replacement;
      },
    };
  },
});
