import { strict as assert } from 'node:assert';
import { type TestContext, test } from 'node:test';
import { readRepositoryStateIn } from '../../src/index.js';
import { type ScriptedRunner, createScriptedRunner } from '../../src/space/testing/index.js';
import { useTempDir } from '../support/temp.js';

// Stage D1, phase D1.1: `readRepositoryStateIn`'s parsing of the commands of
// section 3.3, driven by a scripted `CommandRunner` (architecture document,
// section 2 and section 4). `workTree` must be a real folder because the
// first check is a plain `statSync`, not a git command; every git command
// after it is scripted, so no real git repository is needed here.

const SHA = 'a'.repeat(40);

/** A runner already scripted to answer the identity commands (steps 2 to 4) for a normal branch `main`. */
function baseRunner(): ScriptedRunner {
  return createScriptedRunner([
    {
      bin: 'git',
      args: (args) => args.includes('--absolute-git-dir'),
      reply: { stdout: '/fake/.git' },
    },
    {
      bin: 'git',
      args: (args) => args.includes('symbolic-ref'),
      reply: { stdout: 'main' },
    },
    {
      bin: 'git',
      args: (args) => args.includes('rev-parse') && args.includes('HEAD^{commit}'),
      reply: { stdout: SHA },
    },
  ]);
}

function workTree(t: TestContext): string {
  return useTempDir(t, 'ai-lore-roots-remote-');
}

test('a for-each-ref record of three empty fields, on a repository with a remote, gives no-upstream', async (t) => {
  const runner = baseRunner()
    .on({ bin: 'git', args: (args) => args.includes('for-each-ref'), reply: { stdout: '\0\0' } })
    .on({
      bin: 'git',
      args: (args) => args[args.length - 1] === 'remote',
      reply: { stdout: 'origin\n' },
    });

  const result = await readRepositoryStateIn(runner, workTree(t));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.remote.ahead, null);
  assert.deepEqual(result.value.remote.behind, null);
  assert.equal(result.value.remote.unknown?.reason, 'no-upstream');
  assert.match(
    result.value.remote.unknown?.message ?? '',
    /the branch main has no tracking branch/,
  );
});

test('a for-each-ref record of three empty fields, on a repository with no remote, gives no-remote', async (t) => {
  const runner = baseRunner()
    .on({ bin: 'git', args: (args) => args.includes('for-each-ref'), reply: { stdout: '\0\0' } })
    .on({ bin: 'git', args: (args) => args[args.length - 1] === 'remote', reply: { stdout: '' } });

  const result = await readRepositoryStateIn(runner, workTree(t));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.remote.unknown?.reason, 'no-remote');
  assert.match(result.value.remote.unknown?.message ?? '', /this repository has no remote/);
});

test('a rev-list output of "1\\t2" gives behind 1 and ahead 2', async (t) => {
  const runner = baseRunner()
    .on({
      bin: 'git',
      args: (args) => args.includes('for-each-ref'),
      reply: { stdout: 'refs/remotes/origin/main\0origin/main\0origin' },
    })
    .on({ bin: 'git', args: (args) => args.includes('rev-list'), reply: { stdout: '1\t2\n' } });

  const result = await readRepositoryStateIn(runner, workTree(t));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.remote.behind, 1);
  assert.equal(result.value.remote.ahead, 2);
  assert.equal(result.value.remote.upstream, 'origin/main');
  assert.equal(result.value.remote.remote, 'origin');
  assert.equal(result.value.remote.unknown, null);
});

test('a rev-list that exits 128 gives upstream-missing', async (t) => {
  const runner = baseRunner()
    .on({
      bin: 'git',
      args: (args) => args.includes('for-each-ref'),
      reply: { stdout: 'refs/remotes/origin/gonebr\0origin/gonebr\0origin' },
    })
    .on({
      bin: 'git',
      args: (args) => args.includes('rev-list'),
      reply: { code: 128, stderr: 'fatal: ambiguous argument' },
    });

  const result = await readRepositoryStateIn(runner, workTree(t));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.remote.unknown?.reason, 'upstream-missing');
  assert.match(
    result.value.remote.unknown?.message ?? '',
    /origin\/gonebr is not in this repository/,
  );
  assert.equal(result.value.remote.upstream, 'origin/gonebr');
});

test('a runner that reports timeout gives git-failed, embedded rather than failing the whole read', async (t) => {
  const runner = baseRunner()
    .on({
      bin: 'git',
      args: (args) => args.includes('for-each-ref'),
      reply: { stdout: 'refs/remotes/origin/main\0origin/main\0origin' },
    })
    .on({
      bin: 'git',
      args: (args) => args.includes('rev-list'),
      reply: { failure: 'timeout', code: -1 },
    });

  const result = await readRepositoryStateIn(runner, workTree(t));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.head.kind, 'branch');
  assert.equal(result.value.remote.unknown?.reason, 'git-failed');
  assert.match(result.value.remote.unknown?.message ?? '', /did not finish in time/);
});
