/**
 * The channels of migration from v0.8 (phase M6.5): the plan, the run, its
 * progress, stop, and opening the new Space. The handlers are in
 * `main/space/ipc/migration.ts` and the types in `./migration.types.ts`. This
 * fragment is spread into `CONTRACT`.
 *
 * Every channel is accepted only from a window in the `migration` mode. No
 * channel takes a folder: the v0.8 project is the folder main recorded for the
 * window, and the folder the Space is made in is chosen in main's own dialog.
 *
 * The "Open in the v0.8 cockpit" action of the migration screen is not here;
 * it is `spaceOpenInCockpit` in `./windows.contract.ts`.
 */

import { invoke, push } from './describe.js';
import type {
  MigrationIssueProgress,
  SpaceMigrationChooseFolderResult,
  SpaceMigrationForm,
  SpaceMigrationPlanResult,
  SpaceMigrationRunArg,
  SpaceMigrationRunResult,
  SpaceMigrationStateResult,
  SpaceMigrationStepProgress,
  SpaceMigrationStopResult,
} from './migration.types.js';
import type { SpaceWindowResult } from './windows.types.js';

export const SPACE_MIGRATION_CONTRACT = {
  /** What main holds for this migration window: its folders, whether a run goes on, an interrupted run. */
  spaceMigrationState: invoke<[arg: Record<string, never>], SpaceMigrationStateResult>(
    'space:migration-state',
  ),
  /** Choose the folder the new Space's folder is made in, with main's own folder dialog. */
  spaceMigrationChooseFolder: invoke<
    [arg: Record<string, never>],
    SpaceMigrationChooseFolderResult
  >('space:migration-choose-folder'),
  /** The plan: what will go where, with this project's counts. Nothing is written, on disk or on GitHub. */
  spaceMigrationPlan: invoke<[arg: SpaceMigrationForm], SpaceMigrationPlanResult>(
    'space:migration-plan',
  ),
  /**
   * Run the plan the token names, with the values main kept for it. It
   * resolves when the run ends; confirming again continues a stopped run.
   * Refused without the token of the window's last ready plan.
   */
  spaceMigrationRun: invoke<[arg: SpaceMigrationRunArg], SpaceMigrationRunResult>(
    'space:migration-run',
  ),
  /** Stop the run of this window before its next step. The step that is running finishes. */
  spaceMigrationStop: invoke<[arg: Record<string, never>], SpaceMigrationStopResult>(
    'space:migration-stop',
  ),
  /** Open the Space the last run of this window made, in this window. */
  spaceMigrationOpenSpace: invoke<[arg: Record<string, never>], SpaceWindowResult>(
    'space:migration-open-space',
  ),
  /** Every change of a step's state during the run of this window. */
  onSpaceMigrationProgress: push<SpaceMigrationStepProgress>('space:migration-progress'),
  /** Every change of an issue's state during step 11 of the run of this window. */
  onSpaceMigrationIssueProgress: push<MigrationIssueProgress>('space:migration-issue-progress'),
} as const;
