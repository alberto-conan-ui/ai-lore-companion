import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type MergedPullRequest, createGhCliGitHub, gitHubFailed } from '../../src/index.js';
import { type FakeGitHubState, createFakeGitHub } from '../../src/space/github/fake.js';
import { cloneTempRepo, createScriptedRunner } from '../../src/space/testing/index.js';
import { useTempDir } from '../support/temp.js';
import { gitHubPortContract } from './github-contract.js';
import { createSimulatedGh } from './github-simulated-gh.js';

gitHubPortContract('FakeGitHub', () => {
  const fake = createFakeGitHub({ account: 'fake-human' });
  return {
    port: fake,
    owner: 'fake-human',
    control: {
      setUnreachable: (on) => fake.setUnreachable(on),
      rateLimitNext: (count, seconds) => fake.rateLimitNext(count, seconds),
      loseNextAnswer: (error) => fake.loseNextAnswer(error),
      setViewsSupported: (on) => fake.setViewsSupported(on),
    },
    cleanup: () => fake.dispose(),
  };
});

// The same contract against the gh adapter. `gh` is a runner that answers from a
// `FakeGitHub` in the shapes of `github-samples.ts`; nothing reaches the network.
gitHubPortContract('GhCliGitHub over a simulated gh', () => {
  const fake = createFakeGitHub({ account: 'fake-human' });
  const gh = createSimulatedGh(fake);
  return {
    port: createGhCliGitHub(gh),
    owner: 'fake-human',
    control: gh,
    cleanup: () => fake.dispose(),
  };
});

function pull(number: number, mergedAt: string): MergedPullRequest {
  return {
    number,
    title: `Pull ${number}`,
    url: `https://github.com/fake-human/app/pull/${number}`,
    mergedAt,
    mergeCommit: null,
    headBranch: `branch-${number}`,
    baseBranch: 'main',
  };
}

test('FakeGitHub: a created repository is a bare repository that can be cloned and pushed to', async (t) => {
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  const created = await fake.createRepository({
    owner: 'fake-human',
    name: 'my-space',
    private: true,
  });
  assert.ok(created.ok);
  assert.ok(
    existsSync(join(created.value.cloneUrl, 'HEAD')),
    'the clone address is a bare repository',
  );

  const clone = await cloneTempRepo(created.value.cloneUrl);
  t.after(() => clone.cleanup());
  clone.write('README.md', '# My Space\n');
  const head = await clone.commitAll('First commit');
  await clone.git('push', 'origin', 'HEAD:main');

  const second = await cloneTempRepo(created.value.cloneUrl);
  t.after(() => second.cleanup());
  assert.equal(await second.git('rev-parse', 'HEAD'), head);

  const reposDir = fake.state().reposDir ?? '';
  fake.dispose();
  assert.equal(existsSync(reposDir), false, 'dispose removes the folder the fake made');
});

test('FakeGitHub: createRepository starts git through the runner it is given', async (t) => {
  const reposDir = useTempDir(t);
  const runner = createScriptedRunner([{ bin: 'git' }]);
  const fake = createFakeGitHub({ runner, reposDir });
  const created = await fake.createRepository({ owner: 'fake-human', name: 'x', private: false });
  const path = join(reposDir, 'fake-human', 'x.git');
  assert.deepEqual(runner.calls[0]?.args, ['init', '--bare', '--initial-branch=main', path]);
  assert.equal(runner.calls[0]?.opts.cwd, reposDir);
  assert.equal(created.ok && created.value.cloneUrl, path);

  const failing = createFakeGitHub({
    runner: createScriptedRunner([{ bin: 'git', reply: { code: 128, stderr: 'fatal: no' } }]),
    reposDir,
  });
  const result = await failing.createRepository({ owner: 'fake-human', name: 'y', private: false });
  assert.deepEqual(result, { ok: false, error: gitHubFailed('git init exited 128: fatal: no') });
  assert.equal((await failing.findRepository('fake-human/y')).ok, true);
  assert.deepEqual(failing.state().repositories, []);
});

test('FakeGitHub: a repository or a Project for an account that is not the signed-in one is not-found', async (t) => {
  const fake = createFakeGitHub({ organisations: ['fake-org'], reposDir: useTempDir(t) });
  const stranger = await fake.createRepository({ owner: 'stranger', name: 'x', private: true });
  assert.equal(!stranger.ok && stranger.error.kind, 'not-found');
  const project = await fake.createProject({ owner: 'stranger', title: 'x' });
  assert.equal(!project.ok && project.error.kind, 'not-found');
  assert.equal((await fake.createProject({ owner: 'fake-org', title: 'x' })).ok, true);
  const bad = await fake.createRepository({ owner: 'fake-org', name: 'a b', private: true });
  assert.equal(!bad.ok && bad.error.kind, 'failed');
});

