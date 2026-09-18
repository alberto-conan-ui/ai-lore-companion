/**
 * Argument, result and payload types of the channels of the machine check.
 * Plain data only; types from core are imported with `import type`.
 * `shared/ipc.ts` already re-exports this file.
 *
 * The guidance sentence and the literal command of each requirement are
 * written by core and arrive inside `MachineCheck`. The renderer shows them as
 * they are and imports no value from core.
 */

import type {
  EngineCheck,
  MachineCheck,
  MachineCheckState,
  MachineCheckStateKind,
  MachineRequirementCheck,
  MachineRequirementId,
} from '@ai-lore-companion/core';

export type {
  EngineCheck,
  MachineCheck,
  MachineCheckState,
  MachineCheckStateKind,
  MachineRequirementCheck,
  MachineRequirementId,
};

/**
 * Argument of `spaceMachineCheck`. With `fresh: true` main runs the check now.
 * With `fresh: false` main answers with the last check of this run of the app
 * when there is one, and runs the check when there is none.
 */
export type SpaceMachineCheckArg = { fresh: boolean };

/** Where the `PATH` of the check's commands came from. */
export type MachinePathSource =
  /** The `PATH` of the Human Lead's login shell was read and given to every command. */
  | 'login-shell'
  /** The login shell's `PATH` could not be read; the commands ran with the app's own `PATH`. */
  | 'app-environment';

/** One machine check, as the screens receive it. */
export type MachineCheckReport = {
  /** Core's result: the four requirements in fixed order, the engines, and `ready`. */
  check: MachineCheck;
  /** When the check finished, in milliseconds since the epoch. */
  checkedAt: number;
  pathSource: MachinePathSource;
};

/** Why `spaceMachineCheck` gave no report. `message` can be shown to the Human Lead. */
export type SpaceMachineFailure = {
  kind: 'invalid-argument' | 'not-a-space-window' | 'check-failed';
  message: string;
};

/** The result of `spaceMachineCheck`. */
export type SpaceMachineCheckResult =
  | { ok: true; value: MachineCheckReport }
  | { ok: false; error: SpaceMachineFailure };

/**
 * The requirement ids in the order the screen lists them. The same order as
 * `MachineCheck.requirements`; mirrored here because the renderer imports no
 * value from core. A headless test checks it against core's result.
 */
export const MACHINE_REQUIREMENT_ORDER = [
  'git',
  'gh',
  'engine',
  'python3',
] as const satisfies readonly MachineRequirementId[];

/**
 * Every state a requirement can be in. The screen shows these names as they
 * are. Mirrored from core's `MachineCheckStateKind` for the same reason as
 * `MACHINE_REQUIREMENT_ORDER`.
 */
export const MACHINE_CHECK_STATE_KINDS = [
  'fine',
  'missing',
  'too-old',
  'not-signed-in',
  'missing-scope',
  'undetermined',
] as const satisfies readonly MachineCheckStateKind[];
