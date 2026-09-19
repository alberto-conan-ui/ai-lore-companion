/**
 * Argument, result and payload types of the channels of creating a Space
 * (phase M3.7). Plain data only; types from core are imported with
 * `import type`. `shared/ipc.ts` already re-exports this file.
 *
 * The three flows are core's: create a Space, adopt a plain repository, open
 * a Space by its GitHub address. The sentences of a plan, of a problem and of
 * a failure are written by core and arrive in the results. The renderer shows
 * them as they are and imports no value from core.
 *
 * No form carries a folder. The folder the Space is created in is chosen in
 * main's own folder dialog (`spaceSetupChooseFolder`) and kept in main for the
 * window; the folder of the repository to adopt is the one main put in the
 * window's `SetupStart`.
 */

import type {
  ExistingSpace,
  PlanLine,
  PlannedStep,
  SetupCheckProgress,
  SetupFlow,
  SetupInputProblem,
  SetupPlan,
  SetupReport,
  SetupRepositoryState,
  SetupTargetState,
  SetupViewSetting,
  StepProgress,
  StepState,
} from '@ai-lore-companion/core';

export type {
  ExistingSpace,
  PlanLine,
  PlannedStep,
  SetupCheckProgress,
  SetupFlow,
  SetupInputProblem,
  SetupPlan,
  SetupReport,
  SetupRepositoryState,
  SetupTargetState,
  SetupViewSetting,
  StepProgress,
  StepState,
};

/** Every state of a step, in the order a step goes through them. Mirrors core's `StepState`. */
export const SETUP_STEP_STATES = [
  'checking',
  'skipped',
  'running',
  'done',
  'failed',
] as const satisfies readonly StepState[];

/** The kind of the failure of a run that was stopped. Mirrors core's `STEPS_STOPPED`. */
export const SETUP_STOPPED_KIND = 'stopped';

/** The step ids that always run, whichever the Space's state. Mirrors core's `ALWAYS_RUN_STEP_IDS`. */
export const ALWAYS_RUN_STEP_IDS: readonly string[] = ['machine-check', 'project-layout'];

/** One repository of the form of "create a Space", given by its address. */
export type SpaceSetupRepositoryEntry = {
  /** `owner/name`, or an `https://github.com/…` or `git@github.com:…` address. */
  address: string;
  /** The repository's name in the Space. Default: the name part of the address. */
  name?: string;
};

/** The form of "create a Space", without its folder. Field names are core's `CreateSpaceInput`. */
export type SpaceSetupCreateForm = {
  flow: 'create';
  name: string;
  description: string;
  owner: string;
  private: boolean;
  repositories: SpaceSetupRepositoryEntry[];
};

/** The form of "adopt a repository", without its folders. Field names are core's `AdoptRepositoryInput`. */
export type SpaceSetupAdoptForm = {
  flow: 'adopt';
  name: string;
  description: string;
  owner: string;
  private: boolean;
  /** The repository on GitHub, as `owner/name`. Default: read from the origin of the checkout. */
  github?: string;
  /** The repository's name in the Space. Default: the name part of `github`. */
  repositoryName?: string;
};

/** The form of "open a Space by address", without its folder. Field names are core's `OpenSpaceByAddressInput`. */
export type SpaceSetupOpenForm = {
  flow: 'open';
  address: string;
  /** The name of the Space's folder. Default: the repository's name. */
  folderName?: string;
  /** The names of the manifest's repositories the Human Lead confirmed for cloning. */
  repositories: string[];
};

/** The form of one of the three flows. The window's `SetupStart` decides which one main accepts. */
export type SpaceSetupForm = SpaceSetupCreateForm | SpaceSetupAdoptForm | SpaceSetupOpenForm;

/** Why a setup channel did nothing, or where a plan or a run stopped. `message` is shown as it is. */
export type SpaceSetupFailure = {
  /**
   * Core's kind (`invalid-input`, `target-not-empty`, `repository-taken`,
   * `project-taken`, `stopped`, a step's own kind), or one of main's:
   * `invalid-argument`, `not-a-space-window`, `not-allowed-here`,
   * `cancelled`, `already-running`, `template-missing`, `nothing-to-open`,
   * `not-planned`, `superseded`, `setup-threw`, `plan-timeout`,
   * `not-a-repository`, `no-origin`, `unknown-owner`.
   */
  kind: string;
  message: string;
  /** The step the plan or the run stopped at; `null` when it stopped before the first step. */
  stepId: string | null;
  /** The step's title; `null` with `stepId`. */
  title: string | null;
  /** The problems of the form, for `invalid-input`; otherwise empty. */
  problems: SetupInputProblem[];
  /** The by-hand sentences gathered before the stop. */
  byHand: string[];
  /** The view settings gathered before the stop. */
  viewSettings: SetupViewSetting[];
};

