/**
 * The machine check: whether `git`, `gh`, an engine of the registry and
 * `python3` are on the machine and usable, with the guidance for each that is
 * not.
 *
 * The check reads only. It runs `--version` and status commands through the
 * `CommandRunner` it is given, in parallel, each with a timeout. It writes
 * nothing, installs nothing and asks nothing of the Human Lead. No function of
 * this file throws or rejects: what goes wrong becomes the state
 * `undetermined` with the reason.
 */

import type { EngineEntry } from '../../engines/index.js';
import { catalogEntryFor } from '../engines/catalog.js';
import type { CommandRunner, RunResult } from '../exec/runner.js';
import { errorMessage } from '../result.js';
import { CLAUDE_SIGN_IN_COMMAND, isClaudeEngine, probeEngineSignIn } from './engine-sign-in.js';
import { type GhAuthReading, parseGhAuthStatus } from './gh-auth.js';
import {
  GH_SIGN_IN_COMMAND,
  GITHUB_HOST,
  type GuidanceSubject,
  INSTALL_LINKS,
  REQUIRED_GH_SCOPE,
  guidanceFor,
  platformInstallCommand,
} from './guidance.js';
import type {
  EngineCheck,
  EngineInstallState,
  EngineSignInState,
  MachineCheck,
  MachineCheckOptions,
  MachineCheckState,
  MachineCheckStateKind,
  MachinePlatform,
  MachineRequirementCheck,
  MachineRequirementId,
  ProbeRun,
} from './types.js';
import {
  MIN_GH_VERSION,
  MIN_GIT_VERSION,
  MIN_PYTHON_VERSION,
  type ToolVersion,
  compareToolVersions,
  formatToolVersion,
  parseToolVersion,
} from './versions.js';

/**
 * How long one command of the check may take. The sources give no number; ten
 * seconds is the choice of the session that built phase M3.2, because
 * `gh auth status` asks GitHub over the network before it answers.
 */
export const DEFAULT_MACHINE_CHECK_TIMEOUT_MS = 10_000;

/** The longest piece of a command's output that is quoted in a reason. */
const MAX_QUOTED_OUTPUT = 160;

/** Apple's tool that says whether the command line developer tools are installed. */
const XCODE_SELECT = '/usr/bin/xcode-select';
const WHICH = '/usr/bin/which';

type Settings = {
  runner: CommandRunner;
  timeoutMs: number;
  env: Record<string, string> | undefined;
  platform: MachinePlatform;
  signInProbe: NonNullable<MachineCheckOptions['signInProbe']>;
};

function settingsOf(runner: CommandRunner, options: MachineCheckOptions): Settings {
  const timeoutMs =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_MACHINE_CHECK_TIMEOUT_MS;
  return {
    runner,
    timeoutMs,
    env: options.env,
    platform: options.platform ?? process.platform,
    signInProbe: options.signInProbe ?? probeEngineSignIn,
  };
}

/**
 * Run one command. The runner is given the timeout, and the wait is also ended
 * here after the same time, so that a runner that does not keep the timeout
 * cannot hold the check. A runner that throws or rejects gives `spawn-error`.
 */
function probeRun(settings: Settings): ProbeRun {
  return async (bin, args) => {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<RunResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            code: -1,
            stdout: '',
            stderr: `${bin} was stopped after ${settings.timeoutMs} ms`,
            failure: 'timeout',
          }),
        settings.timeoutMs,
      );
    });
    try {
      const running = Promise.resolve().then(() =>
        settings.runner.run(bin, args, { timeoutMs: settings.timeoutMs, env: settings.env }),
      );
      return await Promise.race([running, timedOut]);
    } catch (caught) {
      return { code: -1, stdout: '', stderr: errorMessage(caught), failure: 'spawn-error' };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The first line of a command's output that is not empty and holds no token, shortened. */
function quoteOutput(result: RunResult): string {
  const line = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text !== '' && !/token:/i.test(text));
  if (line === undefined) return 'it printed nothing';
  const short = line.length > MAX_QUOTED_OUTPUT ? `${line.slice(0, MAX_QUOTED_OUTPUT)}…` : line;
  return `it printed "${short}"`;
}

