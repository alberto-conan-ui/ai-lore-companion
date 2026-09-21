import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as coreBarrel from '../../src/index.js';
import {
  TEST_MODE_ENV,
  createGitPort,
  execFileRunner,
  isInsideLexically,
} from '../../src/index.js';
import * as testingEntry from '../../src/space/testing/index.js';
import {
  cloneTempRepo,
  configureTestIdentity,
  createScriptedRunner,
  enableTestMode,
  makeBareRemote,
  makePlainRepository,
  makeTempDir,
  makeTempGitRepo,
  openTempGitRepo,
} from '../../src/space/testing/index.js';
import {
  loreTemplateDir,
  repositoryRoot,
  runPython,
  useClone,
  useTempDir,
  useTempGitRepo,
} from '../support/index.js';

const git = createGitPort(execFileRunner);

// ---------- the package entry ----------

test('the main barrel of core carries no fixture builder; the package declares ./testing for them', () => {
  const barrelNames = new Set(Object.keys(coreBarrel));
  const leaked = Object.keys(testingEntry).filter((name) => barrelNames.has(name));
  assert.deepEqual(leaked, []);
  assert.equal(Object.keys(testingEntry).includes('makePlainRepository'), true);

  const manifest: unknown = JSON.parse(
    readFileSync(join(repositoryRoot(), 'packages', 'core', 'package.json'), 'utf8'),
  );
  const exportsMap = (manifest as { exports?: Record<string, { default?: string }> }).exports;
  assert.equal(exportsMap?.['./testing']?.default, './dist/space/testing/index.js');
});

// ---------- temporary folders ----------

test('makeTempDir creates a folder under the temporary folder, as a real path, and removes it', () => {
  const temp = makeTempDir('ai-lore-unit-');
  assert.equal(existsSync(temp.dir), true);
  assert.equal(temp.dir, realpathSync(temp.dir));
  assert.equal(isInsideLexically(realpathSync(tmpdir()), temp.dir), true);
  writeFileSync(join(temp.dir, 'a.txt'), 'a');
  temp.cleanup();
  assert.equal(existsSync(temp.dir), false);
  temp.cleanup();
});

test('enableTestMode sets AI_LORE_TEST, and the builders call it', () => {
  delete process.env[TEST_MODE_ENV];
  enableTestMode();
  assert.equal(process.env[TEST_MODE_ENV], '1');
  delete process.env[TEST_MODE_ENV];
  makeTempDir().cleanup();
  assert.equal(process.env[TEST_MODE_ENV], '1');
});

test('useTempDir removes its folder when the test ends', async (t) => {
  let seen = '';
  await t.test('inner', (inner) => {
    seen = useTempDir(inner);
    assert.equal(existsSync(seen), true);
  });
  assert.equal(existsSync(seen), false);
});

// ---------- the scripted runner ----------

test('the scripted runner answers by rule, in order, and records every call', async () => {
  const runner = createScriptedRunner([
    { bin: 'gh', args: ['auth', 'status'], reply: { code: 1, stderr: 'not logged in' }, times: 1 },
    { bin: 'gh', args: ['auth', 'status'], reply: { stdout: 'logged in' } },
  ]).on({
    bin: 'git',
    args: (args) => args.includes('status'),
    reply: (call) => ({ stdout: call.opts.cwd ?? '' }),
  });

  assert.deepEqual(await runner.run('gh', ['auth', 'status', '--hostname', 'github.com']), {
    code: 1,
    stdout: '',
    stderr: 'not logged in',
  });
  assert.deepEqual(await runner.run('gh', ['auth', 'status']), {
    code: 0,
    stdout: 'logged in',
    stderr: '',
  });
  assert.equal(
    (await runner.run('git', ['--no-optional-locks', 'status'], { cwd: '/x' })).stdout,
    '/x',
  );
  assert.deepEqual(
    runner.calls.map((c) => [c.bin, ...c.args]),
    [
      ['gh', 'auth', 'status', '--hostname', 'github.com'],
      ['gh', 'auth', 'status'],
      ['git', '--no-optional-locks', 'status'],
    ],
  );
});

test('the scripted runner rejects a command it has no rule for, and still records it', async () => {
  const runner = createScriptedRunner([{ bin: 'git', args: ['status'] }]);
  await assert.rejects(runner.run('git', ['push']), /no rule for git push/);
  await assert.rejects(runner.run('gh', ['api']), /no rule for gh api/);
  assert.equal(runner.calls.length, 2);
});

// ---------- temporary repositories ----------

