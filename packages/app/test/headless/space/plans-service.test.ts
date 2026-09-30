import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { CommandRunner, RunResult } from '@ai-lore-companion/core';
import {
  EDIT_TOOL,
  PLANS_TIMEOUT_MS,
  PLANS_TOOL,
  SERVER_START_WAIT_MS,
  createSpacePlans,
  parsePlans,
} from '../../../src/main/space/plans.js';

// The Plans band's service (alberto-conan-ui/ai-lore-companion#34): what it runs, how it reads the answer, what it holds
// after a read that did not answer, and how it opens a row. No GitHub, no Electron: a scripted runner, `fetch` and `spawn`.

const ROOT = '/space';

type Unit = Record<string, unknown>;
const unit = (number: number, extra: Unit = {}): Unit => ({
  number,
  title: `Unit ${String(number)}`,
  level: 'Focus',
  kind: 'focus',
  depth: 1,
  stage: 'Build',
  updated: 1_790_000_000,
  updated_exact: true,
  on_github: true,
  dashboard: `/gh/${String(number)}`,
  ...extra,
});

const tool = (state: string, extra: Unit = {}): string =>
  JSON.stringify({
    ok: true,
    state,
    read_at: 1_790_000_100,
    units: [
      unit(131, {
        level: 'Epic',
        kind: 'epic',
        depth: 0,
        on_github: false,
        dashboard: '/epic-factory/dashboard.html',
      }),
      unit(346),
    ],
    missing: [],
    head: '',
    text: '',
    note: 'A brand-new epic can take longer.',
    ...extra,
  });

type Scripted = { stdout?: string; result?: Partial<RunResult> };

function scriptedRunner(answers: Scripted[]): {
  runner: CommandRunner;
  calls: { bin: string; args: readonly string[]; cwd?: string; timeoutMs?: number }[];
} {
  const calls: { bin: string; args: readonly string[]; cwd?: string; timeoutMs?: number }[] = [];
  return {
    calls,
    runner: {
      run: async (bin, args, opts) => {
        calls.push({ bin, args, cwd: opts?.cwd, timeoutMs: opts?.timeoutMs });
        const next = answers.shift() ?? answers[0];
        assert.ok(next, 'the runner was asked more times than the test scripted');
        return { code: 0, stdout: next.stdout ?? '', stderr: '', ...next.result };
      },
    },
  };
}

function service(answers: Scripted[], more: Partial<Parameters<typeof createSpacePlans>[0]> = {}) {
  const run = scriptedRunner(answers);
  const plans = createSpacePlans({
    runner: run.runner,
    root: ROOT,
    liveGitHub: true,
    env: {},
    toolExists: () => true,
    ...more,
  });
  return { plans, ...run };
}

test('a complete read runs the tool in the Space folder with a timeout and lists the rows, in milliseconds', async () => {
  const { plans, calls } = service([{ stdout: tool('complete') }]);
  const state = await plans.refresh();
  assert.deepEqual(calls, [
    { bin: 'python3', args: [PLANS_TOOL, '--json'], cwd: ROOT, timeoutMs: PLANS_TIMEOUT_MS },
  ]);
  assert.equal(state.outcome, 'complete');
  assert.equal(state.readAt, 1_790_000_100_000);
  assert.deepEqual(
    state.units?.map((row) => [row.number, row.kind, row.depth, row.stage, row.onGitHub]),
    [
      [131, 'epic', 0, 'Build', false],
      [346, 'focus', 1, 'Build', true],
    ],
  );
  assert.equal(state.units?.[1]?.updated, 1_790_000_000_000);
  assert.equal(state.reading, false);
  assert.ok(!JSON.stringify(state).includes('/gh/346'), 'the renderer never gets a path to open');
});

test('an empty complete list is a complete state with no rows, not an unread one', async () => {
  const { plans } = service([{ stdout: tool('complete', { units: [] }) }]);
  const state = await plans.refresh();
  assert.equal(state.outcome, 'complete');
  assert.deepEqual(state.units, []);
});

