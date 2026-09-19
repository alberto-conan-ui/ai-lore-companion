import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type CommandRunner,
  GIT_CLONE_TIMEOUT_MS,
  GIT_NETWORK_ENV,
  GIT_PUSH_TIMEOUT_MS,
  type RunOptions,
  createGitPort,
  execFileRunner,
  runGit,
} from '../../src/index.js';
import { createScriptedRunner, openTempGitRepo } from '../../src/space/testing/index.js';
import { useBareRemote, usePlainRepository } from '../support/git.js';
import { useTempDir } from '../support/temp.js';

/** Wrap a runner and record every call, forwarding to it unchanged. */
function recordingRunner(inner: CommandRunner): CommandRunner & {
  calls: { args: readonly string[]; opts: RunOptions }[];
} {
  const calls: { args: readonly string[]; opts: RunOptions }[] = [];
  return {
    calls,
    run(bin, args, opts = {}) {
      calls.push({ args, opts });
      return inner.run(bin, args, opts);
    },
  };
}

const git = createGitPort(execFileRunner);

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

test('isRepository and topLevel tell a repository from a plain folder', async (t) => {
  const plain = useTempDir(t);
  const repo = await usePlainRepository(t);
  repo.write('sub/file.md', 'x');

  assert.deepEqual(await git.isRepository(plain), { ok: true, value: false });
  assert.deepEqual(await git.topLevel(plain), { ok: true, value: null });
  assert.deepEqual(await git.isRepository(repo.dir), { ok: true, value: true });
  assert.deepEqual(await git.topLevel(join(repo.dir, 'sub')), { ok: true, value: repo.dir });

  const missing = await git.isRepository(join(plain, 'not-there'));
  assert.equal(missing.ok, false);
});

test('init creates the folder and a repository on main; head reports no-commits until the first commit', async (t) => {
  const dir = join(useTempDir(t), 'nested', 'repo');
  unwrap(await git.init(dir));
  assert.equal(existsSync(join(dir, '.git')), true);
  assert.deepEqual(await git.currentBranch(dir), {
    ok: true,
    value: { branch: 'main', detached: false },
  });
  const head = await git.head(dir);
  assert.equal(head.ok, false);
  if (!head.ok) assert.equal(head.error.kind, 'no-commits');
});

test('init takes another first branch and can make a bare repository', async (t) => {
  const root = useTempDir(t);
  unwrap(await git.init(join(root, 'a'), { initialBranch: 'trunk' }));
  assert.deepEqual(unwrap(await git.currentBranch(join(root, 'a'))), {
    branch: 'trunk',
    detached: false,
  });
  unwrap(await git.init(join(root, 'b.git'), { bare: true }));
  assert.equal(existsSync(join(root, 'b.git', 'HEAD')), true);
  assert.deepEqual(await git.isRepository(join(root, 'b.git')), { ok: true, value: true });
  assert.deepEqual(await git.topLevel(join(root, 'b.git')), { ok: true, value: null });
});

test('setConfig, addAll and commit make a commit whose message came on standard input', async (t) => {
  const dir = join(useTempDir(t), 'repo');
  unwrap(await git.init(dir));
  unwrap(await git.setConfig(dir, 'user.name', 'Port Test'));
  unwrap(await git.setConfig(dir, 'user.email', 'port@ai-lore.invalid'));
  unwrap(await git.setConfig(dir, 'commit.gpgsign', 'false'));
  const repo = openTempGitRepo(dir);
  repo.write('a.md', 'a');

  assert.deepEqual(await git.isClean(dir), { ok: true, value: false });
  unwrap(await git.addAll(dir));
  const message = '-m looks like an option\n\nSecond paragraph with "quotes" and $(subshell).';
  const sha = unwrap(await git.commit(dir, message));
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(unwrap(await git.head(dir)), sha);
  assert.deepEqual(await git.isClean(dir), { ok: true, value: true });
  assert.equal(await repo.git('log', '-1', '--format=%B'), message);
  assert.equal(await repo.git('log', '-1', '--format=%an'), 'Port Test');
});

