/**
 * Step 13, the verification (phase M6.6), and the lines of the focus's gate
 * condition "Migrates" that no earlier test covers through `runMigration`.
 *
 * One migration of `makeV08Fixture` into `FakeGitHub` runs all thirteen steps
 * through `runMigration` before the tests. Then: the verification passes with
 * its five checks; the Space opens as a Space with its repository, Project and
 * desk; a second run creates nothing. Each failure is made by hand, checked,
 * and put back: a source changed or committed to after step 1; an archived
 * file altered, missing, or one without a source; an issue whose marker is
 * gone, a second issue with the same marker, an issue not on the Project; a
 * Space commit not pushed; a Lore that fails lore-integrity; python3 missing. A failed
 * verification undoes nothing. No test reads the real project or live GitHub.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { detectFolder } from '../../src/space/detect/detect-folder.js';
import { createGitPort, execFileRunner, runGit } from '../../src/space/exec/index.js';
import { bodyHasMarker } from '../../src/space/github/index.js';
import { deskPaths } from '../../src/space/layout/desk-paths.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import {
  MIGRATION_STEP_IDS,
  type MigrationContext,
  type MigrationDeps,
  type MigrationInput,
  type MigrationReport,
  prepareMigration,
  runMigration,
} from '../../src/space/migrate/index.js';
import { VERIFICATION_FAILED, verifyStep } from '../../src/space/migrate/steps/13-verify.js';
import {
  type MigrationVerification,
  VERIFICATION_CHECK_IDS,
  type VerificationCheckId,
  verifyMigration,
} from '../../src/space/migrate/verify.js';
import {
  type FakeGitHub,
  type TempDir,
  type V08Fixture,
  createFakeGitHub,
  makeTempDir,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir } from '../support/index.js';

const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;

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
  input: MigrationInput;
  temps: TempDir[];
  first: MigrationReport;
  ctx: MigrationContext;
};

let bench: Bench | null = null;

function b(): Bench {
  assert.ok(bench, 'the migration of the fixture ran before the tests');
  return bench;
}

before(async () => {
  const fixture = await makeV08Fixture();
  const fake = createFakeGitHub();
  const temps = [makeTempDir('ai-lore-migrate-verify-'), makeTempDir('ai-lore-userdata-')];
  const [parent, userData] = temps as [TempDir, TempDir];
  const deps: MigrationDeps = {
    runner: execFileRunner,
    github: fake,
    templateDir: loreTemplateDir(),
    userDataDir: userData.dir,
    checkMachine: async () => machine(),
    gitConfig: {
      'user.name': 'AI-Lore Test',
      'user.email': 'test@ai-lore.invalid',
      'commit.gpgsign': 'false',
    },
    pause: async () => undefined,
  };
  const input: MigrationInput = {
    sourceRoot: fixture.root,
    form: { parentDir: parent.dir, payloadGitHub: PAYLOAD, description: 'The fixture.' },
  };
  const first = await runMigration(input, deps);
  assert.ok(first.ok, first.ok ? '' : first.error.message);
  const prepared = await prepareMigration(input, deps);
  assert.ok(prepared.ok, prepared.ok ? '' : prepared.error.message);
  bench = { fixture, fake, deps, input, temps, first: first.value, ctx: prepared.value.ctx };
});

after(() => {
  bench?.fake.dispose();
  bench?.fixture.cleanup();
  for (const temp of bench?.temps ?? []) temp.cleanup();
});

/** The paths and contents of a folder, `.git` included, without times. */
function contentHash(dir: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const abs = join(path, name);
      const info = lstatSync(abs);
      hash.update(`${rel}/${name}\0${info.isDirectory() ? 'd' : 'f'}\0`);
      if (info.isSymbolicLink()) hash.update(readlinkSync(abs));
      else if (info.isDirectory()) visit(abs, `${rel}/${name}`);
      else hash.update(readFileSync(abs));
    }
  };
  visit(dir, '');
  return hash.digest('hex');
}

function outcome(verification: MigrationVerification): Record<VerificationCheckId, boolean> {
  return Object.fromEntries(verification.checks.map((one) => [one.id, one.passed])) as Record<
    VerificationCheckId,
    boolean
  >;
}

function only(failed: VerificationCheckId[]): Record<VerificationCheckId, boolean> {
  return Object.fromEntries(
    VERIFICATION_CHECK_IDS.map((id) => [id, !failed.includes(id)]),
  ) as Record<VerificationCheckId, boolean>;
}

function sentenceOf(verification: MigrationVerification, id: VerificationCheckId): string {
  return verification.checks.find((one) => one.id === id)?.sentence ?? '';
}