test('an incomplete read lists its rows and says what was not read', async () => {
  const { plans } = service([
    {
      stdout: tool('incomplete', {
        head: 'Incomplete read',
        text: 'part of the plan was not read',
        missing: [{ unit: null, what: 'the list of units', why: 'more than 500 units' }],
      }),
    },
  ]);
  const state = await plans.refresh();
  assert.equal(state.outcome, 'incomplete');
  assert.equal(state.units?.length, 2);
  assert.deepEqual(state.missing, ['the list of units: more than 500 units']);
  assert.equal(state.head, 'Incomplete read');
});

for (const outcome of ['refused', 'unreachable'] as const) {
  test(`a ${outcome} read holds no list, not even the one read a moment before, and says when the last one answered`, async () => {
    const { plans } = service([
      { stdout: tool('complete') },
      { stdout: tool(outcome, { read_at: null, units: [], head: 'GitHub says', text: 'because' }) },
    ]);
    const first = await plans.refresh();
    const second = await plans.refresh();
    assert.equal(second.outcome, outcome);
    assert.equal(second.units, null);
    assert.equal(second.readAt, null);
    assert.equal(second.lastReadAt, first.readAt);
    assert.deepEqual([second.head, second.text], ['GitHub says', 'because']);
    assert.equal((await plans.open(346)).ok, false, 'a row of the list that is gone is not opened');
  });
}

test('a list in a refused answer is ignored: a read that did not answer lists nothing', () => {
  const parsed = parsePlans(tool('refused', { read_at: null, head: 'h', text: 't' }));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.units, []);
});

test('an answer that cannot be read is failed, never a list and never an empty one', async () => {
  const bad: [string, Scripted][] = [
    ['not JSON', { stdout: 'Traceback (most recent call last)' }],
    ['no units', { stdout: JSON.stringify({ ok: true, state: 'complete', read_at: 1 }) }],
    ['an unknown state', { stdout: tool('certain') }],
    ['a list with no time', { stdout: tool('complete', { read_at: null }) }],
    ['a unit twice', { stdout: tool('complete', { units: [unit(1), unit(1)] }) }],
    [
      'a dashboard on another host',
      { stdout: tool('complete', { units: [unit(1, { dashboard: '//evil.example/x' })] }) },
    ],
    [
      'a dashboard that leaves the server',
      { stdout: tool('complete', { units: [unit(1, { dashboard: '/gh/../../etc' })] }) },
    ],
    ['a stage that is not text', { stdout: tool('complete', { units: [unit(1, { stage: 4 })] }) }],
    ['exit 1', { stdout: '', result: { code: 1, stderr: 'boom' } }],
    ['a timeout', { result: { code: -1, failure: 'timeout', stderr: 'stopped' } }],
    ['no python3', { result: { code: -1, failure: 'not-found', stderr: 'x' } }],
    ['a refused start', { result: { code: -1, failure: 'refused', stderr: 'guard' } }],
  ];
  for (const [what, answer] of bad) {
    const { plans } = service([answer]);
    const state = await plans.refresh();
    assert.equal(state.outcome, 'failed', what);
    assert.equal(state.units, null, what);
    assert.equal(state.head, 'Plans could not be read', what);
    assert.notEqual(state.text, '', what);
  }
});

test('the timeout and python3 missing are said in plain words', async () => {
  const t = await service([
    { result: { code: -1, failure: 'timeout', stderr: '' } },
  ]).plans.refresh();
  assert.match(t.text, /did not finish in 120 seconds/);
  const m = await service([
    { result: { code: -1, failure: 'not-found', stderr: '' } },
  ]).plans.refresh();
  assert.match(m.text, /python3 was not found/);
});

test('a read that started earlier never replaces one that started later', async () => {
  const { plans } = service([
    { stdout: tool('complete', { read_at: 2000, units: [unit(2)] }) },
    { stdout: tool('complete', { read_at: 1000, units: [unit(1)] }) },
  ]);
  await plans.refresh();
  const state = await plans.refresh();
  assert.deepEqual(
    state.units?.map((row) => row.number),
    [2],
  );
  assert.equal(state.readAt, 2_000_000);
});