test('commit with nothing staged fails with command-failed, and allowEmpty makes it pass', async (t) => {
  const repo = await usePlainRepository(t);
  const nothing = await git.commit(repo.dir, 'nothing');
  assert.equal(nothing.ok, false);
  if (!nothing.ok) assert.equal(nothing.error.kind, 'command-failed');
  const empty = unwrap(await git.commit(repo.dir, 'empty', { allowEmpty: true }));
  assert.notEqual(empty, repo.head);
});

test('currentBranch follows a switch and reports a detached HEAD', async (t) => {
  const repo = await usePlainRepository(t);
  await repo.git('checkout', '--quiet', '-b', 'feature/x');
  assert.deepEqual(unwrap(await git.currentBranch(repo.dir)), {
    branch: 'feature/x',
    detached: false,
  });
  await repo.git('checkout', '--quiet', repo.head);
  assert.deepEqual(unwrap(await git.currentBranch(repo.dir)), { branch: '', detached: true });
  const notRepo = await git.currentBranch(useTempDir(t));
  assert.equal(notRepo.ok, false);
});

test('isClean counts an untracked file as a change', async (t) => {
  const repo = await usePlainRepository(t);
  assert.deepEqual(await git.isClean(repo.dir), { ok: true, value: true });
  repo.write('untracked.md', 'u');
  assert.deepEqual(await git.isClean(repo.dir), { ok: true, value: false });
});

test('read commands do not rewrite the index file', async (t) => {
  const repo = await usePlainRepository(t);
  // Make the index stat-dirty: same content, new timestamp. A plain `git status` would refresh it.
  repo.write('README.md', readFileSync(join(repo.dir, 'README.md'), 'utf8'));
  const index = join(repo.dir, '.git', 'index');
  const before = statSync(index).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  unwrap(await git.isClean(repo.dir));
  unwrap(await git.head(repo.dir));
  unwrap(await git.currentBranch(repo.dir));
  unwrap(await git.logForPath(repo.dir, 'README.md'));
  assert.equal(statSync(index).mtimeMs, before);
});

