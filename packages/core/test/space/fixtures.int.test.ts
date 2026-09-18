import { strict as assert } from 'node:assert';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  TEST_MODE_ENV,
  isInsideLexically,
  readSpaceManifest,
  spacePaths,
} from '../../src/index.js';
import {
  type FixtureChange,
  type TempGitRepo,
  makeSpaceFixture,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir } from '../support/index.js';

/** Every file under `dir`, relative to it with `/`, sorted. `.git` folders are left out. */
function filesUnder(dir: string, relative = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(join(dir, entry.name), path));
    else found.push(path);
  }
  return found.sort();
}

/** `git status --porcelain` as changes, sorted by path. */
async function statusOf(repo: TempGitRepo): Promise<FixtureChange[]> {
  const out = await repo.git('status', '--porcelain', '--untracked-files=all');
  const letters: Record<string, FixtureChange['status']> = {
    '??': 'added',
    M: 'changed',
    D: 'deleted',
  };
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      // `repo.git` trims its output, so the first line may have lost a leading space.
      const match = /^\s*(\?\?|M|D)\s+(.+)$/.exec(line);
      const status = letters[match?.[1] ?? ''];
      if (match === null || status === undefined) throw new Error(`unexpected status: ${line}`);
      return { status, path: match[2] ?? '' };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function byPath(changes: readonly FixtureChange[]): FixtureChange[] {
  return [...changes].sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- makeSpaceFixture ----------

test('makeSpaceFixture scaffolds the template into a Space repository with a bare remote', async (t) => {
  delete process.env[TEST_MODE_ENV];
  const template = loreTemplateDir();
  const fixture = await makeSpaceFixture({ templateDir: template });
  t.after(() => fixture.cleanup());
  assert.equal(process.env[TEST_MODE_ENV], '1');
  assert.deepEqual(fixture.paths, spacePaths(fixture.root));
  assert.deepEqual(fixture.repositories, []);

  // Every file of the template is in the Space with the same bytes, but for the two setup changes.
  const expected = filesUnder(template)
    .map((path) => (path === 'gitignore.template' ? '.gitignore' : path))
    .sort();
  assert.deepEqual(filesUnder(fixture.root), expected);
  for (const path of filesUnder(template)) {
    if (path === 'lore/space.md') continue;
    const target = path === 'gitignore.template' ? '.gitignore' : path;
    assert.deepEqual(
      readFileSync(join(fixture.root, target)),
      readFileSync(join(template, path)),
      path,
    );
  }
  for (const dir of [
    fixture.paths.repos,
    fixture.paths.drafts,
    fixture.paths.journal,
    fixture.paths.scratch,
  ]) {
    assert.equal(statSync(dir).isDirectory(), true, dir);
  }

  // The manifest is filled in and is what the file holds.
  assert.deepEqual(fixture.manifest, {
    format: 1,
    name: 'fixture-space',
    github: { repository: 'fixture-owner/fixture-space', project: 7 },
    repositories: [],
    publishAreas: [{ name: 'publish', path: 'publish' }],
  });
  assert.deepEqual(await readSpaceManifest(fixture.root), { ok: true, value: fixture.manifest });

  // One commit, pushed; a clean working tree.
  assert.equal(await fixture.space.git('rev-parse', 'HEAD'), fixture.head);
  assert.equal(await fixture.space.git('status', '--porcelain'), '');
  assert.equal(await fixture.space.git('remote', 'get-url', 'origin'), fixture.remote.dir);
  assert.equal(await fixture.remote.git('rev-parse', 'refs/heads/main'), fixture.head);
});

test('makeSpaceFixture adds repositories with the scripted history, and publish areas outside the Space', async (t) => {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    name: 'my-space',
    owner: 'my-owner',
    project: 12,
    repositories: ['example-app', 'example-site'],
    outsidePublishAreas: ['handbook'],
  });
  t.after(() => fixture.cleanup());

  assert.deepEqual(fixture.manifest.github, { repository: 'my-owner/my-space', project: 12 });
  assert.deepEqual(fixture.manifest.repositories, [
    { name: 'example-app', github: 'my-owner/example-app' },
    { name: 'example-site', github: 'my-owner/example-site' },
  ]);
  assert.deepEqual(fixture.manifest.publishAreas, [
    { name: 'publish', path: 'publish' },
    { name: 'handbook', path: null },
  ]);
  const handbook = fixture.outsidePublishAreas.handbook ?? '';
  assert.equal(existsSync(join(handbook, 'index.md')), true);
  assert.equal(isInsideLexically(fixture.root, handbook), false);

  // The checkouts are git-ignored by the Space repository.
  assert.equal(await fixture.space.git('status', '--porcelain'), '');
  assert.equal((await fixture.space.git('ls-files')).includes('repos/'), false);

  assert.deepEqual(
    fixture.repositories.map((repository) => repository.name),
    ['example-app', 'example-site'],
  );
  for (const repository of fixture.repositories) {
    const { checkout } = repository;
    assert.equal(checkout.dir, join(fixture.paths.repos, repository.name));
    assert.equal(await checkout.git('remote', 'get-url', 'origin'), repository.remote.dir);
    assert.equal(await checkout.git('rev-parse', 'HEAD'), repository.headCommit);
    assert.equal(await checkout.git('rev-parse', 'origin/main'), repository.baseCommit);
    assert.equal(await checkout.git('rev-parse', 'HEAD~1'), repository.baseCommit);

    const diff = await checkout.git(
      'diff',
      '--name-status',
      '--find-renames',
      repository.baseCommit,
      repository.headCommit,
    );
    assert.deepEqual(
      diff.split('\n').map((line) => line.split('\t')),
      [
        ['A', 'src/added.ts'],
        ['M', 'src/change-me.ts'],
        ['D', 'src/delete-me.ts'],
        ['R100', 'src/rename-me.ts', 'src/renamed.ts'],
      ],
    );
    assert.deepEqual(repository.committedSinceBase, [
      { status: 'added', path: 'src/added.ts' },
      { status: 'changed', path: 'src/change-me.ts' },
      { status: 'deleted', path: 'src/delete-me.ts' },
      { status: 'renamed', path: 'src/renamed.ts', from: 'src/rename-me.ts' },
    ]);
    assert.deepEqual(await statusOf(checkout), byPath(repository.uncommitted));
    assert.equal(repository.uncommitted.length, 3);
  }
});

