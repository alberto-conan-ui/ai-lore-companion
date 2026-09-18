import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type BaselinePoints,
  type ChangeEntry,
  type Desk,
  type MergedPullRequestSource,
  type Root,
  addClaims,
  addMark,
  addSession,
  defaultBaselineOf,
  deskPaths,
  execFileRunner,
  getFirstSeen,
  groupBaselinePoints,
  leaveWriting,
  listBaselinePoints,
  listFirstSeen,
  listMarks,
  markRootReviewed,
  openDesk,
  readChangesIn,
  readSessionCloseCommits,
  recordSessionClose,
  resolveRoots,
  startSession,
  updateSession,
} from '../../src/index.js';
import {
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
} from '../../src/space/testing/index.js';
import { useTempGitRepo } from '../support/git.js';
import { loreTemplateDir } from '../support/paths.js';
import { useTempDir } from '../support/temp.js';

const runner = execFileRunner;
const GONE = 'abcdef0123456789abcdef0123456789abcdef01';

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function failureOf<E>(result: { ok: true } | { ok: false; error: E }): E {
  if (result.ok) assert.fail('expected a failure');
  return result.error;
}

/** A desk in a temporary data folder whose clock the test sets. */
function useDesk(t: TestContext, instance?: { pid: number; startedAt: string }) {
  const base = useTempDir(t, 'ai-lore-baseline-');
  const clock = { now: '2026-01-10T09:00:00.000Z' };
  const paths = deskPaths(join(base, 'user data'), join(base, 'space'));
  const open = (as = instance): Desk =>
    must(openDesk(paths, { now: () => new Date(clock.now), ...(as ? { instance: as } : {}) }));
  return { desk: open(), clock, open };
}

async function useSpace(t: TestContext, repositories: string[] = ['alpha']): Promise<SpaceFixture> {
  const fixture = await makeSpaceFixture({ templateDir: loreTemplateDir(), repositories });
  t.after(() => fixture.cleanup());
  return fixture;
}

async function rootOf(fixture: SpaceFixture, id: string): Promise<Root> {
  const roots = must(await resolveRoots({ spaceRoot: fixture.root, runner }));
  const root = roots.find((candidate) => candidate.id === id);
  if (root === undefined) assert.fail(`no root ${id}`);
  return root;
}

function repositoryRoot(name: string, dir: string): Root {
  return {
    id: `repo:${name}`,
    kind: 'repository',
    name,
    path: dir,
    tracking: { tracked: true, workTree: dir, subPath: '' },
  };
}

function summary(points: BaselinePoints): string[] {
  return points.points.map((point) => `${point.kind} ${point.commit.slice(0, 7)}`);
}

/** `git status` writes ` M` where `git diff` writes `M `: the letter is compared, not its column. */
function sorted(entries: readonly ChangeEntry[]): string[] {
  return entries.map((entry) => `${entry.code.trim()}|${entry.oldPath ?? ''}|${entry.path}`).sort();
}

async function changesAgainst(root: Root, baseline: string): Promise<ChangeEntry[]> {
  assert.ok(root.tracking.tracked);
  const { workTree, subPath } = root.tracking;
  return must(await readChangesIn(runner, workTree, baseline, subPath)).entries;
}

async function useFakeGitHub(t: TestContext, name: string) {
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  must(await fake.createRepository({ owner: 'fake-human', name, private: true }));
  const source: MergedPullRequestSource = (arg) => fake.mergedPullRequests(arg);
  return { fake, source, repository: `fake-human/${name}` };
}