test('addRemote, originUrl, push and clone work against a bare remote in the temporary folder', async (t) => {
  const remote = await useBareRemote(t);
  const repo = await usePlainRepository(t);

  assert.deepEqual(await git.originUrl(repo.dir), { ok: true, value: null });
  unwrap(await git.addRemote(repo.dir, 'origin', remote.dir));
  assert.deepEqual(await git.originUrl(repo.dir), { ok: true, value: remote.dir });
  assert.deepEqual(await git.originUrl(repo.dir, 'backup'), { ok: true, value: null });

  unwrap(await git.push(repo.dir, { setUpstream: true }));
  assert.equal(await remote.git('rev-parse', 'refs/heads/main'), repo.head);
  assert.equal(await repo.git('rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');

  const into = join(useTempDir(t), 'deep', 'clone');
  unwrap(await git.clone(remote.dir, into));
  assert.equal(unwrap(await git.head(into)), repo.head);
  assert.equal(unwrap(await git.originUrl(into)), remote.dir);

  const bare = join(useTempDir(t), 'mirror.git');
  unwrap(await git.clone(remote.dir, bare, { bare: true, branch: 'main' }));
  assert.equal(existsSync(join(bare, 'HEAD')), true);
});

test('clone and push pass GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never and their time limits to the runner', async (t) => {
  const remote = await useBareRemote(t);
  const repo = await usePlainRepository(t);
  const recorder = recordingRunner(execFileRunner);
  const recordingGit = createGitPort(recorder);

  const into = join(useTempDir(t), 'clone');
  unwrap(await recordingGit.clone(remote.dir, into));
  unwrap(await recordingGit.addRemote(repo.dir, 'origin', remote.dir));
  unwrap(await recordingGit.push(repo.dir, { setUpstream: true }));

  const clone = recorder.calls.find((call) => call.args[0] === 'clone');
  const push = recorder.calls.find((call) => call.args[0] === 'push');
  assert.deepEqual(clone?.opts.env, { ...GIT_NETWORK_ENV });
  assert.equal(clone?.opts.timeoutMs, GIT_CLONE_TIMEOUT_MS);
  assert.deepEqual(push?.opts.env, { ...GIT_NETWORK_ENV });
  assert.equal(push?.opts.timeoutMs, GIT_PUSH_TIMEOUT_MS);

  const remoteConfig = recorder.calls.find((call) => call.args[0] === 'remote');
  assert.equal(
    remoteConfig?.opts.env,
    undefined,
    'a command that is not clone or push gets no env',
  );
});

test('push names a branch, and fails from a detached HEAD with no branch given', async (t) => {
  const remote = await useBareRemote(t);
  const repo = await usePlainRepository(t);
  unwrap(await git.addRemote(repo.dir, 'origin', remote.dir));
  await repo.git('branch', 'side');
  unwrap(await git.push(repo.dir, { branch: 'side' }));
  assert.equal(await remote.git('rev-parse', 'refs/heads/side'), repo.head);

  await repo.git('checkout', '--quiet', repo.head);
  const detached = await git.push(repo.dir);
  assert.equal(detached.ok, false);
  if (!detached.ok) assert.equal(detached.error.kind, 'invalid-argument');
});

test('a clone or push to a network address is refused by the guard and reaches nothing', async (t) => {
  const repo = await usePlainRepository(t);
  const clone = await git.clone('https://github.com/owner/repo.git', join(useTempDir(t), 'c'));
  assert.equal(clone.ok, false);
  if (!clone.ok) assert.equal(clone.error.kind, 'command-refused');

  const added = await git.addRemote(repo.dir, 'origin', 'https://github.com/owner/repo.git');
  assert.equal(added.ok, false);
  if (!added.ok) assert.equal(added.error.kind, 'command-refused');

  // Stored as plain configuration the address gets in; using it is what is refused.
  unwrap(await git.setConfig(repo.dir, 'remote.origin.url', 'https://github.com/owner/repo.git'));
  const push = await git.push(repo.dir);
  assert.equal(push.ok, false);
  if (!push.ok) assert.equal(push.error.kind, 'command-refused');
});

test('logForPath lists the commits that touched a path, newest first, with limit and since', async (t) => {
  const repo = await usePlainRepository(t);
  repo.write('docs/a.md', '1');
  const first = await repo.commitAll('Add a', { date: '2026-01-01T10:00:00Z' });
  repo.write('other.md', 'o');
  await repo.commitAll('Add other', { date: '2026-01-02T10:00:00Z' });
  repo.write('docs/a.md', '2');
  const third = await repo.commitAll('Change a; with | odd \t characters', {
    date: '2026-01-03T10:00:00Z',
  });

  const log = unwrap(await git.logForPath(repo.dir, 'docs/a.md'));
  assert.deepEqual(log, [
    {
      sha: third,
      subject: 'Change a; with | odd \t characters',
      timestamp: 1767434400,
      author: 'AI-Lore Test',
    },
    { sha: first, subject: 'Add a', timestamp: 1767261600, author: 'AI-Lore Test' },
  ]);
  assert.deepEqual(
    unwrap(await git.logForPath(repo.dir, 'docs/a.md', { limit: 1 })).map((e) => e.sha),
    [third],
  );
  assert.deepEqual(
    unwrap(await git.logForPath(repo.dir, 'docs', { since: first })).map((e) => e.sha),
    [third],
  );
  assert.deepEqual(unwrap(await git.logForPath(repo.dir, 'never-there.md')), []);
  // A path that looks like an option is still a path, because it follows `--`.
  assert.deepEqual(unwrap(await git.logForPath(repo.dir, '--all')), []);
});

test('mergeBase gives the common ancestor, and null for unrelated histories', async (t) => {
  const repo = await usePlainRepository(t);
  await repo.git('checkout', '--quiet', '-b', 'side');
  repo.write('side.md', 's');
  const side = await repo.commitAll('Side');
  await repo.git('checkout', '--quiet', 'main');
  repo.write('main.md', 'm');
  const main = await repo.commitAll('Main');
  assert.deepEqual(await git.mergeBase(repo.dir, main, side), { ok: true, value: repo.head });
  assert.deepEqual(await git.mergeBase(repo.dir, 'main', 'side'), { ok: true, value: repo.head });

  await repo.git('checkout', '--quiet', '--orphan', 'island');
  const island = await repo.commitAll('Island');
  assert.deepEqual(await git.mergeBase(repo.dir, main, island), { ok: true, value: null });

  const unknown = await git.mergeBase(repo.dir, main, 'f'.repeat(40));
  assert.equal(unknown.ok, false);
});

test('isValidBranchName follows git check-ref-format', async (t) => {
  const dir = useTempDir(t);
  assert.deepEqual(await git.isValidBranchName('feature/12-new-thing', dir), {
    ok: true,
    value: true,
  });
  for (const bad of ['', '-x', 'a..b', 'a b', 'a~1', 'x.lock', '@{-1}x:']) {
    assert.deepEqual(await git.isValidBranchName(bad, dir), { ok: true, value: false }, bad);
  }
});

test('a value that git would read as an option is refused before git runs', async (t) => {
  const runner = createScriptedRunner();
  const scripted = createGitPort(runner);
  const dir = useTempDir(t);
  const results = [
    await scripted.clone('--upload-pack=evil', join(dir, 'c')),
    await scripted.clone(join(dir, 'r'), '-o'),
    await scripted.clone(join(dir, 'r'), join(dir, 'c'), { branch: '--x' }),
    await scripted.init(join(dir, 'i'), { initialBranch: '-b' }),
    await scripted.addRemote(dir, '-f', 'x'),
    await scripted.addRemote(dir, 'origin', '--mirror=push'),
    await scripted.setConfig(dir, '--global', 'x'),
    await scripted.push(dir, { remote: '--all', branch: 'main' }),
    await scripted.push(dir, { branch: '--delete' }),
    await scripted.mergeBase(dir, '--all', 'main'),
    await scripted.logForPath(dir, 'a.md', { since: '--output=/tmp/x' }),
    await scripted.originUrl(dir, 'a b'),
  ];
  for (const r of results) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'invalid-argument');
  }
  assert.deepEqual(runner.calls, []);
});

