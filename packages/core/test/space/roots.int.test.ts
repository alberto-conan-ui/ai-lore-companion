import { strict as assert } from 'node:assert';
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type ChangeEntry,
  type Root,
  type RootChanges,
  type RootChangesResult,
  execFileRunner,
  readChangesIn,
  resolveRoots,
} from '../../src/index.js';
import { type SpaceFixture, makeSpaceFixture } from '../../src/space/testing/index.js';
import { usePlainRepository, useTempGitRepo } from '../support/git.js';
import { loreTemplateDir } from '../support/paths.js';
import { useTempDir } from '../support/temp.js';

async function useSpace(
  t: TestContext,
  options: { repositories?: string[]; outsidePublishAreas?: string[] } = {},
): Promise<SpaceFixture> {
  const fixture = await makeSpaceFixture({ templateDir: loreTemplateDir(), ...options });
  t.after(() => fixture.cleanup());
  return fixture;
}

function changesOf(result: RootChangesResult): RootChanges {
  if (!result.ok) assert.fail(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

/** Entries in a fixed order and with composed characters, so that lists compare whatever order git used. */
function sorted(entries: readonly ChangeEntry[]): ChangeEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      path: entry.path.normalize('NFC'),
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath.normalize('NFC') }),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function rootById(roots: readonly Root[], id: string): Root {
  const root = roots.find((candidate) => candidate.id === id);
  if (root === undefined) assert.fail(`no root ${id}`);
  return root;
}

