import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type CommandRunner,
  type V08Description,
  execFileRunner,
  readV08Project,
} from '../../src/index.js';
import { type V08Fixture, makeTempDir, makeV08Fixture } from '../../src/space/testing/index.js';

/** A runner that records every command and runs it for real. */
function recordingRunner(): { runner: CommandRunner; calls: { bin: string; args: string[] }[] } {
  const calls: { bin: string; args: string[] }[] = [];
  return {
    calls,
    runner: {
      run(bin, args, opts) {
        calls.push({ bin, args: [...args] });
        return execFileRunner.run(bin, args, opts);
      },
    },
  };
}

type RepoState = { head: string; status: string; index: string };

/** The head, `git status` and the index file's hash of one repository, read without taking git's lock. */
async function stateOf(repo: V08Fixture['payload']): Promise<RepoState> {
  const head = await repo.git('rev-parse', 'HEAD');
  const status = await repo.git('--no-optional-locks', 'status', '--porcelain');
  const index = createHash('sha256')
    .update(readFileSync(join(repo.dir, '.git', 'index')))
    .digest('hex');
  return { head, status, index };
}

/** Read the fixture, and assert that neither source repository changed while it was read. */
async function readUntouched(
  fixture: V08Fixture,
  options: Parameters<typeof readV08Project>[2] = {},
): Promise<Awaited<ReturnType<typeof readV08Project>>> {
  const before = [await stateOf(fixture.payload), await stateOf(fixture.memory)];
  const { runner, calls } = recordingRunner();
  const result = await readV08Project(fixture.root, { runner }, options);
  const after = [await stateOf(fixture.payload), await stateOf(fixture.memory)];
  assert.deepEqual(
    after,
    before,
    'the head, the status and the index of both repositories are unchanged',
  );
  for (const call of calls) {
    assert.equal(call.bin, 'git');
    assert.equal(call.args[0], '--no-optional-locks', call.args.join(' '));
    const command = call.args
      .slice(1)
      .filter((arg, i, all) => arg !== '-c' && all[i - 1] !== '-c')[0];
    assert.ok(
      ['rev-parse', 'status', 'remote', 'config'].includes(command ?? ''),
      call.args.join(' '),
    );
  }
  return result;
}

function described(result: Awaited<ReturnType<typeof readV08Project>>): V08Description {
  if (!result.ok) throw new Error(`read failed: ${result.error.message}`);
  return result.value;
}

