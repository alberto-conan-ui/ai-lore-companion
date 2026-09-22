import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type Desk,
  type DeskPaths,
  GRAPHQL_ARGS,
  type ProjectInfo,
  type ProjectSnapshot,
  createGhCliGitHub,
  deskFile,
  deskNotices,
  deskPaths,
  isProjectCacheRecord,
  isProjectSnapshot,
  openDesk,
  readProjectCache,
  recordProjectFailure,
  recordProjectSnapshot,
} from '../../src/index.js';
import { createScriptedRunner } from '../../src/space/testing/index.js';
import { type CleanupHost, useTempDir } from '../support/temp.js';
import * as S from './github-samples.js';

// Phase M7.1: the Project cache on the desk, and reading a Project of more than 100 items.

const NOW = '2026-09-18T12:00:00.000Z';

function tempPaths(t: CleanupHost): DeskPaths {
  const base = useTempDir(t, 'ai-lore-project-cache-');
  return deskPaths(join(base, 'user data'), join(base, 'space'));
}

function open(paths: DeskPaths): Desk {
  const opened = openDesk(paths, { now: () => new Date(NOW) });
  if (!opened.ok) assert.fail(opened.error.message);
  return opened.value;
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

const ISSUE = (number: number) => ({
  repository: 'octo/space',
  number,
  url: `https://github.com/octo/space/issues/${number}`,
});

function snapshot(fetchedAt = NOW): ProjectSnapshot {
  return {
    problems: [],
    fetchedAt,
    project: {
      owner: 'octo',
      number: 1,
      title: 'space',
      url: 'https://github.com/users/octo/projects/1',
    },
    stageField: { id: 'F', options: [{ id: 'o1', name: 'Spec' }] },
    focuses: [
      {
        issue: ISSUE(1),
        title: 'A focus',
        state: 'open',
        status: null,
        labels: ['feature'],
        updatedAt: NOW,
        stage: 'Spec',
        stageChangedAt: NOW,
        kind: 'feature',
        items: [
          {
            issue: ISSUE(2),
            title: 'An item',
            state: 'closed',
            status: 'Done',
            labels: [],
            updatedAt: NOW,
          },
        ],
        specUrl: null,
        criteriaOnTicket: true,
        goals: [],
      },
    ],
    standalone: [],
    sessions: [
      {
        issue: ISSUE(3),
        title: 'The claude-code session that started at 2026-09-18T09:00:00.000Z',
        column: 'Writing',
        targets: [{ kind: 'lore' }],
        attended: true,
        person: 'octo',
        machine: 'desk-1',
        updatedAt: NOW,
      },
    ],
  };
}

test('parsing: a snapshot is recognised, and a broken one is not', () => {
  assert.equal(isProjectSnapshot(snapshot()), true);
  assert.equal(isProjectSnapshot({ ...snapshot(), fetchedAt: 'not a time' }), false);
  assert.equal(isProjectSnapshot({ ...snapshot(), focuses: [{ title: 'x' }] }), false);
  const badColumn = snapshot();
  (badColumn.sessions[0] as { column: string }).column = 'Sleeping';
  assert.equal(isProjectSnapshot(badColumn), false);
  assert.equal(isProjectCacheRecord({ snapshot: null, failure: null }), true);
  assert.equal(
    isProjectCacheRecord({
      snapshot: null,
      failure: { kind: 'unreachable', message: 'm', at: NOW },
    }),
    true,
  );
  assert.equal(
    isProjectCacheRecord({ snapshot: null, failure: { kind: 'odd', message: 'm', at: NOW } }),
    false,
  );
});

test('an empty desk has an empty cache; a snapshot is kept and read back', (t) => {
  const desk = open(tempPaths(t));
  assert.deepEqual(must(readProjectCache(desk)), { snapshot: null, failure: null });
  must(recordProjectSnapshot(desk, snapshot()));
  assert.deepEqual(must(readProjectCache(desk)), { snapshot: snapshot(), failure: null });
  const file = JSON.parse(readFileSync(deskFile(desk.paths, 'projectCache'), 'utf8'));
  assert.equal(file.version, 1);
  assert.equal(file.records.length, 1);
});

test('an instance that does not own the desk reads the cache but does not write it', (t) => {
  const desk = open(tempPaths(t));
  must(recordProjectSnapshot(desk, snapshot()));
  const path = deskFile(desk.paths, 'projectCache');
  const before = readFileSync(path, 'utf8');
  const second: Desk = { ...desk, writable: false };
  assert.deepEqual(must(readProjectCache(second)), { snapshot: snapshot(), failure: null });
  const refused = recordProjectFailure(second, { kind: 'unreachable', message: 'x', at: NOW });
  assert.equal(refused.ok ? 'written' : refused.error.kind, 'not-writable');
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a failure keeps the snapshot and records the time; a later success clears it', (t) => {
  const desk = open(tempPaths(t));
  must(recordProjectSnapshot(desk, snapshot()));
  const failure = {
    kind: 'unreachable' as const,
    message: 'no network',
    at: '2026-09-18T13:00:00Z',
  };
  must(recordProjectFailure(desk, failure));
  assert.deepEqual(must(readProjectCache(desk)), { snapshot: snapshot(), failure });
  must(recordProjectSnapshot(desk, snapshot('2026-09-18T14:00:00.000Z')));
  const read = must(readProjectCache(desk));
  assert.equal(read.failure, null);
  assert.equal(read.snapshot?.fetchedAt, '2026-09-18T14:00:00.000Z');
});

test('fields and entries this build does not know are kept when the cache is written', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const record = { snapshot: snapshot(), failure: null, fromNewerBuild: { a: 1 } };
  writeFileSync(
    deskFile(paths, 'projectCache'),
    JSON.stringify({ version: 1, note: 'kept', records: [{ odd: true }, record] }),
  );
  must(recordProjectFailure(desk, { kind: 'rate-limited', message: 'later', at: NOW }));
  const file = JSON.parse(readFileSync(deskFile(paths, 'projectCache'), 'utf8'));
  assert.equal(file.note, 'kept');
  assert.deepEqual(file.records[0], { odd: true });
  assert.deepEqual(file.records[1].fromNewerBuild, { a: 1 });
  assert.equal(file.records[1].failure.kind, 'rate-limited');
  assert.deepEqual(file.records[1].snapshot, snapshot());
});

