import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type FolderKind,
  LEGACY_LORE_PREFIX,
  LEGACY_MANIFEST_LOCATIONS,
  createGitPort,
  detectFolder,
  execFileRunner,
  isMigratableCoreVersion,
  legacyVersionStanding,
} from '../../src/index.js';
import {
  createScriptedRunner,
  makeSpaceFixture,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir, usePlainRepository, useTempDir } from '../support/index.js';

const deps = { git: createGitPort(execFileRunner) };

/** Detect `root` and return the verdict; a failure fails the test. */
async function verdictOf(root: string): Promise<FolderKind> {
  const result = await detectFolder(root, deps);
  if (!result.ok) throw new Error(`detection failed: ${result.error.message}`);
  assert.equal(result.value.root, root);
  assert.notEqual(result.value.reason.trim(), '', 'every verdict has a reason');
  return result.value;
}

/**
 * Every entry under `dir`, `.git` folders included, with what would show a
 * write: the kind, the size, the modification time and the content's hash.
 */
function snapshot(dir: string, relative = ''): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const shown = relative === '' ? name : `${relative}/${name}`;
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      entries[shown] = `link ${readlinkSync(path)}`;
    } else if (info.isDirectory()) {
      entries[shown] = `folder ${info.mtimeMs}`;
      Object.assign(entries, snapshot(path, shown));
    } else {
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      entries[shown] = `file ${info.size} ${info.mtimeMs} ${hash}`;
    }
  }
  return entries;
}

function writeLegacy(root: string, name: string, files: Record<string, string>): void {
  for (const [relative, text] of Object.entries(files)) {
    const path = join(root, `${LEGACY_LORE_PREFIX}${name}`, ...relative.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
}

// ---------- the three fixtures and the v0.7 variant ----------

test('a Space is recognised by its manifest card, and the verdict carries the manifest', async (t) => {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['example-app'],
  });
  t.after(() => fixture.cleanup());
  const verdict = await verdictOf(fixture.root);
  assert.equal(verdict.kind, 'space');
  if (verdict.kind !== 'space') return;
  assert.deepEqual(verdict.manifest, fixture.manifest);
  assert.match(verdict.reason, /the Space fixture-space/);
  assert.match(verdict.reason, /lore\/space\.md has type: space/);
});

test('the template before setup is a Space that has no name yet', async (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'lore'));
  writeFileSync(
    join(root, 'lore', 'space.md'),
    readFileSync(join(loreTemplateDir(), 'lore', 'space.md')),
  );
  const verdict = await verdictOf(root);
  assert.equal(verdict.kind, 'space');
  assert.match(verdict.reason, /setup has not named yet/);
});

test('a v0.8 project is legacy, found at memory/workspace.yaml, and can be migrated', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const verdict = await verdictOf(fixture.root);
  assert.deepEqual(
    { ...verdict, reason: '' },
    {
      kind: 'legacy',
      root: fixture.root,
      lorePath: fixture.lorePath,
      projectName: 'fixture-project',
      coreVersion: '0.8',
      manifestLocation: 'memory-folder',
      migratable: true,
      versionStanding: 'v0.8',
      reason: '',
    },
  );
  assert.match(verdict.reason, /\.ai-lore-fixture-project\/memory\/workspace\.yaml names it/);
  assert.match(verdict.reason, /core_version 0\.8\. It can be migrated/);
});

test('the v0.7 variant is legacy, found at workspace.yaml, and is told to reach v0.8 first', async (t) => {
  const fixture = await makeV08Fixture({ coreVersion: '0.7', name: 'older-project' });
  t.after(() => fixture.cleanup());
  const verdict = await verdictOf(fixture.root);
  assert.equal(verdict.kind, 'legacy');
  if (verdict.kind !== 'legacy') return;
  assert.equal(verdict.coreVersion, '0.7');
  assert.equal(verdict.manifestLocation, 'lore-folder');
  assert.equal(verdict.migratable, false);
  // What the migration screen needs for its "upgrade to v0.8 first" state: that the version is
  // older, which version it is, and the sentence that says so.
  assert.equal(verdict.versionStanding, 'older');
  assert.equal(verdict.projectName, 'older-project');
  assert.match(verdict.reason, /core_version 0\.7\. Migration accepts core_version 0\.8 only/);
  assert.match(verdict.reason, /upgraded to v0\.8 first/);
});