test('makeSpaceFixture removes everything on cleanup, and leaves nothing when it cannot be built', async () => {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['example-app'],
  });
  const parent = join(fixture.root, '..');
  assert.equal(existsSync(fixture.remote.dir), true);
  fixture.cleanup();
  assert.equal(existsSync(parent), false);
  fixture.cleanup();

  await assert.rejects(
    makeSpaceFixture({ templateDir: join(loreTemplateDir(), 'missing') }),
    /fixture: .*is not a folder/,
  );
});

// ---------- makeV08Fixture ----------

test('makeV08Fixture builds a payload repository and a Lore whose memory/ is its own repository', async (t) => {
  delete process.env[TEST_MODE_ENV];
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  assert.equal(process.env[TEST_MODE_ENV], '1');
  assert.equal(fixture.projectName, 'fixture-project');
  assert.equal(fixture.shape, 'v0.8');
  assert.equal(fixture.manifestLocation, 'memory-folder');
  assert.equal(fixture.lorePath, join(fixture.root, '.ai-lore-fixture-project'));
  assert.equal(fixture.memoryPath, join(fixture.lorePath, 'memory'));
  assert.equal(
    readFileSync(join(fixture.memoryPath, 'workspace.yaml'), 'utf8'),
    'project_name: fixture-project\ncore_version: "0.8"\n',
  );
  assert.equal(existsSync(join(fixture.lorePath, 'workspace.yaml')), false);

  // Two repositories, each with one pushed commit and a clean working tree.
  assert.equal(existsSync(join(fixture.root, '.git')), true);
  assert.equal(existsSync(join(fixture.memoryPath, '.git')), true);
  for (const [repo, remote, head] of [
    [fixture.payload, fixture.payloadRemote, fixture.payloadHead],
    [fixture.memory, fixture.memoryRemote, fixture.memoryHead],
  ] as const) {
    assert.equal(await repo.git('rev-parse', 'HEAD'), head);
    assert.equal(await repo.git('status', '--porcelain'), '');
    assert.equal(await repo.git('remote', 'get-url', 'origin'), remote.dir);
    assert.equal(await remote.git('rev-parse', 'refs/heads/main'), head);
  }
  assert.deepEqual(fixture.uncommitted, { payload: [], memory: [] });

  // The payload repository ignores the Lore folder and carries the v0.8 Claude binding.
  const tracked = (await fixture.payload.git('ls-files')).split('\n');
  assert.equal(
    tracked.some((path) => path.startsWith('.ai-lore-')),
    false,
  );
  assert.equal(tracked.includes('ai_readme.md'), false);
  for (const path of [
    '.claude/settings.json',
    '.claude/hooks/ai-lore-guard.py',
    '.claude/skills/ai-lore-orient/SKILL.md',
    'CLAUDE.md',
    'src/index.ts',
  ]) {
    assert.equal(tracked.includes(path), true, path);
  }
  assert.match(
    readFileSync(join(fixture.root, '.claude', 'settings.json'), 'utf8'),
    /python3 \.claude\/hooks\/ai-lore-guard\.py pre/,
  );

  // The Lore repository tracks memory/ only; references/ and ai_readme.md are beside it.
  assert.deepEqual(fixture.loreFiles, filesUnder(fixture.lorePath));
  assert.equal(fixture.loreFiles.includes('ai_readme.md'), true);
  // What the ignore rules keep out is on the disk and not tracked. Names are asked for unquoted,
  // because one of them has characters outside ASCII.
  const memoryTracked = (await fixture.memory.git('-c', 'core.quotepath=false', 'ls-files'))
    .split('\n')
    .sort();
  assert.deepEqual(
    memoryTracked,
    fixture.loreFiles
      .filter((path) => path.startsWith('memory/'))
      .filter((path) => !fixture.contents.ignoredFiles.includes(path))
      .map((path) => path.slice('memory/'.length))
      .sort(),
  );
});

