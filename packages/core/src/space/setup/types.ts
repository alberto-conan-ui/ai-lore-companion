/**
 * The data of setup: what the three flows take (create a Space, adopt a plain
 * repository, open a Space by its GitHub address), what they need from their
 * caller, and what they return.
 *
 * The inputs, the plan, the report and the failure are plain data, so that
 * they can cross IPC as they are. `SetupDeps` is not: it holds the ports.
 */

import type { CommandRunner } from '../exec/runner.js';
import type { GitHubPort } from '../github/port.js';
import type { ProjectInfo, RepositoryInfo } from '../github/types.js';
import type { MachineCheck } from '../machine/types.js';
import type { Failure } from '../result.js';
import type { PlannedStep, RunStepsOptions } from '../steps/types.js';

/** One repository the new Space gets under `repos/`. */
export type SetupRepositoryInput = {
  /** The repository's name in the Space; its checkout is `repos/<name>`. */
  name: string;
  /** The repository on GitHub, as `owner/name`. */
  github: string;
  /**
   * The address to clone from. Default: the clone address GitHub gives for
   * `github`. Adopting a repository fills it with the origin of the checkout
   * that was opened.
   */
  cloneAddress?: string;
};

/** The form of "create a Space". */
export type CreateSpaceInput = {
  /** The Space's name. It is also the name of its folder, of its repository and of its Project. */
  name: string;
  /** What the Space is about, in the Human Lead's words. It becomes the Space's corpus entry. */
  description: string;
  /** The GitHub user or organisation that owns the Space repository and the Project. */
  owner: string;
  /** The folder the Space's folder is created in. It must exist. */
  parentDir: string;
  /** Whether the Space repository is private. Default `true`. */
  private?: boolean;
  /** The repositories of the Space. Default: none. */
  repositories?: SetupRepositoryInput[];
};

/** The form of "create a Space about this repository", for a folder detected as a plain repository. */
export type AdoptRepositoryInput = Omit<CreateSpaceInput, 'repositories'> & {
  /** The checkout that was opened. It is only read: its origin address is what gets cloned. */
  sourceDir: string;
  /** The repository on GitHub, as `owner/name`. Default: read from the origin address. */
  github?: string;
  /** The repository's name in the Space. Default: the name part of `github`. */
  repositoryName?: string;
};

/** The form of "open a Space from a GitHub address". */
export type OpenSpaceByAddressInput = {
  /** `owner/name`, or an `https://github.com/…` or `git@github.com:…` address of the Space repository. */
  address: string;
  /** The folder the Space's folder is created in. It must exist. */
  parentDir: string;
  /** The name of the Space's folder. Default: the repository's name. */
  folderName?: string;
  /**
   * The names of the manifest's repositories the Human Lead confirmed for
   * cloning. Default: none. A first run without it clones the Space and
   * reports the manifest's repositories; a second run with the confirmed names
   * repeats nothing and clones them.
   */
  repositories?: string[];
};

/** What setup needs from its caller. */
export type SetupDeps = {
  /** Runs `git` and `python3`. */
  runner: CommandRunner;
  github: GitHubPort;
  /** The Lore template, `packages/spec/lore-1.0` or its packaged copy. It is only read. */
  templateDir: string;
  /** The companion's data folder; the desk of the Space is under it. */
  userDataDir: string;
  /** The machine check, with the engine registry and the runner the caller chose. */
  checkMachine: () => Promise<MachineCheck>;
  /**
   * Values written to the Space repository's own git configuration before the
   * first commit, for example `user.name`. Default: none, and the machine's
   * configuration applies.
   */
  gitConfig?: Readonly<Record<string, string>>;
};

/** Which flow a plan or a report belongs to. */
export type SetupFlow = 'create' | 'adopt' | 'open';

/** One thing wrong in a form, found before anything is created. */
export type SetupInputProblem = {
  /** The form's field, for example `name` or `repositories[0].github`. */
  field: string;
  /** A sentence that can be shown beside the field. */
  message: string;
};

