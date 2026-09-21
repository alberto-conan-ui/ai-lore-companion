import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type {
  DefaultBaseline,
  RepositoriesModelInput,
  RepositoryRead,
  Root,
  RootChanges,
  RootRepositoryState,
  RootSnapshot,
} from '../../src/index.js';
import { repositoriesModel } from '../../src/index.js';

// Stage D1, phase D1.1: the repositories model, from built inputs, no git
// (architecture document, section 3.4).

function repoRoot(id: string, name = id.replace('repo:', '')): Root {
  return {
    id,
    kind: 'repository',
    name,
    path: `/space/repos/${name}`,
    tracking: { tracked: true, workTree: `/space/repos/${name}`, subPath: '' },
  };
}

function input(overrides: Partial<RepositoriesModelInput> = {}): RepositoriesModelInput {
  return {
    roots: [],
    snapshots: {},
    baselines: {},
    defaults: {},
    reads: {},
    github: {},
    mirrors: {},
    ...overrides,
  };
}

test('the Workbench is never a row, and repository, Lore, publish-area order is kept', () => {
  const roots: Root[] = [
    {
      id: 'lore',
      kind: 'lore',
      name: 'lore',
      path: '/space/lore',
      tracking: { tracked: true, workTree: '/space', subPath: 'lore' },
    },
    {
      id: 'workbench',
      kind: 'workbench',
      name: 'workbench',
      path: '/space/workbench',
      tracking: {
        tracked: false,
        reason: 'git-ignored',
        message: 'The Workbench has no change tracking.',
      },
    },
    {
      id: 'publish:publish',
      kind: 'publish-area',
      name: 'publish',
      path: '/space/repos/publish',
      tracking: { tracked: true, workTree: '/space', subPath: 'repos/publish' },
    },
    {
      id: 'publish:handbook',
      kind: 'publish-area',
      name: 'handbook',
      path: '/outside/handbook',
      tracking: { tracked: true, workTree: '/outside/handbook', subPath: '' },
    },
    repoRoot('repo:alpha', 'alpha'),
  ];

  const model = repositoriesModel(input({ roots }));

  assert.deepEqual(
    model.rows.map((row) => row.rootId),
    ['repo:alpha', 'lore', 'publish:publish', 'publish:handbook'],
  );
  assert.ok(!model.rows.some((row) => row.kind === 'workbench'));
});

test('a publish area inside the Space gets its own row and is not folded into the Lore row', () => {
  const roots: Root[] = [
    {
      id: 'lore',
      kind: 'lore',
      name: 'lore',
      path: '/space/lore',
      tracking: { tracked: true, workTree: '/space', subPath: 'lore' },
    },
    {
      id: 'publish:publish',
      kind: 'publish-area',
      name: 'publish',
      path: '/space/repos/publish',
      tracking: { tracked: true, workTree: '/space', subPath: 'repos/publish' },
    },
  ];

  const model = repositoriesModel(input({ roots }));

  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0]?.rootId, 'lore');
  assert.equal(model.rows[0]?.name, 'Lore');
  assert.deepEqual(model.rows[0]?.alsoCovers, []);
  assert.equal(model.rows[1]?.rootId, 'publish:publish');
});

test('a root with no repository read is reading, with no head, operation or remote', () => {
  const model = repositoriesModel(input({ roots: [repoRoot('repo:alpha')] }));

  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0]?.status, 'reading');
  assert.equal(model.rows[0]?.head, null);
  assert.equal(model.rows[0]?.operation, null);
  assert.equal(model.rows[0]?.remote, null);
  assert.equal(model.rows[0]?.changes, null);
});

test('an untracked repository root is untracked, with resolveRoots’s own message', () => {
  const roots: Root[] = [
    {
      id: 'repo:beta',
      kind: 'repository',
      name: 'beta',
      path: '/space/repos/beta',
      tracking: {
        tracked: false,
        reason: 'folder-missing',
        message: 'The repository "beta" has no folder at /space/repos/beta.',
      },
    },
  ];

  const model = repositoriesModel(input({ roots }));

  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0]?.status, 'untracked');
  assert.equal(
    model.rows[0]?.notKnown,
    'The repository "beta" has no folder at /space/repos/beta.',
  );
  assert.equal(model.rows[0]?.head, null);
});

test('a failed repository read is failed, with its message', () => {
  const reads: Record<string, RepositoryRead> = {
    'repo:alpha': { status: 'failed', message: 'git rev-parse did not finish in time' },
  };

  const model = repositoriesModel(input({ roots: [repoRoot('repo:alpha')], reads }));

  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0]?.status, 'failed');
  assert.equal(model.rows[0]?.notKnown, 'git rev-parse did not finish in time');
  assert.equal(model.rows[0]?.head, null);
});

const STATE: RootRepositoryState = {
  workTree: '/space/repos/alpha',
  head: { kind: 'branch', branch: 'main', commit: 'a'.repeat(40) },
  operation: null,
  remote: {
    remote: 'origin',
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    unknown: null,
    lastFetchAt: null,
  },
  readAt: '2026-09-20T00:00:00.000Z',
};

