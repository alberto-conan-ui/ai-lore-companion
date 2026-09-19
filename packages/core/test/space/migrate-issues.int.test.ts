/**
 * Step 11 of the migration (phase M6.4) on `makeV08Fixture` and `FakeGitHub`:
 * the issues, their labels, their places on the Project, their markers and
 * the ledger; a second run creates none, with the ledger kept or deleted; a
 * rate-limited answer is waited for; a create whose answer was lost is not
 * made twice; an unreachable GitHub stops the step and a later run finishes
 * it; an issue stopped in the middle is completed without a second issue.
 * The step's `run` is called directly, after the Space repository and its
 * Project are made on the fake as step 2 makes them. No test reads the real
 * project, its Lore or live GitHub.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { execFileRunner } from '../../src/space/exec/index.js';
import {
  DEFAULT_STAGES,
  type GitHubPort,
  ISSUE_TITLE_MAX,
  PAUSED_LABEL,
  STAGE_FIELD,
  bodyHasMarker,
  gitHubFailed,
  gitHubRateLimited,
  gitHubUnreachable,
} from '../../src/space/github/index.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import { ISSUE_PACE_MS, issueTitle } from '../../src/space/migrate/github/issue-writer.js';
import {
  type MigrationContext,
  type MigrationDeps,
  type MigrationIssueProgress,
  type MigrationStep,
  prepareMigration,
} from '../../src/space/migrate/index.js';
import {
  type FakeGitHub,
  type V08Fixture,
  createFakeGitHub,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir, useTempDir } from '../support/index.js';

const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;
const SPACE = 'fixture-project-space';
const REPOSITORY = `${OWNER}/${SPACE}`;

function machine(): MachineCheck {
  return {
    ready: true,
    engines: [],
    requirements: [],
    github: { account: null, organisations: [] },
    tools: { brew: true, npm: true },
  };
}

type Bench = {
  fixture: V08Fixture;
  fake: FakeGitHub;
  /** What the step's writes go through; a test may replace one operation. */
  port: GitHubPort;
  deps: MigrationDeps;
  parentDir: string;
  userDataDir: string;
  pauses: number[];
  events: MigrationIssueProgress[];
};

async function bench(t: TestContext): Promise<Bench> {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  const parentDir = useTempDir(t, 'ai-lore-migrate-issues-');
  const userDataDir = useTempDir(t, 'ai-lore-userdata-');
  const pauses: number[] = [];
  const events: MigrationIssueProgress[] = [];
  const port: GitHubPort = { ...fake };
  const deps = {
    runner: execFileRunner,
    github: port,
    templateDir: loreTemplateDir(),
    userDataDir,
    checkMachine: async () => machine(),
    pause: async (ms: number) => {
      pauses.push(ms);
    },
    onIssueProgress: (progress: MigrationIssueProgress) => {
      events.push(progress);
    },
  };
  // What step 2 leaves on GitHub: the Space repository, its Project, and the Stage field.
  const repository = await fake.createRepository({ owner: OWNER, name: SPACE, private: true });
  assert.ok(repository.ok);
  const project = await fake.createProject({ owner: OWNER, title: SPACE });
  assert.ok(project.ok);
  const field = await fake.ensureSingleSelectField({
    project: project.value,
    name: STAGE_FIELD,
    options: [...DEFAULT_STAGES],
  });
  assert.ok(field.ok);
  return { fixture, fake, port, deps, parentDir, userDataDir, pauses, events };
}

async function prepared(b: Bench): Promise<{ ctx: MigrationContext; step: MigrationStep }> {
  const made = await prepareMigration(
    {
      sourceRoot: b.fixture.root,
      form: { parentDir: b.parentDir, payloadGitHub: PAYLOAD, description: 'The fixture.' },
    },
    b.deps,
  );
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  const step = made.value.steps.find((one) => one.id === 'issues');
  assert.ok(step);
  return { ctx: made.value.ctx, step };
}

function issuesOf(b: Bench) {
  return b.fake.state().issues.filter((issue) => issue.ref.repository === REPOSITORY);
}

function creates(b: Bench): number {
  return b.fake.calls.filter((call) => call.operation === 'createIssue').length;
}

/** Each planned issue exists exactly once, found by its marker. */
function assertOncePerMarker(b: Bench, ctx: MigrationContext): void {
  const issues = issuesOf(b);
  assert.equal(issues.length, ctx.issues.length);
  for (const planned of ctx.issues) {
    const holding = issues.filter((issue) => bodyHasMarker(issue.body, planned.marker));
    assert.equal(holding.length, 1, `one issue for ${planned.key}`);
  }
}

/** The ledger kept by the desk is removed, as when the user data folder is lost. */
function deleteLedger(b: Bench): void {
  rmSync(b.userDataDir, { recursive: true, force: true });
  mkdirSync(b.userDataDir, { recursive: true });
}