test('a plain repository is recognised, with its origin address when it has one', async (t) => {
  const repo = await usePlainRepository(t);
  const without = await verdictOf(repo.dir);
  assert.deepEqual(
    { ...without, reason: '' },
    { kind: 'plain-repository', root: repo.dir, originUrl: null, reason: '' },
  );
  assert.match(without.reason, /no remote named origin/);

  const remote = useTempDir(t);
  await repo.git('remote', 'add', 'origin', remote);
  const withOrigin = await verdictOf(repo.dir);
  assert.equal(withOrigin.kind === 'plain-repository' && withOrigin.originUrl, remote);
  assert.equal(withOrigin.reason.includes(`Its origin is ${remote}.`), true);
});

test('a folder with none of the markers is other, and a folder inside a repository is not a repository', async (t) => {
  const root = useTempDir(t);
  writeFileSync(join(root, 'notes.txt'), 'notes');
  const verdict = await verdictOf(root);
  assert.deepEqual({ ...verdict, reason: '' }, { kind: 'other', root, broken: null, reason: '' });
  assert.match(
    verdict.reason,
    /no lore\/space\.md, no \.ai-lore-<name> folder and no git repository/,
  );

  const repo = await usePlainRepository(t);
  mkdirSync(join(repo.dir, 'sub'));
  assert.equal((await verdictOf(join(repo.dir, 'sub'))).kind, 'other');
});

test('a path that is not a folder gives a failure, not a verdict', async (t) => {
  const root = useTempDir(t);
  writeFileSync(join(root, 'a-file'), 'x');
  const file = await detectFolder(join(root, 'a-file'), deps);
  assert.equal(!file.ok && file.error.kind, 'not-a-folder');
  const missing = await detectFolder(join(root, 'missing'), deps);
  assert.equal(!missing.ok && missing.error.kind, 'not-a-folder');
});

// ---------- detection never writes ----------

test('detection changes no file, no index and no modification time in any fixture', async (t) => {
  const space = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['example-app'],
  });
  t.after(() => space.cleanup());
  const v08 = await makeV08Fixture({ uncommitted: true });
  t.after(() => v08.cleanup());
  const v07 = await makeV08Fixture({ coreVersion: '0.7' });
  t.after(() => v07.cleanup());
  const plain = await usePlainRepository(t);
  const empty = useTempDir(t);

  for (const root of [space.root, v08.root, v07.root, plain.dir, empty]) {
    const before = snapshot(root);
    await verdictOf(root);
    await verdictOf(root);
    assert.deepEqual(snapshot(root), before, root);
  }
  assert.equal(await v08.payload.git('rev-parse', 'HEAD'), v08.payloadHead);
  assert.equal(await v08.memory.git('rev-parse', 'HEAD'), v08.memoryHead);
});

// ---------- malformed manifests ----------

test('a Space manifest that cannot be used gives other, and the folder is not offered as a plain repository', async (t) => {
  const cases: Array<[string, string, RegExp]> = [
    ['no frontmatter', "# The Space's manifest\n", /does not begin with frontmatter/],
    ['not closed', '---\ntype: space\n', /not closed/],
    ['outside the subset', "---\ntype: 'space'\n---\n", /line 2: .*single quotes/],
    ['a later format', '---\ntype: space\nformat: 2\n---\n', /format is 2/],
    ['keys missing', '---\ntype: space\nformat: 1\n---\n', /name must be text/],
  ];
  for (const [label, text, reason] of cases) {
    const repo = await usePlainRepository(t);
    repo.write('lore/space.md', text);
    const verdict = await verdictOf(repo.dir);
    assert.equal(verdict.kind, 'other', label);
    assert.equal(verdict.kind === 'other' && verdict.broken, 'space-manifest', label);
    assert.match(verdict.reason, /lore\/space\.md is there and cannot be used/, label);
    assert.match(verdict.reason, reason, label);
  }
});