test('makeV08Fixture holds every kind of content the migration mapping names', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const { contents } = fixture;
  const read = (relative: string): string => readFileSync(join(fixture.lorePath, relative), 'utf8');

  // The registry: one focus in progress and two paused; the done one is under archive/ only.
  const rows = read('memory/status/status.stack.md')
    .split('\n')
    .filter((line) => line.startsWith('| ['));
  assert.deepEqual(
    rows.map((row) => row.split('|')[2]?.trim()),
    ['in progress', 'paused', 'paused'],
  );
  assert.equal(contents.inProgressFocus, 'memory/status/build-the-thing/build-the-thing.focus.md');
  assert.match(read(contents.inProgressFocus ?? ''), /^status: in progress$/m);
  assert.equal(contents.stages.length, 3);
  assert.deepEqual(
    contents.stages.map((path) => /^status: (.*)$/m.exec(read(path))?.[1]),
    ['done', 'in progress', 'draft'],
  );
  assert.equal(contents.pausedFocuses.length, 2);
  for (const path of contents.pausedFocuses) assert.match(read(path), /^status: paused$/m);
  // One finished focus has a folder with a stage; the other is a single file, as a real archive has.
  assert.deepEqual(contents.doneFocuses, [
    'memory/status/archive/earlier-work/earlier-work.focus.md',
    'memory/status/archive/single-file-work.focus.md',
  ]);
  for (const path of contents.doneFocuses) assert.match(read(path), /^status: done$/m);

  // Two backlog files; one lists several entries as sections, the other as a numbered list.
  assert.equal(contents.backlogFiles.length, 2);
  for (const path of contents.backlogFiles) assert.match(read(path), /^type: backlog$/m);
  assert.equal(read(contents.backlogFiles[0] ?? '').match(/^## /gm)?.length, 2);
  assert.equal(read(contents.backlogFiles[1] ?? '').match(/^[0-9]+\. /gm)?.length, 2);

  // Two journal entries; the newer has the handover.
  assert.deepEqual(contents.journalEntries, [
    'memory/journal/live/2026-09-16_01.md',
    'memory/journal/live/2026-09-18_01.md',
  ]);
  assert.doesNotMatch(read(contents.journalEntries[0] ?? ''), /^## Handover$/m);
  assert.match(read(contents.journalEntries[1] ?? ''), /^## Handover$/m);

  // Two project contracts beside the core folder; one mirror node; a project process; a tooling card.
  assert.equal(contents.projectContracts.length, 2);
  assert.equal(
    contents.projectContracts.every((path) => !path.includes('/core/')),
    true,
  );
  assert.equal(
    fixture.loreFiles.filter((path) => path.startsWith('memory/blueprint/contracts/core/')).length,
    3,
  );
  // Contracts in both forms: a file each, and several as the sections of one contracts.spec.md.
  assert.deepEqual(contents.contractSpecFiles, ['memory/blueprint/contracts/contracts.spec.md']);
  const sections = [...read(contents.contractSpecFiles[0] ?? '').matchAll(/^## (.+)$/gm)];
  assert.deepEqual(
    sections.map((match) => match[1]),
    contents.contractSpecSections,
  );
  assert.equal(contents.contractSpecSections.length, 3);
  assert.equal(contents.mirrorNodes.length, 1);
  assert.equal(contents.projectProcesses.length, 1);
  assert.equal(contents.toolingCards.length, 1);

  // The draft spec: the product document, its image folder, the critique note; one other note.
  const focus = read(contents.inProgressFocus ?? '');
  assert.match(focus, /path: \.\.\/\.\.\/notepad\/product-document\.note\.md/);
  assert.match(focus, /path: \.\.\/\.\.\/notepad\/product-critique-2026-09-18\.note\.md/);
  assert.equal(contents.productImages.length, 2);
  for (const path of contents.productImages) {
    assert.equal(path.startsWith('memory/notepad/product-document/'), true);
    const bytes = readFileSync(join(fixture.lorePath, path));
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', path);
  }
  assert.equal(contents.otherNotes.length, 1);

  assert.equal(contents.savePoints.length, 2);
  assert.deepEqual(contents.tracks, ['memory/tracks/home.track.md']);
  assert.equal(contents.references.length, 2);

  // Every path the fixture names is a file of the Lore folder.
  const named = [
    contents.inProgressFocus,
    contents.productDocument,
    contents.critiqueNote,
    ...contents.stages,
    ...contents.pausedFocuses,
    ...contents.doneFocuses,
    ...contents.backlogFiles,
    ...contents.journalEntries,
    ...contents.projectContracts,
    ...contents.mirrorNodes,
    ...contents.projectProcesses,
    ...contents.toolingCards,
    ...contents.productImages,
    ...contents.otherNotes,
    ...contents.savePoints,
    ...contents.tracks,
    ...contents.references,
  ];
  for (const path of named)
    assert.equal(fixture.loreFiles.includes(path ?? ''), true, String(path));
});

test('makeV08Fixture holds what a copy "as it is" must decide about', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const { contents } = fixture;
  const at = (relative: string): string => join(fixture.lorePath, relative);
  const tracked = (await fixture.memory.git('-c', 'core.quotepath=false', 'ls-files', '-s'))
    .split('\n')
    .map((line) => {
      const [mode = '', , , ...name] = line.split(/\s+/);
      return { mode, path: `memory/${name.join(' ')}` };
    });
  const modeOf = (path: string): string | undefined =>
    tracked.find((entry) => entry.path === path)?.mode;

  // Ignored files: on the disk, in the list of the Lore's files, and in neither repository.
  assert.deepEqual(contents.ignoredFiles, [
    '.DS_Store',
    '.idea/workspace.xml',
    'memory/.DS_Store',
    'memory/notepad/.DS_Store',
  ]);
  for (const path of contents.ignoredFiles) {
    assert.equal(fixture.loreFiles.includes(path), true, path);
    assert.equal(modeOf(path), undefined, path);
  }
  assert.equal(
    await fixture.memory.git('status', '--porcelain', '--ignored'),
    ['!! .DS_Store', '!! notepad/.DS_Store'].join('\n'),
  );

  // A name with spaces and characters outside ASCII, committed under that name.
  assert.deepEqual(contents.oddNames, ['memory/notepad/Mapa de ideas — visión 1.0.mmap']);
  assert.equal(modeOf(contents.oddNames[0] ?? ''), '100644');
  assert.equal(readdirSync(at('memory/notepad')).includes('Mapa de ideas — visión 1.0.mmap'), true);

  // A symbolic link that stays inside the Lore folder, committed as a link.
  assert.deepEqual(contents.symlinks, ['memory/notepad/latest-critique.note.md']);
  assert.equal(lstatSync(at(contents.symlinks[0] ?? '')).isSymbolicLink(), true);
  assert.equal(readlinkSync(at(contents.symlinks[0] ?? '')), 'product-critique-2026-09-18.note.md');
  assert.equal(modeOf(contents.symlinks[0] ?? ''), '120000');

  // The executable bit, which git records.
  assert.deepEqual(contents.executableFiles, ['memory/blueprint/tooling/build-script.sh']);
  assert.equal((statSync(at(contents.executableFiles[0] ?? '')).mode & 0o111) !== 0, true);
  assert.equal(modeOf(contents.executableFiles[0] ?? ''), '100755');

  // An empty folder: on the disk only.
  assert.deepEqual(contents.emptyFolders, ['memory/notepad/empty-folder']);
  assert.deepEqual(readdirSync(at(contents.emptyFolders[0] ?? '')), []);

  // The option adds a link that leaves the Lore folder; the default tree has none.
  const withLink = await makeV08Fixture({ outsideLink: true });
  t.after(() => withLink.cleanup());
  assert.deepEqual(withLink.contents.symlinks, [
    'memory/notepad/latest-critique.note.md',
    'memory/notepad/outside.link',
  ]);
  const link = join(withLink.lorePath, 'memory', 'notepad', 'outside.link');
  assert.equal(realpathSync(link), realpathSync(join(withLink.root, 'README.md')));
  assert.equal(await withLink.memory.git('status', '--porcelain'), '');
});

test('makeV08Fixture is built in seconds', async (t) => {
  const started = Date.now();
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `the fixture took ${elapsed} ms to build`);
});

test('makeV08Fixture gives the same tree and the same commits on every build', async (t) => {
  const first = await makeV08Fixture();
  t.after(() => first.cleanup());
  const second = await makeV08Fixture();
  t.after(() => second.cleanup());
  assert.notEqual(first.root, second.root);
  assert.deepEqual(first.loreFiles, second.loreFiles);
  assert.equal(first.payloadHead, second.payloadHead);
  assert.equal(first.memoryHead, second.memoryHead);
});

test('makeV08Fixture with another core version builds the older tree, with the manifest at the top', async (t) => {
  const fixture = await makeV08Fixture({ coreVersion: '0.7', name: 'older-project' });
  t.after(() => fixture.cleanup());
  assert.equal(fixture.shape, 'older');
  assert.equal(fixture.coreVersion, '0.7');
  assert.equal(fixture.manifestLocation, 'lore-folder');
  assert.equal(fixture.lorePath, join(fixture.root, '.ai-lore-older-project'));
  assert.equal(
    readFileSync(join(fixture.lorePath, 'workspace.yaml'), 'utf8'),
    'project_name: older-project\ncore_version: "0.7"\n',
  );
  assert.equal(existsSync(join(fixture.memoryPath, 'workspace.yaml')), false);
  assert.equal(existsSync(join(fixture.memoryPath, 'status', 'status.stack.md')), false);
  assert.match(
    readFileSync(join(fixture.memoryPath, 'status', 'status.index.md'), 'utf8'),
    /^active_focus: \.\/focus\/demo\.focus\.md$/m,
  );
  assert.equal(fixture.contents.inProgressFocus, null);
  assert.deepEqual(fixture.contents.stages, []);
  assert.equal(await fixture.memory.git('status', '--porcelain'), '');
  assert.equal(await fixture.payload.git('status', '--porcelain'), '');

  const patch = await makeV08Fixture({ coreVersion: '0.8.1' });
  t.after(() => patch.cleanup());
  assert.equal(patch.shape, 'v0.8');
  assert.match(readFileSync(join(patch.memoryPath, 'workspace.yaml'), 'utf8'), /"0\.8\.1"/);
});

test('makeV08Fixture can leave changes that are not committed in both repositories', async (t) => {
  const fixture = await makeV08Fixture({ uncommitted: true });
  t.after(() => fixture.cleanup());
  assert.deepEqual(await statusOf(fixture.payload), byPath(fixture.uncommitted.payload));
  assert.deepEqual(await statusOf(fixture.memory), byPath(fixture.uncommitted.memory));
  assert.equal(fixture.uncommitted.payload.length, 2);
  assert.equal(fixture.uncommitted.memory.length, 2);
  assert.equal(await fixture.payload.git('rev-parse', 'HEAD'), fixture.payloadHead);
  assert.equal(await fixture.memory.git('rev-parse', 'HEAD'), fixture.memoryHead);
  // The uncommitted file of the Lore is in the list of the Lore's files: the working tree is what is copied.
  assert.equal(fixture.loreFiles.includes('memory/uncommitted-idea.note.md'), true);
});

test('makeV08Fixture removes everything on cleanup', async () => {
  const fixture = await makeV08Fixture();
  const parent = join(fixture.root, '..');
  assert.equal(existsSync(fixture.payloadRemote.dir), true);
  fixture.cleanup();
  assert.equal(existsSync(parent), false);
  fixture.cleanup();
});
