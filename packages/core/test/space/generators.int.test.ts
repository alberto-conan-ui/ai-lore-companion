/**
 * Runs the two skeleton generators of the AI-Lore 1.0 template,
 * `lore/mirrors/generators/folder-skeleton.py` and `repository-skeleton.py`, as
 * child processes with `python3`, on temporary folders and temporary git
 * repositories. The template is read and never written.
 *
 * What it checks: the listing and its order; the same output between two runs;
 * that `.git` is left out; that a repository is read from its default branch and
 * not from its working tree; that every printed line is a double-quoted scalar of
 * the frontmatter subset, whatever the file names are; an empty folder; a
 * repository with no commits; the depth limit; and that the mirror of the default
 * publish area stores the skeleton that the generator prints for the template's
 * `publish/` folder.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import {
  loreTemplateDir,
  runPython,
  useBareRemote,
  useClone,
  useTempDir,
  useTempGitRepo,
} from '../support/index.js';

const GENERATORS = join(loreTemplateDir(), 'lore', 'mirrors', 'generators');
const FOLDER_SKELETON = join(GENERATORS, 'folder-skeleton.py');
const REPOSITORY_SKELETON = join(GENERATORS, 'repository-skeleton.py');
const NO_COMMITS = 'the repository has no commits, so its skeleton is empty';

/** A double-quoted scalar of the frontmatter subset: the two escapes `\"` and `\\` only. */
const QUOTED_LINE = /^"((?:[^"\\]|\\["\\])*)"$/;

/** File names with a space, a double quote, a backslash, a percent sign, other scripts and a line feed. */
const AWKWARD_NAMES = [
  'with space.md',
  'say "hi".md',
  'back\\slash.md',
  '100%.md',
  'café-ñandú.md',
  '日本語.md',
  'line\nfeed.md',
  'key: value #not-a-comment.md',
];

/** What the generators print for `AWKWARD_NAMES`, after the quotes and the two escapes are read. */
const AWKWARD_VALUES = [
  'with space.md',
  'say "hi".md',
  'back\\slash.md',
  '100%25.md',
  'café-ñandú.md',
  '日本語.md',
  'line%0Afeed.md',
  'key: value #not-a-comment.md',
];

type Run = { code: number; stdout: string; stderr: string; lines: string[] };

/** Run a generator with `cwd` as the working folder and split its output into lines. */
async function generate(script: string, args: string[], cwd: string): Promise<Run> {
  const result = await runPython(script, args, { cwd });
  assert.equal(result.failure, undefined, result.stderr);
  const lines = result.stdout === '' ? [] : result.stdout.replace(/\n$/, '').split('\n');
  return { code: result.code, stdout: result.stdout, stderr: result.stderr, lines };
}

/** Run a generator that must succeed. */
async function skeletonOf(script: string, args: string[], cwd: string): Promise<Run> {
  const run = await generate(script, args, cwd);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, '');
  return run;
}

/**
 * Read printed lines as the items of a mirror's `skeleton`: once with the strict
 * reader of the subset and once with `js-yaml`, which must agree.
 */
