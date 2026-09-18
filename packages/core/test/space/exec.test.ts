import { strict as assert } from 'node:assert';
import { mkdirSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ALLOW_LIVE_GITHUB_ENV,
  type GuardContext,
  TEST_MODE_ENV,
  checkLiveSystemGuard,
  commandFailure,
  createExecFileRunner,
  execFileRunner,
  isTestMode,
  runSucceeded,
} from '../../src/index.js';
import { useTempDir } from '../support/temp.js';

const NODE = process.execPath;

/** A guard context in test mode whose temporary folder is `tempDir`. */
function testContext(tempDir: string, extra: Partial<GuardContext> = {}): GuardContext {
  return { env: { [TEST_MODE_ENV]: '1' }, tempDir, processCwd: tempDir, ...extra };
}

// ---------- the guard: gh ----------

test('the guard refuses gh unless live GitHub is allowed', (t) => {
  const dir = useTempDir(t);
  for (const bin of ['gh', '/opt/homebrew/bin/gh', 'GH.EXE']) {
    const refusal = checkLiveSystemGuard({ bin, args: ['auth', 'status'], cwd: dir }, { env: {} });
    assert.equal(refusal?.kind, 'live-system-refused', bin);
    assert.match(refusal?.message ?? '', /AI_LORE_ALLOW_LIVE_GITHUB/);
  }
  const allowed = checkLiveSystemGuard(
    { bin: 'gh', args: ['auth', 'status'], cwd: dir },
    { env: { [ALLOW_LIVE_GITHUB_ENV]: '1' } },
  );
  assert.equal(allowed, null);
});

test('a runner built with allowLiveGitHub may start gh with no variable in the environment, but not in test mode', (t) => {
  const dir = useTempDir(t);
  const command = { bin: 'gh', args: ['auth', 'status'], cwd: dir };
  assert.equal(checkLiveSystemGuard(command, { env: {}, allowLiveGitHub: true }), null);
  assert.equal(
    checkLiveSystemGuard(command, { env: {}, allowLiveGitHub: false })?.kind,
    'live-system-refused',
  );
  const inTestMode = checkLiveSystemGuard(command, testContext(dir, { allowLiveGitHub: true }));
  assert.equal(inTestMode?.kind, 'live-system-refused');
  assert.match(inTestMode?.message ?? '', /test mode/);
});

test('the guard refuses gh in test mode as well, and tests never allow it', (t) => {
  const dir = useTempDir(t);
  assert.notEqual(checkLiveSystemGuard({ bin: 'gh', args: [], cwd: dir }, testContext(dir)), null);
  assert.equal(process.env[ALLOW_LIVE_GITHUB_ENV], undefined);
});

// ---------- the guard: working folder ----------

test('isTestMode reads NODE_ENV and AI_LORE_TEST', () => {
  assert.equal(isTestMode({}), false);
  assert.equal(isTestMode({ NODE_ENV: 'production' }), false);
  assert.equal(isTestMode({ NODE_ENV: 'test' }), true);
  assert.equal(isTestMode({ [TEST_MODE_ENV]: '1' }), true);
  assert.equal(isTestMode({ [TEST_MODE_ENV]: '0' }), false);
});

test('outside test mode the guard lets any working folder through', () => {
  assert.equal(
    checkLiveSystemGuard({ bin: 'git', args: ['status'], cwd: homedir() }, { env: {} }),
    null,
  );
});

test('in test mode the guard refuses a working folder outside the temporary folder', (t) => {
  const dir = useTempDir(t);
  const refusal = checkLiveSystemGuard(
    { bin: 'git', args: ['status'], cwd: homedir() },
    testContext(dir),
  );
  assert.equal(refusal?.kind, 'live-system-refused');
  assert.match(refusal?.message ?? '', /temporary folder/);
  assert.equal(
    checkLiveSystemGuard({ bin: 'git', args: ['status'], cwd: dir }, testContext(dir)),
    null,
  );
  assert.equal(
    checkLiveSystemGuard(
      { bin: 'python3', args: ['x.py'], cwd: join(dir, 'not', 'there') },
      testContext(dir),
    ),
    null,
  );
});