test('a lore/space.md of another type is not the marker, and the other cases are tried', async (t) => {
  const repo = await usePlainRepository(t);
  repo.write('lore/space.md', '---\ntype: index\n---\n');
  assert.equal((await verdictOf(repo.dir)).kind, 'plain-repository');

  const folder = useTempDir(t);
  mkdirSync(join(folder, 'lore'));
  writeFileSync(join(folder, 'lore', 'space.md'), '---\ntype: index\n---\n');
  const verdict = await verdictOf(folder);
  assert.equal(verdict.kind, 'other');
  assert.match(verdict.reason, /is there without type: space/);
});

test('a legacy manifest that cannot be used gives other, with what is wrong', async (t) => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ['no manifest', { 'memory/status/status.index.md': '# Status\n' }, /has no workspace\.yaml/],
    ['not YAML', { 'memory/workspace.yaml': 'project_name: [unclosed\n' }, /is not valid YAML/],
    ['a list', { 'memory/workspace.yaml': '- project_name: demo\n' }, /is not a map/],
    [
      'no project_name',
      { 'memory/workspace.yaml': 'core_version: "0.8"\n' },
      /has no project_name/,
    ],
    [
      'another project_name',
      { 'memory/workspace.yaml': 'project_name: someone-else\ncore_version: "0.8"\n' },
      /has project_name someone-else, and the folder is named for demo/,
    ],
    ['the manifest is a folder', { 'memory/workspace.yaml/keep': '' }, /cannot be read/],
  ];
  for (const [label, files, reason] of cases) {
    const root = useTempDir(t);
    writeLegacy(root, 'demo', files);
    const verdict = await verdictOf(root);
    assert.equal(verdict.kind, 'other', label);
    assert.equal(verdict.kind === 'other' && verdict.broken, 'legacy-project', label);
    assert.match(verdict.reason, reason, label);
  }
});

test('the core version is read as text, and only 0.8 or a 0.8.x can be migrated', async (t) => {
  const cases: Array<[string, string | null, boolean]> = [
    ['core_version: "0.8"', '0.8', true],
    ['core_version: 0.8', '0.8', true],
    ['core_version: "0.8.1"', '0.8.1', true],
    ['core_version: 0.10', '0.10', false],
    ['core_version: "0.5.1"', '0.5.1', false],
    ['core_version: "0.9"', '0.9', false],
    ['', null, false],
  ];
  for (const [line, coreVersion, migratable] of cases) {
    const root = useTempDir(t);
    writeLegacy(root, 'demo', { 'memory/workspace.yaml': `project_name: demo\n${line}\n` });
    const verdict = await verdictOf(root);
    assert.equal(verdict.kind, 'legacy', line);
    if (verdict.kind !== 'legacy') continue;
    assert.equal(verdict.coreVersion, coreVersion, line);
    assert.equal(verdict.migratable, migratable, line);
  }
  const none = useTempDir(t);
  writeLegacy(none, 'demo', { 'workspace.yaml': 'project_name: demo\n' });
  assert.match((await verdictOf(none)).reason, /has no core_version/);
});

test('the manifest under memory/ is read before the one at the top of the Lore folder', async (t) => {
  const root = useTempDir(t);
  writeLegacy(root, 'demo', {
    'memory/workspace.yaml': 'project_name: demo\ncore_version: "0.8"\n',
    'workspace.yaml': 'project_name: demo\ncore_version: "0.7"\n',
  });
  const verdict = await verdictOf(root);
  assert.equal(verdict.kind === 'legacy' && verdict.manifestLocation, 'memory-folder');
  assert.equal(verdict.kind === 'legacy' && verdict.coreVersion, '0.8');
});

