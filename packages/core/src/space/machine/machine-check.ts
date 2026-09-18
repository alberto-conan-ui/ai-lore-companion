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
import type { CommandRunner, RunResult } from '../exec/runner.js';
import { errorMessage } from '../result.js';
import { CLAUDE_SIGN_IN_COMMAND, isClaudeEngine, probeEngineSignIn } from './engine-sign-in.js';
import { parseGhAuthStatus } from './gh-auth.js';
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

async function ghState(settings: Settings): Promise<MachineCheckState> {
  const version = await versionState(settings, 'gh', MIN_GH_VERSION);
  if (version.kind !== 'fine') return version;
  const args = ['auth', 'status', '--hostname', GITHUB_HOST];
  const command = `gh ${args.join(' ')}`;
  const result = await probeRun(settings)('gh', args);
  if (result.failure !== undefined) return stateOfFailedRun(command, result, settings.timeoutMs);
  const reading = parseGhAuthStatus(`${result.stdout}\n${result.stderr}`);
  switch (reading.kind) {
    case 'not-signed-in':
      return { kind: 'not-signed-in' };
    case 'unreachable':
      return {
        kind: 'undetermined',
        reason: `\`${command}\` could not reach ${GITHUB_HOST} to check the token; ${quoteOutput(result)}.`,
      };
    case 'unknown':
      return {
        kind: 'undetermined',
        reason: `\`${command}\` exited with code ${result.code} and its answer was not understood; ${quoteOutput(result)}.`,
      };
    case 'signed-in':
      if (reading.scopes === null) {
        return {
          kind: 'undetermined',
          reason: `\`${command}\` did not list the scopes of the token, so the \`${REQUIRED_GH_SCOPE}\` scope could not be checked. gh lists scopes only for the token of \`gh auth login\` and for a classic personal token; a fine-grained token or an app's token, often given through GH_TOKEN or GITHUB_TOKEN, has none to list. Remove that variable, or run \`${GH_SIGN_IN_COMMAND}\`.`,
        };
      }
      if (!reading.scopes.includes(REQUIRED_GH_SCOPE)) {
        return { kind: 'missing-scope', scope: REQUIRED_GH_SCOPE };
      }
      return version;
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
  const subject: GuidanceSubject = {
    name: 'gh',
    link: INSTALL_LINKS.gh,
    installCommand: null,
    signInCommand: GH_SIGN_IN_COMMAND,
  };
  try {
    return requirement('gh', 'gh', subject, await ghState(settings));
  } catch (caught) {
    return requirement('gh', 'gh', subject, undeterminedBy(caught));
  }
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

async function engineState(settings: Settings, engine: EngineEntry): Promise<MachineCheckState> {
  const version = await versionState(settings, engine.binary, null);
  if (version.kind !== 'fine') return version;
  let signIn: EngineSignInState;
  let timer: NodeJS.Timeout | undefined;
  // A probe runs at most a few commands; this bound only stops one that never answers.
  const bound = settings.timeoutMs * 3;
  try {
    signIn = await Promise.race([
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
    signIn = {
      kind: 'undetermined',
      reason: `The sign-in probe of ${engine.name} failed: ${errorMessage(caught)}.`,
    };
  } finally {
    clearTimeout(timer);
  }
  if (signIn.kind === 'signed-in') return version;
  if (signIn.kind === 'not-signed-in') return { kind: 'not-signed-in' };
  return { kind: 'undetermined', reason: signIn.reason };
}

/**
 * Check one engine of the registry: its binary answers `--version`, and the
 * sign-in probe says it is signed in. No lowest version is asked of an engine.
 */
export async function checkEngine(
  runner: CommandRunner,
  engine: EngineEntry,
  options: MachineCheckOptions = {},
): Promise<EngineCheck> {
  const settings = settingsOf(runner, options);
  let state: MachineCheckState;
  try {
    state = await engineState(settings, engine);
  } catch (caught) {
    state = undeterminedBy(caught);
  }
  return {
    engineId: engine.id,
    name: engine.name,
    binary: engine.binary,
    state,
    ...guidanceFor(engineSubject(engine), state),
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
 * The `engine` requirement from the checks of the registry's engines: the
 * first engine that is fine, otherwise the engine nearest to fine, the
 * registry's order deciding between equals. An empty registry is `missing`,
 * because the app lists an engine as soon as it finds its binary.
 */
export function engineRequirement(engines: readonly EngineCheck[]): MachineRequirementCheck {
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
  const [git, gh, python3, engineChecks] = await Promise.all([
    checkGit(runner, options),
    checkGh(runner, options),
    checkPython3(runner, options),
    Promise.all(engines.map((engine) => checkEngine(runner, engine, options))),
  ]);
  const requirements = [git, gh, engineRequirement(engineChecks), python3];
  return {
    requirements,
    engines: engineChecks,
    ready: requirements.every((check) => check.state.kind === 'fine'),
  };
}
