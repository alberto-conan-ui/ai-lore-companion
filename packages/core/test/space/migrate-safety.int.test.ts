/**
 * The two promises of the migration (phases M6.3 and M6.4, tested together):
 * the source is never written, and running again duplicates nothing.
 *
 * Steps 1 to 12 run as one migration on `makeV08Fixture` (with uncommitted
 * changes, a stash in both repositories and a large archive) and
 * `FakeGitHub`, with every git command recorded. The source's whole tree
 * (both `.git` folders included), both heads, statuses, stash lists and
 * configurations are the same afterwards; every git command run in the source
 * reads, with `--no-optional-locks`; the clone does not come from the source;
 * no archived file is a hard link. A second run, and a run with the ledger
 * deleted, change nothing in the Space and make nothing on GitHub. Step 10
 * adds only the archive with `--force`, and refuses to push over a remote that
 * has moved on. Step 11, stopped at each of its writes in turn (refused, or
 * done with its answer lost), is finished by the next run with each issue
 * exactly once and in its place. No test reads the real project, its Lore or
 * live GitHub.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { type TestContext, test } from 'node:test';
import { type CommandRunner, execFileRunner, runGit } from '../../src/space/exec/index.js';
import {
  DEFAULT_STAGES,
  type GitHubPort,
  PAUSED_LABEL,
  STAGE_FIELD,
  bodyHasMarker,
  gitHubUnreachable,
} from '../../src/space/github/index.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import {
  type MigrationContext,
  type MigrationDeps,
  type MigrationIssueProgress,
  type MigrationStep,
  prepareMigration,
} from '../../src/space/migrate/index.js';
import { addressIsInSource } from '../../src/space/migrate/steps/03-clone-payload.js';
import { commitAndPushStep } from '../../src/space/migrate/steps/10-commit-and-push.js';
import { runSteps } from '../../src/space/steps/index.js';
import {
  type FakeGitHub,
  type V08Fixture,
  createFakeGitHub,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir, useClone, useTempDir } from '../support/index.js';

const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;
const SPACE = 'fixture-project-space';
const REPOSITORY = `${OWNER}/${SPACE}`;
const BULK = 600;
const GIT_CONFIG = {
  'user.name': 'AI-Lore Test',
  'user.email': 'test@ai-lore.invalid',
  'commit.gpgsign': 'false',
};
/** The git commands the source may be asked, after `--no-optional-locks`. */
const READS = new Set(['rev-parse', 'status', 'remote', 'ls-files', 'config', 'symbolic-ref']);
/** The operations of the port that write. */
const WRITES = new Set<string>([
  'createRepository',
  'createProject',
  'ensureSingleSelectField',
  'linkProjectToRepository',
  'ensureLabels',
  'createIssue',
  'addSubIssue',
  'addIssueToProject',
  'setSingleSelect',
]);

function machine(): MachineCheck {
  const fine = { kind: 'fine', version: '1.0' } as const;
  return {
    ready: true,
    engines: [],
    requirements: [{ id: 'git', binary: 'git', state: fine, guidance: null, command: null }],
  };
}

type GitCall = { args: readonly string[]; cwd: string };

/** A runner that records every git command, with its folder. */
function recordingRunner(calls: GitCall[]): CommandRunner {
  return {
    run: (bin, args, opts) => {
      if (bin === 'git') calls.push({ args: [...args], cwd: opts?.cwd ?? process.cwd() });
      return execFileRunner.run(bin, args, opts);
    },
  };
}

/** Every file, folder and link under `dir`, `.git` included, with mode, size, time and content. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const abs = join(path, name);
      const info = lstatSync(abs);
      hash.update(`${rel}/${name}\0${info.mode}\0${info.size}\0${info.mtimeMs}\0`);
      if (info.isSymbolicLink()) hash.update(readlinkSync(abs));
      else if (info.isDirectory()) visit(abs, `${rel}/${name}`);
      else hash.update(readFileSync(abs));
    }
  };
  visit(dir, '');
  return hash.digest('hex');
}

async function git(dir: string, args: string[]): Promise<string> {
  const run = await runGit(execFileRunner, dir, args, { readOnly: true });
  assert.equal(run.code, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
}

/** The source's tree, and the head, status, stash list and configuration of both repositories. */
async function sourceState(fixture: V08Fixture): Promise<string[]> {
  const state = [treeHash(fixture.root)];
  for (const dir of [fixture.root, fixture.memoryPath]) {
    state.push(
      await git(dir, ['rev-parse', 'HEAD']),
      await git(dir, ['status', '--porcelain']),
      await git(dir, ['stash', 'list']),
      await git(dir, ['config', '--local', '--list']),
    );
  }
  return state;
}

