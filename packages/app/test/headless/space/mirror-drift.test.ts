import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CommandRunner,
  type MirrorCard,
  type Root,
  type RunResult,
  execFileRunner,
} from '@ai-lore-companion/core';
import { createScriptedRunner, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import {
  MIRROR_GENERATOR_TIMEOUT_MS,
  checkPayloadMirrors,
  decodeGeneratorLine,
  uncheckedPayloadMirrors,
} from '../../../src/main/space/mirror-drift.js';
import { createSpaceRepositories } from '../../../src/main/space/repositories.js';
import type { RunningRoots } from '../../../src/main/space/roots-service.js';
import type { RootSummary, SpaceRootsList } from '../../../src/shared/ipc.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

function payloadRoot(kind: 'repository' | 'publish-area', name: string, path: string): Root {
  return {
    id: `${kind === 'repository' ? 'repo' : 'publish'}:${name}`,
    kind,
    name,
    path,
    tracking: { tracked: true, workTree: '/space', subPath: path.slice('/space/'.length) },
  };
}

const repository: MirrorCard = {
  kind: 'mirror',
  payload: 'catalog',
  generator: 'lore/mirrors/generators/repository-skeleton.py',
  skeleton: ['src/', 'src/a"b\\c.ts'],
};

const publishArea: MirrorCard = {
  kind: 'mirror',
  payload: 'spec-library',
  generator: 'lore/mirrors/generators/folder-skeleton.py',
  skeleton: ['deep/', 'deep/one/', 'deep/one/spec.md'],
};

test('mirror checks use payload names to select cards and each root path to run their full skeleton', async () => {
  const runner = createScriptedRunner([
    {
      bin: 'python3',
      args: ['/space/lore/mirrors/generators/repository-skeleton.py', '/worktrees/catalog'],
      reply: { stdout: '"src/"\n"src/a\\"b\\\\c.ts"\n' },
    },
    {
      bin: 'python3',
      args: ['/space/lore/mirrors/generators/folder-skeleton.py', '/documents/spec-library'],
      reply: { stdout: '"deep/"\n"deep/one/"\n"deep/one/spec.md"\n"new.md"\n' },
    },
  ]);

  const result = await checkPayloadMirrors({
    runner,
    spaceRoot: '/space',
    roots: [
      payloadRoot('repository', 'catalog', '/worktrees/catalog'),
      payloadRoot('publish-area', 'spec-library', '/documents/spec-library'),
    ],
    mirrors: [repository, publishArea],
    checkedAt: '2026-09-21T17:13:00.000Z',
  });

  assert.equal(result['repo:catalog']?.state, 'matches');
  assert.deepEqual(result['publish:spec-library'], {
    path: 'lore/mirrors/spec-library.md',
    state: 'differs',
    added: 1,
    removed: 0,
    checkedAt: '2026-09-21T17:13:00.000Z',
  });
  assert.deepEqual(
    runner.calls.map((call) => call.opts),
    [
      { cwd: '/space', timeoutMs: MIRROR_GENERATOR_TIMEOUT_MS },
      { cwd: '/space', timeoutMs: MIRROR_GENERATOR_TIMEOUT_MS },
    ],
  );
  assert.ok(runner.calls.every((call) => !call.args.includes('--depth')));
});

test('a failed or malformed generator output is reported as not checked', async () => {
  const runner = createScriptedRunner([
    { bin: 'python3', reply: { code: -1, failure: 'timeout' } },
    { bin: 'python3', reply: { stdout: 'unquoted-path\n' } },
  ]);
  const roots: Root[] = [
    payloadRoot('repository', 'catalog', '/worktrees/catalog'),
    payloadRoot('publish-area', 'spec-library', '/documents/spec-library'),
    {
      id: 'publish:refused',
      kind: 'publish-area',
      name: 'refused',
      path: '/outside-space',
      tracking: { tracked: false, reason: 'path-refused', message: 'The path is refused.' },
    },
    {
      id: 'publish:unknown',
      kind: 'publish-area',
      name: 'unknown',
      path: '',
      tracking: { tracked: false, reason: 'path-unknown', message: 'The path is unknown.' },
    },
  ];

  const result = await checkPayloadMirrors({
    runner,
    spaceRoot: '/space',
    roots,
    mirrors: [repository, publishArea],
    checkedAt: '2026-09-21T17:13:00.000Z',
  });

  for (const root of roots) {
    assert.equal(result[root.id]?.state, 'not-checked');
    assert.equal(result[root.id]?.checkedAt, '2026-09-21T17:13:00.000Z');
  }
  assert.equal(runner.calls.length, 2, 'refused and unknown paths never start a generator');
  assert.equal(decodeGeneratorLine('"a\\"b\\\\c"'), 'a"b\\c');
});

test('an unreadable Lore replaces a previous mirror result for every payload', () => {
  const roots = [
    payloadRoot('repository', 'catalog', '/worktrees/catalog'),
    payloadRoot('publish-area', 'spec-library', '/documents/spec-library'),
  ];
  const result = uncheckedPayloadMirrors(roots, '2026-09-21T17:13:00.000Z');

  assert.deepEqual(
    Object.values(result).map((mirror) => [mirror.state, mirror.checkedAt]),
    [
      ['not-checked', '2026-09-21T17:13:00.000Z'],
      ['not-checked', '2026-09-21T17:13:00.000Z'],
    ],
  );
});

function summary(root: Root): RootSummary {
  return {
    root,
    baseline: 'HEAD',
    defaultBaseline: null,
    baselineNotice: null,
    snapshot: { rootId: root.id, baseline: 'HEAD', status: 'unread' },
    github: null,
  };
}

test('a file change invalidates a running mirror result, and root path changes force a fresh check', async () => {
  const fixture = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'mirror-service',
  });
  let releaseFirst!: (result: RunResult) => void;
  let sawFirstGenerator!: () => void;
  const firstGenerator = new Promise<RunResult>((resolve) => {
    releaseFirst = resolve;
  });
  const generatorStarted = new Promise<void>((resolve) => {
    sawFirstGenerator = resolve;
  });
  const pythonCalls: string[][] = [];
  let generatorCalls = 0;
  const runner: CommandRunner = {
    run(bin, args, opts) {
      if (bin !== 'python3') return execFileRunner.run(bin, args, opts);
      generatorCalls += 1;
      pythonCalls.push([...args]);
      if (generatorCalls === 1) {
        sawFirstGenerator();
        return firstGenerator;
      }
      return Promise.resolve({ code: 0, stdout: '"specs/"\n"specs/index.md"\n', stderr: '' });
    },
  };
  const loreRoot: Root = {
    id: 'lore',
    kind: 'lore',
    name: 'lore',
    path: `${fixture.root}/lore`,
    tracking: { tracked: true, workTree: fixture.root, subPath: 'lore' },
  };
  const publishRoot: Root = {
    id: 'publish:publish',
    kind: 'publish-area',
    name: 'publish',
    path: `${fixture.root}/publish`,
    tracking: { tracked: true, workTree: fixture.root, subPath: 'publish' },
  };
  const roots: SpaceRootsList = {
    roots: [summary(loreRoot), summary(publishRoot)],
    deskWritable: false,
    deskNotice: null,
  };
  const service = createSpaceRepositories({
    runner,
    roots: async () => ({ ok: true, value: {} as RunningRoots }),
    list: () => roots,
    intervalMs: 0,
    now: () => new Date('2026-09-21T17:13:00.000Z'),
  });

  try {
    const initial = service.refresh();
    await generatorStarted;
    service.changed();
    assert.equal(
      service.current().model?.rows.find((row) => row.rootId === publishRoot.id)?.mirror?.state,
      'not-checked',
    );

    releaseFirst({ code: 0, stdout: '"specs/"\n"specs/index.md"\n', stderr: '' });
    await initial;
    assert.equal(
      service.current().model?.rows.find((row) => row.rootId === publishRoot.id)?.mirror?.state,
      'not-checked',
      'the generator that began before the file event cannot restore its result',
    );

    await service.refresh();
    assert.equal(
      service.current().model?.rows.find((row) => row.rootId === publishRoot.id)?.mirror?.state,
      'matches',
    );

    publishRoot.path = '/a-different-publish-area';
    await service.refresh();
    assert.equal(generatorCalls, 3, 'a changed root path bypasses the normal mirror interval');
    assert.equal(pythonCalls[2]?.[1], '/a-different-publish-area');

    publishRoot.tracking = {
      tracked: false,
      reason: 'path-refused',
      message: 'The publish area path is refused.',
    };
    await service.refresh();
    assert.equal(generatorCalls, 3, 'a refused root path is never passed to a generator');
    assert.equal(
      service.current().model?.rows.find((row) => row.rootId === publishRoot.id)?.mirror?.state,
      'not-checked',
    );
  } finally {
    service.dispose();
    fixture.cleanup();
  }
});