test('in test mode a command with no cwd is judged by the folder of the process', (t) => {
  const dir = useTempDir(t);
  const refusal = checkLiveSystemGuard(
    { bin: 'python3', args: ['x.py'] },
    testContext(dir, { processCwd: homedir() }),
  );
  assert.equal(refusal?.kind, 'live-system-refused');
  assert.equal(checkLiveSystemGuard({ bin: 'python3', args: ['x.py'] }, testContext(dir)), null);
});

test('the guard compares real paths: a link inside the temporary folder that leaves it is refused', (t) => {
  const dir = useTempDir(t);
  symlinkSync('/usr', join(dir, 'out-link'));
  const refusal = checkLiveSystemGuard(
    { bin: 'git', args: ['status'], cwd: join(dir, 'out-link') },
    testContext(dir),
  );
  assert.equal(refusal?.kind, 'live-system-refused');
});

test('the guard accepts a temporary folder spelled through a symbolic link', (t) => {
  const dir = useTempDir(t);
  mkdirSync(join(dir, 'real-tmp', 'work'), { recursive: true });
  symlinkSync(join(dir, 'real-tmp'), join(dir, 'tmp-link'));
  const context = testContext(join(dir, 'tmp-link'));
  assert.equal(
    checkLiveSystemGuard(
      { bin: 'git', args: ['status'], cwd: join(dir, 'real-tmp', 'work') },
      context,
    ),
    null,
  );
});

test('in test mode the guard refuses git -C, --git-dir and --work-tree outside the temporary folder', (t) => {
  const dir = useTempDir(t);
  const cases: string[][] = [
    ['-C', homedir(), 'status'],
    ['--git-dir', join(homedir(), '.git'), 'status'],
    [`--work-tree=${homedir()}`, 'status'],
  ];
  for (const args of cases) {
    const refusal = checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, testContext(dir));
    assert.equal(refusal?.kind, 'live-system-refused', args.join(' '));
  }
  assert.equal(
    checkLiveSystemGuard(
      { bin: 'git', args: ['-C', join(dir, 'repo'), 'status'], cwd: dir },
      testContext(dir),
    ),
    null,
  );
});

// ---------- the guard: git and remotes ----------

test('in test mode the guard refuses clone, fetch, pull, push and ls-remote to a network address', (t) => {
  const dir = useTempDir(t);
  const cases: string[][] = [
    ['clone', 'https://github.com/owner/repo.git', 'into'],
    ['clone', '--', 'git@github.com:owner/repo.git', 'into'],
    ['clone', '--branch', 'main', 'ssh://git@github.com/owner/repo.git'],
    ['--no-optional-locks', '-c', 'a=b', 'fetch', 'https://github.com/owner/repo.git'],
    ['pull', 'https://github.com/owner/repo.git', 'main'],
    ['push', '--quiet', '--', 'https://github.com/owner/repo.git', 'main'],
    ['push', '--repo=https://github.com/owner/repo.git'],
    ['push', '-o', 'ci.skip', 'git@github.com:owner/repo.git'],
    ['ls-remote', 'https://github.com/owner/repo.git'],
  ];
  for (const args of cases) {
    const refusal = checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, testContext(dir));
    assert.equal(refusal?.kind, 'live-system-refused', args.join(' '));
  }
});