test('two Lore folders give other; a file with the Lore prefix is not a Lore folder', async (t) => {
  const two = useTempDir(t);
  writeLegacy(two, 'one', { 'memory/workspace.yaml': 'project_name: one\n' });
  writeLegacy(two, 'two', { 'memory/workspace.yaml': 'project_name: two\n' });
  const verdict = await verdictOf(two);
  assert.equal(verdict.kind === 'other' && verdict.broken, 'legacy-project');
  assert.match(
    verdict.reason,
    /more than one \.ai-lore-<name> folder \(\.ai-lore-one, \.ai-lore-two\)/,
  );

  const file = useTempDir(t);
  writeFileSync(join(file, '.ai-lore-notes'), 'a file');
  const plain = await verdictOf(file);
  assert.equal(plain.kind === 'other' && plain.broken, null);
});

// ---------- symbolic links ----------

test('detection does not follow a symbolic link out of the folder', async (t) => {
  const space = await makeSpaceFixture({ templateDir: loreTemplateDir() });
  t.after(() => space.cleanup());
  const v08 = await makeV08Fixture();
  t.after(() => v08.cleanup());

  // lore/ links to the Lore of a real Space elsewhere.
  const linkedLore = useTempDir(t);
  symlinkSync(space.paths.lore, join(linkedLore, 'lore'));
  const lore = await verdictOf(linkedLore);
  assert.equal(lore.kind === 'other' && lore.broken, 'space-manifest');
  assert.match(lore.reason, /outside/);

  // The Lore folder links to the Lore folder of a real project elsewhere.
  const linkedLegacy = useTempDir(t);
  symlinkSync(v08.lorePath, join(linkedLegacy, '.ai-lore-fixture-project'));
  const legacy = await verdictOf(linkedLegacy);
  assert.equal(legacy.kind === 'other' && legacy.broken, 'legacy-project');
  assert.match(legacy.reason, /symbolic link that leaves the folder, and is not followed/);

  // Only the manifest links out.
  const linkedManifest = useTempDir(t);
  mkdirSync(join(linkedManifest, '.ai-lore-fixture-project', 'memory'), { recursive: true });
  symlinkSync(
    join(v08.memoryPath, 'workspace.yaml'),
    join(linkedManifest, '.ai-lore-fixture-project', 'memory', 'workspace.yaml'),
  );
  const manifest = await verdictOf(linkedManifest);
  assert.equal(manifest.kind === 'other' && manifest.broken, 'legacy-project');
  assert.match(manifest.reason, /leaves the folder, and is not read/);

  // .git links to the git folder of a repository elsewhere.
  const plain = await usePlainRepository(t);
  const linkedGit = useTempDir(t);
  symlinkSync(join(plain.dir, '.git'), join(linkedGit, '.git'));
  const git = await verdictOf(linkedGit);
  assert.equal(git.kind, 'other');
  assert.match(git.reason, /\.git is a symbolic link that leaves the folder/);
});

test('a Lore folder that is a link to a folder inside the opened folder is followed', async (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'kept', 'memory'), { recursive: true });
  writeFileSync(
    join(root, 'kept', 'memory', 'workspace.yaml'),
    'project_name: demo\ncore_version: "0.8"\n',
  );
  symlinkSync(join(root, 'kept'), join(root, '.ai-lore-demo'));
  const verdict = await verdictOf(root);
  assert.equal(verdict.kind === 'legacy' && verdict.migratable, true);
});

// ---------- git cannot be run ----------

test('when git cannot be run, a folder with .git is still a plain repository, and the reason says so', async (t) => {
  const repo = await usePlainRepository(t);
  const runner = createScriptedRunner([
    { bin: 'git', reply: { code: -1, failure: 'not-found', stderr: 'git was not found' } },
  ]);
  const result = await detectFolder(repo.dir, { git: createGitPort(runner) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, 'plain-repository');
  assert.equal(result.value.kind === 'plain-repository' && result.value.originUrl, null);
  assert.match(result.value.reason, /origin address was not read: git was not found/);
  // Every git command detection asked for is a read command.
  for (const call of runner.calls) assert.equal(call.args[0], '--no-optional-locks');
});

test('a .git entry that git does not read as a repository gives other', async (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, '.git'));
  const verdict = await verdictOf(root);
  assert.equal(verdict.kind, 'other');
  assert.match(verdict.reason, /does not read as a repository/);
});

