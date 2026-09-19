/**
 * What is checked before a guarded session starts (phase M4.4). Every check
 * fails closed with a sentence that names what is missing, so that a broken
 * installation is reported as one and no session starts without its guards.
 *
 * - `python3`: observed in phase M4.1, a hook command that cannot be started
 *   does not block a write. The hooks run `python3` by the absolute path found
 *   here, and no session starts without one.
 * - The install: `install.json` is read (a record written by a later companion
 *   is refused), the plugin's manifest exists, and every check script the
 *   record lists is in the checks folder with the hash the record gives. The
 *   three core scripts must be there. A missing or altered script is named.
 */

import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  type CommandRunner,
  type EngineEntry,
  type InstallRecord,
  canRunGuardedSession,
  claudeCodeInstallPaths,
  readInstallRecord,
  sha256File,
} from '@ai-lore-companion/core';
import { guardChangingEngineOption } from './command-line.js';
import { PYTHON_PROBE_TIMEOUT_MS, REQUIRED_CHECKS } from './constants.js';

/** Why a session was not started. `message` can be shown to the Human Lead as it is. */
export type SessionStartFailureKind =
  | 'invalid-argument'
  | 'not-a-space-window'
  | 'no-terminal'
  | 'engine-not-found'
  | 'engine-not-supported'
  | 'engine-not-installed'
  | 'engine-not-signed-in'
  | 'python3-missing'
  | 'not-installed'
  | 'install-record-unreadable'
  | 'install-record-newer'
  | 'plugin-missing'
  | 'check-missing'
  | 'check-altered'
  | 'desk-unavailable'
  | 'session-server-unavailable'
  | 'session-files-failed'
  | 'start-failed';

export type SessionStartFailure = { kind: SessionStartFailureKind; message: string };

type Checked<T> = { ok: true; value: T } | { ok: false; error: SessionStartFailure };

const failed = (kind: SessionStartFailureKind, message: string): Checked<never> => ({
  ok: false,
  error: { kind, message },
});

/** The engine of the registry a session starts with. Only Claude Code has the hooks this design writes. */
export function checkSessionEngine(
  engines: readonly EngineEntry[],
  engineId: string,
): Checked<EngineEntry> {
  const engine = engines.find((entry) => entry.id === engineId);
  if (!engine) {
    return failed(
      'engine-not-found',
      `No AI session was started: the engine "${engineId}" is not in the list of engines.`,
    );
  }
  if (!canRunGuardedSession(engine)) {
    return failed(
      'engine-not-supported',
      `No AI session was started: a guarded session in a Space is started with Claude Code only, and "${engine.name}" is not Claude Code.`,
    );
  }
  const changing = guardChangingEngineOption(engine.args ?? []);
  if (changing !== undefined) {
    return failed(
      'engine-not-supported',
      `No AI session was started: the engine "${engine.name}" is set up with the option ${changing.split('=')[0]}, which would change the permissions or the settings of a guarded session. Remove it from the engine's arguments.`,
    );
  }
  return { ok: true, value: engine };
}

/**
 * The Python program the probe runs: it prints the absolute path of the
 * interpreter when it is 3.8 or later (the check scripts' floor), and nothing otherwise.
 */
export const PYTHON_PROBE_ARGS = [
  '-c',
  'import sys; print(sys.executable if sys.version_info >= (3, 8) else "")',
] as const;

/**
 * The absolute path of `python3`, found with the `PATH` given (the login
 * shell's, when it was read), run in the folder `cwd` (the Space's folder).
 */