test('readV08Project describes every kind of content of the v0.8 fixture', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const d = described(await readUntouched(fixture, { hashes: true }));
  const { contents } = fixture;
  const lore = `.ai-lore-${fixture.projectName}`;
  const shown = (paths: readonly string[]): string[] => paths.map((path) => `${lore}/${path}`);

  assert.equal(d.complete, true);
  assert.deepEqual(d.problems, []);
  assert.equal(d.loreFolder, lore);
  assert.equal(d.project.name, 'fixture-project');
  assert.equal(d.project.namePath, `${lore}/memory/workspace.yaml`);
  assert.deepEqual(d.project.descriptionCandidates, [
    { path: 'README.md', text: 'The payload of the v0.8 fixture.' },
  ]);
  assert.deepEqual(d.core, {
    version: '0.8',
    standing: 'v0.8',
    manifestPath: `${lore}/memory/workspace.yaml`,
    manifestLocation: 'memory-folder',
  });

  // Both repositories: origin, branch, head, no uncommitted change.
  for (const [repo, remote, head, path] of [
    [d.payloadRepository, fixture.payloadRemote, fixture.payloadHead, '.'],
    [d.loreRepository, fixture.memoryRemote, fixture.memoryHead, `${lore}/memory`],
  ] as const) {
    assert.equal(repo.path, path);
    assert.equal(repo.present, true);
    assert.equal(repo.originUrl, remote.dir);
    assert.equal(repo.branch, 'main');
    assert.equal(repo.detached, false);
    assert.equal(repo.head, head);
    assert.equal(repo.hasUncommittedChanges, false);
    assert.equal(repo.changedCount, 0);
  }

  // Contracts outside core/: two with a "The contract" section, one file with several.
  assert.deepEqual(
    d.contracts.map((contract) => contract.path),
    shown([...contents.contractSpecFiles, ...contents.projectContracts].sort()),
  );
  const spec = d.contracts.find((contract) => contract.path.endsWith('contracts.spec.md'));
  assert.equal(spec?.holdsSeveral, true);
  assert.equal(spec?.ruleSource, 'whole-body');
  assert.deepEqual(
    spec?.sections.map((section) => section.heading),
    contents.contractSpecSections,
  );
  const single = d.contracts.find((contract) =>
    contract.path.endsWith('typescript-everywhere.contract.md'),
  );
  assert.equal(single?.ruleSource, 'the-contract-section');
  assert.equal(single?.rule, 'Every source file of the payload is TypeScript.');
  assert.equal(single?.holdsSeveral, false);

  // The mirror: prose without the title.
  assert.deepEqual(
    d.mirror.map((node) => [node.path, node.target]),
    [[`${lore}/${contents.mirrorNodes[0]}`, 'packages/app']],
  );
  assert.match(d.mirror[0]?.prose ?? '', /^\*\*What it is\.\*\*/);

  // Focuses from the registry, with their stages and phases.
  assert.equal(d.stackPath, `${lore}/memory/status/status.stack.md`);
  assert.deepEqual(
    d.focuses.map((focus) => [focus.name, focus.status, focus.activeTrack, focus.inStack]),
    [
      ['build-the-thing', 'in progress', 'home', true],
      ['port-to-linux', 'paused', null, true],
      ['side-helper', 'paused', null, true],
    ],
  );
  const [active, linux, helper] = d.focuses;
  assert.equal(active?.bodyPath, `${lore}/${contents.inProgressFocus}`);
  assert.equal(active?.title, 'Build the thing');
  assert.equal(active?.folderPath, `${lore}/memory/status/build-the-thing`);
  assert.deepEqual(
    active?.stages.map((stage) => [stage.path, stage.status]),
    [
      [`${lore}/${contents.stages[0]}`, 'done'],
      [`${lore}/${contents.stages[1]}`, 'in progress'],
      [`${lore}/${contents.stages[2]}`, 'draft'],
    ],
  );
  assert.deepEqual(
    active?.stages[1]?.phases.map((phase) => [phase.title, phase.status]),
    [['B2.1 — first step', 'in progress']],
  );
  assert.deepEqual(active?.loosePhases, []);
  assert.deepEqual([linux?.bodyPath, helper?.bodyPath], shown(contents.pausedFocuses));
  assert.equal(linux?.stages.length, 1);
  assert.equal(helper?.stages.length, 0);

  // Finished focuses: a folder, a folder with no focus file, a single file.
  assert.deepEqual(
    d.finishedFocuses.map((focus) => [
      focus.name,
      focus.bodyPath,
      focus.folderPath,
      focus.fileCount,
    ]),
    [
      [
        'earlier-work',
        `${lore}/memory/status/archive/earlier-work/earlier-work.focus.md`,
        `${lore}/memory/status/archive/earlier-work`,
        4,
      ],
      ['first-prototype', null, `${lore}/${contents.doneFocusFoldersWithoutFile[0]}`, 2],
      ['single-file-work', `${lore}/memory/status/archive/single-file-work.focus.md`, null, 1],
    ],
  );
  // A folder with no focus file takes its title from its index.
  assert.equal(
    d.finishedFocuses.find((focus) => focus.name === 'first-prototype')?.title,
    'First prototype',
  );

  // Backlog: an item file is one entry; a backlog file has one entry per section other than
  // Purpose and Journal trail, or one per list item.
  assert.deepEqual(
    d.backlog.map((file) => [file.path, file.entriesFrom, file.entries.map((e) => e.title)]),
    [
      [`${lore}/${contents.backlogItems[0]}`, 'whole-file', ['Richer history in the browser tab']],
      [
        `${lore}/${contents.backlogFiles[0]}`,
        'sections',
        ['A first parked item', 'A second parked item'],
      ],
      [`${lore}/${contents.backlogFiles[1]}`, 'list-items', ['A finding.', 'Another finding.']],
    ],
  );
  assert.equal(d.backlog[0]?.entries[0]?.text, 'Keep more of the history and search it.');

  // Journal: dates, the newest entry and its handover.
  assert.deepEqual(
    d.journal.entries.map((entry) => [entry.path, entry.date]),
    [
      [`${lore}/${contents.journalEntries[0]}`, '2026-09-16'],
      [`${lore}/${contents.journalEntries[1]}`, '2026-09-18'],
    ],
  );
  assert.equal(d.journal.newestEntry, `${lore}/${contents.journalEntries[1]}`);
  assert.equal(d.journal.newestHandover?.fromNewestEntry, true);
  assert.match(d.journal.newestHandover?.text ?? '', /^Next: finish the first step/);
  assert.equal(d.journal.archivedCount, 1);

  // Notepad: the product document, its images and the critique note, by the focus's references rows.
  assert.equal(d.notepad.productDocument, `${lore}/${contents.productDocument}`);
  assert.deepEqual(d.notepad.productImages, shown(contents.productImages));
  assert.equal(d.notepad.critiqueNote, `${lore}/${contents.critiqueNote}`);
  assert.match(d.notepad.recognisedBy.productDocument, /"Product document"/);
  const roles = new Map(d.notepad.notes.map((note) => [note.path, note.role]));
  assert.equal(roles.get(`${lore}/${contents.productDocument}`), 'product-document');
  assert.equal(roles.get(`${lore}/${contents.critiqueNote}`), 'critique-note');
  for (const note of contents.otherNotes) assert.equal(roles.get(`${lore}/${note}`), 'note');

  // The kinds that go to the archive only.
  assert.deepEqual(
    d.processes.map((doc) => doc.path),
    shown(contents.projectProcesses),
  );
  assert.deepEqual(
    d.toolingCards.map((doc) => doc.path),
    shown(contents.toolingCards),
  );
  assert.deepEqual(d.projectVerbs, []);
  assert.deepEqual(
    d.savePoints.map((doc) => doc.path),
    shown(contents.savePoints),
  );
  assert.deepEqual(
    d.tracks.map((doc) => doc.path),
    shown(contents.tracks),
  );
  assert.deepEqual(
    d.references.map((doc) => doc.path),
    shown(contents.references.filter((path) => !path.endsWith('.index.md'))),
  );
  for (const path of [
    ...contents.oddNames,
    ...contents.executableFiles,
    ...contents.ignoredFiles,
    'memory/.gitignore',
  ]) {
    assert.ok(d.unmatched.includes(`${lore}/${path}`), path);
  }

  // Every file of the Lore folder is listed once.
  assert.deepEqual(
    d.files.map((file) => file.path),
    shown(fixture.loreFiles),
  );

  // The archive copy: memory/ and references/, and ai_readme.md, counts, size, hashes, the link inside, the empty folder.
  const archived = fixture.loreFiles.filter(
    (path) =>
      path.startsWith('memory/') || path.startsWith('references/') || path === 'ai_readme.md',
  );
  assert.deepEqual(d.archive.roots, shown(['memory', 'references']));
  assert.equal(d.archive.fileCount, archived.length);
  assert.equal(
    d.archive.totalBytes,
    archived.reduce((sum, path) => sum + statSync(join(fixture.lorePath, path)).size, 0),
  );
  assert.equal(d.archive.linkCount, 1);
  assert.deepEqual(d.archive.refusedLinks, []);
  assert.deepEqual(d.archive.emptyFolders, shown(contents.emptyFolders));
  for (const file of d.files) {
    const rel = file.path.slice(lore.length + 1);
    if (!file.archived) {
      assert.equal(file.sha256, null, rel);
      continue;
    }
    const expected = createHash('sha256')
      .update(readFileSync(join(fixture.lorePath, rel)))
      .digest('hex');
    assert.equal(file.sha256, expected, rel);
  }
  const link = d.files.find((file) => file.link !== null);
  assert.equal(link?.link?.standing, 'inside');
});