test('resolveRoots gives the Lore, the Workbench, the publish areas and the repositories, in that order', async (t) => {
  const fixture = await useSpace(t, { repositories: ['alpha'], outsidePublishAreas: ['handbook'] });
  const handbook = fixture.outsidePublishAreas.handbook ?? '';
  const resolved = await resolveRoots({
    spaceRoot: fixture.root,
    runner: execFileRunner,
    outsidePublishAreas: { handbook },
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const roots = resolved.value;
  assert.deepEqual(
    roots.map((root) => [root.id, root.kind, root.name]),
    [
      ['lore', 'lore', 'lore'],
      ['workbench', 'workbench', 'workbench'],
      ['publish:publish', 'publish-area', 'publish'],
      ['publish:handbook', 'publish-area', 'handbook'],
      ['repo:alpha', 'repository', 'alpha'],
    ],
  );
  assert.deepEqual(rootById(roots, 'lore'), {
    id: 'lore',
    kind: 'lore',
    name: 'lore',
    path: fixture.paths.lore,
    tracking: { tracked: true, workTree: fixture.root, subPath: 'lore' },
  });
  assert.deepEqual(rootById(roots, 'publish:publish').tracking, {
    tracked: true,
    workTree: fixture.root,
    subPath: 'publish',
  });
  assert.deepEqual(rootById(roots, 'repo:alpha'), {
    id: 'repo:alpha',
    kind: 'repository',
    name: 'alpha',
    path: join(fixture.paths.repos, 'alpha'),
    tracking: { tracked: true, workTree: join(fixture.paths.repos, 'alpha'), subPath: '' },
  });
  const outside = rootById(roots, 'publish:handbook');
  assert.equal(outside.path, handbook);
  assert.equal(outside.tracking.tracked, false);
  if (!outside.tracking.tracked) assert.equal(outside.tracking.reason, 'outside-a-repository');
});

test('the Workbench is a root with no change tracking, and says so', async (t) => {
  const fixture = await useSpace(t);
  writeFileSync(join(fixture.paths.scratch, 'note.md'), '# scratch\n', 'utf8');
  const resolved = await resolveRoots({ spaceRoot: fixture.root, runner: execFileRunner });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const workbench = rootById(resolved.value, 'workbench');
  assert.equal(workbench.path, fixture.paths.workbench);
  assert.deepEqual(workbench.tracking, {
    tracked: false,
    reason: 'git-ignored',
    message: 'The Workbench has no change tracking.',
  });
});

test('resolveRoots reports a root it cannot track as data: missing folder, not a repository, unknown path, a path that leaves the Space, an ignored folder', async (t) => {
  const fixture = await useSpace(t, { repositories: ['alpha'], outsidePublishAreas: ['handbook'] });
  const elsewhere = useTempDir(t);
  mkdirSync(join(fixture.paths.repos, 'plain-folder'));
  symlinkSync(elsewhere, join(fixture.root, 'linked-out'));
  mkdirSync(join(fixture.paths.scratch, 'site'), { recursive: true });
  const manifest = {
    ...fixture.manifest,
    repositories: [
      ...fixture.manifest.repositories,
      { name: 'ghost', github: 'fixture-owner/ghost' },
      { name: 'plain-folder', github: 'fixture-owner/plain-folder' },
    ],
    publishAreas: [
      ...fixture.manifest.publishAreas,
      { name: 'linked', path: 'linked-out' },
      { name: 'gone', path: 'not-there' },
      { name: 'site', path: 'workbench/scratch/site' },
    ],
  };
  const resolved = await resolveRoots({
    spaceRoot: fixture.root,
    runner: execFileRunner,
    manifest,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const reasonOf = (id: string): string => {
    const tracking = rootById(resolved.value, id).tracking;
    return tracking.tracked ? 'tracked' : tracking.reason;
  };
  assert.equal(reasonOf('repo:alpha'), 'tracked');
  assert.equal(reasonOf('repo:ghost'), 'folder-missing');
  assert.equal(reasonOf('repo:plain-folder'), 'not-a-repository');
  assert.equal(reasonOf('publish:handbook'), 'path-unknown');
  assert.equal(rootById(resolved.value, 'publish:handbook').path, '');
  assert.equal(reasonOf('publish:linked'), 'path-refused');
  assert.equal(reasonOf('publish:gone'), 'folder-missing');
  assert.equal(reasonOf('publish:site'), 'git-ignored');
  for (const root of resolved.value) {
    if (!root.tracking.tracked) assert.notEqual(root.tracking.message, '', root.id);
  }
});

test('resolveRoots fails only when the manifest cannot be read', async (t) => {
  const result = await resolveRoots({ spaceRoot: useTempDir(t), runner: execFileRunner });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'manifest-missing');
});

test('Reviews gate: against a reviewed mark the changes are the committed, the renamed and the uncommitted files; after a new mark only the uncommitted remain', async (t) => {
  const fixture = await useSpace(t, { repositories: ['alpha'] });
  const repository = fixture.repositories[0];
  if (repository === undefined) assert.fail('the fixture has no repository');
  const dir = repository.checkout.dir;
  const indexBefore = statSync(join(dir, '.git', 'index')).mtimeMs;

  const sinceMark = changesOf(await readChangesIn(execFileRunner, dir, repository.baseCommit, ''));
  assert.deepEqual(sorted(sinceMark.entries), [
    { code: 'D ', path: 'docs/delete-uncommitted.md' },
    { code: 'M ', path: 'docs/edit-uncommitted.md' },
    { code: '??', path: 'notes/untracked.md' },
    { code: 'A ', path: 'src/added.ts' },
    { code: 'M ', path: 'src/change-me.ts' },
    { code: 'D ', path: 'src/delete-me.ts' },
    { code: 'R ', path: 'src/renamed.ts', oldPath: 'src/rename-me.ts' },
  ]);
  assert.equal(sinceMark.baseline, repository.baseCommit);
  assert.equal(sinceMark.baselineCommit, repository.baseCommit);
  assert.equal(sinceMark.baselineIsAncestor, true);
  assert.equal(sinceMark.head, repository.headCommit);
  assert.deepEqual(sinceMark.branch, { branch: 'main', detached: false });
  assert.deepEqual([sinceMark.total, sinceMark.truncated], [7, false]);

  // The same list, asked from git itself and from what the fixture says it did.
  // `--no-renames` makes git name both paths of the renamed file, as `listed` does.
  const gitDiff = await repository.checkout.git(
    'diff',
    '--name-only',
    '--no-renames',
    repository.baseCommit,
  );
  const gitOthers = await repository.checkout.git('ls-files', '--others', '--exclude-standard');
  const fromGit = [...gitDiff.split('\n'), ...gitOthers.split('\n')].filter(Boolean).sort();
  const listed = sinceMark.entries.flatMap((entry) =>
    entry.oldPath === undefined ? [entry.path] : [entry.path, entry.oldPath],
  );
  assert.deepEqual(listed.sort(), fromGit);
  const declared = [...repository.committedSinceBase, ...repository.uncommitted];
  assert.deepEqual(
    declared.map((change) => change.path).sort(),
    sorted(sinceMark.entries).map((entry) => entry.path),
  );

  // Marking as reviewed records the present commit: the uncommitted files stay listed.
  const afterMark = changesOf(await readChangesIn(execFileRunner, dir, repository.headCommit, ''));
  assert.deepEqual(sorted(afterMark.entries), [
    { code: 'D ', path: 'docs/delete-uncommitted.md' },
    { code: 'M ', path: 'docs/edit-uncommitted.md' },
    { code: '??', path: 'notes/untracked.md' },
  ]);

  const againstHead = changesOf(await readChangesIn(execFileRunner, dir, 'HEAD', ''));
  assert.deepEqual(sorted(againstHead.entries), [
    { code: ' D', path: 'docs/delete-uncommitted.md' },
    { code: ' M', path: 'docs/edit-uncommitted.md' },
    { code: '??', path: 'notes/untracked.md' },
  ]);
  assert.equal(againstHead.baselineCommit, repository.headCommit);

  assert.equal(
    statSync(join(dir, '.git', 'index')).mtimeMs,
    indexBefore,
    'a read rewrote the index',
  );
});

test('a sub-path root lists only what is under it, with paths relative to the root', async (t) => {
  const fixture = await useSpace(t);
  const space = fixture.space;
  space.write('lore/corpus/extra.md', '# extra\n');
  await space.git('mv', 'lore/verbs/index.md', 'lore/verbs/listing.md');
  space.write('publish/specs/index.md', '# changed in the publish area\n');
  space.write('outside-both.md', '# at the top of the Space\n');
  const commit = await space.commitAll('Work in the Lore and in the publish area');
  space.write('lore/index.md', '# edited and not committed\n');
  space.write('lore/notes with space/ñu.md', '# not committed\n');
  space.write('publish/new.md', '# not committed\n');

  const lore = changesOf(await readChangesIn(execFileRunner, fixture.root, fixture.head, 'lore'));
  assert.deepEqual(sorted(lore.entries), [
    { code: 'A ', path: 'corpus/extra.md' },
    { code: 'M ', path: 'index.md' },
    { code: '??', path: 'notes with space/ñu.md' },
    { code: 'R ', path: 'verbs/listing.md', oldPath: 'verbs/index.md' },
  ]);

  const publish = changesOf(
    await readChangesIn(execFileRunner, fixture.root, fixture.head, 'publish/'),
  );
  assert.deepEqual(sorted(publish.entries), [
    { code: '??', path: 'new.md' },
    { code: 'M ', path: 'specs/index.md' },
  ]);

  const loreAfterMark = changesOf(
    await readChangesIn(execFileRunner, fixture.root, commit, 'lore'),
  );
  assert.deepEqual(sorted(loreAfterMark.entries), [
    { code: 'M ', path: 'index.md' },
    { code: '??', path: 'notes with space/ñu.md' },
  ]);

  const loreHead = changesOf(await readChangesIn(execFileRunner, fixture.root, 'HEAD', 'lore'));
  assert.deepEqual(sorted(loreHead.entries), [
    { code: ' M', path: 'index.md' },
    { code: '??', path: 'notes with space/ñu.md' },
  ]);

  // A file moved from one root into another is deleted in the first and added in the second.
  await space.git('mv', 'lore/corpus/extra.md', 'publish/extra.md');
  const moved = changesOf(await readChangesIn(execFileRunner, fixture.root, 'HEAD', 'publish'));
  assert.deepEqual(
    sorted(moved.entries).map((entry) => [entry.code[0], entry.path, entry.oldPath]),
    [
      ['A', 'extra.md', undefined],
      ['?', 'new.md', undefined],
    ],
  );
});

test('paths with spaces and non-ASCII characters arrive unquoted, whatever core.quotepath says', async (t) => {
  const repo = await usePlainRepository(t);
  await repo.git('config', 'core.quotepath', 'true');
  repo.write('docs/mi año nuevo.md', 'uno\ndos\ntres\ncuatro\ncinco\nseis\n');
  repo.write('日本語/ファイル.txt', 'a\n');
  const mark = await repo.commitAll('Names that git would quote');
  await repo.git('mv', 'docs/mi año nuevo.md', 'docs/feliz año "nuevo".md');
  repo.write('日本語/ファイル.txt', 'b\n');
  repo.write('new folder/tab\there.md', 'x\n');

  const expected = [
    { code: 'R ', path: 'docs/feliz año "nuevo".md', oldPath: 'docs/mi año nuevo.md' },
    { code: '??', path: 'new folder/tab\there.md' },
    { code: 'M ', path: '日本語/ファイル.txt' },
  ];
  const againstMark = changesOf(await readChangesIn(execFileRunner, repo.dir, mark, ''));
  assert.deepEqual(sorted(againstMark.entries), sorted(expected));

  const againstHead = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  assert.deepEqual(
    sorted(againstHead.entries).map((entry) => entry.path),
    sorted(expected).map((entry) => entry.path),
  );
});

test('a repository with no commit is read against HEAD, and a commit baseline in it is reported missing', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('first.md', '# first\n');
  repo.write('staged.md', '# staged\n');
  await repo.git('add', 'staged.md');

  const changes = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  assert.deepEqual(sorted(changes.entries), [
    { code: '??', path: 'first.md' },
    { code: 'A ', path: 'staged.md' },
  ]);
  assert.equal(changes.head, null);
  assert.equal(changes.baselineCommit, null);
  assert.equal(changes.baselineIsAncestor, null);
  assert.deepEqual(changes.branch, { branch: 'main', detached: false });

  const missing = await readChangesIn(execFileRunner, repo.dir, 'a'.repeat(40), '');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.kind, 'baseline-missing');
});

test('a detached HEAD is read and reported', async (t) => {
  const repo = await usePlainRepository(t);
  repo.write('second.md', '# second\n');
  const second = await repo.commitAll('Second commit');
  await repo.git('checkout', '--quiet', '--detach', repo.head);
  repo.write('README.md', '# edited while detached\n');

  const changes = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  assert.deepEqual(changes.branch, { branch: '', detached: true });
  assert.equal(changes.head, repo.head);
  assert.deepEqual(changes.entries, [{ code: ' M', path: 'README.md' }]);

  // A mark on a commit that the detached HEAD is behind: still compared, and said not to be an ancestor.
  const ahead = changesOf(await readChangesIn(execFileRunner, repo.dir, second, ''));
  assert.equal(ahead.baselineIsAncestor, false);
  assert.deepEqual(sorted(ahead.entries), [
    { code: 'M ', path: 'README.md' },
    { code: 'D ', path: 'second.md' },
  ]);
});

test('a mark whose commit was rebased away is compared while the commit exists, and reported once it is gone', async (t) => {
  const repo = await usePlainRepository(t);
  repo.write('work.md', '# first wording\n');
  const mark = await repo.commitAll('The commit the mark records');
  await repo.git('reset', '--quiet', '--hard', repo.head);
  repo.write('work.md', '# second wording\n');
  await repo.commitAll('The same work, rewritten');

  const leftBehind = changesOf(await readChangesIn(execFileRunner, repo.dir, mark, ''));
  assert.equal(leftBehind.baselineIsAncestor, false);
  assert.deepEqual(leftBehind.entries, [{ code: 'M ', path: 'work.md' }]);

  await repo.git('reflog', 'expire', '--expire=now', '--all');
  await repo.git('gc', '--quiet', '--prune=now');
  const gone = await readChangesIn(execFileRunner, repo.dir, mark, '');
  assert.equal(gone.ok, false);
  if (!gone.ok) {
    assert.equal(gone.error.kind, 'baseline-missing');
    assert.match(gone.error.message, /not in this repository any more/);
  }
});

test('a very large change set is cut at the limit, tracked changes first, with the full count', async (t) => {
  const repo = await usePlainRepository(t);
  repo.write('README.md', '# edited\n');
  for (let index = 0; index < 40; index += 1) {
    repo.write(`bulk/file-${String(index).padStart(2, '0')}.md`, `${index}\n`);
  }
  for (const baseline of ['HEAD', repo.head]) {
    const cut = changesOf(
      await readChangesIn(execFileRunner, repo.dir, baseline, '', { limit: 10 }),
    );
    assert.equal(cut.entries.length, 10, baseline);
    assert.deepEqual([cut.total, cut.truncated, cut.limit], [41, true, 10], baseline);
    assert.equal(cut.entries[0]?.path, 'README.md', baseline);
  }
  const whole = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  assert.deepEqual(
    [whole.entries.length, whole.total, whole.truncated, whole.limit],
    [41, 41, false, 5000],
  );
});

test('a missing folder, a folder that is not a repository and a folder inside a repository are failures, not throws', async (t) => {
  const plain = useTempDir(t);
  const repo = await usePlainRepository(t);
  repo.write('sub/file.md', 'x\n');

  const missing = await readChangesIn(execFileRunner, join(plain, 'not-there'), 'HEAD', '');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.kind, 'folder-missing');

  const notRepository = await readChangesIn(execFileRunner, plain, 'HEAD', '');
  assert.equal(notRepository.ok, false);
  if (!notRepository.ok) assert.equal(notRepository.error.kind, 'not-a-repository');

  // `repos/<name>` whose `.git` was removed sits inside the Space repository: it must not read the Space's changes.
  const inside = await readChangesIn(execFileRunner, join(repo.dir, 'sub'), 'HEAD', '');
  assert.equal(inside.ok, false);
  if (!inside.ok) assert.equal(inside.error.kind, 'not-a-repository');

  rmSync(join(repo.dir, '.git'), { recursive: true, force: true });
  const broken = await readChangesIn(execFileRunner, repo.dir, 'HEAD', '');
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.error.kind, 'not-a-repository');
});

