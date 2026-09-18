/**
 * The data of the step runner: a step, a line of its plan, the progress events
 * and what a run returns.
 *
 * Everything except `Step` is plain data, so that it can cross IPC as it is.
 */

import type { Failure, Result } from '../result.js';

/** One line of what a step will do, as the plan screen shows it before the Human Lead confirms. */
export type PlanLine = {
  /** The sentence that says what will be done. */
  what: string;
  /** Where something is taken from: a folder, an address. */
  from?: string;
  /** Where something is put: a folder, a repository's name. */
  to?: string;
  /** How many things the line covers (files, records). */
  count?: number;
};

/** Why a step failed. `message` is a sentence that can be shown to the Human Lead as it is. */
export type StepError = Failure;

/**
 * One step of a setup or of a migration. `C` is the context the steps of one
 * run share.
 *
 * A step can run again: `isDone` asks the real state (the disk, git, GitHub)
 * and never a ledger of what an earlier run did, and `run` leaves what it did
 * in place when it fails.
 */
export type Step<C> = {
  /** Stable, and unique in its list. */
  id: string;
  /** Shown on the screen. */
  title: string;
  /** What the step would do. It changes nothing. */
  describe(ctx: C): Promise<PlanLine[]>;
  /** Whether what the step does is already there. It changes nothing; when it cannot tell, it answers `false`. */
  isDone(ctx: C): Promise<boolean>;
  /** Do the step. A failure is a result; nothing that was done is removed. */
  run(ctx: C): Promise<Result<void, StepError>>;
};

/**
 * Where a step is.
 * `checking`: `isDone` is being asked. `skipped`: it was already done.
 * `running`: `run` started. `done`: `run` succeeded. `failed`: the run stops here.
 */
export type StepState = 'checking' | 'skipped' | 'running' | 'done' | 'failed';

/** One progress event of a run. */
export type StepProgress = {
  stepId: string;
  title: string;
  /** The step's place in the list, from 0. */
  index: number;
  total: number;
  state: StepState;
  /** The failure's sentence when `state` is `failed`; otherwise `null`. */
  message: string | null;
};

/** One step of a plan: whether it is already done, and what it would do when it is not. */
export type PlannedStep = {
  stepId: string;
  title: string;
  done: boolean;
  /** Empty when `done` is true. */
  lines: PlanLine[];
};

/** What a run that reached the end did. */
export type StepsReport = {
  /** The ids of the steps that ran, in order. */
  completed: string[];
  /** The ids of the steps that were already done, in order. */
  skipped: string[];
};

/**
 * A run or a plan that stopped at a step. `kind` and `message` are the step's
 * own; `step-threw` is the kind for a step that raised an exception, and
 * `stopped` for a run stopped through its signal before `stepId` started.
 * What the earlier steps did stays in place.
 */
export type StepsFailure = Failure & {
  stepId: string;
  title: string;
  completed: string[];
  skipped: string[];
};

/** Options of `runSteps`. */
export type RunStepsOptions = {
  /** Called for every change of a step's state. An exception it raises is ignored. */
  onProgress?: (progress: StepProgress) => void;
  /** When aborted, the run stops before the next step starts. A step that is running finishes. */
  signal?: AbortSignal;
};