export async function findPython3(
  runner: CommandRunner,
  path: string | null,
  cwd: string,
): Promise<Checked<string>> {
  const missing = failed(
    'python3-missing',
    'No AI session was started: python3 3.8 or later was not found. The write-guard of a session runs with python3, and a session without it would not be guarded. Install python3 and run the machine check again.',
  );
  const result = await runner.run('python3', PYTHON_PROBE_ARGS, {
    timeoutMs: PYTHON_PROBE_TIMEOUT_MS,
    cwd,
    ...(path !== null ? { env: { PATH: path } } : {}),
  });
  if (result.code !== 0 || result.failure !== undefined) return missing;
  const executable = result.stdout.trim();
  if (executable === '' || !isAbsolute(executable) || /[\0\n\r]/.test(executable)) return missing;
  return { ok: true, value: executable };
}

/** The verified install of a Space: the plugin folder and the check scripts, split by when they run. */
export type VerifiedInstall = {
  pluginDir: string;
  /** Absolute paths of the check scripts to run before a write, write-guard first. */
  beforeChecks: string[];
  /** Absolute paths of the check scripts to run after a write to the Lore. */
  afterChecks: string[];
};

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

function checkOrder(a: string, b: string): number {
  // The write-guard decides by mode and claim; it runs first so that its refusal is the one given.
  const first = REQUIRED_CHECKS[0];
  if (a.endsWith(`/${first}`)) return -1;
  if (b.endsWith(`/${first}`)) return 1;
  return a.localeCompare(b);
}

/** Verify the Claude Code install of the desk whose install folder is `installDir` (`DeskPaths.install`). */
export async function verifyInstall(installDir: string): Promise<Checked<VerifiedInstall>> {
  const paths = claudeCodeInstallPaths(installDir);
  const read = await readInstallRecord(paths.dir);
  if (!read.ok) {
    if (read.error.kind === 'install-record-newer') {
      return failed(
        'install-record-newer',
        'No AI session was started: the Lore was installed into Claude Code by a later version of the companion than this one. Update the companion, or install the Lore again from this one.',
      );
    }
    return failed(
      'install-record-unreadable',
      `No AI session was started: the record of the install into Claude Code cannot be read (${read.error.message}). Install the Lore again.`,
    );
  }
  const record: InstallRecord | null = read.value;
  if (record === null) {
    return failed(
      'not-installed',
      'No AI session was started: the Lore of this Space is not installed into Claude Code. Run the setup step that installs it.',
    );
  }
  if (!(await isRegularFile(paths.pluginManifest))) {
    return failed(
      'plugin-missing',
      `No AI session was started: the plugin of the install is missing (${paths.pluginManifest}). Install the Lore again.`,
    );
  }
  const checks = record.files.filter((file) => file.kind === 'check');
  for (const required of REQUIRED_CHECKS) {
    if (!checks.some((file) => file.path === `checks/${required}`)) {
      return failed(
        'check-missing',
        `No AI session was started: the check script ${required} is not in the install. Install the Lore again.`,
      );
    }
  }
  const before: string[] = [];
  const after: string[] = [];
  for (const file of checks) {
    const absolute = join(paths.dir, ...file.path.split('/'));
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    if (!file.path.startsWith('checks/') || file.path.includes('..')) {
      return failed(
        'install-record-unreadable',
        `No AI session was started: the record of the install names the check script ${name} outside the checks folder. Install the Lore again.`,
      );
    }
    if (!(await isRegularFile(absolute))) {
      return failed(
        'check-missing',
        `No AI session was started: the check script ${name} is missing from the install (${absolute}). Install the Lore again.`,
      );
    }
    const hash = await sha256File(absolute);
    if (!hash.ok || hash.value !== file.sha256) {
      return failed(
        'check-altered',
        `No AI session was started: the check script ${name} differs from the one the install wrote (${absolute}). Install the Lore again.`,
      );
    }
    const whens = file.cards.map((card) => card.when);
    if (whens.includes('before') || whens.includes('both')) before.push(absolute);
    if (whens.includes('after') || whens.includes('both')) after.push(absolute);
  }
  before.sort(checkOrder);
  after.sort(checkOrder);
  return { ok: true, value: { pluginDir: paths.plugin, beforeChecks: before, afterChecks: after } };
}