test('readV08Project reports uncommitted changes in both repositories and changes nothing', async (t) => {
  const fixture = await makeV08Fixture({ uncommitted: true });
  t.after(() => fixture.cleanup());
  const d = described(await readUntouched(fixture));
  assert.equal(d.payloadRepository.hasUncommittedChanges, true);
  assert.equal(d.payloadRepository.changedCount, 2);
  assert.match(d.payloadRepository.statusText, /scratch\.txt/);
  assert.equal(d.loreRepository.hasUncommittedChanges, true);
  assert.equal(d.loreRepository.changedCount, 2);
  assert.match(d.loreRepository.statusText, /uncommitted-idea\.note\.md/);
});

test('readV08Project reports a link that leaves the project and does not follow it', async (t) => {
  const fixture = await makeV08Fixture({ outsideLink: true });
  t.after(() => fixture.cleanup());
  const d = described(await readUntouched(fixture, { hashes: true }));
  const path = `.ai-lore-${fixture.projectName}/memory/notepad/outside.link`;
  const file = d.files.find((entry) => entry.path === path);
  assert.equal(file?.link?.standing, 'outside');
  assert.equal(file?.sha256, null);
  assert.equal(file?.size, 0);
  assert.deepEqual(d.archive.refusedLinks, [path]);
  const problem = d.problems.find((entry) => entry.path === path);
  assert.equal(problem?.kind, 'outside-link');
  assert.match(problem?.message ?? '', /not followed/);
});

