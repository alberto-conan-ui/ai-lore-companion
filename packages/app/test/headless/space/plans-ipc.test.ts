import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import { registerSpacePlans } from '../../../src/main/space/ipc/plans.js';
import { configureSpacePlans } from '../../../src/main/space/plans.js';
import { SPACE_PLANS_CONTRACT } from '../../../src/shared/ipc/space/plans.contract.js';
import type {
  SpacePlansOpenResult,
  SpacePlansState,
  SpacePlansStateResult,
} from '../../../src/shared/ipc/space/plans.types.js';
import { shell } from '../electron-stub.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The Plans band's three channels, through the real Space host on fake windows: a read, the push, and opening a row in the
// browser the way every other link opens (shell.openExternal). The tool and the dashboards' server are scripted.

const PUSH = SPACE_PLANS_CONTRACT.onSpacePlansState.channel;

const answer = JSON.stringify({
  ok: true,
  state: 'complete',
  read_at: 1_790_000_100,
  units: [
    {
      repo: 'alberto-conan-ui/ai-lore',
      number: 346,
      title: 'Live dashboards',
      level: 'Focus',
      kind: 'focus',
      depth: 0,
      stage: 'Build',
      updated: 1_790_000_000,
      updated_exact: true,
      on_github: true,
      dashboard: '/gh/346',
    },
  ],
  missing: [],
  head: '',
  text: '',
  note: '',
});

let space: SpaceFixture;
const opened: { h: SpaceHarness; window: FakeSpaceWindow }[] = [];
let runs: number;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'plans-space' });
});

after(() => {
  configureSpacePlans(null);
  space.cleanup();
});

afterEach(async () => {
  for (const { h } of opened.splice(0)) {
    await h.space.host.dispose();
    h.cleanup();
  }
  configureSpacePlans(null);
  shell.openExternal.calls.length = 0;
});

async function open(): Promise<{ h: SpaceHarness; window: FakeSpaceWindow }> {
  runs = 0;
  configureSpacePlans({
    runner: {
      run: async (_bin, args) => {
        if (args[1] === '--dashboard') {
          const dashboard = JSON.stringify({
            ok: true,
            number: 346,
            dashboard: '/gh/346',
            on_github: true,
          });
          return { code: 0, stdout: dashboard, stderr: '' };
        }
        runs += 1;
        return { code: 0, stdout: answer, stderr: '' };
      },
    },
    liveGitHub: true,
    env: {},
    toolExists: () => true,
    realRoot: space.root,
    fetch: (async () => ({
      ok: true,
      json: async () => ({ ok: true, root: space.root, demo: false }),
    })) as unknown as typeof fetch,
  });
  const h = spaceHarnessFor(registerSpacePlans);
  await h.space.host.openFolder(undefined, space.root);
  const window = h.space.created[h.space.created.length - 1];
  assert.ok(window);
  const result = { h, window };
  opened.push(result);
  return result;
}

const state = (result: unknown): SpacePlansState => {
  const r = result as SpacePlansStateResult;
  if (!r.ok) assert.fail(`${r.error.kind}: ${r.error.message}`);
  return r.value;
};

test('state starts no read; a refresh runs the tool once and answers with the list', async () => {
  const { h, window } = await open();
  const first = state(await h.invoke('spacePlansState', window, {}));
  assert.equal(first.outcome, null);
  assert.equal(runs, 0, 'asking for the state reads nothing');
  const after = state(await h.invoke('spacePlansRefresh', window, {}));
  assert.equal(after.outcome, 'complete');
  assert.equal(after.units?.[0]?.number, 346);
  assert.equal(runs, 1);
});

test('every change of state is pushed to the windows of that Space: reading, then the list', async () => {
  const { h, window } = await open();
  await h.invoke('spacePlansRefresh', window, {});
  const pushed = window.sent
    .filter((m) => m.channel === PUSH)
    .map((m) => m.payload as SpacePlansState);
  assert.deepEqual(
    pushed.map((s) => [s.reading, s.outcome]),
    [
      [true, null],
      [false, 'complete'],
    ],
  );
  assert.ok((pushed[1]?.version ?? 0) > (pushed[0]?.version ?? 0));
});

test('opening a row opens its dashboard through shell.openExternal, after the list has been read', async () => {
  const { h, window } = await open();
  const refused = (await h.invoke('spacePlansOpen', window, {
    number: 346,
  })) as SpacePlansOpenResult;
  assert.equal(refused.ok, false, 'nothing is listed before a read');
  assert.deepEqual(shell.openExternal.calls, []);
  await h.invoke('spacePlansRefresh', window, {});
  const opened = (await h.invoke('spacePlansOpen', window, {
    number: 346,
  })) as SpacePlansOpenResult;
  assert.deepEqual(opened, { ok: true, url: 'http://127.0.0.1:8765/gh/346', startedServer: false });
  assert.deepEqual(shell.openExternal.calls, [['http://127.0.0.1:8765/gh/346']]);
});

test('a browser that cannot be opened is said, not taken for success', async () => {
  const { h, window } = await open();
  await h.invoke('spacePlansRefresh', window, {});
  const real = shell.openExternal;
  const spy = Object.assign(() => Promise.reject(new Error('no browser')), {
    calls: [] as unknown[][],
  });
  (shell as { openExternal: unknown }).openExternal = spy;
  try {
    const result = (await h.invoke('spacePlansOpen', window, {
      number: 346,
    })) as SpacePlansOpenResult;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, 'not-opened');
      assert.match(result.error.message, /no browser/);
    }
  } finally {
    (shell as { openExternal: unknown }).openExternal = real;
  }
});

test('an argument that is not of the expected form is refused, and a window that is not a Space window is told so', async () => {
  const { h, window } = await open();
  for (const [key, arg] of [
    ['spacePlansRefresh', { extra: 1 }],
    ['spacePlansOpen', { number: '346' }],
    ['spacePlansOpen', { number: 0 }],
    ['spacePlansOpen', { number: 346, path: '/etc/passwd' }],
  ] as const) {
    const result = (await h.invoke(key, window, arg)) as { ok: boolean; error?: { kind: string } };
    assert.equal(result.ok, false, `${key} ${JSON.stringify(arg)}`);
    assert.equal(result.error?.kind, 'invalid-argument');
  }
  const stranger = (await h.invoke(
    'spacePlansRefresh',
    { webContentsId: 999_999 },
    {},
  )) as SpacePlansStateResult;
  assert.equal(stranger.ok, false);
  if (!stranger.ok) assert.equal(stranger.error.kind, 'not-a-space-window');
});
