import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_ROOT_CHANGES_LIMIT,
  HEAD_BASELINE,
  LORE_ROOT_ID,
  ROOT_CHANGES_TIMEOUT_MS,
  ROOT_TRACKER_DEBOUNCE_MS,
  WORKBENCH_ROOT_ID,
  entriesRelativeTo,
  parseDiffNameStatusZ,
  parseStatusZ,
  readChangesIn,
  rootIdOf,
} from '../../src/index.js';
import { createScriptedRunner } from '../../src/space/testing/index.js';
import { useTempDir } from '../support/temp.js';

test('rootIdOf gives the four forms of a root id', () => {
  assert.equal(rootIdOf('lore', 'anything'), 'lore');
  assert.equal(rootIdOf('workbench', 'anything'), 'workbench');
  assert.equal(rootIdOf('publish-area', 'handbook'), 'publish:handbook');
  assert.equal(rootIdOf('repository', 'ai-lore-companion'), 'repo:ai-lore-companion');
  assert.equal(LORE_ROOT_ID, 'lore');
  assert.equal(WORKBENCH_ROOT_ID, 'workbench');
});

test('the constants are the documented values', () => {
  assert.equal(HEAD_BASELINE, 'HEAD');
  assert.equal(DEFAULT_ROOT_CHANGES_LIMIT, 5000);
  assert.equal(ROOT_TRACKER_DEBOUNCE_MS, 200);
  assert.equal(ROOT_CHANGES_TIMEOUT_MS, 30_000);
});

test('parseDiffNameStatusZ reads changed, added, deleted, renamed and copied entries', () => {
  const text = [
    'M',
    'src/change me.ts',
    'A',
    'src/añadido.ts',
    'D',
    'src/gone.ts',
    'R087',
    'src/old.ts',
    'src/new.ts',
    'C100',
    'a.md',
    'b.md',
    '',
  ].join('\0');
  assert.deepEqual(parseDiffNameStatusZ(text), [
    { code: 'M ', path: 'src/change me.ts' },
    { code: 'A ', path: 'src/añadido.ts' },
    { code: 'D ', path: 'src/gone.ts' },
    { code: 'R ', path: 'src/new.ts', oldPath: 'src/old.ts' },
    { code: 'C ', path: 'b.md', oldPath: 'a.md' },
  ]);
  assert.deepEqual(parseDiffNameStatusZ(''), []);
  assert.deepEqual(parseDiffNameStatusZ('M\0'), []);
});

test('parseStatusZ reads the old path of a rename marked in either column, and never takes it for an entry', () => {
  const text = [
    ' M changed.md',
    'R  staged-new.md',
    'staged-old.md',
    ' R moved-in-tree.md',
    'was-here-before.md',
    'RM renamed and changed.md',
    'old name.md',
    'UU conflicted.md',
    '?? new\nline.md',
    '',
  ].join('\0');
  assert.deepEqual(parseStatusZ(text), [
    { code: ' M', path: 'changed.md' },
    { code: 'R ', path: 'staged-new.md', oldPath: 'staged-old.md' },
    { code: ' R', path: 'moved-in-tree.md', oldPath: 'was-here-before.md' },
    { code: 'RM', path: 'renamed and changed.md', oldPath: 'old name.md' },
    { code: 'UU', path: 'conflicted.md' },
    { code: '??', path: 'new\nline.md' },
  ]);
  assert.deepEqual(parseStatusZ(''), []);
});

test('entriesRelativeTo makes paths relative to the sub-path and drops what is outside', () => {
  const entries = [
    { code: ' M', path: 'lore/index.md' },
    { code: '??', path: 'lorex/not-inside.md' },
    { code: 'M ', path: 'publish/specs/index.md' },
    { code: 'R ', path: 'lore/verbs/new.md', oldPath: 'lore/verbs/old.md' },
    { code: 'R ', path: 'lore/moved-in.md', oldPath: 'publish/was-here.md' },
    { code: 'R ', path: 'publish/moved-out.md', oldPath: 'lore/was-here.md' },
  ];
  assert.deepEqual(entriesRelativeTo('lore', entries), [
    { code: ' M', path: 'index.md' },
    { code: 'R ', path: 'verbs/new.md', oldPath: 'verbs/old.md' },
    { code: 'A ', path: 'moved-in.md' },
    { code: 'D ', path: 'was-here.md' },
  ]);
  assert.deepEqual(entriesRelativeTo('', entries), entries);
  assert.deepEqual(entriesRelativeTo('publish/specs', entries), [{ code: 'M ', path: 'index.md' }]);
});