test('the four kinds come back in one timeline, newest first, with commits grouped under their session', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk, clock } = useDesk(t);
  const github = await useFakeGitHub(t, 'alpha');

  clock.now = '2026-01-05T12:00:00.000Z';
  must(addMark(desk, root.id, alpha.baseCommit));
  github.fake.addMergedPullRequest(github.repository, {
    number: 12,
    title: 'Add the work',
    url: 'https://github.com/fake-human/alpha/pull/12',
    mergedAt: '2026-01-06T11:00:00Z',
    mergeCommit: alpha.headCommit,
    headBranch: 'item/12',
    baseBranch: 'main',
  });
  github.fake.addMergedPullRequest(github.repository, {
    number: 13,
    title: 'No merge commit given',
    url: 'https://github.com/fake-human/alpha/pull/13',
    mergedAt: '2026-01-06T12:00:00Z',
    mergeCommit: null,
    headBranch: 'item/13',
    baseBranch: 'main',
  });
  must(
    addSession(desk, {
      id: 's1',
      engine: 'claude-code',
      attended: true,
      mode: 'writing',
      startedAt: '2026-01-07T09:00:00.000Z',
    }),
  );
  const sessionCommit = await alpha.checkout.commitAll('Work of the session', {
    date: '2026-01-08T10:00:00Z',
  });
  clock.now = '2026-01-08T12:00:00.000Z';
  must(recordSessionClose(desk, { rootId: root.id, commit: sessionCommit, sessionId: 's1' }));
  // A mark of another root is not a point of this one.
  must(addMark(desk, 'lore', fixture.head));

  const points = must(
    await listBaselinePoints({ runner, desk, root, pullRequests: github, commitLimit: 50 }),
  );
  assert.deepEqual(summary(points), [
    `session-close ${sessionCommit.slice(0, 7)}`,
    `commit ${sessionCommit.slice(0, 7)}`,
    `merged-pull-request ${alpha.headCommit.slice(0, 7)}`,
    `commit ${alpha.headCommit.slice(0, 7)}`,
    `reviewed-mark ${alpha.baseCommit.slice(0, 7)}`,
    `commit ${alpha.baseCommit.slice(0, 7)}`,
  ]);
  assert.equal(points.head, sessionCommit);
  assert.deepEqual(points.mergedPullRequests, { status: 'read', withoutCommit: 1 });
  assert.equal(points.limits.commitsTruncated, false);
  assert.ok(points.points.every((point) => !('commitMissing' in point)));

  const [close, grouped, pull, plain] = points.points;
  assert.deepEqual(close, {
    kind: 'session-close',
    commit: sessionCommit,
    at: '2026-01-08T12:00:00.000Z',
    sessionId: 's1',
  });
  assert.deepEqual(grouped, {
    kind: 'commit',
    commit: sessionCommit,
    at: '2026-01-08T10:00:00.000Z',
    subject: 'Work of the session',
    sessionId: 's1',
  });
  assert.deepEqual(pull, {
    kind: 'merged-pull-request',
    commit: alpha.headCommit,
    at: '2026-01-06T11:00:00Z',
    number: 12,
    title: 'Add the work',
  });
  assert.ok(plain?.kind === 'commit' && plain.sessionId === undefined);

  const rows = groupBaselinePoints(points.points);
  assert.deepEqual(rows[0], {
    kind: 'session',
    sessionId: 's1',
    at: '2026-01-08T12:00:00.000Z',
    closes: [close],
    commits: [grouped],
  });
  assert.equal(rows.length, 5);
  assert.ok(rows.slice(1).every((row) => row.kind === 'point'));
});

test('when the pull request source cannot be reached, the other three kinds come back and the reason is data', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk } = useDesk(t);
  const github = await useFakeGitHub(t, 'alpha');
  must(addMark(desk, root.id, alpha.baseCommit));
  must(recordSessionClose(desk, { rootId: root.id, commit: alpha.headCommit, sessionId: 's9' }));
  github.fake.setUnreachable(true);

  const points = must(await listBaselinePoints({ runner, desk, root, pullRequests: github }));
  assert.equal(points.mergedPullRequests.status, 'omitted');
  assert.ok(points.mergedPullRequests.status === 'omitted');
  assert.equal(points.mergedPullRequests.reason, 'unreachable');
  assert.notEqual(points.mergedPullRequests.message, '');
  assert.deepEqual([...new Set(points.points.map((point) => point.kind))].sort(), [
    'commit',
    'reviewed-mark',
    'session-close',
  ]);

  const throwing: MergedPullRequestSource = () => Promise.reject(new Error('socket hang up'));
  const thrown = must(
    await listBaselinePoints({
      runner,
      desk,
      root,
      pullRequests: { source: throwing, repository: github.repository },
    }),
  );
  assert.deepEqual(thrown.mergedPullRequests, {
    status: 'omitted',
    reason: 'source-threw',
    message: 'socket hang up',
  });
  assert.equal(thrown.points.length, points.points.length);

  const none = must(await listBaselinePoints({ runner, desk, root }));
  assert.deepEqual(none.mergedPullRequests, { status: 'not-applicable' });
});