test('a request made while a read runs is served by it: one process, not two', async () => {
  let release: (result: RunResult) => void = () => undefined;
  let runs = 0;
  const plans = createSpacePlans({
    runner: {
      run: () => {
        runs += 1;
        return new Promise<RunResult>((done) => {
          release = done;
        });
      },
    },
    root: ROOT,
    liveGitHub: true,
    env: {},
    toolExists: () => true,
  });
  const seen: boolean[] = [];
  plans.subscribe((state) => seen.push(state.reading));
  const a = plans.refresh();
  const b = plans.refresh();
  assert.equal(plans.current().reading, true);
  await new Promise((done) => setImmediate(done));
  release({ code: 0, stdout: tool('complete'), stderr: '' });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(runs, 1);
  assert.equal(first.version, second.version);
  assert.deepEqual(seen, [true, false], 'the state says it is reading, then that it is not');
  assert.equal(plans.current().reading, false);
});

test('a Space without the tool has no Plans band and nothing is run', async () => {
  const { plans, calls } = service([{ stdout: tool('complete') }], { toolExists: () => false });
  const state = await plans.refresh();
  assert.equal(state.outcome, 'unavailable');
  assert.equal(calls.length, 0);
});

test('a test or end-to-end run reads no live GitHub: the tool is not started', async () => {
  const { plans, calls } = service([{ stdout: tool('complete') }], { liveGitHub: false });
  const state = await plans.refresh();
  assert.equal(state.outcome, 'failed');
  assert.match(state.text, /not read in a test or end-to-end run/);
  assert.equal(calls.length, 0);
});

test('the demo switches run the tool on the fake GitHub', async () => {
  const { plans, calls } = service([{ stdout: tool('incomplete') }], {
    liveGitHub: false,
    env: { COCKPIT_PLANS_DEMO: '1', COCKPIT_PLANS_SIMULATE: 'incomplete' },
  });
  await plans.refresh();
  assert.deepEqual(calls[0]?.args, [PLANS_TOOL, '--json', '--demo', '--simulate', 'incomplete']);
  const other = service([{ stdout: tool('complete') }], {
    env: { COCKPIT_PLANS_DEMO: '1', COCKPIT_PLANS_SIMULATE: 'whatever' },
  });
  await other.plans.refresh();
  assert.deepEqual(other.calls[0]?.args, [PLANS_TOOL, '--json', '--demo']);
});

// ---- opening a row ----

type Fake = {
  fetch: typeof fetch;
  spawned: { bin: string; args: readonly string[]; cwd: string }[];
  child: EventEmitter & { kill: () => boolean; killed: boolean; exitCode: number | null };
  listening: { up: boolean };
  clock: { t: number };
  options: Partial<Parameters<typeof createSpacePlans>[0]>;
};

function fakeServer(up: boolean, answersAfterSpawn = true): Fake {
  const listening = { up };
  const clock = { t: 0 };
  const spawned: Fake['spawned'] = [];
  const child = Object.assign(new EventEmitter(), {
    killed: false,
    exitCode: null as number | null,
    kill() {
      this.killed = true;
      return true;
    },
  });
  const fetchFn = (async (url: string | URL | Request) => {
    assert.equal(String(url), 'http://127.0.0.1:8765/api/ping');
    if (!listening.up) throw new Error('connect ECONNREFUSED');
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  return {
    fetch: fetchFn,
    spawned,
    child,
    listening,
    clock,
    options: {
      fetch: fetchFn,
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
        if (spawned.length > 0 && answersAfterSpawn && clock.t >= 1000) listening.up = true;
      },
      spawn: (bin, args, cwd) => {
        spawned.push({ bin, args, cwd });
        return child as unknown as ReturnType<NonNullable<Fake['options']['spawn']>>;
      },
    },
  };
}

const listed = (): Scripted[] => [{ stdout: tool('complete') }];

test('opening a row whose plan is on GitHub gives /gh/<n> on the dashboards server; nothing is started when it answers', async () => {
  const fake = fakeServer(true);
  const { plans } = service(listed(), fake.options);
  await plans.refresh();
  assert.deepEqual(await plans.open(346), {
    ok: true,
    url: 'http://127.0.0.1:8765/gh/346',
    startedServer: false,
  });
  assert.equal(fake.spawned.length, 0);
});

test('an epic not yet moved opens its JSON dashboard through the same server', async () => {
  const fake = fakeServer(true);
  const { plans } = service(listed(), fake.options);
  await plans.refresh();
  assert.deepEqual(await plans.open(131), {
    ok: true,
    url: 'http://127.0.0.1:8765/epic-factory/dashboard.html',
    startedServer: false,
  });
});

test('a unit that is not on the list is not opened, whatever number is asked for', async () => {
  const fake = fakeServer(true);
  const { plans } = service(listed(), fake.options);
  await plans.refresh();
  const answer = await plans.open(9999);
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.error.kind, 'not-listed');
});

