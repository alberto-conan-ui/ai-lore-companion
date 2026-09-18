/**
 * The step runner: order, skipping what is done, stopping at the first
 * failure, progress events, the dry run, a step that throws, the stop signal.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fail, ok } from '../../src/space/result.js';
import {
  STEPS_STOPPED,
  STEP_THREW,
  type Step,
  type StepProgress,
  planSteps,
  runSteps,
} from '../../src/space/steps/index.js';

type Ctx = { done: Set<string>; log: string[] };

function step(id: string, behaviour: 'ok' | 'fail' | 'throw' = 'ok'): Step<Ctx> {
  return {
    id,
    title: `Step ${id}`,
    describe: async (ctx) => {
      ctx.log.push(`describe:${id}`);
      return [{ what: `Do ${id}.`, count: 1 }];
    },
    isDone: async (ctx) => ctx.done.has(id),
    run: async (ctx) => {
      ctx.log.push(`run:${id}`);
      if (behaviour === 'throw') throw new Error('boom');
      if (behaviour === 'fail') return fail('no-luck', `The step ${id} could not be done.`);
      ctx.done.add(id);
      return ok(undefined);
    },
  };
}

test('runSteps runs in order, skips what is done and reports every state', async () => {
  const ctx: Ctx = { done: new Set(['b']), log: [] };
  const events: StepProgress[] = [];
  const result = await runSteps([step('a'), step('b'), step('c')], ctx, {
    onProgress: (progress) => events.push(progress),
  });
  assert.deepEqual(result, { ok: true, value: { completed: ['a', 'c'], skipped: ['b'] } });
  assert.deepEqual(ctx.log, ['run:a', 'run:c']);
  assert.deepEqual(
    events.map((event) => `${event.stepId}:${event.state}:${event.index}/${event.total}`),
    [
      'a:checking:0/3',
      'a:running:0/3',
      'a:done:0/3',
      'b:checking:1/3',
      'b:skipped:1/3',
      'c:checking:2/3',
      'c:running:2/3',
      'c:done:2/3',
    ],
  );
});

test('runSteps stops at the first failure and keeps what was done', async () => {
  const ctx: Ctx = { done: new Set(), log: [] };
  const events: StepProgress[] = [];
  const result = await runSteps([step('a'), step('b', 'fail'), step('c')], ctx, {
    onProgress: (progress) => events.push(progress),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'no-luck');
  assert.equal(result.error.message, 'The step b could not be done.');
  assert.equal(result.error.stepId, 'b');
  assert.deepEqual(result.error.completed, ['a']);
  assert.deepEqual(ctx.log, ['run:a', 'run:b']);
  assert.ok(ctx.done.has('a'), 'what the first step did stays');
  const last = events.at(-1);
  assert.equal(last?.state, 'failed');
  assert.equal(last?.message, 'The step b could not be done.');

  // Running again repeats nothing that is done.
  const again = await runSteps([step('a'), step('b'), step('c')], ctx);
  assert.deepEqual(again, { ok: true, value: { completed: ['b', 'c'], skipped: ['a'] } });
});

test('a step that throws becomes a failure with a sentence', async () => {
  const ctx: Ctx = { done: new Set(), log: [] };
  const result = await runSteps([step('a', 'throw')], ctx);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, STEP_THREW);
  assert.match(result.error.message, /The step "Step a" stopped with an error while it ran: boom/);
});

test('a progress callback that throws does not stop the run', async () => {
  const ctx: Ctx = { done: new Set(), log: [] };
  const result = await runSteps([step('a')], ctx, {
    onProgress: () => {
      throw new Error('the screen is gone');
    },
  });
  assert.equal(result.ok, true);
});

test('an aborted signal stops the run before the next step', async () => {
  const ctx: Ctx = { done: new Set(), log: [] };
  const controller = new AbortController();
  const result = await runSteps([step('a'), step('b')], ctx, {
    signal: controller.signal,
    onProgress: (progress) => {
      if (progress.stepId === 'a' && progress.state === 'done') controller.abort();
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, STEPS_STOPPED);
  assert.equal(result.error.stepId, 'b');
  assert.deepEqual(result.error.completed, ['a']);
  assert.deepEqual(ctx.log, ['run:a']);
});

test('planSteps describes what is not done and runs nothing', async () => {
  const ctx: Ctx = { done: new Set(['a']), log: [] };
  const plan = await planSteps([step('a'), step('b')], ctx);
  assert.deepEqual(plan, {
    ok: true,
    value: [
      { stepId: 'a', title: 'Step a', done: true, lines: [] },
      { stepId: 'b', title: 'Step b', done: false, lines: [{ what: 'Do b.', count: 1 }] },
    ],
  });
  assert.deepEqual(ctx.log, ['describe:b']);
});

test('planSteps turns a describe that throws into a failure', async () => {
  const broken: Step<Ctx> = {
    ...step('a'),
    describe: async () => {
      throw new Error('cannot say');
    },
  };
  const plan = await planSteps([broken], { done: new Set<string>(), log: [] });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.error.kind, STEP_THREW);
  assert.equal(plan.error.stepId, 'a');
});