test('a root with no mark compares against its first-seen commit, which is recorded once', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk, clock } = useDesk(t);

  clock.now = '2026-01-10T09:00:00.000Z';
  const first = must(await defaultBaselineOf({ runner, desk, root }));
  assert.deepEqual(first, {
    rootId: root.id,
    baseline: alpha.headCommit,
    source: 'first-seen',
    at: '2026-01-10T09:00:00.000Z',
    firstSeenRecorded: true,
    missing: [],
    notice: null,
  });

  const later = await alpha.checkout.commitAll('Later work', { date: '2026-01-11T10:00:00Z' });
  clock.now = '2026-01-12T09:00:00.000Z';
  const second = must(await defaultBaselineOf({ runner, desk, root }));
  assert.deepEqual(second, { ...first, firstSeenRecorded: false });
  assert.equal(must(listFirstSeen(desk)).length, 1);
  assert.notEqual(later, second.baseline);
  // What the later commit holds is what changed against the first-seen commit.
  assert.deepEqual(
    sorted(await changesAgainst(root, second.baseline)),
    sorted(must(await readChangesIn(runner, alpha.checkout.dir, alpha.headCommit, '')).entries),
  );
  assert.ok((await changesAgainst(root, second.baseline)).length > 0);
});

test('marking as reviewed clears the committed changes and leaves the uncommitted ones listed', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk, clock } = useDesk(t);
  must(addMark(desk, root.id, alpha.baseCommit.slice(0, 10)));

  const before = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(before.source, 'reviewed-mark');
  assert.equal(before.baseline, alpha.baseCommit, 'a short SHA in a mark is given in full');
  assert.equal(before.firstSeenRecorded, false);
  assert.equal(must(getFirstSeen(desk, root.id)), null, 'a marked root needs no first-seen record');
  const uncommitted = sorted(await changesAgainst(root, 'HEAD'));
  const beforeChanges = sorted(await changesAgainst(root, before.baseline));
  assert.ok(uncommitted.length > 0);
  assert.ok(beforeChanges.length > uncommitted.length, 'committed work is listed before the mark');

  clock.now = '2026-01-10T15:00:00.000Z';
  const marked = must(await markRootReviewed({ runner, desk, root }));
  assert.deepEqual(marked, {
    mark: { rootId: root.id, commit: alpha.headCommit, markedAt: '2026-01-10T15:00:00.000Z' },
    baseline: alpha.headCommit,
  });
  assert.equal(must(listMarks(desk, root.id)).length, 2, 'the mark is appended');

  const after = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(after.baseline, alpha.headCommit);
  assert.equal(after.source, 'reviewed-mark');
  assert.deepEqual(sorted(await changesAgainst(root, after.baseline)), uncommitted);
});

test('a mark whose commit is gone is passed over and listed as missing', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk, clock } = useDesk(t);
  clock.now = '2026-01-08T09:00:00.000Z';
  must(addMark(desk, root.id, alpha.baseCommit));
  clock.now = '2026-01-09T09:00:00.000Z';
  must(addMark(desk, root.id, GONE));
  must(addMark(desk, root.id, 'not a sha\n--all'));

  const earlier = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(earlier.baseline, alpha.baseCommit);
  assert.equal(earlier.source, 'reviewed-mark');
  assert.deepEqual(
    earlier.missing.map((entry) => entry.commit),
    ['not a sha\n--all', GONE],
  );
  assert.notEqual(earlier.notice, null);

  const points = must(await listBaselinePoints({ runner, desk, root }));
  const marks = points.points.filter((point) => point.kind === 'reviewed-mark');
  assert.deepEqual(
    marks.map((point) => [point.commit, point.commitMissing === true]),
    [
      [GONE, true],
      ['not a sha\n--all', true],
      [alpha.baseCommit, false],
    ],
  );

  // Only marks whose commit is gone, and no first-seen record: the present commit is recorded.
  const other = useDesk(t);
  must(addMark(other.desk, root.id, GONE));
  const recorded = must(await defaultBaselineOf({ runner, desk: other.desk, root }));
  assert.equal(recorded.source, 'first-seen');
  assert.equal(recorded.baseline, alpha.headCommit);
  assert.equal(recorded.firstSeenRecorded, true);
  assert.equal(recorded.missing.length, 1);
});