test('step 11 creates the expected issues, labels, sub-issues and Project items, paced and recorded', async (t) => {
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  const c = b.fixture.contents;
  const backlog = c.backlogEntryCount;
  assert.equal(ctx.issues.length, 1 + c.stages.length + c.pausedFocuses.length + backlog);
  assert.equal(await step.isDone(ctx), false);

  const run = await step.run(ctx);
  assert.ok(run.ok, run.ok ? '' : run.error.message);

  // One issue per planned issue, each with its marker as a whole line and its link.
  assertOncePerMarker(b, ctx);
  const issues = issuesOf(b);
  for (const planned of ctx.issues) {
    const issue = issues.find((one) => bodyHasMarker(one.body, planned.marker));
    assert.ok(issue);
    assert.equal(issue.title, issueTitle(planned));
    assert.ok(issue.title.length > 0 && issue.title.length <= ISSUE_TITLE_MAX);
    assert.ok(issue.body.split('\n').includes(planned.marker));
    assert.ok(
      issue.body.includes(`https://github.com/${REPOSITORY}/`) &&
        issue.body.includes(`/HEAD/${planned.archived}`),
      issue.body,
    );
    assert.deepEqual(issue.labels, planned.kind === 'paused-focus' ? [PAUSED_LABEL] : []);
    // A backlog item's text is carried into its body.
    if (planned.text !== undefined) assert.ok(issue.body.includes(planned.text), issue.body);
  }

  // The paused label is made by this step; setup does not make it.
  const repository = b.fake.state().repositories.find((r) => r.info.fullName === REPOSITORY);
  assert.ok(repository?.labels.some((label) => label.name === PAUSED_LABEL));

  // The Project: the focus at Build with its stages as items, every other issue standalone.
  const project = b.fake.state().projects[0];
  assert.ok(project);
  const snapshot = await b.fake.readProject({ project: project.info });
  assert.ok(snapshot.ok);
  assert.equal(project.items.length, ctx.issues.length);
  assert.equal(snapshot.value.focuses.length, 1);
  const focus = snapshot.value.focuses[0];
  assert.equal(focus?.stage, 'Build');
  assert.equal(focus?.items.length, c.stages.length);
  assert.equal(snapshot.value.standalone.length, c.pausedFocuses.length + backlog);

  // Paced: one second between two writes, and no other wait.
  assert.ok(b.pauses.length > 0);
  assert.ok(b.pauses.every((ms) => ms === ISSUE_PACE_MS));
  const writeOperations: (keyof GitHubPort)[] = [
    'createRepository',
    'createProject',
    'ensureSingleSelectField',
    'ensureLabels',
    'createIssue',
    'addIssueToProject',
    'setSingleSelect',
    'addSubIssue',
  ];
  const writes = b.fake.calls.filter((call) => writeOperations.includes(call.operation)).length;
  // The bench made three writes itself before the step ran; the step's first write waits for none.
  assert.equal(b.pauses.length, writes - 3 - 1);

  // The ledger records each issue and the step; progress was reported per issue.
  assert.equal(ctx.ledger.filter((r) => r.kind === 'issue').length, ctx.issues.length);
  assert.ok(ctx.ledger.some((r) => r.kind === 'step-done' && r.stepId === 'issues'));
  for (const planned of ctx.issues) {
    const states = b.events.filter((e) => e.key === planned.key).map((e) => e.state);
    assert.deepEqual(states, ['created', 'completed']);
  }
  assert.equal(await step.isDone(ctx), true);
});

test('a second run creates none, with the ledger kept and with the ledger deleted', async (t) => {
  const b = await bench(t);
  const first = await prepared(b);
  assert.ok((await first.step.run(first.ctx)).ok);
  const made = creates(b);

  const again = await prepared(b);
  assert.equal(await again.step.isDone(again.ctx), true, 'the ledger says so');
  assert.ok((await again.step.run(again.ctx)).ok);
  assert.equal(creates(b), made);

  deleteLedger(b);
  const lost = await prepared(b);
  assert.deepEqual(lost.ctx.ledger, []);
  assert.equal(await lost.step.isDone(lost.ctx), true, 'the markers and the Project say so');
  b.events.length = 0;
  assert.ok((await lost.step.run(lost.ctx)).ok);
  assert.equal(creates(b), made);
  assertOncePerMarker(b, lost.ctx);
  assert.ok(b.events.filter((e) => e.state === 'found').length === lost.ctx.issues.length);
});

test('a rate-limited answer is waited for and asked again; a wait above the cap stops the step', async (t) => {
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  b.fake.rateLimitNext(2, 30);
  const run = await step.run(ctx);
  assert.ok(run.ok, run.ok ? '' : run.error.message);
  assert.deepEqual(
    b.pauses.filter((ms) => ms !== ISSUE_PACE_MS),
    [30_000, 30_000],
  );
  assertOncePerMarker(b, ctx);

  const other = await bench(t);
  const second = await prepared(other);
  other.fake.rateLimitNext(1, 7200);
  const stopped = await second.step.run(second.ctx);
  assert.ok(!stopped.ok);
  assert.equal(stopped.error.kind, 'github-rate-limited');
  assert.match(stopped.error.message, /Run the migration again after 7200 seconds\./);
  assert.equal(issuesOf(other).length, 0);
});