/**
 * Run step 13 and require that it fails with every check in its message and
 * leaves the Space as it was: a failed verification undoes nothing.
 */
async function assertStepFailsAndUndoesNothing(ctx: MigrationContext): Promise<void> {
  const space = contentHash(ctx.spaceRoot);
  const run = await verifyStep().run(ctx);
  assert.ok(!run.ok);
  assert.equal(run.error.kind, VERIFICATION_FAILED);
  assert.match(run.error.message, /Nothing was undone/);
  assert.match(run.error.message, /Look at: /);
  for (const title of [
    'lore-integrity passes over the Space',
    "Every archived file's hash equals its source's",
    'Both source repositories are as step 1 recorded them',
    'The Space repository is pushed',
    'Every planned issue exists once',
  ]) {
    assert.match(
      run.error.message,
      new RegExp(`(Passed|Failed): ${title.replace(/[.?*()]/g, '\\$&')}\\.`),
    );
  }
  assert.equal(contentHash(ctx.spaceRoot), space, 'the Space is unchanged');
}

async function assertPassesAgain(ctx: MigrationContext): Promise<void> {
  const again = await verifyMigration(ctx);
  assert.ok(again.passed, JSON.stringify(again.checks, null, 2));
}

test('runMigration runs all thirteen steps and the verification passes with its five checks', async () => {
  const { first, ctx } = b();
  assert.deepEqual(first.completed, [...MIGRATION_STEP_IDS]);
  assert.deepEqual(first.skipped, []);
  const verification = await verifyMigration(ctx);
  assert.ok(verification.passed, JSON.stringify(verification.checks, null, 2));
  assert.deepEqual(
    verification.checks.map((one) => one.id),
    [...VERIFICATION_CHECK_IDS],
  );
  for (const one of verification.checks) {
    assert.ok(one.sentence.endsWith('.'), one.sentence);
    assert.deepEqual(one.lookAt, []);
  }
  assert.match(sentenceOf(verification, 'archive'), /^All \d+ archived files have the SHA-256/);
  assert.match(sentenceOf(verification, 'issues'), new RegExp(`^All ${ctx.issues.length} planned`));
  assert.ok(ctx.ledger.some((r) => r.kind === 'step-done' && r.stepId === 'verify'));
  assert.equal(await verifyStep().isDone(ctx), false, 'step 13 is never skipped');
});

test('Migrates, creates: the Space opens as a Space, with its repository, its Project and its desk', async () => {
  const { fake, ctx, deps } = b();
  const detected = await detectFolder(ctx.spaceRoot, { git: createGitPort(execFileRunner) });
  assert.ok(detected.ok, detected.ok ? '' : detected.error.message);
  assert.equal(detected.value.kind, 'space');
  const repository = await fake.findRepository(ctx.repositoryName);
  assert.ok(repository.ok && repository.value !== null);
  const project = await fake.findProject({ owner: ctx.settings.owner, title: ctx.settings.name });
  assert.ok(project.ok && project.value !== null);
  const desk = deskPaths(deps.userDataDir, ctx.spaceRoot);
  assert.ok(existsSync(desk.desk), desk.desk);
  assert.ok(existsSync(join(desk.desk, 'migration.json')), 'the ledger is on the desk');
  assert.ok(existsSync(desk.install), desk.install);
  assert.ok(fake.state().issues.length >= ctx.issues.length && ctx.issues.length > 0);
});

test('Migrates, running again: a second run from the same input creates nothing and verifies again', async () => {
  const { fake, ctx, deps, input } = b();
  const state = fake.state();
  const counts = {
    repositories: state.repositories.length,
    projects: state.projects.length,
    issues: state.issues.length,
    items: state.projects.reduce((sum, p) => sum + p.items.length, 0),
  };
  const space = contentHash(ctx.spaceRoot);
  const remote = state.repositories.find((r) => r.info.fullName === ctx.repositoryName)?.info
    .cloneUrl;
  assert.ok(remote);
  const commits = await runGit(execFileRunner, remote, ['rev-list', '--all'], { readOnly: true });

  const second = await runMigration(input, deps);
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.deepEqual(second.value.completed, ['verify']);
  assert.deepEqual(
    second.value.skipped,
    MIGRATION_STEP_IDS.filter((id) => id !== 'verify'),
  );
  const now = fake.state();
  assert.deepEqual(
    {
      repositories: now.repositories.length,
      projects: now.projects.length,
      issues: now.issues.length,
      items: now.projects.reduce((sum, p) => sum + p.items.length, 0),
    },
    counts,
  );
  assert.equal(contentHash(ctx.spaceRoot), space, 'the Space is unchanged');
  const later = await runGit(execFileRunner, remote, ['rev-list', '--all'], { readOnly: true });
  assert.equal(later.stdout, commits.stdout, 'no commit');
});

