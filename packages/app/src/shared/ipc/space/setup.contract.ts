/**
 * The channels of creating a Space (phase M3.7). The handlers are in
 * `main/space/ipc/setup.ts` and the types in `./setup.types.ts`. This fragment
 * is spread into `CONTRACT`.
 *
 * Every channel is accepted only from a window in the `setup` mode. No channel
 * takes a folder: main keeps the folders it chose itself for the window.
 */

import { invoke, push } from './describe.js';
import type {
  SpaceSetupChooseFolderResult,
  SpaceSetupForm,
  SpaceSetupPlanResult,
  SpaceSetupRunArg,
  SpaceSetupRunResult,
  SpaceSetupStateResult,
  SpaceSetupStopResult,
  SpaceSetupValidateResult,
  StepProgress,
} from './setup.types.js';
import type { SpaceWindowResult } from './windows.types.js';

export const SPACE_SETUP_CONTRACT = {
  /** What main holds for this setup window: its flow, its folders, whether a run goes on. */
  spaceSetupState: invoke<[arg: Record<string, never>], SpaceSetupStateResult>('space:setup-state'),
  /** Choose the folder the Space's folder is created in, with main's own folder dialog. */
  spaceSetupChooseFolder: invoke<[arg: Record<string, never>], SpaceSetupChooseFolderResult>(
    'space:setup-choose-folder',
  ),
  /** The problems of the form, field by field, with core's sentences. It reads nothing and runs nothing. */
  spaceSetupValidate: invoke<[arg: SpaceSetupForm], SpaceSetupValidateResult>(
    'space:setup-validate',
  ),
  /** The dry run: every step with what it will do. Nothing is created, on disk or on GitHub. */
  spaceSetupPlan: invoke<[arg: SpaceSetupForm], SpaceSetupPlanResult>('space:setup-plan'),
  /**
   * Run the plan the token names, as main kept it. It resolves when the run
   * ends; running again with the same token continues it. Refused without the
   * token of the window's last plan.
   */
  spaceSetupRun: invoke<[arg: SpaceSetupRunArg], SpaceSetupRunResult>('space:setup-run'),
  /** Stop the run of this window before its next step. The step that is running finishes. */
  spaceSetupStop: invoke<[arg: Record<string, never>], SpaceSetupStopResult>('space:setup-stop'),
  /** Open the Space the last run of this window made, in a Space window. */
  spaceSetupOpenSpace: invoke<[arg: Record<string, never>], SpaceWindowResult>(
    'space:setup-open-space',
  ),
  /** Every change of a step's state during the run of this window. */
  onSpaceSetupProgress: push<StepProgress>('space:setup-progress'),
} as const;