/** The state for a command that did not exit with code 0. */
function stateOfFailedRun(
  command: string,
  result: RunResult,
  timeoutMs: number,
): MachineCheckState {
  switch (result.failure) {
    case 'not-found':
      return { kind: 'missing' };
    case 'timeout':
      return {
        kind: 'undetermined',
        reason: `\`${command}\` did not answer within ${
          timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 100) / 10} seconds`
        }.`,
      };
    case 'refused':
      return {
        kind: 'undetermined',
        reason: `\`${command}\` was not run, because the companion's guard refused it; ${quoteOutput(result)}.`,
      };
    case undefined:
      return {
        kind: 'undetermined',
        reason: `\`${command}\` exited with code ${result.code}; ${quoteOutput(result)}.`,
      };
    default:
      return {
        kind: 'undetermined',
        reason: `\`${command}\` could not be run (${result.failure}); ${quoteOutput(result)}.`,
      };
  }
}

/**
 * The state that `<bin> --version` gives: `missing`, `too-old`, `undetermined`,
 * or `fine` with the version. `minimum` is `null` when any version is accepted.
 */
async function versionState(
  settings: Settings,
  bin: string,
  minimum: ToolVersion | null,
): Promise<MachineCheckState> {
  const command = `${bin} --version`;
  const result = await probeRun(settings)(bin, ['--version']);
  if (result.failure !== undefined || result.code !== 0) {
    if (/xcode-select|no developer tools/i.test(result.stderr)) return { kind: 'missing' };
    return stateOfFailedRun(command, result, settings.timeoutMs);
  }
  const version = parseToolVersion(result.stdout) ?? parseToolVersion(result.stderr);
  if (version === null) {
    if (minimum === null) return { kind: 'fine', version: null };
    return {
      kind: 'undetermined',
      reason: `\`${command}\` answered without a version number; ${quoteOutput(result)}.`,
    };
  }
  if (minimum !== null && compareToolVersions(version, minimum) < 0) {
    return {
      kind: 'too-old',
      version: formatToolVersion(version),
      minimum: formatToolVersion(minimum),
    };
  }
  return { kind: 'fine', version: formatToolVersion(version) };
}

/**
 * On macOS, `/usr/bin/git` and `/usr/bin/python3` are placeholders until
 * Apple's command line developer tools are installed, and running one opens
 * an installation dialog. The check may not prompt, so it first asks
 * `xcode-select -p` whether the tools are there, and when they are not, asks
 * `which` whether `bin` is the placeholder. It then reports `missing` without
 * running it. When either question has no clear answer, the tool is run.
 */
async function isMacPlaceholder(settings: Settings, bin: string): Promise<boolean> {
  if (settings.platform !== 'darwin') return false;
  const run = probeRun(settings);
  const tools = await run(XCODE_SELECT, ['-p']);
  if (tools.failure !== undefined || tools.code === 0) return false;
  const found = await run(WHICH, [bin]);
  return (
    found.failure === undefined && found.code === 0 && found.stdout.trim() === `/usr/bin/${bin}`
  );
}

function requirement(
  id: MachineRequirementId,
  binary: string | null,
  subject: GuidanceSubject,
  state: MachineCheckState,
): MachineRequirementCheck {
  return { id, binary, state, ...guidanceFor(subject, state) };
}

function undeterminedBy(caught: unknown): MachineCheckState {
  return { kind: 'undetermined', reason: `The check itself failed: ${errorMessage(caught)}.` };
}

function toolSubject(tool: 'git' | 'python3', platform: MachinePlatform): GuidanceSubject {
  return {
    name: tool,
    link: INSTALL_LINKS[tool],
    installCommand: platformInstallCommand(tool, platform),
    signInCommand: null,
  };
}

/** Check `git`: present, and `MIN_GIT_VERSION` or later. */
export async function checkGit(
  runner: CommandRunner,
  options: MachineCheckOptions = {},
): Promise<MachineRequirementCheck> {
  const settings = settingsOf(runner, options);
  const subject = toolSubject('git', settings.platform);
  try {
    const state = (await isMacPlaceholder(settings, 'git'))
      ? ({ kind: 'missing' } as const)
      : await versionState(settings, 'git', MIN_GIT_VERSION);
    return requirement('git', 'git', subject, state);
  } catch (caught) {
    return requirement('git', 'git', subject, undeterminedBy(caught));
  }
}

