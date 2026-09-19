/**
 * The local steps of the migration (phase M6.3): steps 1 to 10 and 12, run
 * with the shared runner on `makeV08Fixture` and `FakeGitHub`, with the
 * payload and the Space repository on bare remotes in temporary folders.
 * Steps 11 and 13 belong to other phases and are not run here.
 *
 * Every archived file has its source's hash; lore-integrity passes on the
 * resulting Space; a second run changes nothing; a run stopped after each
 * step resumes to the same end state; and the source is unchanged
 * throughout: its tree, and the head and `git status --porcelain` of both
 * source repositories. No test reads the real project, its Lore or live GitHub.
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
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { execFileRunner, runGit } from '../../src/space/exec/index.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import {
  type MigrationContext,
  type MigrationDeps,
  type MigrationStep,
  type MigrationStepId,
  prepareMigration,
  readMigrationLedger,
} from '../../src/space/migrate/index.js';
import { runSteps } from '../../src/space/steps/index.js';
import type { RunStepsOptions } from '../../src/space/steps/index.js';
import {
  type FakeGitHub,
  type V08Fixture,
  createFakeGitHub,
  makeV08Fixture,
} from '../../src/space/testing/index.js';
import { loreTemplateDir, runPython, useTempDir } from '../support/index.js';

const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;
const DESCRIPTION = 'The migrated fixture, described by the Human Lead.';

/** Steps 1 to 10 and 12, in the order of section 5.9. */
const LOCAL: readonly MigrationStepId[] = [
  'record-source',
  'create-space',
  'clone-payload',
  'archive',
  'pointer',
  'contracts',
  'mirror',
  'workbench',
  'corpus-entry',
  'commit-and-push',
  'install',
];

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

type Target = { fake: FakeGitHub; deps: MigrationDeps; parentDir: string; userDataDir: string };

function target(t: TestContext): Target {
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
  return { fake, deps, parentDir, userDataDir };
}

/** The fixture, with links added that the migration must rewrite or set as code. */
async function source(t: TestContext): Promise<V08Fixture> {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  appendFileSync(
    join(fixture.memoryPath, 'notepad', 'product-document.note.md'),
    [
      '',
      'See [the registry](../status/status.stack.md), [the critique](./product-critique-2026-09-18.note.md),',
      '[a note](./renderer-imports.note.md), [the readme](../../../README.md#top) and [a gone file](./gone.md).',
      '',
    ].join('\n'),
  );
  appendFileSync(
    join(fixture.memoryPath, 'blueprint', 'mirror', 'packages', 'app.mirror.md'),
    '\nIts rules are in [the contracts](../../contracts/contracts.spec.md); [a gone file](./gone.md) is not.\n',
  );
  return fixture;
}

async function prepared(
  fixture: V08Fixture,
  where: Target,
): Promise<{ ctx: MigrationContext; steps: MigrationStep[] }> {
  const ready = await prepareMigration(
    {
      sourceRoot: fixture.root,
      form: { parentDir: where.parentDir, payloadGitHub: PAYLOAD, description: DESCRIPTION },
    },
    where.deps,
  );
  assert.ok(ready.ok, ready.ok ? '' : ready.error.message);
  assert.deepEqual(ready.value.refusals, []);
  return { ctx: ready.value.ctx, steps: localSteps(ready.value.steps) };
}

function localSteps(steps: readonly MigrationStep[]): MigrationStep[] {
  const chosen = steps.filter((step) => (LOCAL as readonly string[]).includes(step.id));
  assert.deepEqual(
    chosen.map((step) => step.id),
    LOCAL,
  );
  return chosen;
}

