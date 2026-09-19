/**
 * The data of the machine check: the requirements, the state each can be in,
 * and what the check returns.
 *
 * Every type is plain data, so that a result can cross IPC as it is.
 */

import type { EngineEntry } from '../../engines/index.js';
import type { EngineCatalogId } from '../engines/index.js';
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

/**
 * Whether an engine's binary is on the machine, from `<binary> --version`
 * exactly as `versionState` reads it (no lowest version is asked of an
 * engine). `not-found` gives `missing`.
 */
export type EngineInstallState =
  | { kind: 'installed'; version: string | null }
  | { kind: 'missing' }
  | { kind: 'undetermined'; reason: string };

/** The check of one engine of the list given to `checkMachine`. */
export type EngineCheck = {
  /** The `id` of the registry entry. */
  engineId: string;
  /** The `name` of the registry entry. */
  name: string;
  binary: string;
  /** Kept for existing readers; see `checkEngine`'s doc comment for how it is derived. */
  state: MachineCheckState;
  guidance: string | null;
  command: string | null;
  /** The catalog entry the engine was merged into, or `null` for a hand-added engine. */
  catalogId: EngineCatalogId | null;
  maker: string | null;
  /** Whether Set up this computer is not ready without this engine. */
  required: boolean;
  /** Whether the companion can run a guarded Space session with it. */
  guardedSessions: boolean;
  installed: EngineInstallState;
  /** `not-checked` also when the engine is not installed. */
  signIn: EngineSignInState;
  installCommand: string | null;
  installNeeds: 'npm' | null;
  signInCommand: string | null;
  /** One line shown under the row, or `null`. */
  note: string | null;
  /** The maker's page, or `null`. */
  page: string | null;
};

/** What `checkMachine` returns. */
export type MachineCheck = {
  /** Always four, in the order `git`, `gh`, `engine`, `python3`. */
  requirements: MachineRequirementCheck[];
  /** One entry per engine of the list given, in its order. */
  engines: EngineCheck[];
  /** Whether all four requirements are `fine`. */
  ready: boolean;
  /** The GitHub account `gh` is signed in with, and its organisations. */
  github: { account: string | null; organisations: string[] };
  /** Whether Homebrew and npm are on the machine. */
  tools: { brew: boolean; npm: boolean };
};

/** What a sign-in probe found. */
export type EngineSignInState =
  | { kind: 'signed-in' }
  | { kind: 'not-signed-in' }
  /** The engine has no sign-in check (catalog `signInCheck: { kind: 'none' }`, or an unknown hand-added engine). */
  | { kind: 'not-checked' }
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