test('readV08Project tells a v0.7 project to upgrade to v0.8 first', async (t) => {
  const fixture = await makeV08Fixture({ coreVersion: '0.7' });
  t.after(() => fixture.cleanup());
  const result = await readUntouched(fixture);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, 'older-than-v0.8');
  assert.equal(result.error.versionStanding, 'older');
  assert.equal(result.error.coreVersion, '0.7');
  assert.match(result.error.message, /upgrade the project to v0\.8 first/);
});

test('readV08Project refuses a folder that is not a legacy project, with a reason', async (t) => {
  const temp = makeTempDir('ai-lore-legacy-');
  t.after(() => temp.cleanup());
  const result = await readV08Project(temp.dir, { runner: execFileRunner });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'not-a-legacy-project');
});

test('readV08Project turns bad content into problems and reads the shapes a real Lore has', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const memory = (rel: string): string => join(fixture.memoryPath, ...rel.split('/'));
  const put = (rel: string, text: string | Buffer): void => {
    mkdirSync(join(memory(rel), '..'), { recursive: true });
    writeFileSync(memory(rel), text);
  };
  // Frontmatter that is not YAML; a file too large to read as text; a file that cannot be read.
  put('notepad/broken.note.md', '---\ntitle: [unclosed\n---\n# Broken\n');
  put('notepad/huge.note.md', `# Huge\n\n${'x'.repeat(4096)}\n`);
  put('notepad/locked.note.md', '# Locked\n');
  chmodSync(memory('notepad/locked.note.md'), 0o000);
  // A newer journal entry with no handover, and an older one whose heading only begins with Handover.
  put(
    'journal/live/2026-09-19_01.md',
    '---\ntype: journal\ndate: 2026-09-19\n---\n# Late\n\n## What happened\n\nx\n',
  );
  put(
    'journal/live/2026-09-17_01.md',
    "---\ntype: journal\n---\n# Mid\n\n## Handover — where the work stands, what's next\n\nNext: z.\n",
  );
  // A focus folder the registry has no row for; an archived focus that is a file beside a folder.
  put(
    'status/stray/stray.focus.md',
    '---\ntype: focus\ntitle: Stray\nstatus: draft\n---\n# Stray\n',
  );
  put(
    'status/archive/cockpit.focus.md',
    '---\ntype: focus\ntitle: Cockpit\nstatus: Achieved\n---\n# Cockpit\n',
  );
  put('status/archive/cockpit/A-step.phase.md', '# A step\n');
  // An image in the product document's folder that the document does not show.
  put('notepad/product-document/companion/Extra.jpg', 'not really a jpg');

  const d = described(await readUntouched(fixture, { maxTextBytes: 1024 }));
  const lore = `.ai-lore-${fixture.projectName}`;
  const kinds = new Map(d.problems.map((problem) => [problem.path, problem.kind]));
  assert.equal(kinds.get(`${lore}/memory/notepad/broken.note.md`), 'bad-frontmatter');
  assert.equal(kinds.get(`${lore}/memory/notepad/huge.note.md`), 'too-large');
  if (process.getuid?.() !== 0) {
    assert.equal(kinds.get(`${lore}/memory/notepad/locked.note.md`), 'unreadable');
  }
  for (const problem of d.problems) assert.notEqual(problem.message.trim(), '');
  // The large file is still listed with its size.
  assert.ok((d.files.find((file) => file.path.endsWith('huge.note.md'))?.size ?? 0) > 4096);

  assert.equal(d.journal.newestEntry, `${lore}/memory/journal/live/2026-09-19_01.md`);
  assert.equal(d.journal.newestHandover?.path, `${lore}/memory/journal/live/2026-09-18_01.md`);
  assert.equal(d.journal.newestHandover?.fromNewestEntry, false);
  assert.equal(
    d.journal.entries.find((entry) => entry.path.endsWith('2026-09-17_01.md'))?.date,
    '2026-09-17',
  );

  const stray = d.focuses.find((focus) => focus.name === 'stray');
  assert.deepEqual([stray?.inStack, stray?.status, stray?.title], [false, 'draft', 'Stray']);
  const cockpit = d.finishedFocuses.find((focus) => focus.name === 'cockpit');
  assert.deepEqual(
    [cockpit?.bodyPath, cockpit?.folderPath, cockpit?.statusText, cockpit?.fileCount],
    [
      `${lore}/memory/status/archive/cockpit.focus.md`,
      `${lore}/memory/status/archive/cockpit`,
      'Achieved',
      2,
    ],
  );
  assert.ok(
    d.notepad.productImages.includes(`${lore}/memory/notepad/product-document/companion/Extra.jpg`),
  );
});