test('FakeGitHub: the state file carries GitHub from one instance to the next', async (t) => {
  const dir = useTempDir(t);
  const stateFile = join(dir, 'github.json');
  const first = createFakeGitHub({ stateFile, reposDir: join(dir, 'repos') });
  const repository = await first.createRepository({
    owner: 'fake-human',
    name: 'my-space',
    private: true,
  });
  assert.ok(repository.ok);
  const issue = await first.createIssue({
    repository: 'fake-human/my-space',
    title: 'Kept',
    body: '<!-- ai-lore-test: kept -->',
    labels: [],
  });
  assert.ok(issue.ok);
  first.addMergedPullRequest('fake-human/my-space', pull(1, '2026-09-01T00:00:00Z'));
  const onDisk = JSON.parse(readFileSync(stateFile, 'utf8')) as FakeGitHubState;
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.issues.length, 1);

  const second = createFakeGitHub({ stateFile, account: 'ignored-when-the-file-exists' });
  assert.deepEqual(second.state(), first.state());
  const found = await second.findIssueByMarker({
    repository: 'fake-human/my-space',
    marker: '<!-- ai-lore-test: kept -->',
  });
  assert.deepEqual(found, { ok: true, value: issue.value });
  const next = await second.createIssue({
    repository: 'fake-human/my-space',
    title: 'Next',
    body: '',
    labels: [],
  });
  assert.equal(next.ok && next.value.number, 2);

  const copy = join(dir, 'copy.json');
  second.save(copy);
  assert.deepEqual(createFakeGitHub({ stateFile: copy }).state(), second.state());
  assert.throws(() =>
    createFakeGitHub({ stateFile: join(dir, 'repos', 'fake-human', 'my-space.git', 'HEAD') }),
  );
});

test('FakeGitHub: signed out is not-signed-in, and a token without the scope fails Project operations only', async (t) => {
  const fake = createFakeGitHub({ scopes: ['repo'], reposDir: useTempDir(t) });
  assert.deepEqual(await fake.auth(), {
    ok: true,
    value: { account: 'fake-human', scopes: ['repo'] },
  });
  assert.equal(
    (await fake.createRepository({ owner: 'fake-human', name: 'x', private: true })).ok,
    true,
  );
  const project = await fake.createProject({ owner: 'fake-human', title: 'x' });
  assert.deepEqual(!project.ok && [project.error.kind, project.error.message], [
    'missing-scope',
    'The gh token lacks the project scope. Run: gh auth refresh -s project',
  ]);

  fake.signOut();
  const auth = await fake.auth();
  assert.equal(!auth.ok && auth.error.kind, 'not-signed-in');
  const find = await fake.findRepository('fake-human/x');
  assert.equal(!find.ok && find.error.kind, 'not-signed-in');

  fake.signIn('second-human', ['repo', 'project']);
  assert.equal((await fake.createProject({ owner: 'second-human', title: 'x' })).ok, true);
});

test('FakeGitHub: failNext plans any error, and calls records every operation', async () => {
  const fake = createFakeGitHub();
  fake.failNext(gitHubFailed('planned'), 2);
  assert.deepEqual(await fake.auth(), { ok: false, error: gitHubFailed('planned') });
  assert.deepEqual(await fake.findProject({ owner: 'fake-human', title: 'x' }), {
    ok: false,
    error: gitHubFailed('planned'),
  });
  assert.equal((await fake.auth()).ok, true);
  assert.deepEqual(fake.calls, [
    { operation: 'auth', ok: false },
    { operation: 'findProject', ok: false },
    { operation: 'auth', ok: true },
  ]);
});

test('FakeGitHub: merged pull requests come newest first, up to the limit, per repository', async (t) => {
  const fake = createFakeGitHub({ reposDir: useTempDir(t) });
  await fake.createRepository({ owner: 'fake-human', name: 'app', private: true });
  await fake.createRepository({ owner: 'fake-human', name: 'other', private: true });
  fake.addMergedPullRequest('fake-human/app', pull(1, '2026-09-01T00:00:00Z'));
  fake.addMergedPullRequest('fake-human/app', pull(3, '2026-09-03T00:00:00Z'));
  fake.addMergedPullRequest('fake-human/app', pull(2, '2026-09-02T00:00:00Z'));
  fake.addMergedPullRequest('fake-human/other', pull(9, '2026-09-09T00:00:00Z'));
  const two = await fake.mergedPullRequests({ repository: 'fake-human/app', limit: 2 });
  assert.deepEqual(two.ok && two.value.map((entry) => entry.number), [3, 2]);
  const missing = await fake.mergedPullRequests({ repository: 'fake-human/nope', limit: 2 });
  assert.equal(!missing.ok && missing.error.kind, 'not-found');
});