function readAsSkeleton(lines: string[]): string[] {
  const bySubset = lines.map((line) => {
    const match = QUOTED_LINE.exec(line);
    assert.ok(match, `not a double-quoted scalar of the subset: ${JSON.stringify(line)}`);
    return (match[1] ?? '').replace(/\\(["\\])/g, '$1');
  });
  const yaml =
    lines.length === 0
      ? 'skeleton: []\n'
      : `skeleton:\n${lines.map((line) => `  - ${line}\n`).join('')}`;
  const byYaml = (loadYaml(yaml) as { skeleton: unknown }).skeleton;
  assert.deepEqual(byYaml, bySubset, 'js-yaml and the subset reader differ');
  return bySubset;
}

/** Write a file under `root`, creating its folders. `name` is used as it is, with no check. */
function put(root: string, folder: string, name: string, text = 'x\n'): void {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, name), text, 'utf8');
}

// ---------- the generator for folders ----------

test('folder-skeleton lists files and folders, a folder before what it contains, by code point', async (t) => {
  const dir = useTempDir(t);
  put(dir, 'specs', 'index.md');
  put(dir, 'specs', 'b-spec.md');
  put(dir, 'specs/images', 'a.png');
  put(dir, '.', 'readme.md');
  put(dir, '.', 'Zeta.md');
  put(dir, '.', 'specs.md');
  mkdirSync(join(dir, 'empty'));

  const run = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  assert.deepEqual(readAsSkeleton(run.lines), [
    'Zeta.md',
    'empty/',
    'readme.md',
    'specs/',
    'specs/b-spec.md',
    'specs/images/',
    'specs/images/a.png',
    'specs/index.md',
    'specs.md',
  ]);
});

test('folder-skeleton prints the same output in two runs, with no absolute path, from any working folder', async (t) => {
  const dir = useTempDir(t);
  const elsewhere = useTempDir(t);
  put(dir, 'specs', 'index.md');
  put(dir, 'notes/2026', 'a.md');

  const first = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  const second = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  const third = await skeletonOf(FOLDER_SKELETON, [dir], elsewhere);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout, third.stdout);
  assert.equal(first.stdout.includes(dir), false);
  assert.equal(first.lines.length, 5);
});

test('folder-skeleton leaves out .git at every level and does not follow a symbolic link', async (t) => {
  const dir = useTempDir(t);
  const outside = useTempDir(t);
  put(outside, '.', 'secret.md');
  put(dir, '.git', 'HEAD');
  put(dir, 'sub/.git', 'HEAD');
  put(dir, 'sub', '.git-keep');
  put(dir, 'sub', 'a.md');
  symlinkSync(outside, join(dir, 'link'));

  const run = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  assert.deepEqual(readAsSkeleton(run.lines), ['link', 'sub/', 'sub/.git-keep', 'sub/a.md']);
});

test('folder-skeleton writes awkward names so that every line stays inside the subset', async (t) => {
  const dir = useTempDir(t);
  for (const name of AWKWARD_NAMES) put(dir, 'dir with "quote"', name);

  const run = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  assert.equal(run.lines.length, AWKWARD_NAMES.length + 1);
  const expected = ['dir with "quote"/', ...AWKWARD_VALUES.map((v) => `dir with "quote"/${v}`)];
  assert.deepEqual(readAsSkeleton(run.lines).sort(), expected.sort());
  assert.ok(run.lines.includes('"dir with \\"quote\\"/back\\\\slash.md"'));
});

test('folder-skeleton prints nothing for an empty folder', async (t) => {
  const dir = useTempDir(t);
  const run = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  assert.equal(run.stdout, '');
  assert.deepEqual(readAsSkeleton(run.lines), []);
});

test('folder-skeleton respects --depth and prints a folder at the limit without what it contains', async (t) => {
  const dir = useTempDir(t);
  put(dir, '.', 'top.md');
  put(dir, 'a', 'one.md');
  put(dir, 'a/b', 'two.md');
  put(dir, 'a/b/c', 'three.md');

  const one = await skeletonOf(FOLDER_SKELETON, [dir, '--depth', '1'], dir);
  assert.deepEqual(readAsSkeleton(one.lines), ['a/', 'top.md']);
  const two = await skeletonOf(FOLDER_SKELETON, ['--depth', '2', dir], dir);
  assert.deepEqual(readAsSkeleton(two.lines), ['a/', 'a/b/', 'a/one.md', 'top.md']);
  const all = await skeletonOf(FOLDER_SKELETON, [dir, '--depth', '9'], dir);
  const noLimit = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  assert.equal(all.stdout, noLimit.stdout);
  assert.equal(noLimit.lines.length, 7);
});

test('folder-skeleton exits with 2 and prints nothing for a missing folder or a wrong depth', async (t) => {
  const dir = useTempDir(t);
  put(dir, '.', 'a.md');
  for (const args of [[join(dir, 'missing')], [join(dir, 'a.md')], [dir, '--depth', '0'], []]) {
    const run = await generate(FOLDER_SKELETON, args, dir);
    assert.equal(run.code, 2, `arguments ${JSON.stringify(args)}`);
    assert.equal(run.stdout, '');
    assert.notEqual(run.stderr, '');
  }
});