/**
 * What the target folder is.
 * `absent`: nothing is there. `empty`: a folder with nothing in it.
 * `half-made`: a folder that holds this same Space from an earlier run.
 */
export type SetupTargetState = 'absent' | 'empty' | 'half-made';

/** Which check of a plan is progressing: the target folder, the two GitHub lookups, or building the step list. */
export type SetupCheckId = 'folder' | 'repository' | 'project' | 'steps';

/** One event of a plan's own checks (not a step of the plan itself). */
export type SetupCheckProgress = {
  checkId: SetupCheckId;
  state: 'running' | 'done' | 'failed';
  text: string;
};

/** Options of a plan: reports each of its checks as it runs. */
export type SetupPlanOptions = { onCheck?: (progress: SetupCheckProgress) => void };

/** A view setting the API could set, with the sentence describing it and the view's link, when there is one. */
export type SetupViewSetting = { view: string; setting: string; url: string | null };

/** The dry run: what setup will do, shown before the Human Lead confirms. Nothing was changed. */
export type SetupPlan = {
  flow: SetupFlow;
  /** The Space's folder. */
  spaceRoot: string;
  target: SetupTargetState;
  steps: PlannedStep[];
  /** Whether every step is already done, except the two that always run (`ALWAYS_RUN_STEP_IDS`). */
  complete: boolean;
  /** The Space repository on GitHub, when the plan found it. */
  repository: RepositoryInfo | null;
  /** The Project, when the plan found it. */
  project: ProjectInfo | null;
  /** The titles of the steps found already done, in order, excluding those that always run. */
  alreadyDone: string[];
  /** The titles of the steps not yet done, in order, excluding those that always run. */
  leftToDo: string[];
};

/** A repository of the manifest, and whether its checkout is on this desk. */
export type SetupRepositoryState = { name: string; github: string; cloned: boolean };

/** What a setup that reached the end did. */
export type SetupReport = {
  flow: SetupFlow;
  spaceRoot: string;
  /** The ids of the steps that ran, in order. */
  completed: string[];
  /** The ids of the steps that were already done, in order. */
  skipped: string[];
  /** The Space repository on GitHub. */
  repository: RepositoryInfo | null;
  /** The Project. `null` for a Space opened by address, whose Project is only named in the manifest. */
  project: ProjectInfo | null;
  /** What is left for the Human Lead to do on GitHub, one sentence each: the settings of views the API cannot make. */
  byHand: string[];
  /** The view settings the API could set, with their links. */
  viewSettings: SetupViewSetting[];
  /** The manifest's repositories. For a Space opened by address, those with `cloned: false` await confirmation. */
  repositories: SetupRepositoryState[];
};

/**
 * What a folder holds for the form, without asking GitHub.
 * `absent`: nothing is there. `empty`: an empty folder. `other-content`: something
 * else. `incomplete` and `complete`: this same Space, by the steps that read only
 * the disk and git.
 */
export type ExistingSpaceState = 'absent' | 'empty' | 'other-content' | 'incomplete' | 'complete';

/** What a local, GitHub-free look at a folder found. */
export type ExistingSpace = {
  spaceRoot: string;
  state: ExistingSpaceState;
  message: string | null;
};

/**
 * The kinds of failure setup adds to those of its steps.
 * `invalid-input`: the form has a problem; `problems` lists each.
 * `target-not-empty`: the target folder holds something that is not this same Space.
 */
export type SetupPrecheckFailureKind = 'invalid-input' | 'target-not-empty';

/**
 * A setup or a plan that stopped. `stepId` is `null` when it stopped before the
 * first step. Nothing that was done is removed; running again continues.
 */
export type SetupFailure = Failure & {
  flow: SetupFlow;
  stepId: string | null;
  title: string | null;
  completed: string[];
  skipped: string[];
  problems: SetupInputProblem[];
  /** The by-hand sentences gathered before the stop. */
  byHand: string[];
  /** The view settings gathered before the stop. */
  viewSettings: SetupViewSetting[];
};

/** Options of a setup run: the progress callback and the stop signal of the step runner. */
export type SetupRunOptions = RunStepsOptions;