test('in test mode the guard allows a clone between paths under the temporary folder only', (t) => {
  const dir = useTempDir(t);
  const context = testContext(dir);
  const remote = join(dir, 'remote.git');
  assert.equal(
    checkLiveSystemGuard(
      { bin: 'git', args: ['clone', '--', remote, join(dir, 'c')], cwd: dir },
      context,
    ),
    null,
  );
  assert.equal(
    checkLiveSystemGuard(
      { bin: 'git', args: ['clone', `file://${remote}`, 'c'], cwd: dir },
      context,
    ),
    null,
  );
  assert.equal(
    checkLiveSystemGuard({ bin: 'git', args: ['clone', './remote.git', 'c'], cwd: dir }, context),
    null,
  );
  for (const args of [
    ['clone', join(homedir(), 'some-repo'), join(dir, 'c')],
    ['clone', `file://${homedir()}/some-repo`, join(dir, 'c')],
    ['clone', remote, join(homedir(), 'c')],
    ['clone'],
  ]) {
    const refusal = checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, context);
    assert.equal(refusal?.kind, 'live-system-refused', args.join(' '));
  }
});

test('in test mode a push or fetch by remote name is judged by the address of that remote', (t) => {
  const dir = useTempDir(t);
  const remotes: Record<string, string[]> = {
    origin: [join(dir, 'remote.git')],
    live: ['https://github.com/owner/repo.git'],
  };
  const context = testContext(dir, { listRemotes: () => remotes });
  const guard = (args: string[]): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, context)?.kind;

  assert.equal(guard(['push', '--', 'origin', 'main']), undefined);
  assert.equal(guard(['fetch', 'origin']), undefined);
  assert.equal(guard(['push', 'live', 'main']), 'live-system-refused');
  assert.equal(guard(['fetch', 'live']), 'live-system-refused');
  // No remote named: git would choose one, so every configured remote must be safe.
  assert.equal(guard(['push']), 'live-system-refused');
  // A name that is not a remote and not a path.
  assert.equal(guard(['push', 'upstream', 'main']), 'live-system-refused');
});

test('with no remote lookup the guard refuses a remote given by name', (t) => {
  const dir = useTempDir(t);
  const refusal = checkLiveSystemGuard(
    { bin: 'git', args: ['push', 'origin', 'main'], cwd: dir },
    testContext(dir),
  );
  assert.equal(refusal?.kind, 'live-system-refused');
});

test('in test mode local git commands and refspecs with a colon pass', (t) => {
  const dir = useTempDir(t);
  const context = testContext(dir, { listRemotes: () => ({ origin: [join(dir, 'remote.git')] }) });
  for (const args of [
    ['status', '--porcelain'],
    ['log', '--format=%H', '--', 'a:b.md'],
    ['push', 'origin', 'main:refs/heads/other'],
    ['commit', '--file', '-'],
  ]) {
    assert.equal(
      checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, context),
      null,
      args.join(' '),
    );
  }
});

// ---------- the guard: attempts to get around it ----------

test('in test mode gh does not run even when live GitHub is allowed', (t) => {
  const dir = useTempDir(t);
  const context = testContext(dir);
  context.env = { ...context.env, [ALLOW_LIVE_GITHUB_ENV]: '1' };
  for (const args of [
    ['api', 'user'],
    ['api', 'graphql', '-f', 'query=x'],
    ['auth', 'token'],
  ]) {
    const refusal = checkLiveSystemGuard({ bin: 'gh', args, cwd: dir }, context);
    assert.equal(refusal?.kind, 'live-system-refused', args.join(' '));
    assert.match(refusal?.message ?? '', /test mode/);
  }
  // The variables of one run do not switch the guard: only the process's own do.
  const viaRunEnv = checkLiveSystemGuard(
    { bin: 'gh', args: ['api', 'user'], cwd: dir, env: { [ALLOW_LIVE_GITHUB_ENV]: '1' } },
    { env: {}, tempDir: dir, processCwd: dir },
  );
  assert.equal(viaRunEnv?.kind, 'live-system-refused');
});