/** `code|path` or `code|path<-oldPath`, sorted. */
function lines(changes: RootChanges): string[] {
  return changes.entries
    .map(
      (entry) =>
        `${entry.code}|${entry.path}${entry.oldPath === undefined ? '' : `<-${entry.oldPath}`}`,
    )
    .sort();
}

test('every kind of change is listed once: type, mode, staged then changed, a moved file added with -N, an untracked folder, odd names; an ignored file never', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('.gitignore', 'ignored.log\nignored-dir/\n');
  repo.write('type.txt', 'a file\n');
  repo.write('mode.sh', '#!/bin/sh\n');
  repo.write('staged.txt', 'zero\n');
  repo.write('moved.txt', 'a file that is moved in the working tree\n');
  const base = await repo.commitAll('base');

  rmSync(join(repo.dir, 'type.txt'));
  symlinkSync('mode.sh', join(repo.dir, 'type.txt'));
  chmodSync(join(repo.dir, 'mode.sh'), 0o755);
  repo.write('staged.txt', 'one\n');
  await repo.git('add', 'staged.txt');
  repo.write('staged.txt', 'two\n');
  renameSync(join(repo.dir, 'moved.txt'), join(repo.dir, 'moved-here.txt'));
  await repo.git('add', '-N', 'moved-here.txt');
  for (let index = 0; index < 25; index += 1) repo.write(`new-folder/deep/${index}.md`, 'x\n');
  repo.write('ignored.log', 'x\n');
  repo.write('ignored-dir/inside.md', 'x\n');
  repo.write('new\nline.md', 'x\n');
  repo.write('tab\there.md', 'x\n');

  const atHead = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  const flat = lines(atHead).filter((line) => !line.includes('new-folder/'));
  assert.deepEqual(flat, [
    ' M|mode.sh',
    ' R|moved-here.txt<-moved.txt',
    ' T|type.txt',
    '??|new\nline.md',
    '??|tab\there.md',
    'MM|staged.txt',
  ]);
  assert.equal(
    atHead.entries.filter((entry) => entry.path.startsWith('new-folder/deep/')).length,
    25,
  );

  const atBase = changesOf(await readChangesIn(execFileRunner, repo.dir, base.slice(0, 8), ''));
  assert.equal(atBase.baselineCommit, base, 'a short SHA resolves to the full one');
  assert.equal(
    atBase.entries.some((entry) => entry.path.startsWith('ignored')),
    false,
  );
  assert.equal(atBase.entries.filter((entry) => entry.code === '??').length, 27);
  for (const path of ['mode.sh', 'type.txt', 'staged.txt']) {
    assert.equal(atBase.entries.filter((entry) => entry.path === path).length, 1, path);
  }
});

