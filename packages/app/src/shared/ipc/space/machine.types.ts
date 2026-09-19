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
  EngineInstallState,
  EngineSignInState,
  MachineCheck,
  MachineCheckState,
  MachineCheckStateKind,
  MachineRequirementCheck,
  MachineRequirementId,
  SetUpItemId,
  SetUpReadiness,
} from '@ai-lore-companion/core';

export type {
  EngineCheck,
  EngineInstallState,
  EngineSignInState,
  MachineCheck,
  MachineCheckState,
  MachineCheckStateKind,
  MachineRequirementCheck,
  MachineRequirementId,
  SetUpItemId,
  SetUpReadiness,
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

/** The Spaces folder, as the machine report carries it. */
export type SpacesFolderState = {
  /** The setting's value when it names an existing folder; `null` when not set. */
  value: string | null;
  /** The folder Set up this computer proposes, not yet saved. */
  proposed: string;
};

/** One machine check, as the screens receive it. */
export type MachineCheckReport = {
  /** Core's result: the four requirements in fixed order, the engines, and `ready`. */
  check: MachineCheck;
  /** When the check finished, in milliseconds since the epoch. */
  checkedAt: number;
  pathSource: MachinePathSource;
  spacesFolder: SpacesFolderState;
  /** Whether Set up this computer is ready, and what is left when it is not. */
  setUp: SetUpReadiness;
  /** Every command the screens may run, by id, with its command line. */
  commands: Record<string, string>;
};

/** The result of `spaceSpacesFolderUse` and `spaceSpacesFolderChoose`. */
export type SpaceSpacesFolderResult =
  | { ok: true; value: { folder: string } }
  | {
      ok: false;
      error: {
        kind: 'invalid-argument' | 'not-allowed-here' | 'cancelled' | 'not-a-folder' | 'failed';
        message: string;
      };
    };

/**
 * The ids of the catalog engines, in catalog order. Mirrors core's
 * `ENGINE_CATALOG.map((e) => e.engineId)`; a headless test checks it.
 */
export const CATALOG_ENGINE_IDS = [
  'default.claude',
  'default.codex',
  'default.antigravity',
  'default.opencode',
] as const;

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