test('in test mode the guard refuses configuration injected with -c, --config-env and the environment', (t) => {
  const dir = useTempDir(t);
  const context = testContext(dir, { listRemotes: () => ({ origin: [join(dir, 'remote.git')] }) });
  const guard = (args: string[], env?: Record<string, string>): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args, cwd: dir, env }, context)?.kind;

  // The remote named origin is safe on disk; each of these would change where it leads.
  assert.equal(guard(['fetch', 'origin']), undefined);
  for (const args of [
    ['-c', 'remote.origin.url=https://github.com/owner/repo.git', 'fetch', 'origin'],
    ['-c', 'remote.origin.pushurl=git@github.com:owner/repo.git', 'push', 'origin', 'main'],
    ['-c', `url.https://github.com/.insteadOf=${dir}/`, 'fetch', 'origin'],
    ['-c', 'core.sshCommand=ssh -o ProxyCommand=x', 'fetch', 'origin'],
    ['-c', 'core.fsmonitor=/bin/sh', 'status'],
    ['-c', 'alias.st=!git push https://github.com/owner/repo.git', 'st'],
    ['-c', 'include.path=/etc/gitconfig', 'status'],
    ['--config-env=remote.origin.url=ADDRESS', 'fetch', 'origin'],
    ['--config-env', 'remote.origin.url=ADDRESS', 'fetch', 'origin'],
    ['--exec-path=/somewhere/else', 'status'],
  ]) {
    assert.equal(guard(args), 'live-system-refused', args.join(' '));
  }
  // The keys a fixture needs pass, in any case of letters.
  assert.equal(
    guard(['-c', 'user.name=T', '-c', 'User.Email=t@t.invalid', 'commit', '-q']),
    undefined,
  );
  assert.equal(guard(['-c', 'advice.detachedHead=false', 'checkout', 'main']), undefined);

  assert.equal(
    guard(['fetch', 'origin'], {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'remote.origin.url',
      GIT_CONFIG_VALUE_0: 'https://github.com/owner/repo.git',
    }),
    'live-system-refused',
  );
  assert.equal(
    guard(['status'], { GIT_CONFIG_PARAMETERS: "'core.fsmonitor=/bin/sh'" }),
    'live-system-refused',
  );
});

test('in test mode the guard refuses a repository reached through the environment of the run', (t) => {
  const dir = useTempDir(t);
  const context = testContext(dir);
  const guard = (env: Record<string, string>): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args: ['status'], cwd: dir, env }, context)?.kind;

  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) {
    assert.equal(guard({ [name]: join(homedir(), '.git') }), 'live-system-refused', name);
    assert.equal(guard({ [name]: '../../..' }), 'live-system-refused', `${name} relative`);
    assert.equal(guard({ [name]: join(dir, 'repo', '.git') }), undefined, `${name} under temp`);
  }
  assert.equal(
    guard({ GIT_ALTERNATE_OBJECT_DIRECTORIES: `${join(dir, 'a')}:${homedir()}` }),
    'live-system-refused',
  );
  // The dates a fixture sets are not the guard's concern.
  assert.equal(guard({ GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z' }), undefined);

  // The same variable in the process's own environment is seen too.
  const inherited = testContext(dir);
  inherited.env = { ...inherited.env, GIT_DIR: join(homedir(), '.git') };
  assert.equal(
    checkLiveSystemGuard({ bin: 'git', args: ['status'], cwd: dir }, inherited)?.kind,
    'live-system-refused',
  );
});

test('in test mode the remotes are read from the repository the command names', (t) => {
  const dir = useTempDir(t);
  const other = join(dir, 'other', '.git');
  const asked: (string | null)[] = [];
  const context = testContext(dir, {
    listRemotes: (_dir, gitDir) => {
      asked.push(gitDir);
      return gitDir === other
        ? { origin: ['https://github.com/owner/repo.git'] }
        : { origin: [join(dir, 'remote.git')] };
    },
  });
  const guard = (args: string[], env?: Record<string, string>): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args, cwd: dir, env }, context)?.kind;

  assert.equal(guard(['push', 'origin', 'main']), undefined);
  assert.equal(guard([`--git-dir=${other}`, 'push', 'origin', 'main']), 'live-system-refused');
  assert.equal(guard(['--git-dir', 'other/.git', 'fetch', 'origin']), 'live-system-refused');
  assert.equal(guard(['fetch', 'origin'], { GIT_DIR: 'other/.git' }), 'live-system-refused');
  assert.deepEqual(asked, [null, other, other, other]);
});