// ---------- the generator for repositories ----------

test('repository-skeleton lists the committed tree of the default branch, with its folders', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('README.md', '# r\n');
  repo.write('src/index.ts', 'export {};\n');
  repo.write('src/space/a.ts', 'export {};\n');
  repo.write('Zeta.md', 'z\n');
  await repo.commitAll('first');

  const run = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  assert.deepEqual(readAsSkeleton(run.lines), [
    'README.md',
    'Zeta.md',
    'src/',
    'src/index.ts',
    'src/space/',
    'src/space/a.ts',
  ]);
});

test('repository-skeleton does not list what is only in the working tree, the index or another branch', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('kept.md', 'k\n');
  repo.write('removed-later.md', 'r\n');
  await repo.commitAll('first');
  const committed = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);

  repo.write('untracked.md', 'u\n');
  repo.write('staged.md', 's\n');
  await repo.git('add', 'staged.md');
  repo.remove('removed-later.md');
  repo.write('kept.md', 'changed\n');
  const dirty = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  assert.equal(dirty.stdout, committed.stdout);
  assert.deepEqual(readAsSkeleton(dirty.lines), ['kept.md', 'removed-later.md']);
});

test('repository-skeleton of a clone reads the default branch as it was last fetched, not the item branch', async (t) => {
  const seed = await useTempGitRepo(t);
  seed.write('docs/guide.md', 'g\n');
  await seed.commitAll('first');
  const remote = await useBareRemote(t);
  await seed.git('push', '--quiet', remote.dir, 'main');

  const clone = await useClone(t, remote.dir);
  await clone.git('checkout', '--quiet', '-b', 'item-12');
  clone.write('docs/on-item-branch.md', 'i\n');
  await clone.commitAll('work on the item');
  await clone.git('checkout', '--quiet', 'main');
  clone.write('docs/local-only.md', 'l\n');
  await clone.commitAll('a local commit that is not pushed');
  await clone.git('checkout', '--quiet', 'item-12');

  const run = await skeletonOf(REPOSITORY_SKELETON, [clone.dir], clone.dir);
  assert.deepEqual(readAsSkeleton(run.lines), ['docs/', 'docs/guide.md']);
});

test('repository-skeleton prints the same output in two runs, with no absolute path, and matches folder-skeleton on a clean checkout', async (t) => {
  const repo = await useTempGitRepo(t);
  const elsewhere = useTempDir(t);
  repo.write('a/b/c.md', 'c\n');
  repo.write('a/d.md', 'd\n');
  repo.write('e.md', 'e\n');
  await repo.commitAll('first');

  const first = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  const second = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], elsewhere);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stdout.includes(repo.dir), false);
  const asFolder = await skeletonOf(FOLDER_SKELETON, [repo.dir], repo.dir);
  assert.equal(asFolder.stdout, first.stdout);
});

test('repository-skeleton writes awkward names so that every line stays inside the subset', async (t) => {
  const repo = await useTempGitRepo(t);
  for (const name of AWKWARD_NAMES) put(repo.dir, 'dir with "quote"', name);
  await repo.commitAll('awkward names');

  const run = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  const expected = ['dir with "quote"/', ...AWKWARD_VALUES.map((v) => `dir with "quote"/${v}`)];
  assert.deepEqual(readAsSkeleton(run.lines).sort(), expected.sort());
  const asFolder = await skeletonOf(FOLDER_SKELETON, [repo.dir], repo.dir);
  assert.equal(asFolder.stdout, run.stdout);
});