test('a conflicted file during a merge is listed, and a baseline on another branch is compared and reported as not an ancestor', async (t) => {
  const repo = await useTempGitRepo(t);
  repo.write('shared.md', 'base\n');
  const base = await repo.commitAll('base');
  await repo.git('checkout', '-q', '-b', 'theirs');
  repo.write('shared.md', 'theirs\n');
  const theirs = await repo.commitAll('theirs');
  await repo.git('checkout', '-q', '-b', 'ours', base);
  repo.write('shared.md', 'ours\n');
  await repo.commitAll('ours');

  const other = changesOf(await readChangesIn(execFileRunner, repo.dir, theirs, ''));
  assert.equal(other.baselineIsAncestor, false);
  assert.deepEqual(lines(other), ['M |shared.md']);

  await repo.git('merge', 'theirs').catch(() => undefined);
  const merging = changesOf(await readChangesIn(execFileRunner, repo.dir, 'HEAD', ''));
  assert.deepEqual(lines(merging), ['UU|shared.md']);
  const againstBase = changesOf(await readChangesIn(execFileRunner, repo.dir, base, ''));
  assert.deepEqual(
    againstBase.entries.map((entry) => entry.path),
    ['shared.md'],
  );
});

test('a rename across the edge of a sub-path root is an added file on one side and a deleted file on the other', async (t) => {
  const repo = await useTempGitRepo(t);
  const text = (word: string): string =>
    Array.from({ length: 40 }, (_, index) => `${word} ${index * 7}`).join('\n');
  repo.write('lore/leaves.md', text('leaves'));
  repo.write('lore/stays.md', 'stays\n');
  repo.write('outside/enters.md', text('enters'));
  const base = await repo.commitAll('base');
  await repo.git('mv', 'outside/enters.md', 'lore/entered.md');
  await repo.git('mv', 'lore/leaves.md', 'outside/left.md');

  for (const baseline of ['HEAD', base]) {
    const lore = changesOf(await readChangesIn(execFileRunner, repo.dir, baseline, 'lore'));
    assert.deepEqual(lines(lore), ['A |entered.md', 'D |leaves.md'], baseline);
    const outside = changesOf(await readChangesIn(execFileRunner, repo.dir, baseline, 'outside'));
    assert.deepEqual(lines(outside), ['A |left.md', 'D |enters.md'], baseline);
    const whole = changesOf(await readChangesIn(execFileRunner, repo.dir, baseline, ''));
    assert.deepEqual(
      lines(whole),
      ['R |lore/entered.md<-outside/enters.md', 'R |outside/left.md<-lore/leaves.md'],
      baseline,
    );
  }
});