test('in test mode every remote of fetch --multiple is judged, and a branch remote that is an address', (t) => {
  const dir = useTempDir(t);
  const remotes: Record<string, string[]> = {
    origin: [join(dir, 'remote.git')],
    live: ['https://github.com/owner/repo.git'],
  };
  const guard = (args: string[], known = remotes): string | undefined =>
    checkLiveSystemGuard(
      { bin: 'git', args, cwd: dir },
      testContext(dir, { listRemotes: () => known }),
    )?.kind;

  assert.equal(guard(['fetch', '--multiple', 'origin', 'live']), 'live-system-refused');
  assert.equal(
    guard(['fetch', '--multiple', 'origin'], { origin: remotes.origin ?? [] }),
    undefined,
  );
  assert.equal(guard(['fetch', '--all']), 'live-system-refused');
  assert.equal(guard(['remote', 'update']), 'live-system-refused');
  assert.equal(guard(['remote', 'show', 'origin']), 'live-system-refused');
  // `branch.main.remote` may hold an address; the runner lists it under the key's name.
  const viaBranch = {
    origin: [join(dir, 'remote.git')],
    'branch.main.remote': ['git@github.com:owner/repo.git'],
  };
  assert.equal(guard(['pull'], viaBranch), 'live-system-refused');
  assert.equal(guard(['pull'], { ...viaBranch, 'branch.main.remote': ['origin'] }), undefined);
});

test('in test mode git remote stores only addresses under the temporary folder', (t) => {
  const dir = useTempDir(t);
  const guard = (args: string[]): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, testContext(dir))?.kind;

  assert.equal(guard(['remote', 'add', '--', 'origin', join(dir, 'remote.git')]), undefined);
  assert.equal(
    guard(['remote', 'add', '-f', '-t', 'main', 'origin', '../remote.git']),
    'live-system-refused',
  );
  assert.equal(
    guard(['remote', 'add', 'origin', 'https://github.com/o/r.git']),
    'live-system-refused',
  );
  assert.equal(guard(['remote', 'add', 'origin', 'github.com:o/r.git']), 'live-system-refused');
  assert.equal(
    guard(['remote', 'add', 'origin', `file://${homedir()}/r.git`]),
    'live-system-refused',
  );
  assert.equal(
    guard(['remote', 'set-url', 'origin', 'ssh://git@github.com/o/r.git']),
    'live-system-refused',
  );
  assert.equal(guard(['remote', 'set-url', '--push', 'origin', homedir()]), 'live-system-refused');
  assert.equal(guard(['remote', '-v']), undefined);
  assert.equal(guard(['remote', 'get-url', 'origin']), undefined);
  assert.equal(guard(['remote', 'frobnicate', 'origin']), 'live-system-refused');
});

test('in test mode the guard refuses the commands it cannot judge', (t) => {
  const dir = useTempDir(t);
  for (const args of [
    ['submodule', 'update', '--init'],
    ['submodule', 'add', join(dir, 'remote.git')],
    ['fetch-pack', 'https://github.com/o/r.git'],
    ['send-pack', 'github.com:o/r.git'],
    ['http-push', 'https://github.com/o/r.git'],
    ['remote-https', 'origin', 'https://github.com/o/r.git'],
    ['archive', '--remote=https://github.com/o/r.git', 'HEAD'],
    ['archive', '--remote', 'origin', 'HEAD'],
    ['credential', 'fill'],
    ['lfs', 'pull'],
    ['config', '--global', 'user.name', 'x'],
    ['config', '--system', '--list'],
  ]) {
    const refusal = checkLiveSystemGuard({ bin: 'git', args, cwd: dir }, testContext(dir));
    assert.equal(refusal?.kind, 'live-system-refused', args.join(' '));
  }
  assert.equal(
    checkLiveSystemGuard({ bin: 'git', args: ['archive', 'HEAD'], cwd: dir }, testContext(dir)),
    null,
  );
});