/** Check `python3`: present, and `MIN_PYTHON_VERSION` or later. */
export async function checkPython3(
  runner: CommandRunner,
  options: MachineCheckOptions = {},
): Promise<MachineRequirementCheck> {
  const settings = settingsOf(runner, options);
  const subject = toolSubject('python3', settings.platform);
  try {
    const state = (await isMacPlaceholder(settings, 'python3'))
      ? ({ kind: 'missing' } as const)
      : await versionState(settings, 'python3', MIN_PYTHON_VERSION);
    return requirement('python3', 'python3', subject, state);
  } catch (caught) {
    return requirement('python3', 'python3', subject, undeterminedBy(caught));
  }
}

/** `gh`'s guidance subject, shared by `checkGh` and `checkGitHub`. */
const GH_SUBJECT: GuidanceSubject = {
  name: 'gh',
  link: INSTALL_LINKS.gh,
  installCommand: null,
  signInCommand: GH_SIGN_IN_COMMAND,
};

/**
 * `gh`'s state and, when it was read, the reading of `gh auth status`
 * (`null` when the version check failed, or the command itself did not run).
 * `checkGh` uses only the state; `checkGitHub` uses the reading too, for the
 * account and to decide whether to ask for the organisations.
 */
async function ghStateAndReading(
  settings: Settings,
): Promise<{ state: MachineCheckState; reading: GhAuthReading | null }> {
  const version = await versionState(settings, 'gh', MIN_GH_VERSION);
  if (version.kind !== 'fine') return { state: version, reading: null };
  const args = ['auth', 'status', '--hostname', GITHUB_HOST];
  const command = `gh ${args.join(' ')}`;
  const result = await probeRun(settings)('gh', args);
  if (result.failure !== undefined) {
    return { state: stateOfFailedRun(command, result, settings.timeoutMs), reading: null };
  }
  const reading = parseGhAuthStatus(`${result.stdout}\n${result.stderr}`);
  switch (reading.kind) {
    case 'not-signed-in':
      return { state: { kind: 'not-signed-in' }, reading };
    case 'unreachable':
      return {
        state: {
          kind: 'undetermined',
          reason: `\`${command}\` could not reach ${GITHUB_HOST} to check the token; ${quoteOutput(result)}.`,
        },
        reading,
      };
    case 'unknown':
      return {
        state: {
          kind: 'undetermined',
          reason: `\`${command}\` exited with code ${result.code} and its answer was not understood; ${quoteOutput(result)}.`,
        },
        reading,
      };
    case 'signed-in':
      if (reading.scopes === null) {
        return {
          state: {
            kind: 'undetermined',
            reason: `\`${command}\` did not list the scopes of the token, so the \`${REQUIRED_GH_SCOPE}\` scope could not be checked. gh lists scopes only for the token of \`gh auth login\` and for a classic personal token; a fine-grained token or an app's token, often given through GH_TOKEN or GITHUB_TOKEN, has none to list. Remove that variable, or run \`${GH_SIGN_IN_COMMAND}\`.`,
          },
          reading,
        };
      }
      if (!reading.scopes.includes(REQUIRED_GH_SCOPE)) {
        return { state: { kind: 'missing-scope', scope: REQUIRED_GH_SCOPE }, reading };
      }
      return { state: version, reading };
  }
}

/**
 * Check `gh`: present, `MIN_GH_VERSION` or later, signed in to github.com, and
 * its token has the `project` scope. The guidance for a missing scope carries
 * the literal command that adds it.
 */
export async function checkGh(
  runner: CommandRunner,
  options: MachineCheckOptions = {},
): Promise<MachineRequirementCheck> {
  const settings = settingsOf(runner, options);
  try {
    const { state } = await ghStateAndReading(settings);
    return requirement('gh', 'gh', GH_SUBJECT, state);
  } catch (caught) {
    return requirement('gh', 'gh', GH_SUBJECT, undeterminedBy(caught));
  }
}

