/**
 * The data of the machine check: the requirements, the state each can be in,
 * and what the check returns.
 *
 * Every type is plain data, so that a result can cross IPC as it is.
 */

import type { EngineEntry } from '../../engines/index.js';
import type { RunResult } from '../exec/runner.js';

/**
 * The four things the companion needs on the machine. Stage M3 and decision 16
 * name `git`, `gh` and an engine; `python3` is the fourth, added by the ruling
 * at the head of the architecture document.
 */
export type MachineRequirementId = 'git' | 'gh' | 'engine' | 'python3';

/**
 * The state of one requirement.
 * `fine`: present, and recent enough, signed in and scoped where that applies.
 * `missing`: the command is not on the machine.
 * `too-old`: present, and older than the lowest version the companion accepts.
 * `not-signed-in`: present, and no account is signed in.
 * `missing-scope`: present and signed in, and the token lacks `scope`.
 * `undetermined`: the check could not tell; `reason` says why, as a sentence.
 */
export type MachineCheckState =
  | { kind: 'fine'; version: string | null }
  | { kind: 'missing' }
  | { kind: 'too-old'; version: string; minimum: string }
  | { kind: 'not-signed-in' }
  | { kind: 'missing-scope'; scope: string }
  | { kind: 'undetermined'; reason: string };

/** The kinds of `MachineCheckState`. */
export type MachineCheckStateKind = MachineCheckState['kind'];

/** The check of one requirement, as the machine check screen lists it. */
export type MachineRequirementCheck = {
  id: MachineRequirementId;
  /** The command that was looked for. For `engine`, the engine's binary; `null` when the registry is empty. */
  binary: string | null;
  state: MachineCheckState;
  /** The sentence that says what to do. `null` when the state is `fine`. */
  guidance: string | null;
  /** The literal command the Human Lead runs in the terminal, when one command does it; otherwise `null`. */
  command: string | null;
};

/** The check of one engine of the registry. */
export type EngineCheck = {
  /** The `id` of the registry entry. */
  engineId: string;
  /** The `name` of the registry entry. */
  name: string;
  binary: string;
  state: MachineCheckState;
  guidance: string | null;
  command: string | null;
};

/** What `checkMachine` returns. */
export type MachineCheck = {
  /** Always four, in the order `git`, `gh`, `engine`, `python3`. */
  requirements: MachineRequirementCheck[];
  /** One entry per engine of the registry, in the registry's order. */
  engines: EngineCheck[];
  /** Whether all four requirements are `fine`. */
  ready: boolean;
};

/** What a sign-in probe found. */
export type EngineSignInState =
  | { kind: 'signed-in' }
  | { kind: 'not-signed-in' }
  | { kind: 'undetermined'; reason: string };

/**
 * Runs one command of a probe. It never rejects, and it stops waiting after
 * the check's timeout; both are reported in the `RunResult` as the
 * `CommandRunner` reports them.
 */
export type ProbeRun = (bin: string, args: readonly string[]) => Promise<RunResult>;

/**
 * Finds whether an engine is signed in. A probe only reads: it starts no
 * session, changes no configuration and asks nothing of the Human Lead. It
 * answers `undetermined` when it cannot tell.
 */
export type EngineSignInProbe = (engine: EngineEntry, run: ProbeRun) => Promise<EngineSignInState>;

/** The platforms the guidance sentences differ for. Any other value gets the sentence with the link only. */
export type MachinePlatform = NodeJS.Platform;

/** Options of `checkMachine` and of the single checks. */
export type MachineCheckOptions = {
  /** How long one command may take, in milliseconds. Default `DEFAULT_MACHINE_CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Variables added to the environment of every command, for example the `PATH` of the Human Lead's login shell. */
  env?: Record<string, string>;
  /** The platform the guidance is written for. Default: `process.platform`. */
  platform?: MachinePlatform;
  /** Replaces the sign-in probe. Default: `probeEngineSignIn`. */
  signInProbe?: EngineSignInProbe;
};