test('a create whose answer is lost is not made twice, in the same run or the next', async (t) => {
  // Lost with a rate limit: the step waits, finds the issue by its marker, and goes on.
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  let lose = true;
  b.port.createIssue = (arg) => {
    if (lose) b.fake.loseNextAnswer(gitHubRateLimited(5));
    lose = false;
    return b.fake.createIssue(arg);
  };
  const run = await step.run(ctx);
  assert.ok(run.ok, run.ok ? '' : run.error.message);
  assertOncePerMarker(b, ctx);
  assert.equal(creates(b), ctx.issues.length);

  // Lost as unreachable: the step stops; the next run finds the issue by its marker.
  const o = await bench(t);
  const first = await prepared(o);
  let count = 0;
  o.port.createIssue = (arg) => {
    count += 1;
    if (count === 2) o.fake.loseNextAnswer(gitHubUnreachable('the answer was lost'));
    return o.fake.createIssue(arg);
  };
  const stopped = await first.step.run(first.ctx);
  assert.ok(!stopped.ok);
  assert.equal(stopped.error.kind, 'github-unreachable');
  assert.equal(issuesOf(o).length, 2);
  const again = await prepared(o);
  assert.ok((await again.step.run(again.ctx)).ok);
  assertOncePerMarker(o, again.ctx);
  assert.equal(creates(o), again.ctx.issues.length);
});

test('an unreachable GitHub stops the step with a sentence, and a later run finishes it', async (t) => {
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  let count = 0;
  b.port.createIssue = (arg) => {
    count += 1;
    if (count === 3) b.fake.setUnreachable(true);
    return b.fake.createIssue(arg);
  };
  const stopped = await step.run(ctx);
  assert.ok(!stopped.ok);
  assert.equal(stopped.error.kind, 'github-unreachable');
  const third = ctx.issues[2];
  assert.ok(third);
  assert.equal(
    stopped.error.message,
    `GitHub could not be reached: FakeGitHub was told to be unreachable. The issues step stopped at issue 3 of ${ctx.issues.length}, "${issueTitle(third)}". The issues created so far stay on GitHub and are found again by their markers, so running the migration again creates none of them twice. Run the migration again when GitHub can be reached.`,
  );
  assert.equal(issuesOf(b).length, 2);
  assert.equal(await step.isDone(ctx), false);

  b.fake.setUnreachable(false);
  const resumed = await prepared(b);
  assert.ok((await resumed.step.run(resumed.ctx)).ok);
  assertOncePerMarker(b, resumed.ctx);
  assert.equal(await resumed.step.isDone(resumed.ctx), true);
});

test('an issue created whose sub-issue link failed is completed on the next run, without a second issue', async (t) => {
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  const addSubIssue = b.port.addSubIssue;
  let fails = true;
  b.port.addSubIssue = (arg) => {
    if (fails) b.fake.failNext(gitHubFailed('The link could not be made'));
    fails = false;
    return addSubIssue(arg);
  };
  const stopped = await step.run(ctx);
  assert.ok(!stopped.ok);
  assert.equal(stopped.error.kind, 'github-failed');
  // The focus and its first stage exist; the stage has no parent yet.
  assert.equal(issuesOf(b).length, 2);
  assert.ok(issuesOf(b).every((issue) => issue.parentId === null));

  deleteLedger(b);
  const resumed = await prepared(b);
  assert.ok((await resumed.step.run(resumed.ctx)).ok);
  assertOncePerMarker(b, resumed.ctx);
  const project = b.fake.state().projects[0];
  assert.ok(project);
  const snapshot = await b.fake.readProject({ project: project.info });
  assert.ok(snapshot.ok);
  assert.equal(snapshot.value.focuses[0]?.items.length, b.fixture.contents.stages.length);
});

test('with every issue on GitHub but the last not on the Project, the step is not done and a run places it', async (t) => {
  const b = await bench(t);
  const { ctx, step } = await prepared(b);
  const addIssueToProject = b.port.addIssueToProject;
  let count = 0;
  b.port.addIssueToProject = (arg) => {
    count += 1;
    if (count === ctx.issues.length) b.fake.failNext(gitHubFailed('The item could not be added'));
    return addIssueToProject(arg);
  };
  const stopped = await step.run(ctx);
  assert.ok(!stopped.ok);
  assertOncePerMarker(b, ctx);

  // Every marker is found; with the ledger lost, only the Project tells that the last is missing.
  deleteLedger(b);
  const resumed = await prepared(b);
  assert.equal(await resumed.step.isDone(resumed.ctx), false);
  assert.ok((await resumed.step.run(resumed.ctx)).ok);
  assertOncePerMarker(b, resumed.ctx);
  assert.equal(b.fake.state().projects[0]?.items.length, ctx.issues.length);
  assert.equal(await resumed.step.isDone(resumed.ctx), true);
});
