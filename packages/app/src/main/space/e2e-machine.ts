/**
 * The machine check of the app, and its answer in an end-to-end run with the
 * fake GitHub (phase M3.9).
 *
 * In an end-to-end run the app's runner refuses `gh` (`live-github.ts`), so
 * the real check reports `gh` as not usable and the welcome screen disables
 * the setup entries. The end-to-end test of setup needs them. In that run, and
 * only in it, the check is given:
 * - a runner that answers `gh --version` and `gh auth status` from the state
 *   of the fake GitHub the run already uses (`AI_LORE_FAKE_GITHUB`, read as
 *   `github-service.ts` reads it): signed in as the fake's account with the
 *   fake's scopes, or not signed in when the fake is signed out. Every other
 *   command (`git`, `python3`) goes to the app's runner as it is, so those two
 *   are checked for real;
 * - one engine of its own, whose `--version` the same runner answers and whose
 *   sign-in probe answers signed in, in place of the registry's engines. No
 *   engine is started in an end-to-end run; the real engine is a manual check.
 *
 * The switch is the one `createAppGitHubPort` uses: `COCKPIT_E2E=1` and a
 * state file in `AI_LORE_FAKE_GITHUB`, both read from the environment the app
 * was started with, in an app that is not packaged (`isFakeMachineRun`). The
 * app never sets either, and a terminal or session the app starts cannot
 * change the app's own environment. A launch without both, and every launch of
 * a packaged app, runs core's `checkMachine` unchanged. The fake is loaded from core's testing
 * entry at that moment only, so a normal run never loads it.
 */

import {
  type CommandRunner,
  type EngineEntry,
  type MachineCheck,
  type MachineCheckOptions,
  type RunResult,
  checkMachine,
} from '@ai-lore-companion/core';
import { isPackagedApp } from './template-dir.js';

/**
 * Whether this run uses the fakes of an end-to-end run: the fake GitHub
 * (`createAppGitHubPort`) and this file's machine check. It needs both
 * variables and an app that is not packaged (`isPackagedApp`, which answers as
 * Electron's `app.isPackaged`). A packaged app started with the variables gets
 * no fake: `COCKPIT_E2E=1` still refuses live GitHub there, so its setup
 * entries stay disabled instead of appearing to create a Space on a fake. It
 * changes nothing.
 */
export function isFakeMachineRun(
  env: Record<string, string | undefined>,
  packaged: boolean = isPackagedApp(),
): boolean {
  if (packaged) return false;
  const stateFile = env.AI_LORE_FAKE_GITHUB;
  return env.COCKPIT_E2E === '1' && stateFile !== undefined && stateFile !== '';
}

/** The engine of an end-to-end run, checked in place of the registry's. */
export const FAKE_MACHINE_ENGINE: EngineEntry = {
  id: 'e2e.fake-engine',
  name: 'Fake engine of the end-to-end run',
  binary: 'ai-lore-e2e-fake-engine',
};

/** The `gh` version the fake answers; recent enough for `MIN_GH_VERSION`. */
const FAKE_GH_VERSION = 'gh version 2.92.0 (end-to-end fake)\n';

/** What the fake's `auth` gives. */
export type FakeAuth =
  | { kind: 'signed-in'; account: string; scopes: readonly string[] }
  | { kind: 'not-signed-in' }
  | { kind: 'unreachable' };

const answer = (code: number, stdout: string, stderr = ''): RunResult => ({ code, stdout, stderr });

/** The text `gh auth status --hostname github.com` prints for `auth`, in the form `parseGhAuthStatus` reads. */
export function ghAuthStatusText(auth: FakeAuth): RunResult {
  switch (auth.kind) {
    case 'signed-in':
      return answer(
        0,
        [
          'github.com',
          `  ✓ Logged in to github.com account ${auth.account} (end-to-end fake)`,
          '  - Active account: true',
          `  - Token scopes: ${auth.scopes.map((scope) => `'${scope}'`).join(', ')}`,
          '',
        ].join('\n'),
      );
    case 'not-signed-in':
      return answer(
        1,
        '',
        'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
      );
    case 'unreachable':
      return answer(1, '', 'error connecting to api.github.com\n');
  }
}

/**
 * `runner`, with `gh` and the fake engine answered from `auth`. `auth` is
 * asked at each `gh auth status`, so a test that signs the fake out is seen at
 * the next check.
 */
export function fakeMachineRunner(
  runner: CommandRunner,
  auth: () => Promise<FakeAuth>,
): CommandRunner {
  return {
    async run(bin, args, opts) {
      if (bin === FAKE_MACHINE_ENGINE.binary) {
        return args[0] === '--version'
          ? answer(0, '1.0.0 (end-to-end fake engine)\n')
          : answer(1, '', `${bin} is the fake engine of an end-to-end run.\n`);
      }
      if (bin !== 'gh') return runner.run(bin, args, opts);
      if (args[0] === '--version') return answer(0, FAKE_GH_VERSION);
      if (args[0] === 'auth' && args[1] === 'status') return ghAuthStatusText(await auth());
      return answer(1, '', `gh ${args.join(' ')} is not answered in an end-to-end run.\n`);
    },
  };
}

/** The fake GitHub's answer to `auth`, read from its state file. */
async function fakeAuth(stateFile: string): Promise<FakeAuth> {
  const testing = await import('@ai-lore-companion/core/testing');
  const result = await testing.createFakeGitHub({ stateFile }).auth();
  if (result.ok) {
    return { kind: 'signed-in', account: result.value.account, scopes: result.value.scopes };
  }
  return result.error.kind === 'not-signed-in'
    ? { kind: 'not-signed-in' }
    : { kind: 'unreachable' };
}

/**
 * The machine check of the app: core's `checkMachine`, or, in an end-to-end
 * run with the fake GitHub, the same check with `gh` and the engine answered
 * as this file's header says.
 */
export function checkMachineOfApp(
  runner: CommandRunner,
  engines: readonly EngineEntry[],
  options: MachineCheckOptions,
  env: Record<string, string | undefined> = process.env,
  packaged: boolean = isPackagedApp(),
): Promise<MachineCheck> {
  if (!isFakeMachineRun(env, packaged)) return checkMachine(runner, engines, options);
  const stateFile = env.AI_LORE_FAKE_GITHUB ?? '';
  return checkMachine(
    fakeMachineRunner(runner, () => fakeAuth(stateFile)),
    [FAKE_MACHINE_ENGINE],
    {
      ...options,
      signInProbe: async (engine) =>
        engine.id === FAKE_MACHINE_ENGINE.id
          ? { kind: 'signed-in' }
          : {
              kind: 'undetermined',
              reason: 'Only the fake engine is checked in an end-to-end run.',
            },
    },
  );
}