// ---------- folders that try to be two things, or the wrong one ----------

const SPACE_MANIFEST_TEXT = [
  '---',
  'type: space',
  'format: 1',
  'name: both',
  'github:',
  '  repository: ""',
  '  project: 0',
  'repositories: []',
  'publish_areas: []',
  '---',
  '',
].join('\n');

/** Detect `root` twice and require that nothing under `watched` changed. */
async function verdictWithoutWrites(root: string, watched = root): Promise<FolderKind> {
  const before = snapshot(watched);
  const verdict = await verdictOf(root);
  await verdictOf(root);
  assert.deepEqual(snapshot(watched), before, `detection changed something under ${watched}`);
  return verdict;
}

test('a folder with both markers is a Space, and the reason names the legacy Lore folder', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  mkdirSync(join(fixture.root, 'lore'), { recursive: true });
  writeFileSync(join(fixture.root, 'lore', 'space.md'), SPACE_MANIFEST_TEXT);
  const verdict = await verdictWithoutWrites(fixture.root);
  assert.equal(verdict.kind, 'space');
  assert.match(verdict.reason, /also has \.ai-lore-fixture-project/);
});

test('a legacy project inside a Space does not change what the Space is, and is legacy when opened itself', async (t) => {
  const space = await makeSpaceFixture({ templateDir: loreTemplateDir() });
  t.after(() => space.cleanup());
  const inner = join(space.root, 'repos', 'app');
  writeLegacy(inner, 'app', {
    'memory/workspace.yaml': 'project_name: app\ncore_version: "0.8"\n',
  });
  assert.equal((await verdictWithoutWrites(space.root)).kind, 'space');
  assert.equal((await verdictWithoutWrites(inner)).kind, 'legacy');
});

test('a lore/space.md that was not read as far as type: space does not hide a legacy project', async (t) => {
  const texts: Array<[string, string]> = [
    ['no frontmatter', '# Notes about space\n'],
    ['frontmatter of another tool', '---\ntags: [a, b]\n---\n'],
    ['another type', '---\ntype: index\n---\n'],
  ];
  for (const [label, text] of texts) {
    const root = useTempDir(t);
    writeLegacy(root, 'demo', {
      'memory/workspace.yaml': 'project_name: demo\ncore_version: "0.8"\n',
    });
    mkdirSync(join(root, 'lore'));
    writeFileSync(join(root, 'lore', 'space.md'), text);
    const verdict = await verdictWithoutWrites(root);
    assert.equal(verdict.kind, 'legacy', label);
  }
  // A file that says type: space and is damaged is a damaged Space, whatever else is there.
  const damaged = useTempDir(t);
  writeLegacy(damaged, 'demo', {
    'memory/workspace.yaml': 'project_name: demo\ncore_version: "0.8"\n',
  });
  mkdirSync(join(damaged, 'lore'));
  writeFileSync(join(damaged, 'lore', 'space.md'), '---\ntype: space\nformat: 1\n---\n');
  const verdict = await verdictWithoutWrites(damaged);
  assert.equal(verdict.kind === 'other' && verdict.broken, 'space-manifest');
});

test('the Lore folder of a legacy project, or its memory folder, opened directly is not offered as a repository', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  for (const opened of [fixture.lorePath, join(fixture.lorePath, 'memory')]) {
    const verdict = await verdictWithoutWrites(opened, fixture.root);
    assert.equal(verdict.kind, 'other', opened);
    assert.equal(verdict.kind === 'other' && verdict.broken, 'legacy-project', opened);
    assert.ok(verdict.reason.includes(`${fixture.root};`), verdict.reason);
    assert.match(verdict.reason, /open that folder instead/);
  }
  const older = await makeV08Fixture({ coreVersion: '0.7' });
  t.after(() => older.cleanup());
  const olderVerdict = await verdictOf(older.lorePath);
  assert.equal(olderVerdict.kind === 'other' && olderVerdict.broken, 'legacy-project');
  // A folder that only has the name, and no manifest, is judged like any other folder.
  const named = join(useTempDir(t), '.ai-lore-empty');
  mkdirSync(named);
  const plain = await verdictOf(named);
  assert.equal(plain.kind === 'other' && plain.broken, null);
});

