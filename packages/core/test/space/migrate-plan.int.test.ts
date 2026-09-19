/**
 * The migration plan (phase M6.2) on `makeV08Fixture` and `FakeGitHub`: the
 * thirteen steps, the mapping with the fixture's counts and destinations,
 * what is not carried, the fields, the warnings and the refusals; that making
 * the plan writes nothing, locally or on the fake; and that the plan of a
 * half-done migration says which steps are done. No test reads the real
 * project, its Lore or live GitHub.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { createGitPort, execFileRunner } from '../../src/space/exec/index.js';
import {
  DEFAULT_STAGES,
  type GitHubPort,
  formatIssueMarker,
} from '../../src/space/github/index.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import {
  MIGRATION_STEP_IDS,
  type MigrationDeps,
  type MigrationPlan,
  appendMigrationLedger,
  planMigration,
  prepareMigration,
  runMigration,
} from '../../src/space/migrate/index.js';
import {
  type FakeGitHub,
  type V08Fixture,
  createFakeGitHub,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir, useTempDir, useTempGitRepo } from '../support/index.js';

const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;
const SPACE = 'fixture-project-space';
const READS: ReadonlySet<keyof GitHubPort> = new Set<keyof GitHubPort>([
  'auth',
  'findRepository',
  'findProject',
  'readProject',
  'findIssueByMarker',
  'findIssuesByMarkers',
]);

function machine(): MachineCheck {
  const fine = { kind: 'fine', version: '1.0' } as const;
  return {
    ready: true,
    engines: [],
    requirements: [{ id: 'git', binary: 'git', state: fine, guidance: null, command: null }],
    github: { account: null, organisations: [] },
    tools: { brew: true, npm: true },
  };
}

type Bench = {
  fixture: V08Fixture;
  fake: FakeGitHub;
  deps: MigrationDeps;
  parentDir: string;
  userDataDir: string;
  lore: string;
};

async function bench(
  t: TestContext,
  options: { uncommitted?: boolean; coreVersion?: string } = {},
): Promise<Bench> {
  const fixture = await makeV08Fixture(options);
  t.after(() => fixture.cleanup());
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  const parentDir = useTempDir(t, 'ai-lore-migrate-');
  const userDataDir = useTempDir(t, 'ai-lore-userdata-');
  const deps: MigrationDeps = {
    runner: execFileRunner,
    github: fake,
    templateDir: loreTemplateDir(),
    userDataDir,
    checkMachine: async () => machine(),
    gitConfig: {
      'user.name': 'AI-Lore Test',
      'user.email': 'test@ai-lore.invalid',
      'commit.gpgsign': 'false',
    },
  };
  return { fixture, fake, deps, parentDir, userDataDir, lore: `.ai-lore-${fixture.projectName}` };
}

function input(b: Bench, extra: { description?: string } = {}) {
  return {
    sourceRoot: b.fixture.root,
    form: {
      parentDir: b.parentDir,
      payloadGitHub: PAYLOAD,
      description: 'description' in extra ? extra.description : 'The migrated fixture.',
    },
  };
}

async function planned(b: Bench, extra: { description?: string } = {}): Promise<MigrationPlan> {
  const plan = await planMigration(input(b, extra), b.deps);
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  return plan.value;
}

/** Every file, folder and link under `dir`, `.git` included, with mode, size, time and content, as one hash. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const abs = join(path, name);
      const info = lstatSync(abs);
      hash.update(`${rel}/${name}\0${info.mode}\0${info.size}\0${info.mtimeMs}\0`);
      if (info.isSymbolicLink()) hash.update(readlinkSync(abs));
      else if (info.isDirectory()) visit(abs, `${rel}/${name}`);
      else if (info.size < 1024 * 1024) hash.update(readFileSync(abs));
    }
  };
  visit(dir, '');
  return hash.digest('hex');
}

function row(plan: MigrationPlan, id: string) {
  const found = plan.mapping.find((candidate) => candidate.id === id);
  assert.ok(found, `mapping row ${id}`);
  return found;
}

test('the plan of the fixture: thirteen steps, the mapping with its counts and destinations', async (t) => {
  const b = await bench(t);
  const c = b.fixture.contents;
  const at = (path: string) => `${b.lore}/${path}`;
  const plan = await planned(b);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.target, 'absent');
  assert.equal(plan.spaceRoot, join(b.parentDir, SPACE));
  assert.equal(plan.repository, `${OWNER}/${SPACE}`);
  assert.equal(plan.source.projectName, b.fixture.projectName);

  // The steps: all thirteen, in order, none done, each saying what it will do.
  assert.deepEqual(
    plan.steps.map((step) => step.stepId),
    [...MIGRATION_STEP_IDS],
  );
  assert.deepEqual(
    plan.steps.map((step) => step.number),
    Array.from({ length: 13 }, (_, index) => index + 1),
  );
  for (const step of plan.steps) {
    assert.equal(step.done, false, step.stepId);
    assert.ok(step.lines.length > 0, `${step.stepId} has lines`);
  }

  // The archive: every file under memory/ and references/, and ai_readme.md, ignored files and the inside link included.
  const archivedFiles = b.fixture.loreFiles.filter(
    (path) =>
      path.startsWith('memory/') || path.startsWith('references/') || path === 'ai_readme.md',
  );
  assert.ok(archivedFiles.includes('ai_readme.md'));
  const archive = row(plan, 'archive');
  assert.equal(archive.count, archivedFiles.length);
  assert.equal(archive.destination, 'publish/archive/v0.8/, copied as it is');
  const archiveLine = plan.steps.find((step) => step.stepId === 'archive')?.lines[0];
  assert.equal(archiveLine?.count, archivedFiles.length);
  assert.equal(archiveLine?.to, 'publish/archive/v0.8');

  // Contracts: one card per source file (question 16).
  const contracts = row(plan, 'contracts');
  assert.equal(contracts.count, c.projectContracts.length + c.contractSpecFiles.length);
  assert.ok(contracts.items.some((item) => item.to === 'lore/contracts/contracts.md'));
  for (const path of c.projectContracts) {
    const name = (path.split('/').pop() ?? '').replace(/\.contract\.md$/, '');
    assert.ok(
      contracts.items.some(
        (item) => item.from === at(path) && item.to === `lore/contracts/${name}.md`,
      ),
      path,
    );
  }

  const mirror = row(plan, 'mirror');
  assert.equal(mirror.count, c.mirrorNodes.length);
  assert.ok(mirror.items.every((item) => item.to === 'lore/mirrors/fixture-project.md'));

  // The in-progress focus and its stages, the paused focuses, one issue per backlog item.
  const focus = row(plan, 'in-progress-focus');
  assert.equal(focus.count, 1);
  assert.equal(focus.items.length, 1 + c.stages.length);
  assert.equal(focus.items[0]?.from, at(c.inProgressFocus ?? ''));
  assert.match(focus.destination, /Stage Build/);
  const paused = row(plan, 'paused-focuses');
  assert.equal(paused.count, c.pausedFocuses.length);
  assert.ok(paused.items.every((item) => item.to.includes('labelled paused')));
  const backlog = row(plan, 'backlog');
  assert.equal(backlog.count, c.backlogEntryCount);

  const issues = plan.issues;
  assert.equal(
    issues.length,
    1 + c.stages.length + c.pausedFocuses.length + c.backlogEntryCount,
  );
  for (const issue of issues) {
    assert.equal(issue.marker, formatIssueMarker('migrated', issue.key));
    assert.ok(issue.archived.startsWith('publish/archive/v0.8/'), issue.archived);
  }
  assert.equal(issues[0]?.kind, 'focus');
  assert.equal(issues[0]?.stage, 'Build');
  assert.ok(issues.filter((i) => i.kind === 'stage').every((i) => i.parentKey === issues[0]?.key));
  assert.ok(
    issues.filter((i) => i.kind === 'paused-focus').every((i) => i.labels.includes('paused')),
  );
  // One issue per backlog item: an entry of a backlog file is keyed `<path>#<n>` and
  // carries its text; an item file is one issue keyed by its path.
  const backlogIssues = issues.filter((i) => i.kind === 'backlog');
  const parked = backlogIssues.filter((i) => i.key.startsWith(at(c.backlogFiles[0] ?? '')));
  assert.deepEqual(
    parked.map((i) => [i.key, i.title, i.text]),
    [
      [`${at(c.backlogFiles[0] ?? '')}#1`, 'A first parked item', 'Text of the first item.'],
      [`${at(c.backlogFiles[0] ?? '')}#2`, 'A second parked item', 'Text of the second item.'],
    ],
  );
  assert.ok(parked.every((i) => i.archived === `publish/archive/v0.8/${c.backlogFiles[0]}`));
  const itemFile = backlogIssues.find((i) => i.key === at(c.backlogItems[0] ?? ''));
  assert.equal(itemFile?.title, 'Richer history in the browser tab');

  // The Workbench: the newest handover, the product document, its images and the critique note.
  const handover = row(plan, 'handover');
  assert.equal(handover.count, 1);
  assert.equal(handover.items[0]?.from, at(c.journalEntries.at(-1) ?? ''));
  assert.match(
    handover.items[0]?.to ?? '',
    /^workbench\/journal\/\d{4}-\d{2}-\d{2}-0000-v08-handover-migration\.md$/,
  );
  const drafts = row(plan, 'drafts');
  assert.equal(drafts.count, 1 + c.productImages.length + 1);
  assert.ok(
    drafts.items.some(
      (item) =>
        item.from === at(c.productDocument ?? '') &&
        item.to === 'workbench/drafts/product-document.note.md',
    ),
  );
  for (const image of c.productImages) {
    const tail = image.slice('memory/notepad/'.length);
    assert.ok(
      drafts.items.some((item) => item.to === `workbench/drafts/${tail}`),
      image,
    );
  }

  const corpus = row(plan, 'name-and-description');
  assert.equal(corpus.items[0]?.to, `lore/corpus/${SPACE}.md`);

  // What is not carried: the archive only.
  const group = (what: string) => plan.notCarried.find((g) => g.what === what);
  assert.equal(group('Project processes')?.count, c.projectProcesses.length);
  assert.equal(group('Tooling cards')?.count, c.toolingCards.length);
  assert.equal(group('Save-points')?.count, c.savePoints.length);
  assert.equal(group('Tracks')?.count, c.tracks.length);
  // The index of references/ is an index, not a reference; it is archived all the same.
  assert.equal(
    group('References')?.count,
    c.references.filter((path) => !path.endsWith('.index.md')).length,
  );
  // The link to the critique note is a note of its own, archived as a link and not carried.
  assert.deepEqual(
    [...(group('Other notes')?.paths ?? [])].sort(),
    [...c.otherNotes, ...c.symlinks].map(at).sort(),
  );
  assert.ok(group('The stack'));
  assert.ok(group('Finished focuses'));
  assert.equal(
    row(plan, 'archive-only').count,
    plan.notCarried.reduce((sum, g) => sum + g.count, 0),
  );

  // The fields: proposed values, the Stage preselected to Build.
  const field = (id: string) => plan.fields.find((f) => f.id === id);
  assert.equal(field('name')?.value, SPACE);
  assert.equal(field('name')?.proposed, true);
  assert.equal(field('owner')?.value, OWNER);
  assert.equal(field('owner')?.proposed, true);
  assert.equal(field('focusStage')?.value, 'Build');
  assert.deepEqual(field('focusStage')?.options, [...DEFAULT_STAGES]);
  assert.equal(field('description')?.proposed, false);
  assert.ok(plan.fields.every((f) => f.problem === null));
  // The one warning: the files at the top of the Lore folder, outside memory/ and references/.
  assert.deepEqual(
    plan.warnings.map((w) => w.kind),
    ['not-copied'],
  );
  assert.deepEqual(
    [...(plan.warnings[0]?.paths ?? [])].sort(),
    c.ignoredFiles
      .filter((path) => !path.startsWith('memory/'))
      .map(at)
      .sort(),
  );
});

test('making the plan writes nothing, locally or on the fake', async (t) => {
  const b = await bench(t);
  const before = {
    source: treeHash(b.fixture.root),
    target: treeHash(b.parentDir),
    userData: treeHash(b.userDataDir),
  };
  await planned(b);
  await planned(b, { description: '' });
  assert.equal(treeHash(b.fixture.root), before.source, 'the v0.8 folder is unchanged');
  assert.equal(treeHash(b.parentDir), before.target, 'nothing was made in the target');
  assert.equal(treeHash(b.userDataDir), before.userData, 'no desk record was written');
  assert.ok(b.fake.calls.length > 0);
  for (const call of b.fake.calls) assert.ok(READS.has(call.operation), call.operation);
  const state = b.fake.state();
  assert.deepEqual(
    [state.repositories.length, state.projects.length, state.issues.length],
    [0, 0, 0],
  );
});

test('a field left empty: the plan still describes every step, and is not ready', async (t) => {
  const b = await bench(t);
  const plan = await planned(b, { description: '' });
  assert.equal(plan.ready, false);
  assert.ok(plan.fields.find((f) => f.id === 'description')?.problem);
  assert.equal(plan.steps.length, 13);
  assert.ok(plan.steps.every((step) => !step.done && step.lines.length > 0));
  const run = await runMigration(input(b, { description: '' }), b.deps);
  assert.ok(!run.ok);
  assert.equal(run.error.kind, 'invalid-input');
  assert.deepEqual(
    run.error.problems.map((p) => p.field),
    ['description'],
  );
});

test('uncommitted changes in both source repositories are warnings, and the plan stays ready', async (t) => {
  const b = await bench(t, { uncommitted: true });
  const plan = await planned(b);
  assert.equal(plan.ready, true);
  const uncommitted = plan.warnings.filter((w) => w.kind === 'uncommitted-changes');
  assert.deepEqual(
    uncommitted.map((w) => w.paths[0]),
    ['.', `${b.lore}/memory`],
  );
});

test('refusals: older than v0.8, a target that holds something else, a repository that belongs to something else', async (t) => {
  const older = await bench(t, { coreVersion: '0.7' });
  const refused = await planMigration(input(older), older.deps);
  assert.ok(!refused.ok);
  assert.equal(refused.error.kind, 'refused');
  assert.equal(refused.error.refusal?.kind, 'older-than-v0.8');
  assert.match(refused.error.message, /upgrade the project to v0\.8 first/);

  const b = await bench(t);
  const target = join(b.parentDir, SPACE);
  mkdirSync(target);
  writeFileSync(join(target, 'notes.txt'), 'something else\n');
  const taken = await planned(b);
  assert.equal(taken.ready, false);
  assert.deepEqual(
    taken.refusals.map((r) => r.kind),
    ['target-not-empty'],
  );
  assert.ok(taken.steps.every((step) => !step.done && step.lines.length > 0));

  const other = await bench(t);
  const created = await other.fake.createRepository({ owner: OWNER, name: SPACE, private: true });
  assert.ok(created.ok);
  const seed = await useTempGitRepo(t);
  seed.write('README.md', '# something else\n');
  await seed.commitAll('First commit');
  const git = createGitPort(execFileRunner);
  assert.ok((await git.addRemote(seed.dir, 'origin', created.value.cloneUrl)).ok);
  assert.ok((await git.push(seed.dir, { setUpstream: true })).ok);
  const foreign = await planned(other);
  assert.deepEqual(
    foreign.refusals.map((r) => r.kind),
    ['repository-taken'],
  );
  const run = await runMigration(input(other), other.deps);
  assert.ok(!run.ok);
  assert.equal(run.error.refusal?.kind, 'repository-taken');
});

test('a half-done migration: the plan says which steps are done, from the ledger and the disk', async (t) => {
  const b = await bench(t);
  const prepared = await prepareMigration(input(b), b.deps);
  assert.ok(prepared.ok);
  const { ctx } = prepared.value;

  // What steps 1 and 4 leave: the ledger's record of the source, and the archive copy.
  const recorded = appendMigrationLedger(ctx, {
    kind: 'source-state',
    payload: { path: '.', head: b.fixture.payloadHead, statusText: '' },
    lore: { path: `${b.lore}/memory`, head: b.fixture.memoryHead, statusText: '' },
  });
  assert.ok(recorded.ok);
  const archive = join(ctx.spaceRoot, 'publish', 'archive', 'v0.8');
  for (const top of ['memory', 'references']) {
    cpSync(join(b.fixture.lorePath, top), join(archive, top), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => !path.split(/[\\/]/).includes('.git'),
    });
  }
  cpSync(join(b.fixture.lorePath, 'ai_readme.md'), join(archive, 'ai_readme.md'));

  // What step 6 leaves: one card per contract file, each listed in the part's index.
  const contractsDir = join(ctx.spaceRoot, 'lore', 'contracts');
  mkdirSync(contractsDir, { recursive: true });
  const index = [
    '---',
    'type: index',
    '---',
    '',
    '# Contracts',
    '',
    '- [core/](./core/index.md): the contracts that AI-Lore itself fixes.',
  ];
  for (const card of ctx.targets.contracts) {
    const file = card.to.split('/').pop() ?? '';
    writeFileSync(
      join(contractsDir, file),
      `---\ntype: contract\nname: ${card.name}\n---\n\nThe rule.\n`,
    );
    index.push(`- [${file}](./${file}): the contract ${card.name}.`);
  }
  writeFileSync(join(contractsDir, 'index.md'), `${index.join('\n')}\n`);

  const plan = await planned(b);
  assert.equal(plan.ready, true);
  assert.equal(plan.target, 'half-made');
  const done = plan.steps.filter((step) => step.done).map((step) => step.stepId);
  assert.deepEqual(done, ['record-source', 'archive', 'contracts']);

  // A ledger that says more than was done does not make a step done: the real state wins.
  for (const stepId of ['create-space', 'workbench', 'pointer'] as const) {
    assert.ok(appendMigrationLedger(ctx, { kind: 'step-done', stepId, created: [] }).ok);
  }
  const lied = await planned(b);
  assert.deepEqual(
    lied.steps.filter((step) => step.done).map((step) => step.stepId),
    ['record-source', 'archive', 'contracts'],
  );

  // One archived file changed: the archive step is not done any more.
  const first = ctx.targets.archived.find((file) => file.linkTarget === null);
  assert.ok(first);
  writeFileSync(join(ctx.spaceRoot, ...first.to.split('/')), 'changed\n');
  const again = await planned(b);
  assert.deepEqual(
    again.steps.filter((step) => step.done).map((step) => step.stepId),
    ['record-source', 'contracts'],
  );

  // A run skips the steps that are done, runs the others, and reaches the end:
  // every step is built (phase M6.6 built step 13), and the verification passes.
  const run = await runMigration(input(b), b.deps);
  assert.ok(run.ok, run.ok ? '' : run.error.message);
  assert.deepEqual(run.value.skipped.slice(0, 2), ['record-source', 'contracts']);
  assert.equal(run.value.completed.at(-1), 'verify');
});

test('with no ledger, the issues step is done only when GitHub has every issue by its marker', async (t) => {
  const b = await bench(t);
  const created = await b.fake.createRepository({ owner: OWNER, name: SPACE, private: true });
  assert.ok(created.ok);
  const prepared = await prepareMigration(input(b), b.deps);
  assert.ok(prepared.ok);
  const { ctx, steps } = prepared.value;
  assert.deepEqual(ctx.ledger, []);
  const issuesStep = steps.find((step) => step.id === 'issues');
  assert.ok(issuesStep);
  const [last, ...firsts] = [...ctx.issues].reverse();
  assert.ok(last);
  for (const issue of firsts) {
    const made = await b.fake.createIssue({
      repository: created.value.fullName,
      title: issue.title,
      body: `Migrated.\n\n${issue.marker}\n`,
      labels: [],
    });
    assert.ok(made.ok);
  }
  assert.equal(await issuesStep.isDone(ctx), false, 'one issue is missing');
  const made = await b.fake.createIssue({
    repository: created.value.fullName,
    title: last.title,
    body: `${last.marker}\n`,
    labels: [],
  });
  assert.ok(made.ok);
  assert.equal(await issuesStep.isDone(ctx), true, 'every issue is found by its marker');
  assert.ok(b.fake.calls.some((call) => call.operation === 'findIssuesByMarkers'));
});

test('a Project of the Space name that belongs to something else is refused', async (t) => {
  const b = await bench(t);
  const project = await b.fake.createProject({ owner: OWNER, title: SPACE });
  assert.ok(project.ok);
  // A Project that holds an item is someone's work; an empty one is what a stopped run leaves.
  const elsewhere = await b.fake.createRepository({ owner: OWNER, name: 'other', private: true });
  assert.ok(elsewhere.ok);
  const item = await b.fake.createIssue({
    repository: elsewhere.value.fullName,
    title: 'Something else',
    body: 'Not a migration.\n',
    labels: [],
  });
  assert.ok(item.ok);
  assert.ok((await b.fake.addIssueToProject({ project: project.value, issue: item.value })).ok);
  const plan = await planned(b);
  assert.equal(plan.ready, false);
  assert.deepEqual(
    plan.refusals.map((r) => r.kind),
    ['project-taken'],
  );
});