const CHANGES: RootChanges = {
  baseline: 'd'.repeat(40),
  baselineCommit: 'd'.repeat(40),
  baselineIsAncestor: true,
  head: 'a'.repeat(40),
  branch: { branch: 'main', detached: false },
  entries: [
    { code: ' M', path: 'a.ts' },
    { code: '??', path: 'b.ts' },
  ],
  uncommitted: ['a.ts', 'b.ts'],
  total: 5,
  truncated: true,
  limit: 2,
};

test('baselineSource is picked when the baseline differs from the root’s default, and changes come through unchanged', () => {
  const snapshot: RootSnapshot = {
    rootId: 'repo:alpha',
    baseline: CHANGES.baseline,
    status: 'ok',
    changes: CHANGES,
  };
  const defaults: Record<string, DefaultBaseline | null> = {
    'repo:alpha': {
      rootId: 'repo:alpha',
      baseline: 'HEAD',
      source: 'head',
      at: null,
      firstSeenRecorded: false,
      missing: [],
      notice: null,
    },
  };
  const model = repositoriesModel(
    input({
      roots: [repoRoot('repo:alpha')],
      snapshots: { 'repo:alpha': snapshot },
      baselines: { 'repo:alpha': CHANGES.baseline },
      defaults,
      reads: { 'repo:alpha': { status: 'ok', state: STATE } },
    }),
  );

  const row = model.rows[0];
  assert.equal(row?.status, 'ready');
  assert.equal(row?.changes?.baselineSource, 'picked');
  assert.equal(row?.changes?.baselineAt, null);
  assert.equal(row?.changes?.uncommitted, 2);
  assert.equal(row?.changes?.total, 5);
  assert.equal(row?.changes?.truncated, true);
  assert.equal(row?.head?.kind, 'branch');
  assert.equal(row?.remote?.ahead, 1);
});

test('baselineSource falls back to the default’s own source when the baseline matches it', () => {
  const snapshot: RootSnapshot = {
    rootId: 'repo:alpha',
    baseline: 'e'.repeat(40),
    status: 'ok',
    changes: CHANGES,
  };
  const defaults: Record<string, DefaultBaseline | null> = {
    'repo:alpha': {
      rootId: 'repo:alpha',
      baseline: 'e'.repeat(40),
      source: 'reviewed-mark',
      at: '2026-09-19T00:00:00.000Z',
      firstSeenRecorded: false,
      missing: [],
      notice: null,
    },
  };
  const model = repositoriesModel(
    input({
      roots: [repoRoot('repo:alpha')],
      snapshots: { 'repo:alpha': snapshot },
      baselines: { 'repo:alpha': 'e'.repeat(40) },
      defaults,
      reads: { 'repo:alpha': { status: 'ok', state: STATE } },
    }),
  );

  const row = model.rows[0];
  assert.equal(row?.changes?.baselineSource, 'reviewed-mark');
  assert.equal(row?.changes?.baselineAt, '2026-09-19T00:00:00.000Z');
});

test('a snapshot still unread keeps the row reading even when the repository read succeeded', () => {
  const snapshot: RootSnapshot = { rootId: 'repo:alpha', baseline: 'HEAD', status: 'unread' };
  const model = repositoriesModel(
    input({
      roots: [repoRoot('repo:alpha')],
      snapshots: { 'repo:alpha': snapshot },
      reads: { 'repo:alpha': { status: 'ok', state: STATE } },
    }),
  );

  assert.equal(model.rows[0]?.status, 'reading');
  assert.equal(model.rows[0]?.head, null);
});

test('a snapshot that failed to read leaves changes null but keeps the row ready', () => {
  const snapshot: RootSnapshot = {
    rootId: 'repo:alpha',
    baseline: 'HEAD',
    status: 'failed',
    error: { kind: 'command-failed', message: 'git status did not run' },
  };
  const model = repositoriesModel(
    input({
      roots: [repoRoot('repo:alpha')],
      snapshots: { 'repo:alpha': snapshot },
      reads: { 'repo:alpha': { status: 'ok', state: STATE } },
    }),
  );

  assert.equal(model.rows[0]?.status, 'ready');
  assert.equal(model.rows[0]?.changes, null);
  assert.equal(model.rows[0]?.head?.kind, 'branch');
});

import { mirrorDrift } from '../../src/index.js';

test('mirrorDrift reports not-checked when generated is null', () => {
  const result = mirrorDrift({ path: 'p', stored: ['a'], generated: null, checkedAt: null });
  assert.equal(result.state, 'not-checked');
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
});

test('mirrorDrift reports matches when lists match', () => {
  const result = mirrorDrift({
    path: 'p',
    stored: ['a', 'b'],
    generated: ['b', 'a'],
    checkedAt: 'time',
  });
  assert.equal(result.state, 'matches');
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  assert.equal(result.checkedAt, 'time');
});

test('mirrorDrift reports differs with correct added and removed counts', () => {
  const result = mirrorDrift({
    path: 'p',
    stored: ['a', 'b'],
    generated: ['b', 'c', 'd'],
    checkedAt: 'time',
  });
  assert.equal(result.state, 'differs');
  assert.equal(result.added, 2);
  assert.equal(result.removed, 1);
});