test('in test mode no argument of git names a path outside the temporary folder', (t) => {
  const dir = useTempDir(t);
  const project = process.cwd();
  mkdirSync(join(dir, 'repo'));
  symlinkSync(project, join(dir, 'repo', 'link-to-project'));
  symlinkSync(project, join(dir, 'link-to-project'));
  const guard = (args: string[], cwd = join(dir, 'repo')): string | undefined =>
    checkLiveSystemGuard({ bin: 'git', args, cwd }, testContext(dir))?.kind;

  for (const args of [
    ['init', project],
    ['init', '--quiet', '../../../../../../..'],
    ['init', 'link-to-project'],
    ['init', 'link-to-project/new-folder'],
    ['init', `--separate-git-dir=${project}/.git`],
    ['init', '--separate-git-dir', join(project, '.git')],
    ['worktree', 'add', join(project, 'wt')],
    ['config', '--file', join(homedir(), '.gitconfig'), 'user.name', 'x'],
    ['config', `--file=${homedir()}/.gitconfig`, 'user.name', 'x'],
    ['clone', join(dir, 'remote.git'), project],
    ['clone', join(dir, 'remote.git'), 'link-to-project/clone'],
    ['clone', project, 'into'],
    ['clone', '../link-to-project', 'into'],
    ['clone', `file://${project}`, 'into'],
    ['diff', '--no-index', join(project, 'package.json'), 'a.md'],
    ['-C', 'link-to-project', 'status'],
    ['-C', '..', '-C', 'link-to-project', 'status'],
    ['--git-dir', 'link-to-project/.git', 'log'],
    ['--work-tree=link-to-project', 'status'],
  ]) {
    assert.equal(guard(args), 'live-system-refused', args.join(' '));
  }
  // The working folder itself, as a link into the project.
  assert.equal(guard(['status'], join(dir, 'link-to-project')), 'live-system-refused');
  assert.equal(
    guard(['status'], join(dir, 'repo', 'link-to-project', 'packages')),
    'live-system-refused',
  );

  // What is not a path, or is a path under the temporary folder, passes.
  for (const args of [
    ['init', '--quiet', '--initial-branch', 'main'],
    ['init', join(dir, 'new', 'repo')],
    ['worktree', 'add', '../wt', 'main'],
    ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
    ['log', '--format=%H\x1f%ct\x1e', '--max-count', '5', 'abc123..HEAD', '--', 'docs/a.md'],
    ['commit', '--quiet', '--message', `A long message. ${'word '.repeat(200)}`],
    ['merge-base', 'main', 'feature/x'],
    ['config', '--local', '--', 'remote.origin.url', 'https://github.com/o/r.git'],
  ]) {
    assert.equal(guard(args), undefined, args.join(' '));
  }
});

test('a path with a NUL character cannot be judged and is refused', (t) => {
  const dir = useTempDir(t);
  const refusal = checkLiveSystemGuard(
    { bin: 'git', args: ['init', 'a\0b'], cwd: dir },
    testContext(dir),
  );
  assert.equal(refusal?.kind, 'live-system-refused');
});

// ---------- the real runner ----------

test('execFileRunner returns the exit code, stdout and stderr', async (t) => {
  const dir = useTempDir(t);
  const okRun = await execFileRunner.run(
    NODE,
    ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
    { cwd: dir },
  );
  assert.deepEqual(okRun, { code: 0, stdout: 'out', stderr: 'err' });
  assert.equal(runSucceeded(okRun), true);
  const failed = await execFileRunner.run(NODE, ['-e', 'process.exit(3)'], { cwd: dir });
  assert.equal(failed.code, 3);
  assert.equal(failed.failure, undefined);
  assert.equal(runSucceeded(failed), false);
});