test('readV08Project takes the product document and critique note by name when asked', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const lore = `.ai-lore-${fixture.projectName}`;
  const d = described(
    await readUntouched(fixture, {
      productDocumentPath: `${lore}/memory/notepad/renderer-imports.note.md`,
      critiqueNotePath: `${lore}/memory/notepad/missing.note.md`,
    }),
  );
  assert.equal(d.notepad.productDocument, `${lore}/memory/notepad/renderer-imports.note.md`);
  assert.deepEqual(d.notepad.productImages, []);
  assert.equal(d.notepad.critiqueNote, null);
  assert.match(d.notepad.recognisedBy.productDocument, /option/);
});

test('readV08Project stops at its file and time limits and says the description is not complete', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const few = described(await readUntouched(fixture, { maxFiles: 5 }));
  assert.equal(few.complete, false);
  assert.equal(few.files.length, 5);
  assert.equal(
    few.problems.some((problem) => problem.kind === 'limit-reached'),
    true,
  );
  const none = described(await readUntouched(fixture, { timeBudgetMs: -1 }));
  assert.equal(none.complete, false);
});

test('readV08Project reads a Lore of several thousand files within a bounded time', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const bulk = join(fixture.memoryPath, 'journal', 'archive', 'bulk');
  mkdirSync(bulk);
  for (let i = 0; i < 5000; i += 1) {
    writeFileSync(
      join(bulk, `${String(i).padStart(4, '0')}.md`),
      `# Entry ${i}\n\n## Handover\n\nNothing.\n`,
    );
  }
  const started = Date.now();
  const d = described(await readUntouched(fixture, { hashes: true }));
  const elapsed = Date.now() - started;
  assert.equal(d.complete, true);
  assert.equal(d.journal.archivedCount, 5001);
  assert.ok(d.archive.fileCount > 5000);
  assert.ok(elapsed < 20_000, `read took ${elapsed} ms`);
});

