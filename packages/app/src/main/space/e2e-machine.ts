/**
 * The machine check of the app, and its answer in an end-to-end run with the
 * fake GitHub (phase M3.9, reshaped for the catalog by M9.4).
 *
 * In an end-to-end run the app's runner refuses `gh` (`live-github.ts`), so
 * the real check reports `gh` as not usable and the welcome screen disables
 * the setup entries. The end-to-end test of setup needs them. In that run, and
 * only in it, the check is given a runner that answers, before handing a
 * command to the real runner:
 * - a binary whose basename is `claude`: installed and signed in;
 * - a binary whose basename is `codex`, `agy` or `opencode`: not found (so the
 *   catalog engines other than Claude Code report `missing` in an end-to-end
 *   run, as they do until the Human Lead installs them for real);
 * - `brew --version` and `npm --version`: both present;
 * - `gh --version` and `gh auth status`: the state of the fake GitHub the run
 *   already uses (`AI_LORE_FAKE_GITHUB`, read as `github-service.ts` reads
 *   it), signed in as the fake's account with the fake's scopes, or not
 *   signed in when the fake is signed out;
 * - `gh api user/orgs …`: no organisations.
 *
 * Every other command (`git`, `python3`, any other `gh` call) goes to the
 * app's runner as it is, so those two are checked for real. The engine list
 * given to `checkMachine` is the app's own list (the catalog engines first,
 * `main/engines.ts`), not a fake engine of its own: an end-to-end run now
 * exercises the same catalog a real run does, with Claude Code answered as
 * installed and signed in.
 *
 * The switch is the one `createAppGitHubPort` uses: `COCKPIT_E2E=1` and a
 * state file in `AI_LORE_FAKE_GITHUB`, both read from the environment the app
 * was started with, in an app that is not packaged (`isFakeMachineRun`). The
 * app never sets either, and a terminal or session the app starts cannot
 * change the app's own environment. A launch without both, and every launch of
 * a packaged app, runs core's `checkMachine` unchanged. The fake is loaded from core's testing
 * entry at that moment only, so a normal run never loads it.
 *
 * A test that needs `checkMachineOfApp` to answer a report of its own choosing
 * (M12.2: the engines section with engines present or missing, Claude Code
 * signed out, and so on) states it in `AI_LORE_E2E_MACHINE`, an environment
 * variable read only when `COCKPIT_E2E=1` and the app is not packaged — the
 * same guard as the fake GitHub, but not conditioned on `AI_LORE_FAKE_GITHUB`
 * being set, so a test can state the machine report without also running the
 * fake GitHub. The variable holds a `MachineCheck` as JSON; it is parsed and
 * shape-checked (`fakeMachineReportSchema`) before it is trusted, and on any
 * parse failure, or any doubt about its shape, it is ignored — the check falls
 * through to the behaviour above as if the variable were absent. The variable
 * being unset takes the same path as before this addition, unchanged.
 */

import { basename } from 'node:path';
import {
  type CommandRunner,
  type EngineCheck,
  type EngineEntry,
  type GitHubCheck,
  type MachineCheck,
  type MachineCheckOptions,
  type RunResult,
  catalogEntryFor,
  checkEngine,
  checkGitHub,
  checkMachine,
  isClaudeEngine,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import { isPackagedApp } from './template-dir.js';

/** `MachineCheckState`, shape-checked (`packages/core/src/space/machine/types.ts`). */
const machineCheckStateSchema = z.union([
  z.strictObject({ kind: z.literal('fine'), version: z.string().nullable() }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('too-old'), version: z.string(), minimum: z.string() }),
  z.strictObject({ kind: z.literal('not-signed-in') }),
  z.strictObject({ kind: z.literal('missing-scope'), scope: z.string() }),
  z.strictObject({ kind: z.literal('undetermined'), reason: z.string() }),
]);

/** `EngineInstallState`, shape-checked. */
const engineInstallStateSchema = z.union([
  z.strictObject({ kind: z.literal('installed'), version: z.string().nullable() }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('undetermined'), reason: z.string() }),
]);