test('execFileRunner passes arguments as an array: shell characters are plain text', async (t) => {
  const dir = useTempDir(t);
  const hostile = '$(touch pwned); echo `id` > x && "quoted" \'single\' *';
  const r = await execFileRunner.run(
    NODE,
    ['-e', 'process.stdout.write(process.argv[1])', hostile],
    { cwd: dir },
  );
  assert.equal(r.stdout, hostile);
});

test('execFileRunner passes cwd, env and input', async (t) => {
  const dir = useTempDir(t);
  const script =
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({cwd:process.cwd(),v:process.env.AI_LORE_PROBE,s})))';
  const r = await execFileRunner.run(NODE, ['-e', script], {
    cwd: dir,
    env: { AI_LORE_PROBE: 'probe value' },
    input: 'body on stdin',
  });
  assert.deepEqual(JSON.parse(r.stdout), { cwd: dir, v: 'probe value', s: 'body on stdin' });
});

test('execFileRunner resolves, and does not reject, for a missing binary, a missing cwd and a timeout', async (t) => {
  const dir = useTempDir(t);
  const missing = await execFileRunner.run('ai-lore-no-such-binary', [], { cwd: dir });
  assert.equal(missing.code, -1);
  assert.equal(missing.failure, 'not-found');

  const noCwd = await execFileRunner.run(NODE, ['-e', '0'], { cwd: join(dir, 'not-there') });
  assert.equal(noCwd.failure, 'spawn-error');

  const slow = await execFileRunner.run(NODE, ['-e', 'setTimeout(()=>{}, 30000)'], {
    cwd: dir,
    timeoutMs: 200,
  });
  assert.equal(slow.code, -1);
  assert.equal(slow.failure, 'timeout');
});

test('execFileRunner refuses gh without starting it', async (t) => {
  const dir = useTempDir(t);
  const r = await execFileRunner.run('gh', ['auth', 'status'], { cwd: dir });
  assert.equal(r.code, -1);
  assert.equal(r.failure, 'refused');
  assert.match(r.stderr, /AI_LORE_ALLOW_LIVE_GITHUB/);
});

test('execFileRunner in test mode refuses a cwd outside the temporary folder, and no cwd at all', async () => {
  assert.equal(process.env[TEST_MODE_ENV], '1');
  const home = await execFileRunner.run(NODE, ['-e', 'process.stdout.write("ran")'], {
    cwd: homedir(),
  });
  assert.equal(home.failure, 'refused');
  assert.equal(home.stdout, '');
  const noCwd = await execFileRunner.run(NODE, ['-e', 'process.stdout.write("ran")']);
  assert.equal(noCwd.failure, 'refused');
});

test('createExecFileRunner takes a guard context, so the guard can be tested without the process environment', async (t) => {
  const dir = useTempDir(t);
  const runner = createExecFileRunner({ guard: { env: {} } });
  const r = await runner.run(NODE, ['-e', 'process.stdout.write("ran")'], { cwd: dir });
  assert.equal(r.stdout, 'ran');
  const gh = await runner.run('gh', ['--version'], { cwd: dir });
  assert.equal(gh.failure, 'refused');
});

test('execFileRunner stops a command whose output passes the limit', async (t) => {
  const dir = useTempDir(t);
  const runner = createExecFileRunner({ maxOutputBytes: 1024 });
  const loud = await runner.run(NODE, ['-e', 'process.stdout.write("x".repeat(100000))'], {
    cwd: dir,
  });
  assert.equal(loud.code, -1);
  assert.equal(loud.failure, 'output-too-large');
  const loudErr = await runner.run(NODE, ['-e', 'process.stderr.write("x".repeat(100000))'], {
    cwd: dir,
  });
  assert.equal(loudErr.failure, 'output-too-large');
  const quiet = await runner.run(NODE, ['-e', 'process.stdout.write("x".repeat(1000))'], {
    cwd: dir,
  });
  assert.equal(quiet.code, 0);
});