/** The result of a setup channel. */
export type SpaceSetupResult<T> = { ok: true; value: T } | { ok: false; error: SpaceSetupFailure };

/** A run that ended because its window was closed. Running again with the same form continues it. */
export type SpaceSetupInterrupted = {
  flow: SetupFlow;
  spaceRoot: string;
  /** The form of the input that was planned, so the screen can show it again. */
  form: SpaceSetupForm;
};

/** The GitHub account and organisations known for setup, with which one is proposed. */
export type SpaceSetupOwners = {
  account: string | null;
  organisations: string[];
  /** The owner used by an earlier run, when it is still one of `account` or `organisations`; else `account`. */
  defaultOwner: string | null;
};

/** What a plan's own checks report, pushed as they run (`onSpaceSetupPlanProgress`). */
export type SpaceSetupPlanProgress = { planId: number } & SetupCheckProgress;

/** What a folder holds for the form, without asking GitHub. Mirrors core's `ExistingSpace`. */
export type SpaceSetupTargetPreview = ExistingSpace;

/** The repository chosen on the form, for "Space from a repository on this computer". */
export type SpaceSetupSource = {
  sourceDir: string;
  /** The origin address, with credentials removed; `null` when origin has none. */
  originUrl: string | null;
  /** `owner/name`, when the origin is a GitHub address. */
  github: string | null;
  /** The folder's own name, proposed as the repository's name in the Space. */
  name: string;
};

/** What main holds for the setup window that asks. */
export type SpaceSetupState = {
  /** The flow of this window, from its `SetupStart`. */
  flow: SetupFlow;
  /** The folder the Space's folder is created in, as chosen in main's dialog; `null` before. */
  parentDir: string | null;
  /** For `adopt` from `about-repository`: the folder of the repository, as main opened it. Otherwise `null`. */
  sourceDir: string | null;
  /** For `adopt` from `about-repository`: the origin address main read, with credentials removed. Otherwise `null`. */
  originUrl: string | null;
  /** For `adopt` from `from-repository`: the repository chosen on the form. Otherwise `null`. */
  source: SpaceSetupSource | null;
  /** The GitHub account and organisations known for the owner field. */
  owners: SpaceSetupOwners;
  /** The Spaces folder setting, when it is set. */
  spacesFolder: string | null;
  /** True while a run of this window goes on. */
  running: boolean;
  /** The last run of this run of the app that ended because its window was closed, or `null`. */
  interrupted: SpaceSetupInterrupted | null;
};

/** The exact names of what a create or an adopt makes on GitHub. */
export type SpaceSetupGitHubNames = {
  owner: string;
  /** The Space repository, as `owner/name`. */
  repository: string;
  visibility: 'private' | 'public';
  /** True when the plan found the repository on GitHub; it is then used, not created. */
  repositoryExists: boolean;
  /** The repository's page, when the plan found or planned it. */
  repositoryUrl: string | null;
  /** The name of the Project. */
  project: string;
  /** True when the plan found the Project; it is then used, not created. */
  projectExists: boolean;
  /** The Project's page, when the plan found it. */
  projectUrl: string | null;
  /** The names of the labels the repository gets. */
  labels: string[];
  /** The names of the views the Project gets. */
  views: string[];
};

/**
 * The dry run, and for create and adopt the names on GitHub. `github` is
 * `null` for open by address. `token` names this plan: main keeps the input it
 * planned, and a run is accepted only with the token of the last plan of the
 * window.
 */
export type SpaceSetupPlanValue = {
  plan: SetupPlan;
  github: SpaceSetupGitHubNames | null;
  token: string;
};

/** What a run takes: the token of the plan the Human Lead confirmed. */
export type SpaceSetupRunArg = {
  token: string;
  /**
   * Open by address only: the names of the manifest's repositories the Human
   * Lead confirmed for cloning after the first run. Omitted: the plan's.
   */
  repositories?: string[];
};

export type SpaceSetupStateResult = SpaceSetupResult<SpaceSetupState>;
export type SpaceSetupChooseFolderResult = SpaceSetupResult<{ parentDir: string }>;
export type SpaceSetupValidateResult = SpaceSetupResult<{
  problems: SetupInputProblem[];
  target: SpaceSetupTargetPreview | null;
}>;
export type SpaceSetupPlanResult = SpaceSetupResult<SpaceSetupPlanValue>;
export type SpaceSetupRunResult = SpaceSetupResult<SetupReport>;
export type SpaceSetupStopResult = SpaceSetupResult<{ stopping: boolean }>;
/** Choosing the folder of the repository, for "Space from a repository on this computer". */
export type SpaceSetupChooseSourceResult = SpaceSetupResult<SpaceSetupSource>;
/** The Spaces of an owner already on GitHub, for "Space from GitHub". */
export type SpaceSetupListSpacesResult = SpaceSetupResult<{
  repositories: { fullName: string; url: string; private: boolean }[];
}>;