test('makePlainRepository is a git repository with one commit and no Lore', async () => {
  const repo = await makePlainRepository();
  try {
    assert.equal(isInsideLexically(realpathSync(tmpdir()), repo.dir), true);
    assert.match(repo.head, /^[0-9a-f]{40}$/);
    assert.equal(await repo.git('rev-list', '--count', 'HEAD'), '1');
    assert.equal(await repo.git('ls-files'), 'README.md');
    assert.deepEqual(await git.isClean(repo.dir), { ok: true, value: true });
    assert.equal(existsSync(join(repo.dir, 'lore')), false);
    assert.equal(await repo.git('config', '--local', 'commit.gpgsign'), 'false');
    assert.equal(await repo.git('config', '--local', 'user.email'), 'test@ai-lore.invalid');
  } finally {
    repo.cleanup();
  }
  assert.equal(existsSync(repo.dir), false);
});

test('a temporary repository writes, removes and commits with a fixed date', async (t) => {
  const repo = await useTempGitRepo(t, { branch: 'trunk' });
  assert.equal(await repo.git('symbolic-ref', '--short', 'HEAD'), 'trunk');
  repo.write('docs/deep/a.md', 'a');
  repo.write('b.md', 'b');
  const first = await repo.commitAll('Add two', { date: '2026-02-03T04:05:06Z' });
  // `%cI` spells UTC as `Z` on newer git and as `+00:00` on older git.
  assert.match(
    await repo.git('log', '-1', '--format=%cI'),
    /^2026-02-03T04:05:06(Z|\+00:00)$/,
  );
  repo.remove('docs');
  const second = await repo.commitAll('Remove docs');
  assert.notEqual(first, second);
  assert.equal(await repo.git('ls-files'), 'b.md');
  assert.throws(() => repo.write('../escape.md', 'x'), /outside/);
  assert.throws(() => repo.remove('..'), /outside/);
  await assert.rejects(repo.git('rev-parse', '--verify', 'no-such-ref'), /fixture: git rev-parse/);
});

test('makeTempGitRepo can initialise inside a folder the caller owns, and then removes nothing', async (t) => {
  const root = useTempDir(t);
  const repo = await makeTempGitRepo({ dir: join(root, 'repos', 'payload') });
  assert.equal(existsSync(join(root, 'repos', 'payload', '.git')), true);
  repo.cleanup();
  assert.equal(existsSync(join(root, 'repos', 'payload', '.git')), true);
});

test('a bare remote, a push and a clone stay under the temporary folder', async (t) => {
  const remote = await makeBareRemote();
  t.after(() => remote.cleanup());
  assert.equal(await remote.git('rev-parse', '--is-bare-repository'), 'true');

  const source = await useTempGitRepo(t);
  source.write('a.md', 'a');
  const head = await source.commitAll('First');
  await source.git('remote', 'add', 'origin', remote.dir);
  await source.git('push', '--quiet', 'origin', 'main');

  const clone = await useClone(t, remote.dir);
  assert.equal(await clone.git('rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(join(clone.dir, 'a.md'), 'utf8'), 'a');
  assert.equal(await clone.git('config', '--local', 'user.name'), 'AI-Lore Test');

  const into = join(useTempDir(t), 'named');
  const named = await cloneTempRepo(remote.dir, into);
  assert.equal(named.dir, into);
  named.cleanup();
  assert.equal(existsSync(into), true);
});

test('openTempGitRepo and configureTestIdentity wrap a repository made another way', async (t) => {
  const dir = join(useTempDir(t), 'raw');
  assert.equal((await git.init(dir)).ok, true);
  await configureTestIdentity(dir);
  const repo = openTempGitRepo(dir);
  repo.write('x.md', 'x');
  assert.match(await repo.commitAll('X'), /^[0-9a-f]{40}$/);
});

test('a fixture cannot reach a network address: the builder throws the refusal of the guard', async () => {
  await assert.rejects(cloneTempRepo('https://github.com/owner/repo.git'), /refused/);
});

test('a builder that fails removes the folder it created', async () => {
  const prefix = `ai-lore-failing-${process.pid}-`;
  await assert.rejects(makeTempGitRepo({ prefix, branch: '-not-a-branch' }), /fixture/);
  const left = readdirSync(realpathSync(tmpdir())).filter((name) => name.startsWith(prefix));
  assert.deepEqual(left, []);
});

// ---------- test support ----------

test('repositoryRoot finds the workspace root, and the template folder is under packages/spec', () => {
  const root = repositoryRoot();
  assert.equal(existsSync(join(root, 'packages', 'core', 'package.json')), true);
  assert.equal(loreTemplateDir(), join(root, 'packages', 'spec', 'lore-1.0'));
});

test('runPython runs a script with python3 in a temporary folder', async (t) => {
  const dir = useTempDir(t);
  const script = join(dir, 'echo.py');
  writeFileSync(
    script,
    'import sys\nsys.stdout.write(sys.argv[1] + sys.stdin.read())\nsys.exit(2)\n',
  );
  const r = await runPython(script, ['arg with spaces;'], { cwd: dir, input: ' and input' });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, 'arg with spaces; and input');
});