test('readChangesIn refuses a baseline that is not HEAD or a SHA, and a sub-path that leaves the working tree, before git runs', async (t) => {
  const dir = useTempDir(t);
  const runner = createScriptedRunner();
  for (const baseline of ['main', '--output=/tmp/x', 'HEAD~1', 'abc', '']) {
    const result = await readChangesIn(runner, dir, baseline, '');
    assert.equal(result.ok, false, baseline);
    if (!result.ok) assert.equal(result.error.kind, 'invalid-argument');
  }
  for (const subPath of ['../outside', '/abs', 'a/../../b', 'a\\b', 'a//b', 'C:/x', './a']) {
    const result = await readChangesIn(runner, dir, 'HEAD', subPath);
    assert.equal(result.ok, false, subPath);
    if (!result.ok) assert.equal(result.error.kind, 'invalid-argument');
  }
  assert.equal(runner.calls.length, 0);
});

test('readChangesIn reports git output beyond the runner limit as change-set-too-large, and a missing git as command-not-found', async (t) => {
  const dir = useTempDir(t);
  const tooLarge = createScriptedRunner([
    { bin: 'git', args: (args) => args.includes('--show-toplevel'), reply: { stdout: `${dir}\n` } },
    { bin: 'git', args: (args) => args.includes('--git-dir'), reply: { stdout: '.git\n' } },
    { bin: 'git', args: (args) => args.includes('symbolic-ref'), reply: { stdout: 'main\n' } },
    {
      bin: 'git',
      args: (args) => args.includes('HEAD^{commit}'),
      reply: { stdout: 'a'.repeat(40) },
    },
    {
      bin: 'git',
      args: (args) => args.includes('status'),
      reply: { code: -1, failure: 'output-too-large', stderr: 'git produced too much output' },
    },
  ]);
  const large = await readChangesIn(tooLarge, dir, 'HEAD', 'lore');
  assert.equal(large.ok, false);
  if (!large.ok) assert.equal(large.error.kind, 'change-set-too-large');

  const status = tooLarge.calls.find((call) => call.args.includes('status'));
  assert.deepEqual(status?.args, [
    '--no-optional-locks',
    '--literal-pathspecs',
    '-c',
    'core.quotepath=off',
    'status',
    '--porcelain',
    '-z',
    '-uall',
    '--find-renames',
    '--',
    'lore',
  ]);
  assert.equal(status?.opts.cwd, dir);
  assert.equal(status?.opts.timeoutMs, ROOT_CHANGES_TIMEOUT_MS);

  const noGit = createScriptedRunner([
    { bin: 'git', reply: { code: -1, failure: 'not-found', stderr: 'git was not found' } },
  ]);
  const missing = await readChangesIn(noGit, dir, 'HEAD', '');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.kind, 'command-not-found');
});

test('readChangesIn against a commit walks the working tree with one git status, which also names the untracked files and both names of a rename not committed', async (t) => {
  const dir = useTempDir(t);
  const head = 'a'.repeat(40);
  const mark = 'b'.repeat(40);
  const runner = createScriptedRunner([
    { bin: 'git', args: (args) => args.includes('--show-toplevel'), reply: { stdout: `${dir}\n` } },
    { bin: 'git', args: (args) => args.includes('--git-dir'), reply: { stdout: '.git\n' } },
    { bin: 'git', args: (args) => args.includes('symbolic-ref'), reply: { stdout: 'main\n' } },
    { bin: 'git', args: (args) => args.includes('HEAD^{commit}'), reply: { stdout: head } },
    { bin: 'git', args: (args) => args.includes(`${mark}^{commit}`), reply: { stdout: mark } },
    { bin: 'git', args: (args) => args.includes('merge-base'), reply: { code: 0 } },
    {
      bin: 'git',
      args: (args) => args.includes('diff'),
      // The diff does not pair the rename: git's similarity differs from the index's.
      reply: { stdout: 'M\0lore/committed.md\0D\0lore/old.md\0A\0lore/new.md\0' },
    },
    {
      bin: 'git',
      args: (args) => args.includes('status'),
      reply: { stdout: 'R  lore/new.md\0lore/old.md\0?? lore/untracked.md\0?? outside.md\0' },
    },
  ]);
  const read = await readChangesIn(runner, dir, mark, 'lore');
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(
    read.value.entries.map((entry) => entry.path),
    ['committed.md', 'old.md', 'new.md', 'untracked.md'],
  );
  assert.deepEqual([...read.value.uncommitted].sort(), ['new.md', 'old.md', 'untracked.md']);
  assert.equal(runner.calls.filter((call) => call.args.includes('status')).length, 1);
  assert.equal(runner.calls.filter((call) => call.args.includes('ls-files')).length, 0);
});