test('containment: a repository folder linked out of the Space, and a root that shares its folder with another root, are refused', async (t) => {
  const fixture = await useSpace(t, {
    repositories: ['alpha'],
    outsidePublishAreas: ['handbook', 'wiki', 'twin'],
  });
  const elsewhere = await usePlainRepository(t);
  symlinkSync(elsewhere.dir, join(fixture.paths.repos, 'linked-out'));
  symlinkSync(join(fixture.paths.repos, 'alpha'), join(fixture.paths.repos, 'alias'));
  const linkToLore = join(useTempDir(t), 'link-to-lore');
  symlinkSync(fixture.paths.lore, linkToLore);
  const handbook = fixture.outsidePublishAreas.handbook ?? '';
  mkdirSync(join(fixture.paths.repos, 'alpha', 'docs'), { recursive: true });

  const manifest = {
    ...fixture.manifest,
    repositories: [
      ...fixture.manifest.repositories,
      { name: 'linked-out', github: 'fixture-owner/linked-out' },
      { name: 'alias', github: 'fixture-owner/alias' },
    ],
    publishAreas: [
      ...fixture.manifest.publishAreas,
      { name: 'dotted', path: '../outside' },
      { name: 'in-lore', path: 'lore/verbs' },
      { name: 'in-repo', path: 'repos/alpha/docs' },
      { name: 'whole-space', path: null },
    ],
  };
  const resolved = await resolveRoots({
    spaceRoot: fixture.root,
    runner: execFileRunner,
    manifest,
    outsidePublishAreas: {
      handbook,
      wiki: linkToLore,
      twin: handbook,
      'whole-space': fixture.root,
    },
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const reasonOf = (id: string): string => {
    const tracking = rootById(resolved.value, id).tracking;
    return tracking.tracked ? 'tracked' : tracking.reason;
  };
  assert.equal(reasonOf('lore'), 'tracked');
  assert.equal(reasonOf('repo:alpha'), 'tracked');
  assert.equal(reasonOf('publish:publish'), 'tracked');
  // The first outside area is kept: a folder of its own, in no repository.
  assert.equal(reasonOf('publish:handbook'), 'outside-a-repository');
  assert.equal(reasonOf('repo:linked-out'), 'path-refused');
  assert.equal(reasonOf('repo:alias'), 'path-refused');
  assert.equal(reasonOf('publish:dotted'), 'path-refused');
  assert.equal(reasonOf('publish:in-lore'), 'path-refused');
  assert.equal(reasonOf('publish:in-repo'), 'path-refused');
  assert.equal(reasonOf('publish:wiki'), 'path-refused');
  assert.equal(reasonOf('publish:twin'), 'path-refused');
  assert.equal(reasonOf('publish:whole-space'), 'path-refused');
  assert.equal(
    resolved.value.length,
    manifest.publishAreas.length + manifest.repositories.length + 2,
  );
});

test('20,000 changed files are read in a few seconds, cut at the limit, with the full count', async (t) => {
  const repo = await usePlainRepository(t);
  for (let folder = 0; folder < 200; folder += 1) {
    mkdirSync(join(repo.dir, 'bulk', String(folder)), { recursive: true });
    for (let file = 0; file < 100; file += 1) {
      writeFileSync(join(repo.dir, 'bulk', String(folder), `${file}.md`), 'x');
    }
  }
  for (const baseline of ['HEAD', repo.head]) {
    const start = Date.now();
    const read = changesOf(await readChangesIn(execFileRunner, repo.dir, baseline, ''));
    assert.ok(Date.now() - start < 10_000, `${baseline}: ${Date.now() - start} ms`);
    assert.deepEqual(
      [read.entries.length, read.total, read.truncated],
      [5000, 20_000, true],
      baseline,
    );
  }
});
