/**
 * The durable queue of writes to GitHub that did not land (the Space's #112).
 *
 * The defect these guard: every board write used to be attempted once and lost
 * on failure. A grant of Writing on 2026-09-22 answered, in as many words,
 * "gh was not found on this machine, and nothing will retry it".
 */

import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type Desk,
  dropPendingWrite,
  listPendingWrites,
  openDesk,
  pendingWritesOf,
  queuePendingWrite,
  recordPendingAttempt,
} from '../../src/space/desk/index.js';
import { type DeskPaths, deskPaths } from '../../src/space/layout/index.js';
import { describePendingWrite, drainPendingWrites } from '../../src/space/project/index.js';
import { type SessionIssuePlace, issueRefFor } from '../../src/space/project/index.js';
import { type FakeGitHub, createFakeGitHub } from '../../src/space/testing/index.js';
import { type CleanupHost, useTempDir } from '../support/temp.js';

/** A desk under a fresh temporary data folder. Nothing but temp folders is used. */
function deskBench(t: CleanupHost): Desk {
  const base = useTempDir(t, 'ai-lore-pending-');
  const paths: DeskPaths = deskPaths(join(base, 'user data'), join(base, 'space'));
  const opened = openDesk(paths, {});
  assert.equal(opened.ok, true, opened.ok ? '' : opened.error.message);
  if (!opened.ok) throw new Error('unreachable');
  return opened.value;
}

const ISSUE = issueRefFor('owner/repo', 7);

test('a queued write survives, and a second statement of the same intent replaces it', async (t: TestContext) => {
  const desk = deskBench(t);
  assert.ok(
    queuePendingWrite(desk, {
      id: 'a',
      sessionId: 's-1',
      kind: 'move',
      issue: ISSUE,
      column: 'Done',
    }).ok,
  );
  assert.ok(
    queuePendingWrite(desk, {
      id: 'a',
      sessionId: 's-1',
      kind: 'move',
      issue: ISSUE,
      column: 'Read only',
    }).ok,
  );
  const queued = listPendingWrites(desk);
  assert.ok(queued.ok);
  assert.equal(queued.value.length, 1, 'the same intent is queued once');
  assert.equal(queued.value[0]?.kind === 'move' ? queued.value[0].column : '', 'Read only');

  assert.ok(
    queuePendingWrite(desk, { id: 'b', sessionId: 's-2', kind: 'comment', issue: ISSUE, body: 'x' })
      .ok,
  );
  const mine = pendingWritesOf(desk, 's-1');
  assert.ok(mine.ok);
  assert.deepEqual(
    mine.value.map((write) => write.id),
    ['a'],
  );

  assert.ok(recordPendingAttempt(desk, 'a', 'GitHub could not be reached').ok);
  const tried = listPendingWrites(desk);
  assert.ok(tried.ok);
  const a = tried.value.find((write) => write.id === 'a');
  assert.equal(a?.attempts, 2, 'the attempt that queued it counts, and so does the retry');
  assert.equal(a?.lastError, 'GitHub could not be reached');
  assert.ok(a?.lastTriedAt !== undefined);

  assert.ok(dropPendingWrite(desk, 'a').ok);
  const left = listPendingWrites(desk);
  assert.ok(left.ok);
  assert.deepEqual(
    left.value.map((write) => write.id),
    ['b'],
  );
});

