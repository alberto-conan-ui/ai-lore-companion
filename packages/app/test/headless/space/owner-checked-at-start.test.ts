import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CommandRunner, GitHubPort } from '@ai-lore-companion/core';
import { createFakeGitHub } from '@ai-lore-companion/core/testing';
import { createSpacePlans } from '../../../src/main/space/plans.js';
import { createProjectRefresh } from '../../../src/main/space/project-refresh.js';
import { createSpaceRepositories } from '../../../src/main/space/repositories.js';

// Rule N1 (review of slice 5a, findings 2 and 3): the owner is checked where work STARTS, not where it was queued. A service
// that is disposed while a step is queued or pending makes no port call and spawns nothing afterwards.

// ---- the Plans service (finding 2) ----

const PLANS_JSON = JSON.stringify({
  ok: true,
  state: 'complete',
  read_at: 1_790_000_100,
  units: [],
  missing: [],
  head: '',
  text: '',
  note: '',
});

function plansService() {
  const runs: unknown[][] = [];
  const runner: CommandRunner = {
    run: async (...args) => {
      runs.push(args);
      return { code: 0, stdout: PLANS_JSON, stderr: '' };
    },
  };
  const service = createSpacePlans({
    root: '/fake',
    realRoot: '/fake',
    toolExists: () => true,
    liveGitHub: true,
    env: {},
    runner,
  });
  return { service, runs };
}

test('N1 (probe of finding 2): refresh() then dispose() before the queued read starts runs the tool zero times', async () => {
  const { service, runs } = plansService();
  const pending = service.refresh();
  service.dispose();
  await pending;
  assert.equal(runs.length, 0, 'plans.py was run after disposal');
});

test('N1: dispose while the tool runs keeps nothing of its answer and starts nothing more', async () => {
  let release: (() => void) | null = null;
  const runs: unknown[][] = [];
  const service = createSpacePlans({
    root: '/fake',
    realRoot: '/fake',
    toolExists: () => true,
    liveGitHub: true,
    env: {},
    runner: {
      run: async (...args) => {
        runs.push(args);
        await new Promise<void>((done) => {
          release = done;
        });
        return { code: 0, stdout: PLANS_JSON, stderr: '' };
      },
    },
  });
  const pending = service.refresh();
  for (let i = 0; i < 10 && release === null; i++) await new Promise((done) => setImmediate(done));
  service.dispose();
  (release as unknown as () => void)();
  const state = await pending;
  assert.equal(runs.length, 1);
  assert.equal(state.outcome, null, 'an answer that arrived after disposal was kept');
  await service.refresh();
  assert.equal(runs.length, 1);
});

// ---- the Project refresh (finding 3): dispose at each await boundary of the chain ----

const OWNER = 'fake-human';

async function projectWorld() {
  const fake = createFakeGitHub();
  await fake.createRepository({ owner: OWNER, name: 'space', private: true });
  const created = await fake.createProject({ owner: OWNER, title: 'space' });
  assert.ok(created.ok);
  return { fake, project: created.value };
}

/** A port that counts every operation when it STARTS; the one at index `holdAt` is held pending until `release()`. */
function heldPort(fake: ReturnType<typeof createFakeGitHub>, holdAt: number) {
  const started: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const port = new Proxy(fake, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const index = started.length;
        started.push(String(name));
        if (index === holdAt) await gate;
        return value.apply(target, args);
      };
    },
  }) as unknown as GitHubPort;
  return { port, started, release: () => release() };
}

const manifest = (project: number) => ({
  name: 'space',
  github: { repository: `${OWNER}/space`, project },
  repositories: [{ name: 'app', github: `${OWNER}/app` }],
});

const tick = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((done) => setImmediate(done));
};

test('N1 (probe of finding 3): disposed while options.github() is pending, nothing is called on the port', async () => {
  const { fake, project } = await projectWorld();
  let release: (() => void) | null = null;
  const refresh = createProjectRefresh({
    github: () =>
      new Promise((done) => {
        release = () => done(fake as unknown as GitHubPort);
      }),
    manifest: () => manifest(project.number) as never,
    desk: () => ({ ok: false, error: { kind: 'not-found', message: '' } }) as never,
    gates: () => [],
    intervalMs: 0,
  });
  const pending = refresh.refresh();
  await tick();
  const before = fake.calls.length;
  refresh.dispose();
  (release as unknown as () => void)();
  await pending;
  assert.deepEqual(
    fake.calls.slice(before).map((call) => call.operation),
    [],
  );
});

test('N1: disposed at every await boundary of the Project chain, no operation STARTS after dispose', async () => {
  for (let holdAt = 0; holdAt < 6; holdAt++) {
    const { fake, project } = await projectWorld();
    const held = heldPort(fake, holdAt);
    const refresh = createProjectRefresh({
      github: async () => held.port,
      manifest: () => manifest(project.number) as never,
      desk: () => ({ ok: false, error: { kind: 'not-found', message: '' } }) as never,
      gates: () => [],
      intervalMs: 0,
    });
    const pending = refresh.refresh();
    for (let i = 0; i < 400 && held.started.length <= holdAt; i++) await tick(1);
    if (held.started.length <= holdAt) break; // the chain has fewer operations than this boundary
    assert.equal(held.started.length, holdAt + 1, 'the chain is waiting on the held operation');
    refresh.dispose();
    held.release();
    await pending;
    await tick(30);
    assert.equal(
      held.started.length,
      holdAt + 1,
      `an operation started after dispose (boundary ${String(holdAt)}): ${held.started.join(', ')}`,
    );
  }
});

test('N1: a refresh queued behind a running one, and a timer, start nothing once disposed', async () => {
  const { fake, project } = await projectWorld();
  const held = heldPort(fake, 0);
  const refresh = createProjectRefresh({
    github: async () => held.port,
    manifest: () => manifest(project.number) as never,
    desk: () => ({ ok: false, error: { kind: 'not-found', message: '' } }) as never,
    gates: () => [],
    intervalMs: 0,
  });
  const first = refresh.refresh();
  for (let i = 0; i < 100 && held.started.length === 0; i++) await tick(1);
  const queued = refresh.refresh(); // queued behind the first
  refresh.dispose();
  const startedAtDispose = held.started.length;
  held.release();
  await Promise.all([first, queued]);
  await tick(30);
  assert.equal(held.started.length, startedAtDispose);
  await refresh.refresh();
  assert.equal(held.started.length, startedAtDispose, 'a refresh after dispose called the port');
});

test('N1: the repositories service disposed while its roots are pending runs no command afterwards', async () => {
  let release: (() => void) | null = null;
  const commands: unknown[][] = [];
  const service = createSpaceRepositories({
    runner: {
      run: async (...args) => {
        commands.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
    },
    roots: () =>
      new Promise((done) => {
        release = () => done({ ok: true, value: {} } as never);
      }),
    list: () => ({ roots: [] }) as never,
    intervalMs: 0,
  });
  const pending = service.refresh();
  for (let i = 0; i < 10 && release === null; i++) await new Promise((d) => setImmediate(d));
  service.dispose();
  (release as unknown as () => void)();
  await pending;
  await service.refresh();
  assert.equal(commands.length, 0);
});