test('a corrupt cache is set aside, reported, and read as empty', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  mkdirSync(paths.desk, { recursive: true });
  writeFileSync(deskFile(paths, 'projectCache'), '{ not json');
  assert.deepEqual(must(readProjectCache(desk)), { snapshot: null, failure: null });
  assert.ok(readdirSync(paths.desk).some((name) => name.startsWith('project-cache.json.corrupt-')));
  assert.ok(deskNotices(desk).some((notice) => notice.kind === 'corrupt-file'));
  assert.ok(existsSync(deskFile(paths, 'projectCache')));
});

test('a cache of a newer version is left as it is', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  mkdirSync(paths.desk, { recursive: true });
  writeFileSync(deskFile(paths, 'projectCache'), JSON.stringify({ version: 9, records: [] }));
  const read = readProjectCache(desk);
  assert.equal(read.ok, false);
  assert.equal(read.ok ? '' : read.error.kind, 'newer-version');
});

test('readProject reads a Project of 250 items in three pages of at most 100', async () => {
  const runner = createScriptedRunner();
  const port = createGhCliGitHub(runner, { now: () => new Date(NOW) });
  const project: ProjectInfo = { ...S.PROJECT_NODE, owner: 'octo-human' };
  const sizes = [100, 100, 50];
  let number = 0;
  sizes.forEach((size, page) => {
    const nodes = Array.from({ length: size }, () => {
      number += 1;
      return {
        id: `PVTI_${number}`,
        isArchived: false,
        fieldValues: { nodes: [] },
        content: {
          __typename: 'Issue',
          number,
          url: `https://github.com/octo-human/my-space/issues/${number}`,
          title: `Issue ${number}`,
          body: '',
          state: 'OPEN',
          updatedAt: NOW,
          repository: { nameWithOwner: 'octo-human/my-space' },
          labels: { nodes: [] },
          parent: null,
          subIssues: { nodes: [] },
        },
      };
    });
    const last = page === sizes.length - 1;
    runner.on({
      bin: 'gh',
      args: GRAPHQL_ARGS,
      times: 1,
      reply: {
        code: 0,
        stdout: S.apiResponse({
          data: {
            node: {
              stage: null,
              items: {
                pageInfo: { hasNextPage: !last, endCursor: `cursor-${page + 1}` },
                nodes,
              },
            },
          },
        }),
        stderr: '',
      },
    });
  });
  const read = await port.readProject({ project });
  assert.ok(read.ok, read.ok ? '' : read.error.message);
  assert.equal(runner.calls.length, 3);
  assert.equal(read.value.standalone.length, 250);
  assert.equal(read.value.standalone.at(-1)?.issue.number, 250);
  assert.ok(isProjectSnapshot(JSON.parse(JSON.stringify(read.value))));
});

test('an older cache without updatedAt and stageChangedAt still loads', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const old = snapshot();
  delete (old.focuses[0] as any).updatedAt;
  delete (old.focuses[0] as any).stageChangedAt;
  delete (old.focuses[0]!.items[0] as any).updatedAt;
  const fileContent = { version: 1, records: [{ snapshot: old, failure: null }] };
  writeFileSync(deskFile(paths, 'projectCache'), JSON.stringify(fileContent));
  const read = must(readProjectCache(desk));
  assert.equal(read.snapshot?.focuses[0]?.updatedAt, null);
  assert.equal(read.snapshot?.focuses[0]?.stageChangedAt, null);
});
