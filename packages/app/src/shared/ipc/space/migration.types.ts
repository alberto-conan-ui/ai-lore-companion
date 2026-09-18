/**
 * Argument, result and payload types of the channels of migration from v0.8
 * (phase M6.5). Plain data only; types from core are imported with
 * `import type`. `shared/ipc.ts` already re-exports this file.
 *
 * The plan, its sentences and the sentences of a failure are written by core
 * and arrive in the results. The renderer shows them as they are and imports
 * no value from core.
 *
 * No argument carries a folder. The v0.8 project is the folder main recorded
 * for the window; the folder the new Space's folder is made in is chosen in
 * main's own folder dialog (`spaceMigrationChooseFolder`) and kept in main.
 */

import type {
  MigrationField,
  MigrationFieldId,
  MigrationFocusStage,
  MigrationIssueKind,
  MigrationIssuePlan,
  MigrationIssueProgress,
  MigrationIssueProgressState,
  MigrationMappingRow,
  MigrationNotCarried,
  MigrationPlan,
  MigrationPlannedStep,
  MigrationRefusal,
  MigrationReport,
  MigrationSourceRepository,
  MigrationWarning,
  StepProgress,
} from '@ai-lore-companion/core';

export type {
  MigrationField,
  MigrationFieldId,
  MigrationFocusStage,
  MigrationIssueKind,
  MigrationIssuePlan,
  MigrationIssueProgress,
  MigrationIssueProgressState,
  MigrationMappingRow,
  MigrationNotCarried,
  MigrationPlan,
  MigrationPlannedStep,
  MigrationRefusal,
  MigrationReport,
  MigrationSourceRepository,
  MigrationWarning,
};

/** The kind of the failure of a run that was stopped. Mirrors core's `STEPS_STOPPED`. */
export const MIGRATION_STOPPED_KIND = 'stopped';

/** The id of the step whose progress is also given per issue. Mirrors core's step 11. */
export const MIGRATION_ISSUES_STEP_ID = 'issues';

/** The id of the last step, whose success is the verification result. Mirrors core's step 13. */
export const MIGRATION_VERIFY_STEP_ID = 'verify';

/**
 * What the Human Lead fills, without the folder. Field names are core's
 * `MigrationForm`. A text left out is proposed by core, and the plan says which
 * value it used.
 */
export type SpaceMigrationForm = {
  name?: string;
  owner?: string;
  description?: string;
  focusStage?: MigrationFocusStage;
  payloadGitHub?: string;
  private: boolean;
};

/** Why a migration channel did nothing, or where a plan or a run stopped. `message` is shown as it is. */
export type SpaceMigrationFailure = {
  /**
   * Core's kind (`refused`, `invalid-input`, `read-failed`, `stopped`, a
   * step's own kind), or one of main's: `invalid-argument`,
   * `not-a-space-window`, `not-allowed-here`, `cancelled`, `not-a-folder`,
   * `already-running`, `not-planned`, `superseded`, `template-missing`,
   * `migration-threw`.
   */
  kind: string;
  message: string;
  /** The step it stopped at; `null` when it stopped before the first step. */
  stepId: string | null;
  /** For `refused`: why, with core's kind (`older-than-v0.8`, `target-not-empty`, …). */
  refusal: MigrationRefusal | null;
  /** For `invalid-input`: the fields with a problem. */
  problems: { field: MigrationFieldId; message: string }[];
};

/** The result of a migration channel. */
export type SpaceMigrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SpaceMigrationFailure };

/** A run of this folder that ended because its window was closed. Confirming its plan again continues it. */
export type SpaceMigrationInterrupted = {
  /** The new Space's folder the run was making. */
  spaceRoot: string;
  /** The step the run stopped at, or `null` before the first step. */
  stepId: string | null;
};

/** What main holds for the migration window that asks. */
export type SpaceMigrationState = {
  /** The v0.8 project's folder: the folder main recorded for this window. */
  sourceRoot: string;
  /** The folder chosen in main's dialog; `null` when none was chosen and core proposes one. */
  parentDir: string | null;
  /** True while a run of this window goes on. */
  running: boolean;
  /** True while a run of this same folder goes on in another window. */
  runningElsewhere: boolean;
  /** The last run of this folder, in this run of the app, that ended because its window was closed. */
  interrupted: SpaceMigrationInterrupted | null;
};

/**
 * The plan, and its token. `token` is `null` when the plan is not ready (a
 * field has a problem, or it is refused): nothing can be confirmed. Otherwise
 * main keeps the values the plan was made with, and a run is accepted only
 * with the token of the window's last plan.
 */
export type SpaceMigrationPlanValue = { plan: MigrationPlan; token: string | null };

/** What a run takes: the token of the plan the Human Lead confirmed. */
export type SpaceMigrationRunArg = { token: string };

/** The progress of one step of the run of this window. */
export type SpaceMigrationStepProgress = StepProgress;

export type SpaceMigrationStateResult = SpaceMigrationResult<SpaceMigrationState>;
export type SpaceMigrationChooseFolderResult = SpaceMigrationResult<{ parentDir: string }>;
export type SpaceMigrationPlanResult = SpaceMigrationResult<SpaceMigrationPlanValue>;
export type SpaceMigrationRunResult = SpaceMigrationResult<MigrationReport>;
export type SpaceMigrationStopResult = SpaceMigrationResult<{ stopping: boolean }>;