/** The fixture with a stash in both repositories, uncommitted changes, and a large notepad. */
async function source(t: TestContext): Promise<V08Fixture> {
  const fixture = await makeV08Fixture({ uncommitted: true });
  t.after(() => fixture.cleanup());
  for (const [dir, file] of [
    [fixture.root, 'README.md'],
    [fixture.memoryPath, 'workspace.yaml'],
  ] as const) {
    for (const [key, value] of Object.entries(GIT_CONFIG)) {
      await runGit(execFileRunner, dir, ['config', key, value]);
    }
    appendFileSync(join(dir, file), '\nA change kept in the stash.\n');
    const stashed = await runGit(execFileRunner, dir, ['stash', 'push', '--', file]);
    assert.equal(stashed.code, 0, stashed.stderr);
  }
  const bulk = join(fixture.memoryPath, 'notepad', 'bulk');
  mkdirSync(bulk, { recursive: true });
  for (let index = 0; index < BULK; index += 1) {
    writeFileSync(join(bulk, `note-${index}.note.md`), `# Note ${index}\n\nKept as it is.\n`);
  }
  return fixture;
}

type Bench = {
  fixture: V08Fixture;
  fake: FakeGitHub;
  port: GitHubPort;
  deps: MigrationDeps;
  parentDir: string;
  userDataDir: string;
  calls: GitCall[];
  events: MigrationIssueProgress[];
};

function bench(t: TestContext, fixture: V08Fixture): Bench {
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  const calls: GitCall[] = [];
  const events: MigrationIssueProgress[] = [];
  const port: GitHubPort = { ...fake };
  const parentDir = useTempDir(t, 'ai-lore-migrate-safety-');
  const userDataDir = useTempDir(t, 'ai-lore-userdata-');
  const deps: MigrationDeps = {
    runner: recordingRunner(calls),
    github: port,
    templateDir: loreTemplateDir(),
    userDataDir,
    checkMachine: async () => machine(),
    gitConfig: GIT_CONFIG,
    pause: async () => undefined,
    onIssueProgress: (progress) => {
      events.push(progress);
    },
  };
  return { fixture, fake, port, deps, parentDir, userDataDir, calls, events };
}

/**
 * Prepare as `runMigration` does. `refusals` is false for the step 11 bench,
 * which has a Project with items and no Space folder, since step 2 did not run.
 */
async function prepared(
  b: Bench,
  refusals = true,
): Promise<{ ctx: MigrationContext; steps: MigrationStep[] }> {
  const made = await prepareMigration(
    {
      sourceRoot: b.fixture.root,
      form: { parentDir: b.parentDir, payloadGitHub: PAYLOAD, description: 'The fixture.' },
    },
    b.deps,
  );
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  if (refusals) assert.deepEqual(made.value.refusals, []);
  // Step 13 belongs to phase M6.6.
  return { ctx: made.value.ctx, steps: made.value.steps.filter((step) => step.id !== 'verify') };
}