test('a source changed after step 1 fails the verification and names the Lore repository', async () => {
  const { fixture, ctx } = b();
  const file = join(fixture.memoryPath, 'workspace.yaml');
  const original = readFileSync(file);
  appendFileSync(file, '\n# Written after step 1.\n');
  try {
    const verification = await verifyMigration(ctx);
    assert.equal(verification.passed, false);
    assert.deepEqual(outcome(verification), only(['archive', 'source-repositories']));
    assert.match(
      sentenceOf(verification, 'source-repositories'),
      /The source changed after step 1/,
    );
    assert.match(
      sentenceOf(verification, 'source-repositories'),
      /the git status of the Lore repository/,
    );
    assert.match(sentenceOf(verification, 'archive'), /workspace\.yaml/);
    const failed = verification.checks.find((one) => one.id === 'source-repositories');
    assert.ok(failed?.lookAt.some((path) => path.endsWith('memory')));
    await assertStepFailsAndUndoesNothing(ctx);
  } finally {
    writeFileSync(file, original);
  }
  await assertPassesAgain(ctx);
});

test('an archived file altered fails the archive check and names the file', async () => {
  const { ctx } = b();
  const archived = ctx.targets.archived.find((file) => file.linkTarget === null);
  assert.ok(archived);
  const path = join(ctx.spaceRoot, ...archived.to.split('/'));
  const original = readFileSync(path);
  writeFileSync(path, 'Altered after the migration.\n');
  try {
    const verification = await verifyMigration(ctx);
    // The altered file is also a change the Space has not committed.
    assert.deepEqual(outcome(verification), only(['archive', 'space-pushed']));
    assert.match(sentenceOf(verification, 'archive'), /1 archived files differ from their source/);
    assert.ok(sentenceOf(verification, 'archive').includes(archived.to));
    const failed = verification.checks.find((one) => one.id === 'archive');
    assert.deepEqual(failed?.lookAt, [path]);
    await assertStepFailsAndUndoesNothing(ctx);
  } finally {
    writeFileSync(path, original);
  }
  await assertPassesAgain(ctx);
});

test('an issue whose marker is gone fails the issues check and names what it stands for', async () => {
  const { fake, ctx } = b();
  const planned = ctx.issues[0];
  assert.ok(planned);
  const issue = fake.state().issues.find((one) => bodyHasMarker(one.body, planned.marker));
  assert.ok(issue);
  const body = issue.body;
  const edited = await fake.updateIssue({
    issue: issue.ref,
    body: body
      .split('\n')
      .filter((line) => line !== planned.marker)
      .join('\n'),
  });
  assert.ok(edited.ok);
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['issues']));
    assert.match(sentenceOf(verification, 'issues'), /1 problem was found/);
    assert.ok(
      sentenceOf(verification, 'issues').includes(`no issue has the marker of ${planned.key}`),
    );
    await assertStepFailsAndUndoesNothing(ctx);
  } finally {
    assert.ok((await fake.updateIssue({ issue: issue.ref, body })).ok);
  }
  await assertPassesAgain(ctx);
});

test('a commit made in a source repository after step 1 fails the source check', async () => {
  const { fixture, ctx } = b();
  const lore = fixture.memoryPath;
  const head = (await runGit(execFileRunner, lore, ['rev-parse', 'HEAD'])).stdout.trim();
  const committed = await runGit(execFileRunner, lore, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@ai-lore.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'After step 1.',
  ]);
  assert.equal(committed.code, 0, committed.stderr);
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['source-repositories']));
    assert.match(
      sentenceOf(verification, 'source-repositories'),
      new RegExp(`the Lore repository .* and step 1 recorded ${head}`),
    );
  } finally {
    await runGit(execFileRunner, lore, ['reset', '--soft', head]);
  }
  await assertPassesAgain(ctx);
});