test('a manifest of 50 MB is not read, for a Space and for a legacy project, and detection stays fast', async (t) => {
  const size = 50 * 1024 * 1024;
  const space = useTempDir(t);
  mkdirSync(join(space, 'lore'));
  writeFileSync(join(space, 'lore', 'space.md'), SPACE_MANIFEST_TEXT);
  truncateSync(join(space, 'lore', 'space.md'), size);
  const legacy = useTempDir(t);
  writeLegacy(legacy, 'demo', {
    'memory/workspace.yaml': 'project_name: demo\ncore_version: "0.8"\n',
  });
  truncateSync(join(legacy, '.ai-lore-demo', 'memory', 'workspace.yaml'), size);

  const started = Date.now();
  const spaceVerdict = await verdictOf(space);
  const legacyVerdict = await verdictOf(legacy);
  const elapsed = Date.now() - started;
  assert.equal(spaceVerdict.kind === 'other' && spaceVerdict.broken, 'space-manifest');
  assert.match(spaceVerdict.reason, /52428800 bytes/);
  assert.equal(legacyVerdict.kind === 'other' && legacyVerdict.broken, 'legacy-project');
  assert.match(legacyVerdict.reason, /52428800 bytes/);
  assert.ok(elapsed < 1000, `two detections took ${elapsed} ms`);
});

test('every spelling of core_version gives a verdict, with where it stands against v0.8', async (t) => {
  const cases: Array<[string, string | null, boolean, string]> = [
    ['core_version: "0.8"', '0.8', true, 'v0.8'],
    ['core_version: 0.8', '0.8', true, 'v0.8'],
    ['core_version: "0.8.0"', '0.8.0', true, 'v0.8'],
    ['core_version: "v0.8"', 'v0.8', false, 'unknown'],
    ['core_version: "0.7"', '0.7', false, 'older'],
    ['core_version: 0.7', '0.7', false, 'older'],
    ['core_version: "0.6"', '0.6', false, 'older'],
    ['core_version: "0.5.1"', '0.5.1', false, 'older'],
    ['core_version: "1.0"', '1.0', false, 'newer'],
    ['core_version: 1', '1', false, 'newer'],
    ['core_version: "0.10"', '0.10', false, 'newer'],
    ['core_version: 0.10', '0.10', false, 'newer'],
    ['core_version: "0.9"', '0.9', false, 'newer'],
    ['core_version: "0.80"', '0.80', false, 'newer'],
    ['core_version: ""', null, false, 'unknown'],
    ['core_version:', null, false, 'unknown'],
    ['core_version: [0.8]', null, false, 'unknown'],
    ['core_version: latest', 'latest', false, 'unknown'],
    ['', null, false, 'unknown'],
  ];
  for (const [line, coreVersion, migratable, standing] of cases) {
    const root = useTempDir(t);
    writeLegacy(root, 'demo', { 'memory/workspace.yaml': `project_name: demo\n${line}\n` });
    const verdict = await verdictOf(root);
    assert.equal(verdict.kind, 'legacy', line);
    if (verdict.kind !== 'legacy') continue;
    assert.equal(verdict.coreVersion, coreVersion, line);
    assert.equal(verdict.migratable, migratable, line);
    assert.equal(verdict.versionStanding, standing, line);
    assert.equal(legacyVersionStanding(coreVersion), standing, line);
    // Only an older version is told to upgrade to v0.8 first; a newer one is not.
    assert.equal(
      /upgraded to v0\.8 first/.test(verdict.reason),
      standing === 'older' || coreVersion === null,
      line,
    );
  }
});