test('when nothing answers, the server is started in the Space folder as a child the service owns, then the row opens', async () => {
  const fake = fakeServer(false);
  const { plans } = service(listed(), fake.options);
  await plans.refresh();
  assert.deepEqual(await plans.open(346), {
    ok: true,
    url: 'http://127.0.0.1:8765/gh/346',
    startedServer: true,
  });
  assert.deepEqual(fake.spawned, [{ bin: 'python3', args: [EDIT_TOOL], cwd: ROOT }]);
  assert.equal(fake.child.killed, false);
  // a second row does not start a second server
  assert.deepEqual(await plans.open(131), {
    ok: true,
    url: 'http://127.0.0.1:8765/epic-factory/dashboard.html',
    startedServer: false,
  });
  assert.equal(fake.spawned.length, 1);
  plans.dispose();
  assert.equal(fake.child.killed, true, 'the server the service started stops with it');
});

test('a server that stops before it answers is said, with the likely cause', async () => {
  const fake = fakeServer(false, false);
  const { plans } = service(listed(), {
    ...fake.options,
    sleep: async (ms) => {
      fake.clock.t += ms;
      fake.child.emit('exit', 1);
    },
  });
  await plans.refresh();
  const answer = await plans.open(346);
  assert.equal(answer.ok, false);
  if (!answer.ok) {
    assert.equal(answer.error.kind, 'server-not-started');
    assert.match(answer.error.message, /stopped \(exit 1\)/);
    assert.match(answer.error.message, /port 8765/);
    assert.match(answer.error.message, /python3 tools\/plan\/edit\.py/);
  }
});

test('a server that never answers is given up after the wait, stopped, and said', async () => {
  const fake = fakeServer(false, false);
  const { plans } = service(listed(), fake.options);
  await plans.refresh();
  const answer = await plans.open(346);
  assert.equal(answer.ok, false);
  assert.ok(fake.clock.t >= SERVER_START_WAIT_MS, 'it waited the whole time, and no longer');
  assert.ok(fake.clock.t < SERVER_START_WAIT_MS + 1000);
  assert.equal(fake.child.killed, true, 'a server that did not answer is not left half-started');
  if (!answer.ok) assert.match(answer.error.message, /did not answer within 15 seconds/);
});

test('python3 that cannot start the server is said, not waited for', async () => {
  const fake = fakeServer(false, false);
  const { plans } = service(listed(), {
    ...fake.options,
    sleep: async (ms) => {
      fake.clock.t += ms;
      fake.child.emit('error', new Error('spawn python3 ENOENT'));
    },
  });
  await plans.refresh();
  const answer = await plans.open(346);
  assert.equal(answer.ok, false);
  if (!answer.ok)
    assert.match(
      answer.error.message,
      /could not start tools\/plan\/edit\.py: spawn python3 ENOENT/,
    );
  assert.ok(fake.clock.t < 1000);
});

test('an answer on the port that is not the dashboards server (no ok) is not taken for it', async () => {
  const fake = fakeServer(false, false);
  const { plans } = service(listed(), {
    ...fake.options,
    fetch: (async () => ({
      ok: true,
      json: async () => ({ hello: 'world' }),
    })) as unknown as typeof fetch,
  });
  await plans.refresh();
  const answer = await plans.open(346);
  assert.equal(answer.ok, false);
  assert.equal(fake.spawned.length, 1, 'it tried to start its own');
});

test('the demo switch starts the server on the fake GitHub as well', async () => {
  const fake = fakeServer(false);
  const { plans } = service(listed(), {
    ...fake.options,
    env: { COCKPIT_PLANS_DEMO: '1' },
    liveGitHub: false,
  });
  await plans.refresh();
  await plans.open(346);
  assert.deepEqual(fake.spawned[0]?.args, [EDIT_TOOL, '--demo']);
});