/** The organisations `gh api user/orgs` lists, in the order GitHub returns them. Any failure gives `[]`. */
async function readOrganisations(settings: Settings): Promise<string[]> {
  const args = ['api', 'user/orgs', '--paginate', '--jq', '.[].login'];
  try {
    const result = await probeRun(settings)('gh', args);
    if (result.failure !== undefined || result.code !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** What `checkGitHub` returns: the `gh` requirement, the signed-in account, and its organisations. */
export type GitHubCheck = {
  requirement: MachineRequirementCheck;
  account: string | null;
  organisations: string[];
};

/**
 * Check GitHub through `gh`: the `gh` requirement (as `checkGh` gives it), the
 * account `gh` is signed in with, and its organisations. The account and the
 * organisations are read from the same `gh auth status` call `checkGh` makes,
 * so signing in is asked for once; the organisations are asked for only when
 * signed in.
 */
export async function checkGitHub(
  runner: CommandRunner,
  options: MachineCheckOptions = {},
): Promise<GitHubCheck> {
  const settings = settingsOf(runner, options);
  try {
    const { state, reading } = await ghStateAndReading(settings);
    const requirementCheck = requirement('gh', 'gh', GH_SUBJECT, state);
    if (reading?.kind !== 'signed-in') {
      return { requirement: requirementCheck, account: null, organisations: [] };
    }
    return {
      requirement: requirementCheck,
      account: reading.account,
      organisations: await readOrganisations(settings),
    };
  } catch (caught) {
    return {
      requirement: requirement('gh', 'gh', GH_SUBJECT, undeterminedBy(caught)),
      account: null,
      organisations: [],
    };
  }
}

/**
 * `true` unless the probe's result says the binary was not found. `probeRun`
 * itself never throws or rejects, but a runner that answers with something
 * that is not a `RunResult` at all (a test's broken double) might still make
 * reading `.failure` throw; that is read as present too, since nothing said
 * otherwise.
 */
async function toolPresent(settings: Settings, bin: string): Promise<boolean> {
  try {
    const result = await probeRun(settings)(bin, ['--version']);
    return result.failure !== 'not-found';
  } catch {
    return true;
  }
}

/** Whether Homebrew and npm are on the machine. */
async function checkTools(settings: Settings): Promise<{ brew: boolean; npm: boolean }> {
  const [brew, npm] = await Promise.all([
    toolPresent(settings, 'brew'),
    toolPresent(settings, 'npm'),
  ]);
  return { brew, npm };
}

function engineSubject(engine: EngineEntry): GuidanceSubject {
  const claude = isClaudeEngine(engine);
  return {
    name: engine.name,
    link: claude ? INSTALL_LINKS.claude : null,
    installCommand: null,
    signInCommand: claude ? CLAUDE_SIGN_IN_COMMAND : null,
  };
}

/** `<binary> --version`, read as an `EngineInstallState` (no lowest version is asked of an engine). */
async function engineInstallState(
  settings: Settings,
  engine: EngineEntry,
): Promise<EngineInstallState> {
  const version = await versionState(settings, engine.binary, null);
  switch (version.kind) {
    case 'fine':
      return { kind: 'installed', version: version.version };
    case 'missing':
      return { kind: 'missing' };
    case 'undetermined':
      return { kind: 'undetermined', reason: version.reason };
    default:
      // `versionState` with no lowest version never gives `too-old`, `not-signed-in`
      // or `missing-scope`; this is only a defensive fallback.
      return { kind: 'undetermined', reason: 'the installed version could not be read' };
  }
}

/**
 * The sign-in probe's answer, bounded so that one that never answers cannot
 * hold the check. Asked only when `installed.kind === 'installed'`.
 */
async function engineSignInState(
  settings: Settings,
  engine: EngineEntry,
  installed: EngineInstallState,
): Promise<EngineSignInState> {
  if (installed.kind !== 'installed') return { kind: 'not-checked' };
  let timer: NodeJS.Timeout | undefined;
  // A probe runs at most a few commands; this bound only stops one that never answers.
  const bound = settings.timeoutMs * 3;
  try {
    return await Promise.race([
      Promise.resolve().then(() => settings.signInProbe(engine, probeRun(settings))),
      new Promise<EngineSignInState>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              kind: 'undetermined',
              reason: `The sign-in probe of ${engine.name} did not answer in time.`,
            }),
          bound,
        );
      }),
    ]);
  } catch (caught) {
    return {
      kind: 'undetermined',
      reason: `The sign-in probe of ${engine.name} failed: ${errorMessage(caught)}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The legacy `MachineCheckState` kept for existing readers: `missing` when
 * not installed, `undetermined` when the install state is undetermined,
 * `not-signed-in` when `signIn` is `not-signed-in`, otherwise `fine` with the
 * version. A sign-in that is `undetermined` or `not-checked` does not make
 * this other than `fine`.
 */
function legacyEngineState(
  installed: EngineInstallState,
  signIn: EngineSignInState,
): MachineCheckState {
  if (installed.kind === 'missing') return { kind: 'missing' };
  if (installed.kind === 'undetermined') return { kind: 'undetermined', reason: installed.reason };
  if (signIn.kind === 'not-signed-in') return { kind: 'not-signed-in' };
  return { kind: 'fine', version: installed.version };
}

/**
 * Check one engine of the list given to `checkMachine`: its binary answers
 * `--version`, and, once installed, the sign-in probe of its catalog entry
 * (A.3) says whether it is signed in. No lowest version is asked of an
 * engine. `state` is kept for readers written before phase M9.3, derived from
 * `installed` and `signIn` by `legacyEngineState`.
 */
export async function checkEngine(
  runner: CommandRunner,
  engine: EngineEntry,
  options: MachineCheckOptions = {},
): Promise<EngineCheck> {
  const settings = settingsOf(runner, options);
  const catalog = catalogEntryFor(engine);
  let installed: EngineInstallState;
  try {
    installed = await engineInstallState(settings, engine);
  } catch (caught) {
    installed = {
      kind: 'undetermined',
      reason: `The check itself failed: ${errorMessage(caught)}.`,
    };
  }
  let signIn: EngineSignInState;
  try {
    signIn = await engineSignInState(settings, engine, installed);
  } catch (caught) {
    signIn = {
      kind: 'undetermined',
      reason: `The sign-in probe of ${engine.name} failed: ${errorMessage(caught)}.`,
    };
  }
  const state = legacyEngineState(installed, signIn);
  return {
    engineId: engine.id,
    name: engine.name,
    binary: engine.binary,
    state,
    ...guidanceFor(engineSubject(engine), state),
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
}

/** Which state is shown for the `engine` requirement when no engine is fine: the one nearest to fine. */
const ENGINE_STATE_ORDER: readonly MachineCheckStateKind[] = [
  'fine',
  'not-signed-in',
  'missing-scope',
  'undetermined',
  'too-old',
  'missing',
];

/**
 * The `engine` requirement: the check of the catalog's Claude Code engine
 * when the list given has one. Otherwise (a caller that passes engines
 * without it), the first engine that is fine, otherwise the engine nearest to
 * fine, the list's order deciding between equals; an empty list is `missing`,
 * because the app lists an engine as soon as it finds its binary.
 */
export function engineRequirement(engines: readonly EngineCheck[]): MachineRequirementCheck {
  const claudeCode = engines.find((candidate) => candidate.catalogId === 'claude-code');
  if (claudeCode !== undefined) {
    return {
      id: 'engine',
      binary: claudeCode.binary,
      state: claudeCode.state,
      guidance: claudeCode.guidance,
      command: claudeCode.command,
    };
  }
  let best: EngineCheck | undefined;
  for (const candidate of engines) {
    if (
      best === undefined ||
      ENGINE_STATE_ORDER.indexOf(candidate.state.kind) < ENGINE_STATE_ORDER.indexOf(best.state.kind)
    ) {
      best = candidate;
    }
  }
  if (best === undefined) {
    return {
      id: 'engine',
      binary: null,
      state: { kind: 'missing' },
      guidance: `No AI engine is registered. Install Claude Code from ${INSTALL_LINKS.claude}, or add an engine under Engines in Settings. Then check again.`,
      command: null,
    };
  }
  return {
    id: 'engine',
    binary: best.binary,
    state: best.state,
    guidance: best.guidance,
    command: best.command,
  };
}

/**
 * Check the machine. `engines` is the app's engine registry (the app keeps the
 * list under its own data folder, where core cannot read it). The four
 * requirements and every engine are checked at the same time. The promise
 * always resolves.
 */
export async function checkMachine(
  runner: CommandRunner,
  engines: readonly EngineEntry[],
  options: MachineCheckOptions = {},
): Promise<MachineCheck> {
  const [git, github, python3, engineChecks, tools] = await Promise.all([
    checkGit(runner, options),
    checkGitHub(runner, options),
    checkPython3(runner, options),
    Promise.all(engines.map((engine) => checkEngine(runner, engine, options))),
    checkTools(settingsOf(runner, options)),
  ]);
  const requirements = [git, github.requirement, engineRequirement(engineChecks), python3];
  return {
    requirements,
    engines: engineChecks,
    ready: requirements.every((check) => check.state.kind === 'fine'),
    github: { account: github.account, organisations: github.organisations },
    tools,
  };
}