function real(path: string): string {
  return realpathSync(path);
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}${sep}`);
}

/** Whether the resolved folder of a git call, or any of its arguments, is in the source. */
function touchesSource(call: GitCall, sourceRoot: string): boolean {
  let cwd = call.cwd;
  try {
    cwd = real(call.cwd);
  } catch {
    // A folder that does not exist yet is not the source.
  }
  if (isInside(cwd, sourceRoot)) return true;
  return call.args.some((arg) => arg.startsWith('/') && isInside(arg, sourceRoot));
}

/** What GitHub holds for the Space: counted so that a second run can be compared. */
function gitHubCounts(fake: FakeGitHub): Record<string, number> {
  const state = fake.state();
  const project = state.projects[0];
  return {
    repositories: state.repositories.length,
    projects: state.projects.length,
    fields: project?.fields.length ?? 0,
    items: project?.items.length ?? 0,
    issues: state.issues.length,
    labels: state.repositories.reduce((sum, repository) => sum + repository.labels.length, 0),
  };
}

function writesSince(fake: FakeGitHub, from: number): string[] {
  return fake.calls
    .slice(from)
    .filter((call) => WRITES.has(call.operation) && call.ok)
    .map((call) => call.operation);
}

/** Each planned issue exactly once, on the Project once, the stages under the focus, the Stage set. */
function assertIssuesInPlace(fake: FakeGitHub, ctx: MigrationContext): void {
  const state = fake.state();
  const issues = state.issues.filter((issue) => issue.ref.repository === REPOSITORY);
  assert.equal(issues.length, ctx.issues.length, 'one issue per planned issue');
  const byKey = new Map<string, (typeof issues)[number]>();
  for (const planned of ctx.issues) {
    const holding = issues.filter((issue) => bodyHasMarker(issue.body, planned.marker));
    assert.equal(holding.length, 1, `one issue for ${planned.key}`);
    const [issue] = holding;
    assert.ok(issue);
    byKey.set(planned.key, issue);
  }
  const project = state.projects[0];
  assert.ok(project);
  const stageField = project.fields.find((field) => field.name === STAGE_FIELD);
  assert.ok(stageField);
  for (const planned of ctx.issues) {
    const issue = byKey.get(planned.key);
    assert.ok(issue);
    const items: { values: Record<string, string> }[] = project.items.filter(
      (item) => item.issueId === issue.id,
    );
    assert.equal(items.length, 1, `${planned.key} is on the Project once`);
    const parent = planned.parentKey === null ? null : (byKey.get(planned.parentKey)?.id ?? 'none');
    assert.equal(issue.parentId, parent, `${planned.key} has its parent`);
    const value: string | undefined = items[0]?.values[stageField.id];
    const option: { name: string } | undefined = stageField.options.find((o) => o.id === value);
    // Only the focus issue has a Stage: a stage item or a standalone issue with one would be read as a focus.
    assert.equal(option?.name ?? null, planned.kind === 'focus' ? planned.stage : null);
  }
  const labels = state.repositories.find((r) => r.info.fullName === REPOSITORY)?.labels ?? [];
  assert.equal(labels.filter((label) => label.name === PAUSED_LABEL).length, 1);
}

test('the whole migration leaves the source as it was and a second run, with or without the ledger, changes nothing', async (t) => {
  const fixture = await source(t);
  const b = bench(t, fixture);
  const sourceRoot = real(fixture.root);
  const before = await sourceState(fixture);

  const { ctx, steps } = await prepared(b);
  const payloadDir = join(ctx.spaceRoot, ctx.targets.payloadCheckout);
  const run = await runSteps(steps, ctx, {
    onProgress: (progress) => {
      // Ignored content the Space holds when step 10 runs: none of it may reach the commit.
      if (progress.stepId === 'corpus-entry' && progress.state === 'done') {
        mkdirSync(join(ctx.spaceRoot, 'workbench', 'node_modules'), { recursive: true });
        writeFileSync(join(ctx.spaceRoot, 'workbench', '.env'), 'SECRET=1\n');
        writeFileSync(join(ctx.spaceRoot, 'workbench', 'node_modules', 'a.js'), '1\n');
        writeFileSync(join(payloadDir, '.env'), 'SECRET=2\n');
      }
    },
  });
  assert.ok(run.ok, run.ok ? '' : run.error.message);
  assert.deepEqual(await sourceState(fixture), before, 'the source is unchanged');

  // Every git command run in the source reads, and says so with --no-optional-locks.
  const inSource = b.calls.filter((call) => touchesSource(call, sourceRoot));
  assert.ok(inSource.length > 0);
  const seen = new Set<string>();
  for (const call of inSource) {
    const line = call.args.join(' ');
    assert.equal(call.args[0], '--no-optional-locks', line);
    // Global options such as `-c core.quotepath=false` come before the command.
    const rest = call.args.slice(1);
    while (rest[0] === '-c') rest.splice(0, 2);
    const [command = '', next = ''] = rest;
    seen.add(command);
    assert.ok(READS.has(command), `only reads in the source: ${line}`);
    if (command === 'config') assert.equal(next, '--get', line);
    if (command === 'remote') assert.equal(next, 'get-url', line);
  }
  t.diagnostic(`git commands run in the source: ${[...seen].sort().join(', ')}`);
  // The clone comes from the payload's origin, never from the source or with an alternate.
  const clones = b.calls.filter((call) => call.args.includes('clone'));
  assert.ok(clones.length > 0);
  for (const call of clones) {
    assert.ok(!call.args.some((arg) => /^--(reference|shared|dissociate)|^-s$/.test(arg)));
    assert.ok(!touchesSource(call, sourceRoot), call.args.join(' '));
  }
  // The archive copies bytes: no archived file shares its source's inode.
  assert.ok(ctx.targets.archived.length > BULK);
  for (const file of ctx.targets.archived) {
    const to = statSync(join(ctx.spaceRoot, ...file.to.split('/')));
    const from = statSync(join(fixture.root, ...file.from.split('/')));
    assert.equal(to.nlink, 1, file.to);
    assert.notEqual(to.ino, from.ino, file.to);
  }

  // The archive, ignored files included, is on the remote; the ignored content of the Space is not.
  const repository = await b.fake.findRepository(ctx.repositoryName);
  assert.ok(repository.ok && repository.value !== null);
  const remote = repository.value.cloneUrl;
  const listed = new Set(
    (await git(remote, ['ls-tree', '-r', '-z', '--name-only', 'main'])).split('\0'),
  );
  for (const file of ctx.targets.archived) assert.ok(listed.has(file.to), file.to);
  for (const path of listed) {
    assert.ok(!/(^|\/)\.env$|node_modules|^workbench\/|^repos\//.test(path), path);
  }
  assertIssuesInPlace(b.fake, ctx);

  // A second run: no file change, no commit, nothing made on GitHub.
  const space = treeHash(ctx.spaceRoot);
  const commits = await git(remote, ['rev-list', '--all']);
  const counts = gitHubCounts(b.fake);
  for (const round of ['ledger kept', 'ledger deleted']) {
    if (round === 'ledger deleted') {
      rmSync(b.userDataDir, { recursive: true, force: true });
      mkdirSync(b.userDataDir, { recursive: true });
    }
    const from = b.fake.calls.length;
    const again = await prepared(b);
    const second = await runSteps(again.steps, again.ctx);
    assert.ok(second.ok, second.ok ? '' : `${round}: ${second.error.message}`);
    assert.equal(treeHash(ctx.spaceRoot), space, `${round}: the Space is unchanged`);
    assert.equal(await git(remote, ['rev-list', '--all']), commits, `${round}: no commit`);
    assert.deepEqual(gitHubCounts(b.fake), counts, `${round}: nothing new on GitHub`);
    const writes = writesSince(b.fake, from);
    // Setup's Project layout is asked again each run (and step 2 runs it again once the ledger is
    // gone): those calls ensure what is there and make nothing, as the counts above show.
    const idempotent = new Set([
      'ensureSingleSelectField',
      'ensureLabels',
      'linkProjectToRepository',
    ]);
    assert.ok(
      writes.every((operation) => idempotent.has(operation)),
      `${round}: ${writes.join(', ')}`,
    );
    assertIssuesInPlace(b.fake, again.ctx);
    assert.deepEqual(await sourceState(fixture), before, `${round}: the source is unchanged`);
  }

  // A remote that moved on is not pushed over: the step stops and says so.
  const other = await useClone(t, remote);
  other.write('elsewhere.md', 'Written on another desk.\n');
  await other.commitAll('Elsewhere');
  await other.git('push', '--quiet', 'origin', 'main');
  const moved = (await git(remote, ['rev-parse', 'main'])).trim();
  writeFileSync(join(ctx.spaceRoot, 'publish', 'later.md'), 'Written after the migration.\n');
  const refused = await commitAndPushStep().run(ctx);
  assert.ok(!refused.ok);
  assert.match(refused.error.message, /rejected|non-fast-forward|fetch first/i);
  assert.match(refused.error.message, /running the migration again continues/);
  assert.equal((await git(remote, ['rev-parse', 'main'])).trim(), moved, 'not pushed over');
});

test('step 11 stopped at each of its writes, refused or with its answer lost, is finished by the next run', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());

  /** A bench where step 2 has made the Space repository and its Project, as the issues test does. */
  async function ready(): Promise<Bench> {
    const b = bench(t, fixture);
    assert.ok((await b.fake.createRepository({ owner: OWNER, name: SPACE, private: true })).ok);
    const project = await b.fake.createProject({ owner: OWNER, title: SPACE });
    assert.ok(project.ok);
    const field = await b.fake.ensureSingleSelectField({
      project: project.value,
      name: STAGE_FIELD,
      options: [...DEFAULT_STAGES],
    });
    assert.ok(field.ok);
    return b;
  }
  async function issuesStepOf(b: Bench) {
    const { ctx, steps } = await prepared(b, false);
    const step = steps.find((one) => one.id === 'issues');
    assert.ok(step);
    return { ctx, step };
  }

  // How many writes an uninterrupted run makes.
  const whole = await ready();
  const from = whole.fake.calls.length;
  const first = await issuesStepOf(whole);
  assert.ok((await first.step.run(first.ctx)).ok);
  const total = writesSince(whole.fake, from).length;
  assert.ok(total >= first.ctx.issues.length * 2);
  assertIssuesInPlace(whole.fake, first.ctx);
  const events = whole.events.filter((event) => event.state === 'completed');
  assert.equal(events.length, first.ctx.issues.length, 'one completed event per issue');

  for (const mode of ['refused', 'lost'] as const) {
    for (let stopAt = 1; stopAt <= total; stopAt += 1) {
      const b = await ready();
      let count = 0;
      let armed = true;
      for (const operation of WRITES) {
        const name = operation as keyof GitHubPort;
        const original = b.port[name] as (arg: unknown) => Promise<unknown>;
        (b.port as Record<string, unknown>)[name] = async (arg: unknown) => {
          count += 1;
          if (!armed || count !== stopAt) return original(arg);
          if (mode === 'refused') return { ok: false, error: gitHubUnreachable('down') };
          await original(arg);
          return { ok: false, error: gitHubUnreachable('the answer was lost') };
        };
      }
      const stopped = await issuesStepOf(b);
      const firstRun = await stopped.step.run(stopped.ctx);
      assert.ok(!firstRun.ok, `${mode} at write ${stopAt}`);
      assert.equal(firstRun.error.kind, 'github-unreachable');
      // The next run, with GitHub reachable again.
      armed = false;
      const resumed = await issuesStepOf(b);
      const next = await resumed.step.run(resumed.ctx);
      assert.ok(next.ok, next.ok ? '' : `${mode} at write ${stopAt}: ${next.error.message}`);
      assertIssuesInPlace(b.fake, resumed.ctx);
      const again = await issuesStepOf(b);
      assert.equal(await again.step.isDone(again.ctx), true, `${mode} at write ${stopAt}`);
    }
  }
});

test('addressIsInSource: a local origin in the source is refused, any other address is not', () => {
  const root = useTempDir({ after: () => undefined }, 'ai-lore-address-');
  try {
    mkdirSync(join(root, 'inner'));
    assert.equal(addressIsInSource(root, root), true);
    assert.equal(addressIsInSource(join(root, 'inner'), root), true);
    assert.equal(addressIsInSource('./inner', root), true);
    assert.equal(addressIsInSource(`file://${join(root, 'inner')}`, root), true);
    assert.equal(addressIsInSource(join(root, '..', 'elsewhere.git'), root), false);
    assert.equal(addressIsInSource('https://github.com/owner/name.git', root), false);
    assert.equal(addressIsInSource('git@github.com:owner/name.git', root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