test('execFileRunner ends a command that ignores the signal of its timeout', async (t) => {
  const dir = useTempDir(t);
  const started = Date.now();
  const stubborn = await execFileRunner.run(
    NODE,
    ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("up");setInterval(()=>{},1000)'],
    { cwd: dir, timeoutMs: 300 },
  );
  assert.equal(stubborn.failure, 'timeout');
  assert.equal(stubborn.stdout, 'up');
  assert.equal(Date.now() - started < 10_000, true);
});

test('execFileRunner does not pass a shell: a binary with arguments in its name is not found', async (t) => {
  const dir = useTempDir(t);
  const r = await execFileRunner.run('node -e "process.exit(0)"', [], { cwd: dir });
  assert.equal(r.failure, 'not-found');
});

test('execFileRunner in test mode refuses git pointed elsewhere by the environment or by -c, without starting it', async (t) => {
  const dir = useTempDir(t);
  const viaEnv = await execFileRunner.run('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    env: { GIT_DIR: join(process.cwd(), '..', '..', '.git') },
  });
  assert.equal(viaEnv.failure, 'refused');
  assert.equal(viaEnv.stdout, '');
  const viaConfig = await execFileRunner.run(
    'git',
    ['-c', 'remote.origin.url=https://github.com/owner/repo.git', 'ls-remote', 'origin'],
    { cwd: dir },
  );
  assert.equal(viaConfig.failure, 'refused');
});

test('execFileRunner reads the remotes of the real repository, including a branch remote that is an address', async (t) => {
  const dir = useTempDir(t);
  const git = (...args: string[]): Promise<{ code: number; failure?: string; stderr: string }> =>
    execFileRunner.run('git', args, { cwd: dir, timeoutMs: 20_000 });
  assert.equal((await git('init', '--quiet', '--bare', 'remote.git')).code, 0);
  assert.equal((await git('init', '--quiet', '--initial-branch', 'main')).code, 0);
  assert.equal((await git('remote', 'add', 'origin', join(dir, 'remote.git'))).code, 0);
  assert.equal((await git('fetch', 'origin')).code, 0);
  assert.equal((await git('fetch')).code, 0);

  // Stored as plain configuration, which the guard lets through; used, it is refused.
  assert.equal((await git('config', 'branch.main.remote', 'https://github.com/o/r.git')).code, 0);
  const pull = await git('pull');
  assert.equal(pull.failure, 'refused');
  assert.match(pull.stderr, /branch\.main\.remote/);
  assert.equal((await git('config', '--unset', 'branch.main.remote')).code, 0);

  assert.equal((await git('config', 'remote.origin.pushurl', 'git@github.com:o/r.git')).code, 0);
  assert.equal((await git('push', 'origin', 'main')).failure, 'refused');
  assert.equal((await git('fetch', 'origin')).failure, 'refused');
});

// ---------- commandFailure ----------

test('commandFailure names the binary and subcommand, and maps each failure to a kind', () => {
  const args = ['--no-optional-locks', 'status', '--porcelain'];
  assert.deepEqual(
    commandFailure('git', args, { code: 128, stdout: '', stderr: 'fatal: not a repo\n' }),
    {
      kind: 'command-failed',
      message: 'git status exited 128: fatal: not a repo',
    },
  );
  assert.equal(
    commandFailure('gh', [], { code: -1, stdout: '', stderr: 'x', failure: 'not-found' }).kind,
    'command-not-found',
  );
  assert.equal(
    commandFailure('gh', ['api'], { code: -1, stdout: '', stderr: 'x', failure: 'refused' }).kind,
    'command-refused',
  );
  assert.equal(
    commandFailure('git', ['push'], { code: -1, stdout: '', stderr: '', failure: 'timeout' }).kind,
    'command-timeout',
  );
  assert.equal(
    commandFailure('git', ['push'], { code: -1, stdout: '', stderr: '', failure: 'killed' }).kind,
    'command-failed',
  );
});