test('an archived file missing, or a file in the archive without a source, fails the archive check', async () => {
  const { ctx } = b();
  const archived = ctx.targets.archived.find((file) => file.linkTarget === null);
  assert.ok(archived);
  const path = join(ctx.spaceRoot, ...archived.to.split('/'));
  const original = readFileSync(path);
  rmSync(path);
  const extra = join(ctx.spaceRoot, ...ctx.targets.archiveDir.split('/'), 'memory', 'extra.md');
  writeFileSync(extra, 'Not in the source.\n');
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['archive', 'space-pushed']));
    const sentence = sentenceOf(verification, 'archive');
    assert.match(sentence, /1 archived files are missing/);
    assert.ok(sentence.includes(archived.to), sentence);
    assert.match(sentence, /1 files in the archive have no source file: .*memory\/extra\.md/);
    await assertStepFailsAndUndoesNothing(ctx);
  } finally {
    rmSync(extra, { force: true });
    writeFileSync(path, original);
  }
  await assertPassesAgain(ctx);
});

test('a second issue with the same marker fails the issues check', async () => {
  const { fake, ctx } = b();
  const planned = ctx.issues[0];
  assert.ok(planned);
  const created = await fake.createIssue({
    repository: ctx.repositoryName,
    title: 'A duplicate',
    body: `A duplicate.\n${planned.marker}\n`,
    labels: [],
  });
  assert.ok(created.ok);
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['issues']));
    assert.ok(
      sentenceOf(verification, 'issues').includes(`the marker of ${planned.key} is on 2 issues`),
      sentenceOf(verification, 'issues'),
    );
  } finally {
    assert.ok((await fake.updateIssue({ issue: created.value, body: 'No marker.\n' })).ok);
  }
  await assertPassesAgain(ctx);
});

test('an issue that is not on the Project fails the issues check', async () => {
  const { fake, ctx } = b();
  const snapshot = await fake.readProject({
    project: await (async () => {
      const found = await fake.findProject({ owner: ctx.settings.owner, title: ctx.settings.name });
      assert.ok(found.ok && found.value !== null);
      return found.value;
    })(),
  });
  assert.ok(snapshot.ok);
  const dropped = snapshot.value.standalone[0];
  assert.ok(dropped, 'the fixture has a standalone issue');
  const github = {
    ...fake,
    readProject: async (arg: Parameters<FakeGitHub['readProject']>[0]) => {
      const read = await fake.readProject(arg);
      if (!read.ok) return read;
      const standalone = read.value.standalone.filter(
        (item) => item.issue.number !== dropped.issue.number,
      );
      return { ok: true as const, value: { ...read.value, standalone } };
    },
  };
  const verification = await verifyMigration({ ...ctx, deps: { ...ctx.deps, github } });
  assert.deepEqual(outcome(verification), only(['issues']));
  assert.match(sentenceOf(verification, 'issues'), /is on the Project 0 times/);
});

test('a Space commit that is not pushed fails the pushed check', async () => {
  const { ctx } = b();
  const head = (await runGit(execFileRunner, ctx.spaceRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const committed = await runGit(execFileRunner, ctx.spaceRoot, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@ai-lore.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Not pushed.',
  ]);
  assert.equal(committed.code, 0, committed.stderr);
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['space-pushed']));
  } finally {
    await runGit(execFileRunner, ctx.spaceRoot, ['reset', '--soft', head]);
  }
  await assertPassesAgain(ctx);
});

test('python3 missing fails the lore-integrity check with a sentence', async () => {
  const { ctx } = b();
  const runner = {
    run: async (
      bin: string,
      args: readonly string[],
      opts?: Parameters<typeof execFileRunner.run>[2],
    ) =>
      bin === 'python3'
        ? { code: -1, stdout: '', stderr: 'python3 was not found.', failure: 'not-found' as const }
        : execFileRunner.run(bin, args, opts),
  };
  const verification = await verifyMigration({ ...ctx, deps: { ...ctx.deps, runner } });
  assert.deepEqual(outcome(verification), only(['lore-integrity']));
  assert.match(
    sentenceOf(verification, 'lore-integrity'),
    /^lore-integrity could not be run with python3, so the Lore of the Space was not checked: python3 was not found\.$/,
  );
});

test('a Lore that fails lore-integrity fails the verification with the findings', async () => {
  const { ctx } = b();
  const stray = join(ctx.spaceRoot, 'lore', 'stray.md');
  writeFileSync(stray, 'A card without frontmatter.\n');
  try {
    const verification = await verifyMigration(ctx);
    assert.deepEqual(outcome(verification), only(['lore-integrity', 'space-pushed']));
    const sentence = sentenceOf(verification, 'lore-integrity');
    assert.match(sentence, /lore-integrity failed over the Lore of the Space with exit code 2/);
    assert.match(sentence, /lore\/stray\.md/);
    await assertStepFailsAndUndoesNothing(ctx);
  } finally {
    rmSync(stray, { force: true });
  }
  await assertPassesAgain(ctx);
});