test('a folder or a manifest that cannot be read gives a failure or a verdict, never an exception', async (t) => {
  if (process.getuid?.() === 0) return t.skip('the super-user reads every folder');
  /** Run `body` with `path` closed to everyone, and open it again so that the cleanup can remove it. */
  const whileLocked = async (path: string, body: () => Promise<void>): Promise<void> => {
    chmodSync(path, 0o000);
    try {
      await body();
    } finally {
      chmodSync(path, 0o700);
    }
  };

  const locked = useTempDir(t);
  await whileLocked(locked, async () => {
    const unreadable = await detectFolder(locked, deps);
    assert.equal(!unreadable.ok && unreadable.error.kind, 'folder-unreadable');
  });

  const space = useTempDir(t);
  mkdirSync(join(space, 'lore'));
  writeFileSync(join(space, 'lore', 'space.md'), SPACE_MANIFEST_TEXT);
  await whileLocked(join(space, 'lore'), async () => {
    const verdict = await verdictOf(space);
    assert.equal(verdict.kind === 'other' && verdict.broken, 'space-manifest');
  });

  const legacy = useTempDir(t);
  writeLegacy(legacy, 'demo', { 'memory/workspace.yaml': 'project_name: demo\n' });
  await whileLocked(join(legacy, '.ai-lore-demo'), async () => {
    const verdict = await verdictOf(legacy);
    assert.equal(verdict.kind === 'other' && verdict.broken, 'legacy-project');
  });
});

test('a path that does not exist, an empty path with a file, and a path with a NUL give a failure', async (t) => {
  const dir = useTempDir(t);
  for (const path of [join(dir, 'missing'), join(dir, 'missing', 'deeper'), `${dir}\0x`]) {
    const result = await detectFolder(path, deps);
    assert.equal(!result.ok && result.error.kind, 'not-a-folder', JSON.stringify(path));
  }
});

test('a GitPort that rejects gives a failure, not an exception', async (t) => {
  const repo = await usePlainRepository(t);
  const rejecting = {
    ...deps.git,
    isRepository: (): Promise<never> => Promise.reject(new Error('the port broke')),
  };
  const result = await detectFolder(repo.dir, { git: rejecting });
  assert.equal(!result.ok && result.error.kind, 'folder-unreadable');
  assert.match(result.ok ? '' : result.error.message, /the port broke/);
});

// ---------- the small exported names ----------

test('legacyVersionStanding compares the numbers as numbers', () => {
  assert.equal(legacyVersionStanding('0.8'), 'v0.8');
  assert.equal(legacyVersionStanding('0.8.3'), 'v0.8');
  assert.equal(legacyVersionStanding('0.7.9'), 'older');
  assert.equal(legacyVersionStanding('0'), 'older');
  assert.equal(legacyVersionStanding('0.10'), 'newer');
  assert.equal(legacyVersionStanding('1.0'), 'newer');
  assert.equal(legacyVersionStanding('v0.8'), 'unknown');
  assert.equal(legacyVersionStanding('0.8-rc1'), 'unknown');
  assert.equal(legacyVersionStanding(null), 'unknown');
});

test('isMigratableCoreVersion accepts 0.8 and 0.8.x only', () => {
  assert.equal(isMigratableCoreVersion('0.8'), true);
  assert.equal(isMigratableCoreVersion('0.8.0'), true);
  assert.equal(isMigratableCoreVersion('0.8.12'), true);
  assert.equal(isMigratableCoreVersion('0.80'), false);
  assert.equal(isMigratableCoreVersion('0.7'), false);
  assert.equal(isMigratableCoreVersion('1.0'), false);
  assert.equal(isMigratableCoreVersion('0.8-rc1'), false);
  assert.equal(isMigratableCoreVersion(null), false);
});

test('the legacy markers are the v0.8 manifest place first, then the older one', () => {
  assert.equal(LEGACY_LORE_PREFIX, '.ai-lore-');
  assert.deepEqual(LEGACY_MANIFEST_LOCATIONS, [
    { location: 'memory-folder', relativePath: 'memory/workspace.yaml' },
    { location: 'lore-folder', relativePath: 'workspace.yaml' },
  ]);
});