test('repository-skeleton prints an empty skeleton for a repository with no commits, and says so on standard error', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('not-committed.md', 'n\n');
  const remote = await useBareRemote(t);
  const emptyClone = await useClone(t, remote.dir);

  for (const dir of [repo.dir, emptyClone.dir]) {
    const first = await generate(REPOSITORY_SKELETON, [dir], dir);
    const second = await generate(REPOSITORY_SKELETON, [dir], dir);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, '');
    assert.equal(first.stderr, `repository-skeleton: ${NO_COMMITS}.\n`);
    assert.deepEqual(second, first);
    assert.deepEqual(readAsSkeleton(first.lines), []);
  }
});

test('repository-skeleton refuses to guess the default branch of a repository that has origin and no origin/HEAD', async (t) => {
  const seed = await useTempGitRepo(t);
  seed.write('a.md', 'a\n');
  await seed.commitAll('first');
  const remote = await useBareRemote(t);
  await seed.git('push', '--quiet', remote.dir, 'main');

  // No remote: the branch that HEAD names is read.
  assert.deepEqual((await skeletonOf(REPOSITORY_SKELETON, [seed.dir], seed.dir)).lines, ['"a.md"']);

  // A remote named origin that was added by hand has no origin/HEAD.
  await seed.git('remote', 'add', 'origin', remote.dir);
  await seed.git('fetch', '--quiet', 'origin');
  await seed.git('checkout', '--quiet', '-b', 'item-12');
  const unknown = await generate(REPOSITORY_SKELETON, [seed.dir], seed.dir);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /the default branch is not known/);
  assert.match(unknown.stderr, /git remote set-head origin --auto/);

  // Detached HEAD and no remote: not known either.
  const alone = await useTempGitRepo(t);
  alone.write('b.md', 'b\n');
  await alone.commitAll('first');
  await alone.git('checkout', '--quiet', '--detach');
  const detached = await generate(REPOSITORY_SKELETON, [alone.dir], alone.dir);
  assert.equal(detached.code, 2);
  assert.match(detached.stderr, /the default branch is not known/);
});