test('the port builds argument arrays: read commands carry --no-optional-locks and outside values follow --', async (t) => {
  const dir = useTempDir(t);
  const runner = createScriptedRunner([{ bin: 'git' }]);
  const scripted = createGitPort(runner);
  await scripted.isClean(dir);
  await scripted.logForPath(dir, 'some path.md', { limit: 5 });
  await scripted.addAll(dir);
  await scripted.push(dir, { remote: 'origin', branch: 'main' });
  await scripted.clone('/tmp/a b/remote.git', join(dir, 'into'));

  const [status, log, add, push, clone] = runner.calls;
  assert.deepEqual(status?.args, ['--no-optional-locks', 'status', '--porcelain']);
  assert.equal(status?.opts.cwd, dir);
  assert.deepEqual(log?.args.slice(0, 2), ['--no-optional-locks', 'log']);
  assert.deepEqual(log?.args.slice(-4), ['--max-count', '5', '--', 'some path.md']);
  assert.deepEqual(add?.args, ['add', '--all']);
  assert.deepEqual(push?.args, ['push', '--quiet', '--', 'origin', 'main']);
  assert.deepEqual(clone?.args, [
    'clone',
    '--quiet',
    '--',
    '/tmp/a b/remote.git',
    join(dir, 'into'),
  ]);
  assert.equal(clone?.opts.cwd, dir);
});

test('a git that is missing or fails gives a failure, not a wrong answer', async (t) => {
  const dir = useTempDir(t);
  const missing = createGitPort(
    createScriptedRunner([
      { bin: 'git', reply: { code: -1, stderr: 'git was not found', failure: 'not-found' } },
    ]),
  );
  for (const r of [
    await missing.isRepository(dir),
    await missing.topLevel(dir),
    await missing.head(dir),
    await missing.isClean(dir),
    await missing.isValidBranchName('main', dir),
    await missing.mergeBase(dir, 'a', 'b'),
  ]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'command-not-found');
  }
});

test('runGit runs any git command in a folder and returns the raw result', async (t) => {
  const repo = await usePlainRepository(t);
  const r = await runGit(execFileRunner, repo.dir, ['rev-parse', 'HEAD'], { readOnly: true });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), repo.head);
  const bad = await runGit(execFileRunner, repo.dir, ['rev-parse', '--verify', 'no-such-ref']);
  assert.notEqual(bad.code, 0);
});
