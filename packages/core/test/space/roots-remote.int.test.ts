import { strict as assert } from 'node:assert';
import { type TestContext, test } from 'node:test';
import { execFileRunner, readRepositoryStateIn } from '../../src/index.js';
import type { TempGitRepo } from '../../src/space/testing/index.js';
import { useBareRemote, useClone, usePlainRepository } from '../support/git.js';
import { useTempDir } from '../support/temp.js';

// Stage D1, phase D1.1: `readRepositoryStateIn` against real repositories,
// one per case of the architecture document's section 4 table. The companion
// never fetches to answer these; every fetch below is the test itself
// standing in for a terminal, to build the state a row must read honestly.

/** The `# branch.ab +<ahead> -<behind>` line of `git status --porcelain=v2 --branch`, read independently of `rev-list`. */
async function branchAb(repo: TempGitRepo): Promise<{ ahead: number; behind: number } | null> {
  const output = await repo.git('status', '--porcelain=v2', '--branch');
  const line = output.split('\n').find((entry) => entry.startsWith('# branch.ab'));
  if (line === undefined) return null;
  const match = /\+(\d+) -(\d+)/.exec(line);
  if (match === null) return null;
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

/** A bare remote with one commit (`base.txt`) on `main`, pushed from a throwaway clone. */
async function seededRemote(t: TestContext): Promise<TempGitRepo> {
  const remote = await useBareRemote(t);
  const seed = await useClone(t, remote.dir);
  seed.write('base.txt', 'base\n');
  await seed.commitAll('base commit');
  await seed.git('push', '-u', 'origin', 'main');
  return remote;
}

test('on a branch with a tracking branch that is in the repository, ahead and behind are the two counts', async (t) => {
  const remote = await seededRemote(t);
  const clone = await useClone(t, remote.dir);
  clone.write('base.txt', 'ahead only\n');
  await clone.commitAll('a local commit, never pushed');

  const result = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'branch');
  assert.equal(result.value.remote.unknown, null);
  assert.equal(result.value.remote.ahead, 1);
  assert.equal(result.value.remote.behind, 0);
  assert.equal(result.value.remote.remote, 'origin');
  assert.equal(result.value.remote.upstream, 'origin/main');
  // A fresh clone has no FETCH_HEAD (section 2, fact 6): the age of the
  // knowledge is not known, never zero and never "just now".
  assert.equal(result.value.remote.lastFetchAt, null);

  const ab = await branchAb(clone);
  assert.deepEqual(ab, { ahead: result.value.remote.ahead, behind: result.value.remote.behind });
});

test('ahead and behind both move after a push elsewhere and a fetch here, and lastFetchAt is then set', async (t) => {
  const remote = await seededRemote(t);
  const clone = await useClone(t, remote.dir);
  clone.write('base.txt', 'ahead by one\n');
  await clone.commitAll('a local commit, never pushed');

  const before = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(before.ok, true);
  if (before.ok) assert.equal(before.value.remote.lastFetchAt, null);

  const other = await useClone(t, remote.dir);
  other.write('base.txt', 'pushed by another desk\n');
  await other.commitAll('pushed elsewhere');
  await other.git('push', 'origin', 'main');

  await clone.git('fetch', 'origin');

  const after = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(after.ok, true);
  if (!after.ok) return;
  assert.equal(after.value.remote.unknown, null);
  assert.equal(after.value.remote.ahead, 1);
  assert.equal(after.value.remote.behind, 1);
  assert.notEqual(after.value.remote.lastFetchAt, null);
  assert.ok(!Number.isNaN(Date.parse(after.value.remote.lastFetchAt ?? '')));

  const ab = await branchAb(clone);
  assert.deepEqual(ab, { ahead: 1, behind: 1 });
});

test('on a branch with no tracking branch, in a repository that has a remote, gives no-upstream', async (t) => {
  const remote = await useBareRemote(t);
  const repo = await usePlainRepository(t);
  await repo.git('remote', 'add', 'origin', remote.dir);
  await repo.git('checkout', '-b', 'solo');

  const result = await readRepositoryStateIn(execFileRunner, repo.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'branch');
  if (result.value.head.kind === 'branch') assert.equal(result.value.head.branch, 'solo');
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'no-upstream');
  assert.match(
    result.value.remote.unknown?.message ?? '',
    /the branch solo has no tracking branch/,
  );
});

test('on a branch, with no remote at all, gives no-remote', async (t) => {
  const repo = await usePlainRepository(t);

  const result = await readRepositoryStateIn(execFileRunner, repo.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'no-remote');
  assert.match(result.value.remote.unknown?.message ?? '', /this repository has no remote/);
});

