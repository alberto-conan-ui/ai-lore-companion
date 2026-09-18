/**
 * The GitHub port of the app, and the port of an open Space as a service of
 * its context. Added by phase M5.1, which was the first part of the app to
 * read GitHub for a Space.
 *
 * Which port is built (architecture document, section 5.3), by
 * `createAppGitHubPort`:
 * - in an end-to-end run (`COCKPIT_E2E=1`) with `AI_LORE_FAKE_GITHUB=<state
 *   file>`, core's `FakeGitHub` on that file. It is loaded from core's testing
 *   entry at that moment only, so a normal run never loads it. This is the same
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

import {
  type CommandRunner,
  type GitHubError,
  type GitHubPort,
  createGhCliGitHub,
} from '@ai-lore-companion/core';
import { defineSpaceService } from './context.js';
import { liveGitHubAllowed } from './live-github.js';
import type { SpaceLog } from './log.js';

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
    findProject: answer,
    createProject: answer,
    ensureSingleSelectField: answer,
    ensureProjectView: answer,
    linkProjectToRepository: answer,
    ensureLabels: answer,
    findIssueByMarker: answer,
    findIssuesByMarkers: answer,
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
  };
}

/** What `createAppGitHubPort` needs. */
export type AppGitHubPortOptions = {
  /** The app's own command runner (`deps.space.runner`), which alone may start `gh`. */
  runner: CommandRunner;
  /** The environment the app was started with. Default: `process.env`. It is read, never changed. */
  env?: Record<string, string | undefined>;
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
  if (env.COCKPIT_E2E === '1' && stateFile !== undefined && stateFile !== '') {
    const testing = await import('@ai-lore-companion/core/testing');
    log?.info('github-port', { ...fields, port: 'fake' });
    return testing.createFakeGitHub({ stateFile });
  }
  if (!liveGitHubAllowed(env)) {
    log?.info('github-port', { ...fields, port: 'unreachable' });
    return unreachableGitHub('GitHub is not reached in a test run.');
  }
  log?.info('github-port', { ...fields, port: 'gh' });
  return createGhCliGitHub(runner);
}

/** The GitHub port of an open Space, shared by every part of the app that reads GitHub for it. */
export const spaceGitHub = defineSpaceService<SpaceGitHub>({
  id: 'github',
  create: (context) => {
    let port: GitHubPort | null = null;
    return {
      async port() {
        if (port === null) {
          port = await createAppGitHubPort({
            runner: context.runner,
            log: context.log,
            space: context.key,
          });
        }
        return port;
      },
      use(replacement) {
        port = replacement;
      },
    };
  },
});