test('a repository with no commit has HEAD as its baseline, records nothing and cannot be marked', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('notes.md', 'not committed\n');
  const root = repositoryRoot('empty', repo.dir);
  const { desk } = useDesk(t);

  const baseline = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(baseline.baseline, 'HEAD');
  assert.equal(baseline.source, 'head');
  assert.equal(baseline.firstSeenRecorded, false);
  assert.deepEqual(must(listFirstSeen(desk)), []);
  assert.deepEqual(sorted(await changesAgainst(root, baseline.baseline)), ['??||notes.md']);
  assert.equal(baseline.notice !== null, true);

  assert.equal(failureOf(await markRootReviewed({ runner, desk, root })).kind, 'no-commits');
  assert.deepEqual(must(listMarks(desk)), []);

  const points = must(await listBaselinePoints({ runner, desk, root }));
  assert.equal(points.head, null);
  assert.deepEqual(points.points, []);

  // The first-seen record is written once there is a commit.
  const first = await repo.commitAll('First', { date: '2026-01-05T10:00:00Z' });
  const afterCommit = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(afterCommit.baseline, first);
  assert.equal(afterCommit.firstSeenRecorded, true);
});

test('a root with no change tracking has no baseline, and nothing is written for it', async (t) => {
  const fixture = await useSpace(t, []);
  const workbench = await rootOf(fixture, 'workbench');
  assert.equal(workbench.tracking.tracked, false);
  const { desk } = useDesk(t);

  for (const result of [
    await defaultBaselineOf({ runner, desk, root: workbench }),
    await markRootReviewed({ runner, desk, root: workbench }),
    await listBaselinePoints({ runner, desk, root: workbench }),
  ]) {
    const failure = failureOf(result);
    assert.equal(failure.kind, 'root-untracked');
    assert.equal(failure.cause, 'git-ignored');
  }
  assert.deepEqual(must(listFirstSeen(desk)), []);
  assert.deepEqual(must(listMarks(desk)), []);

  const plain = useTempDir(t, 'ai-lore-baseline-plain-');
  const noRepository = repositoryRoot('plain', plain);
  assert.equal(
    failureOf(await defaultBaselineOf({ runner, desk, root: noRepository })).kind,
    'not-a-repository',
  );
  const missing = repositoryRoot('missing', join(plain, 'nothing-here'));
  assert.equal(
    failureOf(await markRootReviewed({ runner, desk, root: missing })).kind,
    'folder-missing',
  );
  assert.deepEqual(must(listFirstSeen(desk)), []);
});

test('a root that is a folder of the Space repository has the commits of that repository and no pull requests', async (t) => {
  const fixture = await useSpace(t, []);
  const lore = await rootOf(fixture, 'lore');
  assert.ok(lore.tracking.tracked && lore.tracking.subPath !== '');
  const { desk } = useDesk(t);
  fixture.space.write('outside-the-lore.md', 'a file beside the Lore\n');
  const outside = await fixture.space.commitAll('Outside the Lore', {
    date: '2026-01-09T10:00:00Z',
  });
  let asked = 0;
  const source: MergedPullRequestSource = () => {
    asked += 1;
    return Promise.resolve({ ok: true, value: [] });
  };

  const points = must(
    await listBaselinePoints({
      runner,
      desk,
      root: lore,
      pullRequests: { source, repository: 'fixture-owner/fixture-space' },
    }),
  );
  assert.deepEqual(points.mergedPullRequests, { status: 'not-applicable' });
  assert.equal(asked, 0);
  assert.deepEqual(summary(points), [
    `commit ${outside.slice(0, 7)}`,
    `commit ${fixture.head.slice(0, 7)}`,
  ]);

  const marked = must(await markRootReviewed({ runner, desk, root: lore }));
  assert.equal(marked.baseline, outside);
  assert.deepEqual(await changesAgainst(lore, marked.baseline), []);
});

test('the commit list is cut at the limit and says so', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk } = useDesk(t);

  const one = must(await listBaselinePoints({ runner, desk, root, commitLimit: 1 }));
  assert.deepEqual(summary(one), [`commit ${alpha.headCommit.slice(0, 7)}`]);
  assert.equal(one.limits.commits, 1);
  assert.equal(one.limits.commitsTruncated, true);

  const defaults = must(await listBaselinePoints({ runner, desk, root }));
  assert.deepEqual(
    [defaults.limits.commits, defaults.limits.records, defaults.limits.pullRequests],
    [200, 200, 50],
  );
});

test('on a desk another instance owns, the present commit is the baseline and is not recorded', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const owner = useDesk(t);
  const reader = owner.open({ pid: process.pid + 1, startedAt: '2026-01-10T09:00:00.000Z' });
  assert.equal(reader.writable, false);

  const baseline = must(await defaultBaselineOf({ runner, desk: reader, root }));
  assert.equal(baseline.baseline, alpha.headCommit);
  assert.equal(baseline.source, 'head');
  assert.equal(baseline.firstSeenRecorded, false);
  assert.notEqual(baseline.notice, null);
  assert.deepEqual(must(listFirstSeen(owner.desk)), []);

  const refused = failureOf(await markRootReviewed({ runner, desk: reader, root }));
  assert.equal(refused.kind, 'desk-failed');
  assert.equal(refused.cause, 'not-writable');
});