test('a tracking branch configured but deleted from the repository gives upstream-missing', async (t) => {
  const remote = await seededRemote(t);
  const clone = await useClone(t, remote.dir);
  await clone.git('update-ref', '-d', 'refs/remotes/origin/main');

  const result = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'upstream-missing');
  assert.match(
    result.value.remote.unknown?.message ?? '',
    /the tracking branch origin\/main is not in this repository/,
  );
  // %(upstream) is read from the branch's own configuration (section 2, fact
  // 2), so it survives the tracking ref itself being gone.
  assert.equal(result.value.remote.upstream, 'origin/main');
});

test('a detached HEAD gives detached-head, with no further command run', async (t) => {
  const remote = await seededRemote(t);
  const clone = await useClone(t, remote.dir);
  const head = await clone.git('rev-parse', 'HEAD');
  await clone.git('checkout', head);

  const result = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'detached');
  if (result.value.head.kind === 'detached') {
    assert.equal(result.value.head.commit, head);
    assert.equal(result.value.head.rebasing, null);
  }
  assert.equal(result.value.operation, null);
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'detached-head');
  assert.match(result.value.remote.unknown?.message ?? '', /this repository is not on a branch/);
});

test('a fresh clone of an empty bare remote gives an unborn branch', async (t) => {
  const remote = await useBareRemote(t);
  const clone = await useClone(t, remote.dir);

  const result = await readRepositoryStateIn(execFileRunner, clone.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'unborn-branch');
  if (result.value.head.kind === 'unborn-branch') assert.equal(result.value.head.branch, 'main');
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'unborn-branch');
  assert.match(result.value.remote.unknown?.message ?? '', /the branch main has no commit yet/);
});

test('a repository left mid-merge still answers the counts and reports operation merge', async (t) => {
  const remote = await seededRemote(t);
  const work = await useClone(t, remote.dir);
  work.write('base.txt', 'main change\n');
  await work.commitAll('main change, ahead by one');
  await work.git('branch', 'feature', 'HEAD~1');
  await work.git('checkout', 'feature');
  work.write('base.txt', 'feature change\n');
  await work.commitAll('feature change');
  await work.git('checkout', 'main');
  try {
    // `-m` is passed so that a merge that turned out not to conflict would
    // not stop to open an editor; the content above is built to conflict.
    await work.git('merge', '-m', 'test merge', 'feature');
  } catch {
    // A conflicting merge exits non-zero; MERGE_HEAD is what this test is after.
  }

  const result = await readRepositoryStateIn(execFileRunner, work.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'branch');
  if (result.value.head.kind === 'branch') assert.equal(result.value.head.branch, 'main');
  assert.equal(result.value.operation, 'merge');
  assert.equal(result.value.remote.unknown, null);
  assert.equal(result.value.remote.ahead, 1);
  assert.equal(result.value.remote.behind, 0);

  const ab = await branchAb(work);
  assert.deepEqual(ab, { ahead: 1, behind: 0 });
});

test('a repository left mid-rebase reports operation rebase, a detached HEAD and the branch being rebased', async (t) => {
  const remote = await seededRemote(t);
  const work = await useClone(t, remote.dir);
  work.write('base.txt', 'main change one\n');
  await work.commitAll('main change one');
  await work.git('checkout', '-b', 'br1');
  work.write('base.txt', 'br1 change\n');
  await work.commitAll('br1 change');
  await work.git('checkout', 'main');
  work.write('base.txt', 'main change two, conflicting\n');
  await work.commitAll('main change two');
  await work.git('checkout', 'br1');
  try {
    await work.git('rebase', 'main');
  } catch {
    // A conflicting rebase exits non-zero and leaves .git/rebase-merge, which this test reads.
  }

  const result = await readRepositoryStateIn(execFileRunner, work.dir);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'detached');
  if (result.value.head.kind === 'detached') assert.equal(result.value.head.rebasing, 'br1');
  assert.equal(result.value.operation, 'rebase');
  assert.equal(result.value.remote.ahead, null);
  assert.equal(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'detached-head');
});

test('a repository with no folder at all fails whole, with folder-missing', async (t) => {
  const dir = useTempDir(t);

  const result = await readRepositoryStateIn(execFileRunner, `${dir}/does-not-exist`);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'folder-missing');
  assert.match(result.error.message, /There is no folder at/);
});

test('a folder that is not a git repository fails whole, with not-a-repository', async (t) => {
  const dir = useTempDir(t);

  const result = await readRepositoryStateIn(execFileRunner, dir);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'not-a-repository');
  assert.match(result.error.message, /is not a git repository/);
});