/** `EngineSignInState`, shape-checked. */
const engineSignInStateSchema = z.union([
  z.strictObject({ kind: z.literal('signed-in') }),
  z.strictObject({ kind: z.literal('not-signed-in') }),
  z.strictObject({ kind: z.literal('not-checked') }),
  z.strictObject({ kind: z.literal('undetermined'), reason: z.string() }),
]);

/** `EngineCheck`, shape-checked. */
const engineCheckSchema = z.strictObject({
  engineId: z.string(),
  name: z.string(),
  binary: z.string(),
  state: machineCheckStateSchema,
  guidance: z.string().nullable(),
  command: z.string().nullable(),
  catalogId: z.enum(['claude-code', 'codex', 'antigravity', 'opencode']).nullable(),
  maker: z.string().nullable(),
  required: z.boolean(),
  guardedSessions: z.boolean(),
  installed: engineInstallStateSchema,
  signIn: engineSignInStateSchema,
  installCommand: z.string().nullable(),
  installNeeds: z.literal('npm').nullable(),
  signInCommand: z.string().nullable(),
  note: z.string().nullable(),
  page: z.string().nullable(),
});

/** `MachineRequirementCheck`, shape-checked. */
const machineRequirementCheckSchema = z.strictObject({
  id: z.enum(['git', 'gh', 'engine', 'python3']),
  binary: z.string().nullable(),
  state: machineCheckStateSchema,
  guidance: z.string().nullable(),
  command: z.string().nullable(),
});

/**
 * `MachineCheck`, shape-checked (`packages/core/src/space/machine/types.ts`).
 * Not a proof that the report is internally consistent (for example, that the
 * `engine` requirement agrees with the Claude Code entry of `engines`) — only
 * that a test wrote something of the right shape. A test that states an
 * inconsistent report gets an inconsistent screen, which is its own mistake to
 * find, not a crash to guard against here.
 */
const fakeMachineReportSchema = z.strictObject({
  requirements: z.array(machineRequirementCheckSchema),
  engines: z.array(engineCheckSchema),
  ready: z.boolean(),
  github: z.strictObject({ account: z.string().nullable(), organisations: z.array(z.string()) }),
  tools: z.strictObject({ brew: z.boolean(), npm: z.boolean() }),
});

/**
 * The `MachineCheck` a test stated in `AI_LORE_E2E_MACHINE`, or `null` when
 * the variable is absent, is not valid JSON, or does not parse against
 * {@link fakeMachineReportSchema} — every one of those is "no report stated",
 * never a thrown error.
 */
export function parseFakeMachineReport(raw: string | undefined): MachineCheck | null {
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = fakeMachineReportSchema.safeParse(parsed);
  return result.success ? (result.data as MachineCheck) : null;
}

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

/** Not-found answer for a binary the end-to-end run has no fake for. */
function notFound(bin: string): RunResult {
  return { code: -1, stdout: '', stderr: `${bin} was not found`, failure: 'not-found' };
}