test('of several callers that ask for the default baseline at once, one writes the first-seen record', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const root = await rootOf(fixture, 'repo:alpha');
  const { desk } = useDesk(t);

  const answers = await Promise.all(
    [1, 2, 3, 4].map(() => defaultBaselineOf({ runner, desk, root })),
  );
  const baselines = answers.map((answer) => must(answer));
  assert.deepEqual(
    baselines.map((baseline) => [baseline.baseline, baseline.source]),
    baselines.map(() => [alpha.headCommit, 'first-seen']),
  );
  assert.equal(baselines.filter((baseline) => baseline.firstSeenRecorded).length, 1);
  assert.equal(must(listFirstSeen(desk)).length, 1);
});

test('a commit written long before it was committed is grouped by the date it was committed', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('a.txt', 'one\n');
  await repo.commitAll('Base', { date: '2020-01-01T00:00:00Z' });
  const root = repositoryRoot('plain', repo.dir);
  const { desk, clock } = useDesk(t);

  // The session runs around the present moment, which is when git commits below.
  const present = Date.now();
  clock.now = new Date(present - 60_000).toISOString();
  must(startSession(desk, { id: 's1', engine: 'claude-code' }));
  repo.write('a.txt', 'two\n');
  await repo.git('add', '-A');
  await repo.git('commit', '-m', 'Written in 2020', '--date', '2020-06-01T00:00:00Z');
  const head = await repo.git('rev-parse', 'HEAD');
  clock.now = new Date(present + 60_000).toISOString();
  must(recordSessionClose(desk, { rootId: root.id, commit: head, sessionId: 's1' }));

  const points = must(await listBaselinePoints({ runner, desk, root }));
  const commit = points.points.find((point) => point.commit === head && point.kind === 'commit');
  assert.ok(commit && commit.kind === 'commit');
  assert.equal(commit.sessionId, 's1', 'the committer date is inside the session');
  assert.ok(
    Date.parse(commit.at) >= present - 2000,
    'at is the committer date, not the author date',
  );
  const base = points.points.at(-1);
  assert.ok(base && base.kind === 'commit');
  assert.equal(base.sessionId, undefined);
});

test('the commits a session leaves are read from the roots it holds and become session closes', async (t) => {
  const fixture = await useSpace(t);
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const roots = must(await resolveRoots({ spaceRoot: fixture.root, runner }));
  const { desk, clock } = useDesk(t);
  must(startSession(desk, { id: 's1', engine: 'claude-code' }));
  must(startSession(desk, { id: 's2', engine: 'claude-code' }));
  must(
    addClaims(desk, 's1', [
      { kind: 'repository', name: 'alpha', branch: 'main' },
      { kind: 'lore' },
    ]),
  );
  must(addClaims(desk, 's2', [{ kind: 'publish-area', name: 'not-in-this-space' }]));
  must(updateSession(desk, 's1', { mode: 'writing' }));

  const read = must(await readSessionCloseCommits({ runner, desk, roots, sessionId: 's1' }));
  assert.deepEqual(read, {
    closes: [
      { rootId: 'repo:alpha', commit: alpha.headCommit },
      { rootId: 'lore', commit: fixture.head },
    ],
    skipped: [],
  });
  const other = must(await readSessionCloseCommits({ runner, desk, roots, sessionId: 's2' }));
  assert.deepEqual(other.closes, []);
  assert.deepEqual(
    other.skipped.map((entry) => entry.rootId),
    ['publish:not-in-this-space'],
  );
  assert.deepEqual(
    must(await readSessionCloseCommits({ runner, desk, roots, sessionId: 'nobody' })),
    { closes: [], skipped: [] },
  );

  clock.now = '2026-01-10T18:00:00.000Z';
  const left = must(leaveWriting(desk, 's1', { closes: read.closes }));
  assert.equal(left.closes.length, 2);
  const root = await rootOf(fixture, 'repo:alpha');
  const points = must(await listBaselinePoints({ runner, desk, root }));
  assert.deepEqual(points.points[0], {
    kind: 'session-close',
    commit: alpha.headCommit,
    at: '2026-01-10T18:00:00.000Z',
    sessionId: 's1',
  });
});