test('FakeGitHub: a test can read an issue with its comments, branches and times', async (t) => {
  let clock = Date.parse('2026-09-18T10:00:00Z');
  const fake = createFakeGitHub({
    reposDir: useTempDir(t),
    now: () => {
      clock += 60_000;
      return new Date(clock);
    },
  });
  await fake.createRepository({ owner: 'fake-human', name: 'my-space', private: true });
  const created = await fake.createIssue({
    repository: 'fake-human/my-space',
    title: 'T',
    body: 'B',
    labels: [],
  });
  assert.ok(created.ok);
  await fake.comment({ issue: created.value, body: 'Handover' });
  await fake.developBranch({
    issue: created.value,
    branchRepository: 'fake-human/my-space',
    name: '1-t',
  });
  const refused = await fake.developBranch({
    issue: created.value,
    branchRepository: 'fake-human/my-space',
    name: '-x',
  });
  assert.equal(!refused.ok && refused.error.kind, 'failed');
  const issue = fake.issue(created.value);
  assert.deepEqual(issue?.comments, ['Handover']);
  assert.deepEqual(issue?.branches, [{ repository: 'fake-human/my-space', name: '1-t' }]);
  assert.equal(issue?.createdAt, '2026-09-18T10:01:00.000Z');
  assert.equal(issue?.updatedAt, '2026-09-18T10:02:00.000Z');
  assert.equal(fake.issue({ ...created.value, number: 5 }), null);

  const project = await fake.createProject({ owner: 'fake-human', title: 'P' });
  assert.ok(project.ok);
  const state = fake.state();
  assert.deepEqual(
    state.projects[0]?.fields.map((field) => field.name),
    ['Status'],
  );
  assert.deepEqual(
    state.projects[0]?.views.map((view) => view.name),
    ['View 1'],
  );
  const gone = await fake.readProject({ project: { ...project.value, id: 'PVT_gone' } });
  assert.equal(!gone.ok && gone.error.kind, 'not-found');
});

test('FakeGitHub: it can be made slow, and a lost answer leaves the issue in its state', async (t) => {
  const fake = createFakeGitHub({ reposDir: useTempDir(t) });
  await fake.createRepository({ owner: 'fake-human', name: 'my-space', private: true });
  fake.setDelay(60);
  const before = Date.now();
  const found = await fake.findRepository('fake-human/my-space');
  assert.ok(found.ok);
  assert.ok(Date.now() - before >= 50, 'the answer waited');
  fake.setDelay(0);

  fake.loseNextAnswer(gitHubFailed('the answer was lost'));
  // A read does not use up the lost answer; the next write does.
  assert.equal((await fake.findRepository('fake-human/my-space')).ok, true);
  const lost = await fake.createIssue({
    repository: 'fake-human/my-space',
    title: 'Made, and not answered',
    body: '',
    labels: [],
  });
  assert.deepEqual(lost, { ok: false, error: gitHubFailed('the answer was lost') });
  assert.deepEqual(
    fake.state().issues.map((issue) => issue.title),
    ['Made, and not answered'],
  );
  assert.deepEqual(fake.calls.at(-1), { operation: 'createIssue', ok: false });
  const next = await fake.createIssue({
    repository: 'fake-human/my-space',
    title: 'Answered',
    body: '',
    labels: [],
  });
  assert.equal(next.ok && next.value.number, 2);
});

test('FakeGitHub: a repository named .. is refused, so no folder is made outside the repositories folder', async (t) => {
  const reposDir = useTempDir(t);
  const fake = createFakeGitHub({ reposDir, organisations: ['..'] });
  for (const [owner, name] of [
    ['..', 'escaped'],
    ['fake-human', '..'],
    ['fake-human', '.'],
  ] as const) {
    const result = await fake.createRepository({ owner, name, private: true });
    assert.equal(!result.ok && result.error.kind, 'failed', `${owner}/${name}`);
  }
  assert.equal(existsSync(join(reposDir, '..', 'escaped.git')), false);
  assert.deepEqual(fake.state().repositories, []);
});
