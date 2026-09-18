/**
 * The step runner that setup and migration share.
 *
 * `planSteps` is the dry run: it asks every step whether it is done and what it
 * would do, and changes nothing. `runSteps` goes through the steps in order,
 * skips a step that is already done, stops at the first failure and reports
 * progress. Neither removes anything: a run that stopped is continued by
 * running the same list again.
 */

import { type Result, err, errorMessage, ok } from '../result.js';
import type {
  PlannedStep,
  RunStepsOptions,
  Step,
  StepProgress,
  StepState,
  StepsFailure,
  StepsReport,
} from './types.js';

/** The kind of `StepsFailure` for a step that raised an exception. */
export const STEP_THREW = 'step-threw';

/** The kind of `StepsFailure` for a run stopped through its signal. */
export const STEPS_STOPPED = 'stopped';

function threw<C>(
  step: Step<C>,
  doing: string,
  caught: unknown,
): { kind: string; message: string } {
  return {
    kind: STEP_THREW,
    message: `The step "${step.title}" stopped with an error while ${doing}: ${errorMessage(caught)}`,
  };
}

/**
 * The plan of `steps`: for each, whether it is already done and, when it is
 * not, the lines of what it would do. Nothing is changed. The plan is made
 * against the state as it is now, so a step that depends on an earlier one is
 * described as if the earlier one had not run.
 */
export async function planSteps<C>(
  steps: readonly Step<C>[],
  ctx: C,
): Promise<Result<PlannedStep[], StepsFailure>> {
  const planned: PlannedStep[] = [];
  for (const step of steps) {
    try {
      const done = await step.isDone(ctx);
      const lines = done ? [] : await step.describe(ctx);
      planned.push({ stepId: step.id, title: step.title, done, lines });
    } catch (caught) {
      return err({
        ...threw(step, 'it was planned', caught),
        stepId: step.id,
        title: step.title,
        completed: [],
        skipped: [],
      });
    }
  }
  return ok(planned);
}

/**
 * Run `steps` in order. A step whose `isDone` answers true is skipped; the run
 * stops at the first step that fails, and what was done before stays in place.
 */
export async function runSteps<C>(
  steps: readonly Step<C>[],
  ctx: C,
  options: RunStepsOptions = {},
): Promise<Result<StepsReport, StepsFailure>> {
  const completed: string[] = [];
  const skipped: string[] = [];
  const total = steps.length;

  const report = (
    step: Step<C>,
    index: number,
    state: StepState,
    message: string | null = null,
  ): void => {
    const progress: StepProgress = {
      stepId: step.id,
      title: step.title,
      index,
      total,
      state,
      message,
    };
    try {
      options.onProgress?.(progress);
    } catch {
      // A screen that fails to show an event does not stop the run.
    }
  };

  const stopAt = (
    step: Step<C>,
    index: number,
    failure: { kind: string; message: string },
  ): Result<StepsReport, StepsFailure> => {
    report(step, index, 'failed', failure.message);
    return err({ ...failure, stepId: step.id, title: step.title, completed, skipped });
  };

  for (const [index, step] of steps.entries()) {
    if (options.signal?.aborted === true) {
      return err({
        kind: STEPS_STOPPED,
        message: `The run was stopped before the step "${step.title}". What was done stays in place, and running again continues from here.`,
        stepId: step.id,
        title: step.title,
        completed,
        skipped,
      });
    }

    report(step, index, 'checking');
    let done: boolean;
    try {
      done = await step.isDone(ctx);
    } catch (caught) {
      return stopAt(step, index, threw(step, 'it checked what is already done', caught));
    }
    if (done) {
      skipped.push(step.id);
      report(step, index, 'skipped');
      continue;
    }

    report(step, index, 'running');
    try {
      const result = await step.run(ctx);
      if (!result.ok) return stopAt(step, index, result.error);
    } catch (caught) {
      return stopAt(step, index, threw(step, 'it ran', caught));
    }
    completed.push(step.id);
    report(step, index, 'done');
  }
  return ok({ completed, skipped });
}