test('a drain replays in order and stops at the first failure, leaving the rest queued', async (t: TestContext) => {
  const desk = deskBench(t);
  const { fake, place } = await benchPlace();
  const first = await fake.createIssue({
    repository: 'owner/repo',
    title: 'One',
    body: '',
    labels: [],
  });
  assert.ok(first.ok);

  assert.ok(
    queuePendingWrite(desk, {
      id: 'c1',
      sessionId: 's-1',
      kind: 'comment',
      issue: first.value,
      body: 'the handover',
    }).ok,
  );
  // An issue the fake does not have: this one cannot land.
  assert.ok(
    queuePendingWrite(desk, {
      id: 'c2',
      sessionId: 's-1',
      kind: 'comment',
      issue: issueRefFor('owner/repo', 9999),
      body: 'never lands',
    }).ok,
  );
  assert.ok(
    queuePendingWrite(desk, {
      id: 'c3',
      sessionId: 's-1',
      kind: 'comment',
      issue: first.value,
      body: 'after the one that fails',
    }).ok,
  );

  const report = await drainPendingWrites(place, desk);
  assert.ok(report.ok);
  assert.equal(report.value.landed, 1, 'the first landed');
  assert.equal(report.value.waiting, 2, 'the failure and everything after it are still queued');
  assert.ok(report.value.stoppedBecause !== null);

  const left = listPendingWrites(desk);
  assert.ok(left.ok);
  assert.deepEqual(
    left.value.map((write) => write.id),
    ['c2', 'c3'],
    'a later intent may depend on an earlier one, so the drain does not skip past a failure',
  );
  const failed = left.value.find((write) => write.id === 'c2');
  assert.equal(failed?.attempts, 2);
  assert.ok(failed?.lastError !== undefined);
});

test('a drain that empties the queue says so, and the writes have landed', async (t: TestContext) => {
  const desk = deskBench(t);
  const { fake, place } = await benchPlace();
  const issue = await fake.createIssue({
    repository: 'owner/repo',
    title: 'One',
    body: '',
    labels: [],
  });
  assert.ok(issue.ok);
  assert.ok(
    queuePendingWrite(desk, {
      id: 'c1',
      sessionId: 's-1',
      kind: 'comment',
      issue: issue.value,
      body: 'the handover that was queued while GitHub was down',
    }).ok,
  );

  const report = await drainPendingWrites(place, desk);
  assert.ok(report.ok);
  assert.deepEqual(report.value, { landed: 1, waiting: 0, stoppedBecause: null });
  const left = listPendingWrites(desk);
  assert.ok(left.ok && left.value.length === 0);
  const written = fake.state().issues.find((entry) => entry.ref.number === issue.value.number);
  assert.ok(
    (written?.comments ?? []).some((text) => text.includes('queued while GitHub was down')),
    'it arrived when connectivity returned',
  );
});

test('a queued write describes itself for a Human Lead who asks what has not landed', () => {
  assert.equal(
    describePendingWrite({
      id: 'x',
      sessionId: 's-1',
      kind: 'comment',
      issue: ISSUE,
      body: 'b',
      queuedAt: '2026-09-22T17:00:00.000Z',
      attempts: 3,
      lastError: 'gh is not signed in to GitHub',
    }),
    'a comment on https://github.com/owner/repo/issues/7, queued at 2026-09-22T17:00:00.000Z, tried 3 times: gh is not signed in to GitHub',
  );
  assert.equal(
    describePendingWrite({
      id: 'y',
      sessionId: 's-1',
      kind: 'move',
      issue: ISSUE,
      column: 'Done',
      queuedAt: '2026-09-22T17:00:00.000Z',
      attempts: 1,
    }),
    'https://github.com/owner/repo/issues/7 moved to the column Done, queued at 2026-09-22T17:00:00.000Z, tried once',
  );
});

/** A fake GitHub with a Project, as the place a drain writes to. */
async function benchPlace(): Promise<{ fake: FakeGitHub; place: SessionIssuePlace }> {
  const fake = createFakeGitHub();
  fake.signIn('owner', ['repo', 'project']);
  const repository = await fake.createRepository({ owner: 'owner', name: 'repo', private: true });
  assert.ok(repository.ok);
  const project = await fake.createProject({ owner: 'owner', title: 'A Space' });
  assert.ok(project.ok);
  return { fake, place: { github: fake, repository: 'owner/repo', project: project.value } };
}