test('repository-skeleton is not steered by git variables of the environment', async (t) => {
  const wanted = await useTempGitRepo(t);
  wanted.write('wanted.md', 'w\n');
  await wanted.commitAll('first');
  const other = await useTempGitRepo(t);
  other.write('other.md', 'o\n');
  await other.commitAll('first');

  const result = await runPython(REPOSITORY_SKELETON, [wanted.dir], {
    cwd: other.dir,
    env: {
      GIT_DIR: join(other.dir, '.git'),
      GIT_WORK_TREE: other.dir,
      GIT_INDEX_FILE: join(other.dir, '.git', 'index'),
      GIT_OBJECT_DIRECTORY: join(other.dir, '.git', 'objects'),
      GIT_NAMESPACE: 'elsewhere',
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '"wanted.md"\n');
});

test('repository-skeleton lists a submodule as a folder, a symbolic link as a file, and names that begin with a hyphen', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('-rf', 'x\n');
  repo.write('--depth', 'x\n');
  repo.write('-dir/--file', 'x\n');
  symlinkSync('-rf', join(repo.dir, 'link-to-file'));
  await repo.commitAll('first');
  const head = await repo.git('rev-parse', 'HEAD');
  // A submodule is a tree entry of the kind "commit"; no clone is needed to record one.
  await repo.git('update-index', '--add', '--cacheinfo', `160000,${head},vendor/module`);
  await repo.git('commit', '--quiet', '-m', 'a submodule entry');

  const run = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  assert.deepEqual(readAsSkeleton(run.lines), [
    '--depth',
    '-dir/',
    '-dir/--file',
    '-rf',
    'link-to-file',
    'vendor/',
    'vendor/module/',
  ]);
});

test('both generators take a folder whose name begins with a hyphen after "--", and refuse it as an option without', async (t) => {
  const dir = useTempDir(t);
  put(dir, '-x', '-rf');
  const listed = await skeletonOf(FOLDER_SKELETON, ['--', '-x'], dir);
  assert.deepEqual(listed.lines, ['"-rf"']);
  const refused = await generate(FOLDER_SKELETON, ['-x'], dir);
  assert.equal(refused.code, 2);
  assert.equal(refused.stdout, '');
});

test('folder-skeleton reads a tree deeper than the interpreter would let a function call itself', async (t) => {
  const dir = useTempDir(t);
  const levels = 150;
  mkdirSync(join(dir, 'tree', ...Array<string>(levels).fill('d')), { recursive: true });
  // A wrapper, written in the temporary folder, lowers the limit and then runs the generator.
  const wrapper = join(dir, 'wrapper.py');
  writeFileSync(
    wrapper,
    [
      'import runpy, sys',
      'script = sys.argv[1]',
      'sys.argv = sys.argv[1:]',
      'sys.setrecursionlimit(100)',
      'runpy.run_path(script, run_name="__main__")',
      '',
    ].join('\n'),
    'utf8',
  );
  const run = await skeletonOf(wrapper, [FOLDER_SKELETON, join(dir, 'tree')], dir);
  assert.equal(run.lines.length, levels);
  assert.equal(run.lines[levels - 1], `"${Array<string>(levels).fill('d').join('/')}/"`);
});

test('a printed line reads back to the name of the file', async (t) => {
  const dir = useTempDir(t);
  for (const name of AWKWARD_NAMES) put(dir, '.', name);
  const run = await skeletonOf(FOLDER_SKELETON, [dir], dir);
  const names = readAsSkeleton(run.lines).map((value) => decodeURIComponent(value));
  assert.deepEqual(names.sort(), [...AWKWARD_NAMES].sort());
});

test('repository-skeleton respects --depth and prints a folder at the limit without what it contains', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('top.md', 't\n');
  repo.write('a/one.md', '1\n');
  repo.write('a/b/two.md', '2\n');
  repo.write('a/b/c/three.md', '3\n');
  await repo.commitAll('first');

  const one = await skeletonOf(REPOSITORY_SKELETON, [repo.dir, '--depth', '1'], repo.dir);
  assert.deepEqual(readAsSkeleton(one.lines), ['a/', 'top.md']);
  const two = await skeletonOf(REPOSITORY_SKELETON, [repo.dir, '--depth', '2'], repo.dir);
  assert.deepEqual(readAsSkeleton(two.lines), ['a/', 'a/b/', 'a/one.md', 'top.md']);
  const noLimit = await skeletonOf(REPOSITORY_SKELETON, [repo.dir], repo.dir);
  assert.equal(noLimit.lines.length, 7);
  const sameAsFolder = await skeletonOf(FOLDER_SKELETON, [repo.dir, '--depth', '2'], repo.dir);
  assert.equal(sameAsFolder.stdout, two.stdout);
});

test('repository-skeleton exits with 2 for a folder that is not the top of a repository, and for a wrong depth', async (t) => {
  const plain = useTempDir(t);
  const repo = await useTempGitRepo(t);
  repo.write('sub/a.md', 'a\n');
  await repo.commitAll('first');

  const cases = [
    [plain],
    [join(repo.dir, 'sub')],
    [join(plain, 'missing')],
    [repo.dir, '--depth', 'x'],
  ];
  for (const args of cases) {
    const run = await generate(REPOSITORY_SKELETON, args, plain);
    assert.equal(run.code, 2, `arguments ${JSON.stringify(args)}`);
    assert.equal(run.stdout, '');
    assert.notEqual(run.stderr, '');
  }
});

// ---------- the template's own mirror ----------

test('the mirror of the default publish area stores the skeleton that its generator prints', async (t) => {
  const cwd = useTempDir(t);
  const template = loreTemplateDir();
  const card = readFileSync(join(template, 'lore', 'mirrors', 'publish.md'), 'utf8');
  const end = card.indexOf('\n---\n', 4);
  assert.ok(card.startsWith('---\n') && end > 0, 'publish.md must begin with frontmatter');
  const data = loadYaml(card.slice(4, end)) as { generator: string; skeleton: string[] };

  assert.equal(data.generator, 'lore/mirrors/generators/folder-skeleton.py');
  const run = await skeletonOf(join(template, data.generator), [join(template, 'publish')], cwd);
  assert.deepEqual(readAsSkeleton(run.lines), data.skeleton);
});