/** Prepare as `runMigration` does, and run the local steps. */
async function runLocal(fixture: V08Fixture, where: Target, options: RunStepsOptions = {}) {
  const { ctx, steps } = await prepared(fixture, where);
  return { ctx, run: await runSteps(steps, ctx, options) };
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

/** The paths and contents of a folder without any `.git`, and without times: what two runs must agree on. */
function contentHash(dir: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      if (name === '.git') continue;
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

async function git(dir: string, args: string[]): Promise<string> {
  const run = await runGit(execFileRunner, dir, args, { readOnly: true });
  assert.equal(run.code, 0, run.stderr);
  return run.stdout;
}

/** The source's tree, and the head and status of both of its repositories. */
async function sourceState(fixture: V08Fixture): Promise<string[]> {
  const state = [treeHash(fixture.root)];
  for (const dir of [fixture.root, fixture.memoryPath]) {
    state.push(await git(dir, ['rev-parse', 'HEAD']), await git(dir, ['status', '--porcelain']));
  }
  return state;
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function read(ctx: MigrationContext, relative: string): string {
  return readFileSync(join(ctx.spaceRoot, ...relative.split('/')), 'utf8');
}

async function assertLoreIntegrity(space: string): Promise<void> {
  const script = join(space, 'lore', 'contracts', 'core', 'lore-integrity.py');
  const run = await runPython(script, ['--space', space, '--when', 'after'], { cwd: space });
  assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
}

test('the local steps make the Space: archive, pointer, contracts, mirror, Workbench, corpus entry, pushed and installed', async (t) => {
  const fixture = await source(t);
  const where = target(t);
  const before = await sourceState(fixture);

  const { ctx, run } = await runLocal(fixture, where);
  assert.ok(run.ok, run.ok ? '' : run.error.message);
  assert.deepEqual(run.value.completed, LOCAL);
  assert.deepEqual(await sourceState(fixture), before, 'the source is unchanged');

  // Every archived file has its source's hash; ignored files are archived too.
  assert.ok(ctx.targets.archived.length > 20);
  for (const file of ctx.targets.archived) {
    const at = join(ctx.spaceRoot, ...file.to.split('/'));
    assert.equal(sha(at), sha(join(fixture.root, ...file.from.split('/'))), file.to);
  }
  assert.ok(existsSync(join(ctx.spaceRoot, 'publish/archive/v0.8/memory/.DS_Store')));
  assert.ok(!existsSync(join(ctx.spaceRoot, 'publish/archive/v0.8/memory/.git')));

  // The pointer, outside v0.8/.
  const pointer = read(ctx, 'publish/archive/index.md');
  assert.ok(pointer.includes(fixture.root));
  for (const repository of [ctx.source.payloadRepository, ctx.source.loreRepository]) {
    assert.ok(repository.originUrl !== null && pointer.includes(repository.originUrl));
  }

  // One contract card per source file, rule only, listed.
  assert.equal(ctx.targets.contracts.length, fixture.contents.projectContracts.length + 1);
  const index = read(ctx, 'lore/contracts/index.md');
  for (const card of ctx.targets.contracts) {
    const text = read(ctx, card.to);
    assert.match(text, /^---\ntype: contract\n/);
    assert.match(text, /\ncheck: null\nwhen: null\n---\n/);
    assert.ok(index.includes(`(./${card.name}.md)`), card.name);
  }
  const spec = read(ctx, 'lore/contracts/contracts.md');
  for (const section of fixture.contents.contractSpecSections)
    assert.ok(spec.includes(`## ${section}`));
  assert.ok(
    read(ctx, 'lore/contracts/typescript-everywhere.md').includes(
      'Every source file of the payload is TypeScript.',
    ),
  );

  // The mirror: a fresh skeleton, the v0.8 prose, a link rewritten and one set as code.
  const mirror = read(ctx, ctx.targets.mirror.to);
  assert.match(mirror, /\nskeleton:\n {2}- "/);
  assert.ok(mirror.includes('**What it is.** The application of the payload.'));
  assert.ok(
    mirror.includes(
      '[the contracts](../../publish/archive/v0.8/memory/blueprint/contracts/contracts.spec.md)',
    ),
  );
  assert.ok(mirror.includes('a gone file (`./gone.md`)'));

  // The Workbench: the handover as the first entry, the drafts.
  const handover = ctx.targets.handover;
  assert.ok(handover);
  assert.equal(handover.to, 'workbench/journal/2026-09-18-0000-v08-handover-migration.md');
  assert.ok(read(ctx, handover.to).includes('Next: finish the first step of the second stage.'));
  const product = read(ctx, 'workbench/drafts/product-document.note.md');
  assert.ok(
    product.includes('[the registry](../../publish/archive/v0.8/memory/status/status.stack.md)'),
  );
  assert.ok(product.includes('[the critique](./product-critique-2026-09-18.note.md)'));
  assert.ok(
    product.includes(
      '[a note](../../publish/archive/v0.8/memory/notepad/renderer-imports.note.md)',
    ),
  );
  assert.ok(product.includes('[the readme](../../repos/fixture-project/README.md#top)'));
  assert.ok(
    product.includes('[a gone file](./gone.md)'),
    'a link broken in v0.8 is left as it was',
  );
  assert.ok(product.includes('![Dashboard](./product-document/Dashboard.png)'));
  for (const draft of ctx.targets.drafts.filter(
    (d) => !d.to.endsWith('product-document.note.md'),
  )) {
    assert.equal(sha(join(ctx.spaceRoot, ...draft.to.split('/'))), draft.sha256, draft.to);
  }

  // The corpus entry: the project's name and the Human Lead's description.
  const entry = read(ctx, ctx.targets.corpusEntry);
  assert.ok(entry.includes(`"${fixture.projectName}"`));
  assert.ok(entry.includes(DESCRIPTION));

  await assertLoreIntegrity(ctx.spaceRoot);

  // Pushed, never forced: the remote has the local head, and the ignored archive files.
  const found = await where.fake.findRepository(ctx.repositoryName);
  assert.ok(found.ok && found.value !== null);
  const remote = found.value.cloneUrl;
  const head = (await git(ctx.spaceRoot, ['rev-parse', 'HEAD'])).trim();
  assert.equal((await git(remote, ['rev-parse', 'main'])).trim(), head);
  const listed = await git(remote, ['ls-tree', '-r', '--name-only', 'main']);
  assert.ok(listed.includes('publish/archive/v0.8/memory/.DS_Store'));
  assert.ok(listed.includes('publish/archive/index.md'));
  assert.ok(!listed.includes('workbench/'));

  // The ledger: the source's state and one record per step.
  const ledger = readMigrationLedger(where.userDataDir, ctx.spaceRoot, fixture.root);
  const payloadState = ledger.find((record) => record.kind === 'source-state');
  assert.ok(payloadState?.kind === 'source-state');
  assert.equal(payloadState.payload.head, fixture.payloadHead);
  assert.equal(payloadState.lore.head, fixture.memoryHead);
  assert.deepEqual(
    ledger.flatMap((record) => (record.kind === 'step-done' ? [record.stepId] : [])),
    LOCAL,
  );

  // A second run changes nothing: every step is skipped, the Space's tree is the same.
  const space = treeHash(ctx.spaceRoot);
  const writesBefore = where.fake.calls.filter((call) =>
    call.operation.startsWith('create'),
  ).length;
  const again = await runLocal(fixture, where);
  assert.ok(again.run.ok, again.run.ok ? '' : again.run.error.message);
  assert.deepEqual(again.run.value.completed, []);
  assert.deepEqual(again.run.value.skipped, LOCAL);
  assert.equal(treeHash(ctx.spaceRoot), space, 'the second run changed nothing');
  assert.equal(
    where.fake.calls.filter((call) => call.operation.startsWith('create')).length,
    writesBefore,
  );
  assert.equal(
    readMigrationLedger(where.userDataDir, ctx.spaceRoot, fixture.root).length,
    ledger.length,
  );
  assert.deepEqual(await sourceState(fixture), before, 'the source is unchanged');
});

test('a run stopped after each local step resumes to the same end state', async (t) => {
  const fixture = await source(t);
  const before = await sourceState(fixture);

  const reference = target(t);
  const whole = await runLocal(fixture, reference);
  assert.ok(whole.run.ok, whole.run.ok ? '' : whole.run.error.message);
  const wanted = contentHash(whole.ctx.spaceRoot);
  const wantedTree = (await git(whole.ctx.spaceRoot, ['rev-parse', 'HEAD^{tree}'])).trim();

  for (const [index, stopAfter] of LOCAL.entries()) {
    const where = target(t);
    const controller = new AbortController();
    const first = await runLocal(fixture, where, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.stepId === stopAfter && progress.state === 'done') controller.abort();
      },
    });
    if (index < LOCAL.length - 1) {
      assert.ok(!first.run.ok, stopAfter);
      assert.equal(first.run.error.kind, 'stopped');
      assert.equal(first.run.error.stepId, LOCAL[index + 1]);
    }
    const resumed = await runLocal(fixture, where);
    assert.ok(resumed.run.ok, resumed.run.ok ? '' : `${stopAfter}: ${resumed.run.error.message}`);
    assert.deepEqual(resumed.run.value.completed, LOCAL.slice(index + 1), stopAfter);
    assert.equal(
      contentHash(resumed.ctx.spaceRoot),
      wanted,
      `the Space after stopping at ${stopAfter}`,
    );
    const tree = (await git(resumed.ctx.spaceRoot, ['rev-parse', 'HEAD^{tree}'])).trim();
    assert.equal(tree, wantedTree, `the commit's tree after stopping at ${stopAfter}`);
    const ledger = readMigrationLedger(where.userDataDir, resumed.ctx.spaceRoot, fixture.root);
    assert.deepEqual(
      ledger.flatMap((record) => (record.kind === 'step-done' ? [record.stepId] : [])),
      LOCAL,
    );
    assert.deepEqual(await sourceState(fixture), before, `the source after ${stopAfter}`);
  }
});