/**
 * Every file, folder and link under `dir`, `.git` folders included, with its
 * size, its modification time and a hash of its content (a link's target), as
 * one hash: anything the reader wrote, anywhere, changes it.
 */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const abs = join(path, name);
      const info = lstatSync(abs);
      hash.update(`${rel}/${name}\0${info.mode}\0${info.size}\0${info.mtimeMs}\0`);
      if (info.isSymbolicLink()) hash.update(readlinkSync(abs));
      else if (info.isDirectory()) visit(abs, `${rel}/${name}`);
      else if ((info.mode & 0o444) !== 0 && info.size < 1024 * 1024) hash.update(readFileSync(abs));
    }
  };
  visit(dir, '');
  return hash.digest('hex');
}

test('readV08Project writes nothing and follows nothing out: tree hash, link loops, a 200 MB note', async (t) => {
  const fixture = await makeV08Fixture({ outsideLink: true });
  t.after(() => fixture.cleanup());
  const notepad = join(fixture.memoryPath, 'notepad');
  // Two links that point at each other, and a link to the folder that holds it.
  symlinkSync('loop-b.note.md', join(notepad, 'loop-a.note.md'));
  symlinkSync('loop-a.note.md', join(notepad, 'loop-b.note.md'));
  symlinkSync('..', join(notepad, 'up'));
  // A sparse file of 200 MB: it is sized, streamed for its hash, and never read as text.
  const big = join(notepad, 'big.note.md');
  writeFileSync(big, '');
  truncateSync(big, 200 * 1024 * 1024);

  const before = treeHash(fixture.root);
  const d = described(await readUntouched(fixture, { hashes: true }));
  assert.equal(treeHash(fixture.root), before, 'no file, folder or link changed');

  const lore = `.ai-lore-${fixture.projectName}`;
  const file = (name: string) => d.files.find((f) => f.path === `${lore}/memory/notepad/${name}`);
  const kind = (name: string) =>
    d.problems.find((p) => p.path === `${lore}/memory/notepad/${name}`)?.kind;
  assert.equal(file('loop-a.note.md')?.link?.standing, 'broken');
  assert.equal(kind('loop-a.note.md'), 'broken-link');
  assert.equal(file('up')?.link?.standing, 'folder');
  assert.equal(kind('up'), 'folder-link');
  assert.equal(file('outside.link')?.link?.standing, 'outside');
  assert.equal(file('big.note.md')?.size, 200 * 1024 * 1024);
  assert.equal(kind('big.note.md'), 'too-large');
  assert.match(file('big.note.md')?.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(d.complete, true);
});

test('readV08Project tells the versions and folder shapes apart', async (t) => {
  const patch = await makeV08Fixture({ coreVersion: '0.8.3', name: 'other' });
  t.after(() => patch.cleanup());
  const read = described(await readUntouched(patch));
  assert.deepEqual(
    [read.loreFolder, read.project.name, read.core.version, read.core.standing],
    ['.ai-lore-other', 'other', '0.8.3', 'v0.8'],
  );

  const newer = await makeV08Fixture({ coreVersion: '0.9' });
  t.after(() => newer.cleanup());
  const newerResult = await readUntouched(newer);
  assert.equal(newerResult.ok ? null : newerResult.error.kind, 'newer-than-v0.8');

  const shapes = await makeV08Fixture();
  t.after(() => shapes.cleanup());
  const manifest = join(shapes.memoryPath, 'workspace.yaml');
  const failureOf = async (): Promise<string> => {
    const result = await readUntouched(shapes);
    assert.equal(result.ok, false);
    return result.ok ? '' : `${result.error.kind}: ${result.error.message}`;
  };
  writeFileSync(manifest, 'project_name: [fixture-project\n');
  assert.match(await failureOf(), /^not-a-legacy-project: .*not valid YAML/);
  writeFileSync(manifest, 'project_name: fixture-project\ncore_version: "banana"\n');
  assert.match(await failureOf(), /^unknown-version: /);
  rmSync(manifest);
  assert.match(await failureOf(), /^not-a-legacy-project: .*has no workspace\.yaml/);
  writeFileSync(manifest, 'project_name: fixture-project\ncore_version: "0.8"\n');
  mkdirSync(join(shapes.root, '.ai-lore-second', 'memory'), { recursive: true });
  writeFileSync(
    join(shapes.root, '.ai-lore-second', 'memory', 'workspace.yaml'),
    'project_name: second\ncore_version: "0.8"\n',
  );
  assert.match(await failureOf(), /^not-a-legacy-project: .*more than one/);
});

test('readV08Project reads hostile and irregular content without failing', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const memory = (rel: string): string => join(fixture.memoryPath, ...rel.split('/'));
  const put = (rel: string, text: string): void => {
    mkdirSync(join(memory(rel), '..'), { recursive: true });
    writeFileSync(memory(rel), text);
  };
  // Aliases nested nine deep (a billion laughs if expanded), a custom tag, duplicate keys.
  const laughs = ['a0: &a0 [lol, lol, lol, lol, lol, lol, lol, lol, lol]'];
  for (let i = 1; i < 9; i += 1)
    laughs.push(
      `a${i}: &a${i} [${Array(9)
        .fill(`*a${i - 1}`)
        .join(', ')}]`,
    );
  put('notepad/laughs.note.md', `---\ntitle: Laughs\n${laughs.join('\n')}\n---\n# Laughs\n`);
  put('notepad/tagged.note.md', '---\ntitle: !!js/function "function () {}"\n---\n# Tagged\n');
  put('notepad/twice.note.md', '---\ntitle: First\ntitle: Second\n---\n# Twice\n');
  // A frontmatter of 10 MB, in a file the reader is allowed to read as text.
  put('notepad/wide.note.md', `---\ntitle: Wide\nfiller: ${'x'.repeat(10 * 1024 * 1024)}\n---\n`);
  put('notepad/bare.note.md', 'No frontmatter and no heading.\n');
  // CRLF line ends in a backlog file whose entries are a list with nested items.
  put(
    'status/backlog/nested.backlog.md',
    [
      '---',
      'type: backlog',
      'title: Nested',
      '---',
      '# Nested',
      '',
      '- First entry',
      '  - a detail',
      '  - another detail',
      '- Second entry',
      '',
    ].join('\r\n'),
  );
  // Registry rows: a focus whose file is missing, and rows that point outside the Lore.
  const stack = memory('status/status.stack.md');
  writeFileSync(
    stack,
    `${readFileSync(stack, 'utf8')}| [gone](./gone/gone.focus.md) | paused | |\n| [escape](../../../README.md) | paused | |\n| [absolute](/etc/hosts) | paused | |\n`,
  );

  const started = Date.now();
  const d = described(await readUntouched(fixture, { maxTextBytes: 16 * 1024 * 1024 }));
  assert.ok(Date.now() - started < 10_000);
  const lore = `.ai-lore-${fixture.projectName}`;
  const note = (name: string) =>
    d.notepad.notes.find((n) => n.path === `${lore}/memory/notepad/${name}`);
  const problem = (rel: string) => d.problems.find((p) => p.path === `${lore}/memory/${rel}`);
  assert.equal(note('laughs.note.md')?.title, 'Laughs');
  assert.equal(problem('notepad/laughs.note.md'), undefined);
  assert.equal(problem('notepad/tagged.note.md')?.kind, 'bad-frontmatter');
  assert.equal(problem('notepad/twice.note.md')?.kind, 'bad-frontmatter');
  assert.equal(note('twice.note.md')?.title, 'Second');
  assert.match(problem('notepad/wide.note.md')?.message ?? '', /larger than/);
  assert.equal(note('wide.note.md')?.title, 'Wide');
  assert.equal(note('bare.note.md')?.title, null);

  const nested = d.backlog.find((b) => b.path.endsWith('nested.backlog.md'));
  assert.equal(nested?.title, 'Nested');
  assert.deepEqual(
    nested?.entries.map((e) => e.title),
    ['First entry', 'Second entry'],
  );
  assert.match(nested?.entries[0]?.text ?? '', /a detail\n- another detail/);

  for (const name of ['gone', 'escape', 'absolute']) {
    const focus = d.focuses.find((f) => f.name === name);
    assert.deepEqual([focus?.inStack, focus?.bodyPath, focus?.stages], [true, null, []], name);
    assert.ok(
      d.problems.some((p) => p.kind === 'missing' && p.message.includes(`row ${name} `)),
      name,
    );
  }
});