/** `basename(bin)`, lower case, `.exe` removed — the same key `mergeEnginesWithCatalog` matches a binary by. */
function binaryName(bin: string): string {
  return basename(bin)
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

/** The catalog engines other than Claude Code, never installed in an end-to-end run. */
const NOT_INSTALLED_CATALOG_BINARIES = new Set(['codex', 'agy', 'opencode']);

/**
 * `runner`, with the catalog engines, Homebrew, npm and `gh` answered from the
 * fake, before a command reaches `runner`. `auth` is asked at each
 * `gh auth status`, so a test that signs the fake out is seen at the next
 * check.
 */
export function fakeMachineRunner(
  runner: CommandRunner,
  auth: () => Promise<FakeAuth>,
): CommandRunner {
  return {
    async run(bin, args, opts) {
      const name = binaryName(bin);
      if (name === 'claude') {
        if (args[0] === '--version') return answer(0, '2.1.276 (Claude Code)\n');
        if (args[0] === 'auth' && args[1] === 'status' && args[2] === '--json') {
          return answer(0, '{"loggedIn":true}');
        }
        return answer(1, '', `${bin} ${args.join(' ')} is not answered in an end-to-end run.\n`);
      }
      if (NOT_INSTALLED_CATALOG_BINARIES.has(name)) return notFound(bin);
      if (name === 'brew' && args[0] === '--version') return answer(0, 'Homebrew 4.6.0\n');
      if (name === 'npm' && args[0] === '--version') return notFound(bin);
      if (bin !== 'gh') return runner.run(bin, args, opts);
      if (args[0] === '--version') return answer(0, FAKE_GH_VERSION);
      if (args[0] === 'auth' && args[1] === 'status') return ghAuthStatusText(await auth());
      if (args[0] === 'api' && args[1] === 'user/orgs') return answer(0, '');
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
 * run with the fake GitHub, the same check with the catalog engines,
 * Homebrew, npm and `gh` answered as this file's header says. `engines` is
 * the app's own list (catalog first) in both cases — a fake run checks the
 * same registry a real run does, not an engine of its own.
 *
 * Before either path, an unpackaged run with `COCKPIT_E2E=1` gets one more
 * chance to answer without touching `runner` at all: `AI_LORE_E2E_MACHINE`,
 * parsed and shape-checked by {@link parseFakeMachineReport}. A test states a
 * report there when it needs one this file's own fake cannot give (an engine
 * marked installed, Claude Code signed out, and so on — M12.2). When the
 * variable is absent, or does not parse, this is a no-op and every line below
 * runs exactly as it did before the variable existed: the default path is
 * this function's `if` and `return` unchanged, reached the same way.
 */
export function checkMachineOfApp(
  runner: CommandRunner,
  engines: readonly EngineEntry[],
  options: MachineCheckOptions,
  env: Record<string, string | undefined> = process.env,
  packaged: boolean = isPackagedApp(),
): Promise<MachineCheck> {
  if (!packaged && env.COCKPIT_E2E === '1') {
    const stated = parseFakeMachineReport(env.AI_LORE_E2E_MACHINE);
    if (stated !== null) return Promise.resolve(stated);
  }
  if (!isFakeMachineRun(env, packaged)) return checkMachine(runner, engines, options);
  const stateFile = env.AI_LORE_FAKE_GITHUB ?? '';
  return checkMachine(
    fakeMachineRunner(runner, () => fakeAuth(stateFile)),
    engines,
    options,
  );
}

/**
 * The `EngineCheck` of one engine of the app's registry: in a fake machine
 * run, installed and signed in, without running anything (an end-to-end run
 * starts no real engine); otherwise core's `checkEngine`, for real.
 */
export function probeEngineOfApp(
  runner: CommandRunner,
  engine: EngineEntry,
  options: MachineCheckOptions,
  env: Record<string, string | undefined> = process.env,
  packaged: boolean = isPackagedApp(),
): Promise<EngineCheck> {
  if (!isFakeMachineRun(env, packaged)) return checkEngine(runner, engine, options);
  const catalog = catalogEntryFor(engine);
  const installed = { kind: 'installed' as const, version: '1.0.0' };
  const signIn = { kind: 'signed-in' as const };
  const check: EngineCheck = {
    engineId: engine.id,
    name: engine.name,
    binary: engine.binary,
    state: { kind: 'fine', version: installed.version },
    guidance: null,
    command: null,
    catalogId: catalog?.catalogId ?? null,
    maker: catalog?.maker ?? null,
    required: catalog?.required ?? false,
    guardedSessions: catalog?.guardedSessions ?? isClaudeEngine(engine),
    installed,
    signIn,
    installCommand: catalog?.installCommand ?? null,
    installNeeds: catalog?.installNeeds ?? null,
    signInCommand: catalog?.signInCommand ?? null,
    note: catalog?.note ?? null,
    page: catalog?.page ?? null,
  };
  return Promise.resolve(check);
}

/**
 * The signed-in account and its organisations, as the machine report shows
 * them: core's `checkGitHub` through the fake in a fake machine run, else
 * through `runner`, for real.
 */
export async function readGitHubOwnersOfApp(
  runner: CommandRunner,
  options: MachineCheckOptions,
  env: Record<string, string | undefined> = process.env,
  packaged: boolean = isPackagedApp(),
): Promise<{ account: string | null; organisations: string[] }> {
  const of: CommandRunner = isFakeMachineRun(env, packaged)
    ? fakeMachineRunner(runner, () => fakeAuth(env.AI_LORE_FAKE_GITHUB ?? ''))
    : runner;
  const result: GitHubCheck = await checkGitHub(of, options);
  return { account: result.account, organisations: result.organisations };
}
