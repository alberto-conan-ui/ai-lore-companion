/**
 * Setup against real folders, real git and `FakeGitHub`: creating a Space,
 * the dry run, a run that was killed and is run again, the refusals, adopting
 * a plain repository and opening a Space by address. The "GitHub" remotes are
 * the bare repositories `FakeGitHub` makes under the temporary folder. The
 * template is read and never written.
 *
 * The first test is the whole-template check that phase M1.7 left to this
 * phase: lore-integrity, run with `python3` as a child process, passes over a
 * Space that setup made.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { closeDesk, listFirstSeen, openDesk } from '../../src/space/desk/index.js';
import { detectFolder } from '../../src/space/detect/index.js';
import { createGitPort, execFileRunner } from '../../src/space/exec/index.js';
import { parseLoreFrontmatter } from '../../src/space/frontmatter/index.js';
import { AGENTS_COLUMNS, DEFAULT_STAGES, type GitHubPort } from '../../src/space/github/index.js';
import { claudeCodeInstallPaths } from '../../src/space/install/index.js';
import { deskPaths } from '../../src/space/layout/index.js';
import { readLore } from '../../src/space/lore/index.js';
import { GH_ADD_SCOPE_COMMAND, type MachineCheck } from '../../src/space/machine/index.js';
import { readSpaceManifest } from '../../src/space/manifest/index.js';
import {
  type CreateSpaceInput,
  type SetupDeps,
  adoptRepository,
  createSpace,
  openSpaceByAddress,
  planAdoptRepository,
  planCreateSpace,
  planOpenSpaceByAddress,
} from '../../src/space/setup/index.js';
import { STEPS_STOPPED, type StepProgress } from '../../src/space/steps/index.js';
import { type FakeGitHub, createFakeGitHub } from '../../src/space/testing/index.js';
import { loreTemplateDir, runPython, useTempDir, useTempGitRepo } from '../support/index.js';

const git = createGitPort(execFileRunner);
const OWNER = 'fake-human';
const WRITES: ReadonlySet<keyof GitHubPort> = new Set<keyof GitHubPort>([
  'createRepository',
  'createProject',
  'ensureSingleSelectField',
  'ensureProjectView',
  'linkProjectToRepository',
  'ensureLabels',
]);

function machine(ready: boolean): MachineCheck {
  const fine = { kind: 'fine', version: '1.0' } as const;
  return {
    ready,
    engines: [],
    requirements: [
      { id: 'git', binary: 'git', state: fine, guidance: null, command: null },
      ready
        ? { id: 'gh', binary: 'gh', state: fine, guidance: null, command: null }
        : {
            id: 'gh',
            binary: 'gh',
            state: { kind: 'not-signed-in' },
            guidance: 'Sign in to GitHub with gh',
            command: 'gh auth login',
          },
      { id: 'engine', binary: 'claude', state: fine, guidance: null, command: null },
      { id: 'python3', binary: 'python3', state: fine, guidance: null, command: null },
    ],
  };
}

type Bench = { fake: FakeGitHub; deps: SetupDeps; parentDir: string; form: CreateSpaceInput };

function bench(t: TestContext, options: { scopes?: string[]; ready?: boolean } = {}): Bench {
  const fake = createFakeGitHub(options.scopes === undefined ? {} : { scopes: options.scopes });
  t.after(() => fake.dispose());
  const parentDir = useTempDir(t, 'ai-lore-setup-');
  const deps: SetupDeps = {
    runner: execFileRunner,
    github: fake,
    templateDir: loreTemplateDir(),
    userDataDir: useTempDir(t, 'ai-lore-userdata-'),
    checkMachine: async () => machine(options.ready ?? true),
    gitConfig: {
      'user.name': 'AI-Lore Test',
      'user.email': 'test@ai-lore.invalid',
      'commit.gpgsign': 'false',
    },
  };
  const form: CreateSpaceInput = {
    name: 'demo-space',
    description: 'A Space for the tests.\nIt links to [nothing](./nowhere.md) on purpose.',
    owner: OWNER,
    parentDir,
  };
  return { fake, deps, parentDir, form };
}

/** A repository on the fake GitHub with one pushed commit. Returns its `owner/name`. */
async function seedRepository(t: TestContext, fake: FakeGitHub, name: string): Promise<string> {
  const created = await fake.createRepository({ owner: OWNER, name, private: true });
  assert.ok(created.ok);
  const seed = await useTempGitRepo(t);
  seed.write('README.md', `# ${name}\n`);
  seed.write('src/main.ts', 'export const main = 1;\n');
  await seed.commitAll('First commit');
  assert.ok((await git.addRemote(seed.dir, 'origin', created.value.cloneUrl)).ok);
  assert.ok((await git.push(seed.dir, { setUpstream: true })).ok);
  fake.calls.length = 0;
  return created.value.fullName;
}

/** One hash over every file of a folder, `.git` included: its path, its kind and its content. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(dir, relative)).sort()) {
      const child = relative === '' ? name : `${relative}/${name}`;
      const info = lstatSync(join(dir, child));
      if (info.isDirectory()) {
        hash.update(`dir:${child}\n`);
        walk(child);
      } else if (info.isFile()) {
        hash.update(`file:${child}:${info.mtimeMs}\n`);
        hash.update(readFileSync(join(dir, child)));
      } else {
        hash.update(`other:${child}\n`);
      }
    }
  };
  walk('');
  return hash.digest('hex');
}

async function assertLoreIntegrity(space: string): Promise<void> {
  const script = join(space, 'lore', 'contracts', 'core', 'lore-integrity.py');
  const run = await runPython(script, ['--space', space, '--when', 'after'], { cwd: space });
  assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /passes the check/);
}

function firstSeenRoots(userDataDir: string, space: string): string[] {
  const desk = openDesk(deskPaths(userDataDir, space));
  assert.ok(desk.ok);
  try {
    const seen = listFirstSeen(desk.value);
    assert.ok(seen.ok);
    return seen.value.map((record) => record.rootId).sort();
  } finally {
    closeDesk(desk.value);
  }
}

function writes(fake: FakeGitHub, operation: keyof GitHubPort): number {
  return fake.calls.filter((call) => call.operation === operation).length;
}

test('createSpace ends with a pushed repository, a Project with five stages and a Lore that passes lore-integrity', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const app = await seedRepository(t, fake, 'app');
  const input = { ...form, repositories: [{ name: 'app', github: app }] };
  const events: StepProgress[] = [];
  const result = await createSpace(input, deps, { onProgress: (event) => events.push(event) });
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  const report = result.value;
  const space = join(parentDir, 'demo-space');
  assert.equal(report.spaceRoot, space);
  assert.deepEqual(report.completed, [
    'machine-check',
    'space-repository',
    'project',
    'project-layout',
    'scaffold',
    'corpus-entry',
    'clone:app',
    'mirror:app',
    'first-commit',
    'install',
    'first-seen',
  ]);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.repositories, [{ name: 'app', github: app, cloned: true }]);

  // Progress: every step was checked, ran and was done, in order.
  assert.deepEqual(
    events.filter((event) => event.state === 'done').map((event) => event.stepId),
    report.completed,
  );
  assert.ok(events.every((event) => event.total === report.completed.length));

  // The repository is pushed: the bare remote's main is the Space's head, and the tree is clean.
  const head = await git.head(space);
  assert.ok(head.ok);
  assert.ok(report.repository !== null);
  const remoteHead = await git.head(report.repository.cloneUrl);
  assert.deepEqual(remoteHead, head);
  assert.deepEqual(await git.isClean(space), { ok: true, value: true });
  assert.ok(existsSync(join(space, 'repos', 'app', 'README.md')));
  assert.ok(existsSync(join(space, 'workbench', 'journal')));
  assert.ok(!existsSync(join(space, 'gitignore.template')));

  // The Project: five stages, the Agents field, the link, the labels, three views.
  const state = fake.state();
  assert.equal(state.projects.length, 1);
  const project = state.projects[0];
  assert.ok(project !== undefined);
  assert.equal(project.info.title, 'demo-space');
  const options = (name: string): string[] | undefined =>
    project.fields.find((field) => field.name === name)?.options.map((option) => option.name);
  assert.deepEqual(options('Stage'), [...DEFAULT_STAGES]);
  assert.deepEqual(options('Agents'), [...AGENTS_COLUMNS]);
  assert.deepEqual(project.linked, [`${OWNER}/demo-space`]);
  // "View 1" is the view GitHub gives every new Project; setup leaves it.
  assert.deepEqual(
    project.views.map((view) => view.name),
    ['View 1', 'Focuses by Stage', 'Items by focus', 'Agents board'],
  );
  const labels = state.repositories.find((entry) => entry.info.fullName === `${OWNER}/demo-space`);
  assert.deepEqual(labels?.labels.map((label) => label.name).sort(), [
    'document',
    'feature',
    'investigation',
    'session',
  ]);
  // What the API cannot set comes back as steps by hand.
  assert.equal(report.byHand.length, 3);
  assert.ok(report.byHand.some((step) => step.includes('"Column by"') && step.includes('Stage')));
  assert.ok(report.byHand.some((step) => step.includes('"Group by"')));

  // The manifest, the corpus entry and the mirror.
  const manifest = await readSpaceManifest(space);
  assert.ok(manifest.ok);
  assert.equal(manifest.value.name, 'demo-space');
  assert.deepEqual(manifest.value.github, {
    repository: `${OWNER}/demo-space`,
    project: project.info.number,
  });
  assert.deepEqual(
    manifest.value.repositories.map((entry) => [entry.name, entry.github]),
    [['app', app]],
  );
  const entry = readFileSync(join(space, 'lore', 'corpus', 'demo-space.md'), 'utf8');
  assert.match(entry, /^term: demo-space$/m);
  assert.match(entry, /A Space for the tests\./);
  const mirror = parseLoreFrontmatter(
    readFileSync(join(space, 'lore', 'mirrors', 'app.md'), 'utf8'),
  );
  assert.ok(mirror.ok);
  assert.equal(mirror.value.data.payload, 'app');
  assert.deepEqual(mirror.value.data.skeleton, ['README.md', 'src/', 'src/main.ts']);

  // The whole-template check: lore-integrity over the Space that setup made.
  await assertLoreIntegrity(space);

  // Detection and the Lore reader agree.
  const detected = await detectFolder(space, { git });
  assert.ok(detected.ok);
  assert.equal(detected.value.kind, 'space');
  const lore = await readLore(space);
  assert.ok(lore.ok);
  assert.deepEqual(lore.value.problems, []);

  // The install and the first-seen records are on the desk, outside the Space.
  const install = claudeCodeInstallPaths(deskPaths(deps.userDataDir, space).install);
  assert.ok(existsSync(install.record));
  assert.ok(readdirSync(install.skills).length > 0);
  assert.deepEqual(firstSeenRoots(deps.userDataDir, space), [
    'lore',
    'publish:publish',
    'repo:app',
  ]);

  // A run on the finished Space creates nothing and commits nothing.
  fake.calls.length = 0;
  const again = await createSpace(input, deps);
  assert.ok(again.ok, again.ok ? '' : again.error.message);
  assert.deepEqual(again.value.completed, ['machine-check', 'project-layout']);
  assert.equal(writes(fake, 'createRepository') + writes(fake, 'createProject'), 0);
  assert.equal(fake.state().projects[0]?.views.length, 4);
  assert.deepEqual(await git.head(space), head);
});

test('the dry run returns every step with what it will do and changes nothing', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const plan = await planCreateSpace(
    { ...form, repositories: [{ name: 'app', github: `${OWNER}/app` }] },
    deps,
  );
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.flow, 'create');
  assert.equal(plan.value.target, 'absent');
  assert.equal(plan.value.spaceRoot, join(parentDir, 'demo-space'));
  assert.deepEqual(
    plan.value.steps.map((step) => step.stepId),
    [
      'machine-check',
      'space-repository',
      'project',
      'project-layout',
      'scaffold',
      'corpus-entry',
      'clone:app',
      'mirror:app',
      'first-commit',
      'install',
      'first-seen',
    ],
  );
  for (const step of plan.value.steps) {
    assert.equal(step.done, false, step.stepId);
    assert.ok(step.lines.length > 0, step.stepId);
    assert.ok(step.lines.every((line) => line.what.length > 0));
  }
  const scaffold = plan.value.steps.find((step) => step.stepId === 'scaffold');
  assert.equal(scaffold?.lines[0]?.from, loreTemplateDir());
  assert.ok((scaffold?.lines[0]?.count ?? 0) > 50);

  assert.deepEqual(readdirSync(parentDir), []);
  assert.deepEqual(readdirSync(deps.userDataDir), []);
  assert.ok(fake.calls.every((call) => !WRITES.has(call.operation)));
  assert.equal(fake.state().repositories.length, 0);
  assert.equal(fake.state().projects.length, 0);
});

test('killed after the repository is created, a second run finishes with one repository and one Project', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const controller = new AbortController();
  const killed = await createSpace(form, deps, {
    signal: controller.signal,
    onProgress: (event) => {
      if (event.stepId === 'space-repository' && event.state === 'done') controller.abort();
    },
  });
  assert.equal(killed.ok, false);
  if (killed.ok) return;
  assert.equal(killed.error.kind, STEPS_STOPPED);
  assert.equal(killed.error.stepId, 'project');
  assert.deepEqual(killed.error.completed, ['machine-check', 'space-repository']);
  assert.equal(fake.state().repositories.length, 1);
  assert.equal(fake.state().projects.length, 0);

  // A new process knows nothing of the first run: new ports over the same GitHub and the same folders.
  const second = await createSpace(form, { ...deps });
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.deepEqual(second.value.skipped, ['space-repository']);
  assert.equal(writes(fake, 'createRepository'), 1);
  assert.equal(writes(fake, 'createProject'), 1);
  assert.equal(fake.state().repositories.length, 1);
  assert.equal(fake.state().projects.length, 1);
  await assertLoreIntegrity(join(parentDir, 'demo-space'));

  // A third run, killed after the scaffold of another Space, is recognised by its manifest.
  const other = { ...form, name: 'other-space' };
  const stop = new AbortController();
  const half = await createSpace(other, deps, {
    signal: stop.signal,
    onProgress: (event) => {
      if (event.stepId === 'scaffold' && event.state === 'done') stop.abort();
    },
  });
  assert.equal(half.ok, false);
  const plan = await planCreateSpace(other, deps);
  assert.ok(plan.ok);
  assert.equal(plan.value.target, 'half-made');
  assert.deepEqual(
    plan.value.steps.filter((step) => step.done).map((step) => step.stepId),
    ['space-repository', 'project', 'scaffold'],
  );
  const finished = await createSpace(other, deps);
  assert.ok(finished.ok, finished.ok ? '' : finished.error.message);
  assert.equal(fake.state().repositories.length, 2);
  assert.equal(fake.state().projects.length, 2);
});

test('an answer lost after GitHub created the Project does not make a second Project', async (t) => {
  const { fake, deps, form } = bench(t);
  let armed = false;
  const first = await createSpace(form, deps, {
    onProgress: (event) => {
      if (event.stepId === 'project' && event.state === 'running' && !armed) {
        armed = true;
        fake.loseNextAnswer({ kind: 'unreachable', message: 'GitHub could not be reached: reset' });
      }
    },
  });
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.error.stepId, 'project');
  assert.equal(first.error.kind, 'github-unreachable');
  const second = await createSpace(form, deps);
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.equal(fake.state().projects.length, 1);
});

test('a target folder that holds something else is refused and left as it is', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const target = join(parentDir, 'demo-space');
  mkdirSync(target);
  writeFileSync(join(target, 'notes.txt'), 'mine\n');
  const before = treeHash(target);
  for (const result of [await planCreateSpace(form, deps), await createSpace(form, deps)]) {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, 'target-not-empty');
    assert.equal(result.error.stepId, null);
    assert.match(result.error.message, /is not empty and holds no Space manifest/);
  }
  assert.equal(treeHash(target), before);
  assert.deepEqual(fake.calls, []);

  // Another Space's folder is refused as well; an empty folder is accepted.
  const made = await createSpace({ ...form, name: 'first' }, deps);
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  const clash = await planCreateSpace({ ...form, name: 'first', owner: 'someone-else' }, deps);
  assert.equal(clash.ok, false);
  if (!clash.ok) assert.match(clash.error.message, /holds another Space/);
  mkdirSync(join(parentDir, 'empty-one'));
  const empty = await planCreateSpace({ ...form, name: 'empty-one' }, deps);
  assert.ok(empty.ok);
  assert.equal(empty.value.target, 'empty');
});

test('names are checked before anything is created', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const cases: [Partial<CreateSpaceInput>, string][] = [
    [{ name: 'two words' }, 'name'],
    [{ name: 'Lore' }, 'name'],
    [{ owner: 'a--b' }, 'owner'],
    [{ parentDir: join(parentDir, 'missing') }, 'parentDir'],
    [{ repositories: [{ name: 'publish', github: `${OWNER}/x` }] }, 'repositories[0].name'],
    [{ repositories: [{ name: 'x', github: `${OWNER}/demo-space` }] }, 'repositories[0].github'],
  ];
  for (const [change, field] of cases) {
    const result = await createSpace({ ...form, ...change }, deps);
    assert.equal(result.ok, false, field);
    if (result.ok) return;
    assert.equal(result.error.kind, 'invalid-input');
    assert.deepEqual(
      result.error.problems.map((problem) => problem.field),
      [field],
    );
    assert.ok(result.error.message.startsWith('Nothing was created.'));
  }
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(readdirSync(parentDir), []);
});

test('a machine that is not ready stops setup before GitHub is asked for anything', async (t) => {
  const { fake, deps, form } = bench(t, { ready: false });
  const result = await createSpace(form, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.stepId, 'machine-check');
  assert.equal(result.error.kind, 'machine-not-ready');
  assert.match(result.error.message, /Sign in to GitHub with gh\./);
  assert.deepEqual(fake.calls, []);
});

test('GitHub unreachable or a missing scope stops at that step with the guidance sentence', async (t) => {
  const offline = bench(t);
  offline.fake.setUnreachable(true);
  const unreachable = await createSpace(offline.form, offline.deps);
  assert.equal(unreachable.ok, false);
  if (unreachable.ok) return;
  assert.equal(unreachable.error.stepId, 'space-repository');
  assert.equal(unreachable.error.kind, 'github-unreachable');
  assert.match(unreachable.error.message, /Check the network connection and run setup again/);
  assert.deepEqual(readdirSync(offline.parentDir), []);
  offline.fake.setUnreachable(false);
  const resumed = await createSpace(offline.form, offline.deps);
  assert.ok(resumed.ok, resumed.ok ? '' : resumed.error.message);

  const scoped = bench(t, { scopes: ['repo'] });
  const missing = await createSpace(scoped.form, scoped.deps);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  // The Project is looked for before the repository is created, so the missing
  // scope is found while GitHub still holds nothing of this Space.
  assert.equal(missing.error.stepId, 'space-repository');
  assert.equal(missing.error.kind, 'github-missing-scope');
  assert.ok(missing.error.message.includes(GH_ADD_SCOPE_COMMAND));
  assert.deepEqual(missing.error.completed, ['machine-check']);
  assert.equal(scoped.fake.state().repositories.length, 0);
  assert.deepEqual(readdirSync(scoped.parentDir), []);
  scoped.fake.signIn(OWNER, ['repo', 'project']);
  const after = await createSpace(scoped.form, scoped.deps);
  assert.ok(after.ok, after.ok ? '' : after.error.message);
  assert.equal(scoped.fake.state().repositories.length, 1);
});

test('views the host cannot create come back whole as steps by hand', async (t) => {
  const { fake, deps, form } = bench(t);
  fake.setViewsSupported(false);
  const result = await createSpace(form, deps);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.deepEqual(
    fake.state().projects[0]?.views.map((view) => view.name),
    ['View 1'],
  );
  for (const name of ['Focuses by Stage', 'Items by focus', 'Agents board']) {
    assert.ok(
      result.value.byHand.some((step) => step.includes(`add a view named "${name}"`)),
      name,
    );
  }
});

test('adoptRepository clones fresh into repos/<name> and never touches the source folder', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const github = await seedRepository(t, fake, 'plain');
  const address = fake.state().repositories[0]?.info.cloneUrl ?? '';
  // The Human Lead's own checkout, with work that is not pushed and not committed.
  const source = useTempDir(t, 'ai-lore-source-');
  assert.ok((await git.clone(address, source)).ok);
  writeFileSync(join(source, 'unpushed.txt'), 'local only\n');
  const before = treeHash(source);

  const input = { ...form, name: 'plain-space', sourceDir: source, github };
  const plan = await planAdoptRepository(input, deps);
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.flow, 'adopt');
  const clone = plan.value.steps.find((step) => step.stepId === 'clone:plain');
  assert.equal(clone?.lines[0]?.from, address);
  assert.equal(treeHash(source), before);

  const result = await adoptRepository(input, deps);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.equal(treeHash(source), before);

  const space = join(parentDir, 'plain-space');
  const checkout = join(space, 'repos', 'plain');
  assert.deepEqual(await git.originUrl(checkout), { ok: true, value: address });
  assert.ok(existsSync(join(checkout, 'README.md')));
  assert.ok(!existsSync(join(checkout, 'unpushed.txt')), 'a fresh clone, not a copy');
  assert.deepEqual(result.value.repositories, [{ name: 'plain', github, cloned: true }]);
  assert.ok(existsSync(join(space, 'lore', 'mirrors', 'plain.md')));
  await assertLoreIntegrity(space);
  const detected = await detectFolder(space, { git });
  assert.ok(detected.ok && detected.value.kind === 'space');

  // A source with no origin, and a Space inside the source, are refused.
  const lonely = await useTempGitRepo(t);
  const noOrigin = await planAdoptRepository({ ...input, sourceDir: lonely.dir }, deps);
  assert.equal(noOrigin.ok, false);
  if (!noOrigin.ok) assert.match(noOrigin.error.message, /has no remote named origin/);
  const inside = await planAdoptRepository({ ...input, parentDir: source }, deps);
  assert.equal(inside.ok, false);
  if (!inside.ok) assert.match(inside.error.message, /may not hold one another/);
  assert.equal(treeHash(source), before);
});

test('openSpaceByAddress clones the Space, rebuilds the desk and clones what was confirmed', async (t) => {
  const made = bench(t);
  const app = await seedRepository(t, made.fake, 'app');
  const created = await createSpace(
    { ...made.form, repositories: [{ name: 'app', github: app }] },
    made.deps,
  );
  assert.ok(created.ok, created.ok ? '' : created.error.message);

  // Another desk: another folder and another data folder, the same GitHub.
  const parentDir = useTempDir(t, 'ai-lore-open-');
  const deps: SetupDeps = { ...made.deps, userDataDir: useTempDir(t, 'ai-lore-userdata2-') };
  const input = { address: `https://github.com/${OWNER}/demo-space.git`, parentDir };

  const plan = await planOpenSpaceByAddress(input, deps);
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.deepEqual(
    plan.value.steps.map((step) => step.stepId),
    ['machine-check', 'clone-space', 'workbench', 'install', 'clone-repositories', 'first-seen'],
  );
  assert.deepEqual(readdirSync(parentDir), []);

  made.fake.calls.length = 0;
  const first = await openSpaceByAddress(input, deps);
  assert.ok(first.ok, first.ok ? '' : first.error.message);
  const space = join(parentDir, 'demo-space');
  assert.equal(first.value.spaceRoot, space);
  assert.equal(first.value.project, null);
  assert.deepEqual(first.value.repositories, [{ name: 'app', github: app, cloned: false }]);
  assert.ok(made.fake.calls.every((call) => !WRITES.has(call.operation)));
  assert.ok(existsSync(join(space, 'workbench', 'drafts')));
  assert.ok(existsSync(join(space, 'repos')));
  const install = claudeCodeInstallPaths(deskPaths(deps.userDataDir, space).install);
  assert.ok(existsSync(install.record));
  assert.deepEqual(firstSeenRoots(deps.userDataDir, space), ['lore', 'publish:publish']);
  const detected = await detectFolder(space, { git });
  assert.ok(detected.ok && detected.value.kind === 'space');
  assert.deepEqual(await git.isClean(space), { ok: true, value: true });

  // The Human Lead confirms the repository; the second run repeats nothing and clones it.
  const second = await openSpaceByAddress({ ...input, repositories: ['app'] }, deps);
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.deepEqual(second.value.completed, ['machine-check', 'clone-repositories', 'first-seen']);
  assert.deepEqual(second.value.repositories, [{ name: 'app', github: app, cloned: true }]);
  assert.deepEqual(firstSeenRoots(deps.userDataDir, space), [
    'lore',
    'publish:publish',
    'repo:app',
  ]);

  // A name the manifest does not have, an address that is not one, a repository that is not a Space.
  const unknown = await openSpaceByAddress({ ...input, repositories: ['ghost'] }, deps);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.kind, 'repository-not-in-manifest');
  const bad = await openSpaceByAddress({ ...input, address: 'not an address' }, deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.problems[0]?.field, 'address');
  const notSpace = await openSpaceByAddress({ address: app, parentDir, folderName: 'app-x' }, deps);
  assert.equal(notSpace.ok, false);
  if (!notSpace.ok) assert.equal(notSpace.error.kind, 'not-a-space');
});

// ---------- a run that stops at every boundary ----------

/** Every file of a folder outside `.git`, with the hash of its content. Folders are listed by name. */
function contentListing(dir: string): string[] {
  const lines: string[] = [];
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(dir, relative)).sort()) {
      if (name === '.git') continue;
      const child = relative === '' ? name : `${relative}/${name}`;
      if (lstatSync(join(dir, child)).isDirectory()) {
        lines.push(`${child}/`);
        walk(child);
      } else {
        const hash = createHash('sha256')
          .update(readFileSync(join(dir, child)))
          .digest('hex');
        lines.push(`${child} ${hash}`);
      }
    }
  };
  walk('');
  return lines;
}

/** What GitHub holds, without the ids and addresses that differ from one fake to the next. */
function gitHubShape(fake: FakeGitHub): unknown {
  const state = fake.state();
  return {
    repositories: state.repositories.map((entry) => ({
      name: entry.info.fullName,
      labels: entry.labels.map((label) => label.name),
    })),
    projects: state.projects.map((project) => ({
      title: project.info.title,
      number: project.info.number,
      fields: project.fields.map((field) => [field.name, field.options.map((o) => o.name)]),
      views: project.views.map((view) => view.name),
      linked: project.linked,
    })),
  };
}

async function commitCount(address: string): Promise<number> {
  const run = await execFileRunner.run('git', ['rev-list', '--count', 'main'], { cwd: address });
  assert.equal(run.code, 0, run.stderr);
  return Number(run.stdout.trim());
}

/** The end state of one finished setup, in a form two benches can be compared by. */
async function endState(b: Bench, spaceName: string): Promise<unknown> {
  const space = join(b.parentDir, spaceName);
  const address = b.fake
    .state()
    .repositories.find((entry) => entry.info.fullName === `${OWNER}/${spaceName}`)?.info.cloneUrl;
  assert.ok(address !== undefined);
  const install = deskPaths(b.deps.userDataDir, space).install;
  return {
    files: contentListing(space),
    gitHub: gitHubShape(b.fake),
    commits: await commitCount(address),
    pushed: (await git.head(address)).ok && (await git.isClean(space)).ok,
    installed: contentListing(install).map((line) => line.split(' ')[0]),
    firstSeen: firstSeenRoots(b.deps.userDataDir, space),
  };
}

const CREATE_STEPS = [
  'machine-check',
  'space-repository',
  'project',
  'project-layout',
  'scaffold',
  'corpus-entry',
  'clone:app',
  'mirror:app',
  'first-commit',
  'install',
  'first-seen',
];

test('create: stopped while each step runs in turn, a second run ends as an uninterrupted run does', async (t) => {
  const reference = bench(t);
  const app = await seedRepository(t, reference.fake, 'app');
  const events: StepProgress[] = [];
  const whole = await createSpace(
    { ...reference.form, repositories: [{ name: 'app', github: app }] },
    reference.deps,
    { onProgress: (event) => events.push(event) },
  );
  assert.ok(whole.ok, whole.ok ? '' : whole.error.message);
  const expected = await endState(reference, 'demo-space');

  // Progress: per step one "checking", then "running", then one end, in the order of the steps.
  assert.deepEqual(
    events.map((event) => `${event.index}:${event.stepId}:${event.state}`),
    CREATE_STEPS.flatMap((id, index) =>
      ['checking', 'running', 'done'].map((state) => `${index}:${id}:${state}`),
    ),
  );

  for (const [index, stepId] of CREATE_STEPS.entries()) {
    const b = bench(t);
    await seedRepository(t, b.fake, 'app');
    const input = { ...b.form, repositories: [{ name: 'app', github: app }] };
    const controller = new AbortController();
    const seen: StepProgress[] = [];
    // The signal is raised while the step runs: the step finishes, and the run stops at the boundary after it.
    const killed = await createSpace(input, b.deps, {
      signal: controller.signal,
      onProgress: (event) => {
        seen.push(event);
        if (event.stepId === stepId && event.state === 'running') controller.abort();
      },
    });
    const last = index === CREATE_STEPS.length - 1;
    assert.equal(killed.ok, last, stepId);
    if (!killed.ok) {
      assert.equal(killed.error.kind, STEPS_STOPPED, `${stepId}: ${killed.error.message}`);
      assert.equal(killed.error.stepId, CREATE_STEPS[index + 1]);
      assert.deepEqual(killed.error.completed, CREATE_STEPS.slice(0, index + 1));
      assert.equal(seen.at(-1)?.state, 'done', 'the step that was running ended before the stop');
    }
    const again = await createSpace(input, { ...b.deps });
    assert.ok(again.ok, again.ok ? stepId : `${stepId}: ${again.error.message}`);
    assert.deepEqual(await endState(b, 'demo-space'), expected, `after a stop at ${stepId}`);
    assert.equal(writes(b.fake, 'createRepository'), 1, stepId);
    assert.equal(writes(b.fake, 'createProject'), 1, stepId);
  }
});

test('create: an answer lost at each GitHub write is repaired by the second run, and the layout keeps its ids', async (t) => {
  for (const stepId of ['space-repository', 'project', 'project-layout']) {
    const b = bench(t);
    let armed = false;
    const first = await createSpace(b.form, b.deps, {
      onProgress: (event) => {
        if (event.stepId === stepId && event.state === 'running' && !armed) {
          armed = true;
          b.fake.loseNextAnswer({ kind: 'unreachable', message: 'GitHub could not be reached' });
        }
      },
    });
    assert.equal(first.ok, false, stepId);
    if (!first.ok) assert.equal(first.error.stepId, stepId);
    const second = await createSpace(b.form, b.deps);
    assert.ok(second.ok, second.ok ? '' : `${stepId}: ${second.error.message}`);
    const state = b.fake.state();
    assert.equal(state.repositories.length, 1, stepId);
    assert.equal(state.projects.length, 1, stepId);
    assert.equal(await commitCount(state.repositories[0]?.info.cloneUrl ?? ''), 1);

    // The step that is never skipped runs a third time and changes nothing on GitHub.
    const third = await createSpace(b.form, b.deps);
    assert.ok(third.ok);
    assert.deepEqual(third.value.completed, ['machine-check', 'project-layout']);
    assert.deepEqual(b.fake.state().projects, state.projects, 'fields, option ids, views and link');
    assert.deepEqual(b.fake.state().repositories, state.repositories, 'labels');
    const labels = state.repositories[0]?.labels.map((label) => label.name) ?? [];
    assert.equal(new Set(labels).size, labels.length);
    assert.equal(labels.length, 4);
  }
});

test('adopt and open: stopped while each step runs, a second run finishes and the source is never touched', async (t) => {
  const ADOPT_STEPS = CREATE_STEPS.map((id) => id.replace(':app', ':plain'));
  let expected: unknown = null;
  for (const stepId of [null, ...ADOPT_STEPS]) {
    const b = bench(t);
    const github = await seedRepository(t, b.fake, 'plain');
    const address = b.fake.state().repositories[0]?.info.cloneUrl ?? '';
    const source = useTempDir(t, 'ai-lore-source-');
    assert.ok((await git.clone(address, source)).ok);
    writeFileSync(join(source, 'unpushed.txt'), 'local only\n');
    const before = treeHash(source);
    const input = { ...b.form, name: 'plain-space', sourceDir: source, github };
    if (stepId !== null) {
      const controller = new AbortController();
      await adoptRepository(input, b.deps, {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.stepId === stepId && event.state === 'running') controller.abort();
        },
      });
    }
    const done = await adoptRepository(input, b.deps);
    assert.ok(done.ok, done.ok ? '' : `${stepId}: ${done.error.message}`);
    assert.equal(treeHash(source), before, `${stepId}: the source folder, its .git included`);
    const state = await endState(b, 'plain-space');
    if (expected === null) expected = state;
    else assert.deepEqual(state, expected, `after a stop at ${stepId}`);
  }

  // Open by address, on another desk, stopped at each step.
  const made = bench(t);
  const app = await seedRepository(t, made.fake, 'app');
  const created = await createSpace(
    { ...made.form, repositories: [{ name: 'app', github: app }] },
    made.deps,
  );
  assert.ok(created.ok);
  made.fake.calls.length = 0;
  let opened: unknown = null;
  for (const stepId of [
    null,
    'machine-check',
    'clone-space',
    'workbench',
    'install',
    'clone-repositories',
    'first-seen',
  ]) {
    const parentDir = useTempDir(t, 'ai-lore-open-');
    const deps: SetupDeps = { ...made.deps, userDataDir: useTempDir(t, 'ai-lore-userdata2-') };
    const input = { address: `${OWNER}/demo-space`, parentDir, repositories: ['app'] };
    if (stepId !== null) {
      const controller = new AbortController();
      await openSpaceByAddress(input, deps, {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.stepId === stepId && event.state === 'running') controller.abort();
        },
      });
    }
    const done = await openSpaceByAddress(input, deps);
    assert.ok(done.ok, done.ok ? '' : `${stepId}: ${done.error.message}`);
    const space = join(parentDir, 'demo-space');
    const state = {
      files: contentListing(space),
      firstSeen: firstSeenRoots(deps.userDataDir, space),
      clean: await git.isClean(space),
    };
    if (opened === null) opened = state;
    else assert.deepEqual(state, opened, `after a stop at ${stepId}`);
  }
  assert.ok(made.fake.calls.every((call) => !WRITES.has(call.operation)));
});

// ---------- never destroy ----------

test('a repository of the same name that holds other commits is refused before anything is created', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  await seedRepository(t, fake, 'demo-space');
  const address = fake.state().repositories[0]?.info.cloneUrl ?? '';
  const head = await git.head(address);
  for (const result of [await planCreateSpace(form, deps), await createSpace(form, deps)]) {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, 'repository-taken');
    assert.equal(result.error.stepId, 'space-repository');
    assert.match(result.error.message, /holds commits that are not those of/);
  }
  assert.ok(fake.calls.every((call) => !WRITES.has(call.operation)));
  assert.equal(fake.state().projects.length, 0);
  assert.deepEqual(fake.state().repositories[0]?.labels, []);
  assert.deepEqual(readdirSync(parentDir), []);
  assert.deepEqual(await git.head(address), head);

  // A half-made folder of the same name does not make it this Space's: its commit is not there.
  const other = bench(t);
  const stop = new AbortController();
  await createSpace(other.form, other.deps, {
    signal: stop.signal,
    onProgress: (event) => {
      if (event.stepId === 'corpus-entry' && event.state === 'running') stop.abort();
    },
  });
  const halfMade = await createSpace(
    { ...form, parentDir: other.parentDir },
    { ...deps, userDataDir: other.deps.userDataDir },
  );
  assert.equal(halfMade.ok, false);
  if (!halfMade.ok) assert.equal(halfMade.error.kind, 'repository-taken');
  assert.deepEqual(await git.head(address), head);
});

test('a Project of the same title that holds items is refused; an empty one is used', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const elsewhere = await seedRepository(t, fake, 'elsewhere');
  const project = await fake.createProject({ owner: OWNER, title: 'demo-space' });
  assert.ok(project.ok);
  const issue = await fake.createIssue({
    repository: elsewhere,
    title: 'Work of something else',
    body: '',
    labels: [],
  });
  assert.ok(issue.ok);
  assert.ok((await fake.addIssueToProject({ project: project.value, issue: issue.value })).ok);
  const before = fake.state();
  fake.calls.length = 0;

  for (const result of [await planCreateSpace(form, deps), await createSpace(form, deps)]) {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, 'project-taken');
    assert.match(result.error.message, /already has an open Project titled "demo-space"/);
  }
  assert.ok(fake.calls.every((call) => !WRITES.has(call.operation)));
  assert.deepEqual(
    fake.state(),
    before,
    'no repository was created and the Project was left as it is',
  );
  assert.deepEqual(readdirSync(parentDir), []);

  // An empty Project of the title is what a killed run leaves, and is used.
  const empty = await fake.createProject({ owner: OWNER, title: 'fresh-space' });
  assert.ok(empty.ok);
  const made = await createSpace({ ...form, name: 'fresh-space' }, deps);
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  assert.equal(made.value.project?.number, empty.value.number);
  assert.deepEqual(made.value.skipped, ['project']);
});

test('the manifest that marks a half-made Space must name this Space and this repository', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const made = await createSpace(form, deps);
  assert.ok(made.ok);
  const space = join(parentDir, 'demo-space');
  const before = treeHash(space);
  fake.calls.length = 0;
  // The same repository under another Space name, and the same name under another owner.
  const renamed = join(parentDir, 'renamed');
  mkdirSync(join(renamed, 'lore'), { recursive: true });
  writeFileSync(
    join(renamed, 'lore', 'space.md'),
    readFileSync(join(space, 'lore', 'space.md'), 'utf8'),
  );
  const renamedBefore = treeHash(renamed);
  for (const input of [
    { ...form, name: 'renamed' },
    { ...form, owner: 'someone-else' },
  ]) {
    for (const result of [await planCreateSpace(input, deps), await createSpace(input, deps)]) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.kind, 'target-not-empty');
    }
  }
  assert.deepEqual(fake.calls, [], 'refused before GitHub is asked for anything');
  assert.equal(treeHash(space), before);
  assert.equal(treeHash(renamed), renamedBefore);
});

test('an address or an origin with a token in it is refused, and the token is in no message', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const secret = 'ghp_secretTOKEN123';
  const opened = await openSpaceByAddress(
    { address: `https://octo:${secret}@github.com/${OWNER}/demo-space.git`, parentDir },
    deps,
  );
  assert.equal(opened.ok, false);
  // A checkout whose origin carries a token: adopting it would copy the token into the plan and the clone.
  const source = await useTempGitRepo(t);
  source.write('README.md', '# x\n');
  await source.commitAll('First commit');
  const origin = `https://octo:${secret}@github.com/${OWNER}/plain.git`;
  // Written into the configuration file: the runner's guard refuses a command that names a live address.
  appendFileSync(
    join(source.dir, '.git', 'config'),
    `[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
  const before = treeHash(source.dir);
  const base = { ...form, name: 'plain-space', sourceDir: source.dir };
  const results = [
    opened,
    await planAdoptRepository(base, deps),
    await adoptRepository({ ...base, github: `${OWNER}/plain` }, deps),
    await createSpace(
      {
        ...form,
        repositories: [{ name: 'x', github: `${OWNER}/x`, cloneAddress: 'ext::sh -c id' }],
      },
      deps,
    ),
  ];
  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, 'invalid-input');
    assert.ok(!JSON.stringify(result.error).includes(secret), result.error.message);
  }
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(readdirSync(parentDir), []);
  assert.equal(treeHash(source.dir), before);
});

// ---------- the dry run ----------

test('the dry run of a half-made Space, of adopt and of open changes nothing and only reads GitHub', async (t) => {
  const b = bench(t);
  const github = await seedRepository(t, b.fake, 'plain');
  const address = b.fake.state().repositories[0]?.info.cloneUrl ?? '';
  const source = useTempDir(t, 'ai-lore-source-');
  assert.ok((await git.clone(address, source)).ok);
  const input = { ...b.form, name: 'plain-space', sourceDir: source, github };
  const stop = new AbortController();
  await adoptRepository(input, b.deps, {
    signal: stop.signal,
    onProgress: (event) => {
      if (event.stepId === 'clone:plain' && event.state === 'running') stop.abort();
    },
  });
  const hashes = (): string[] => [
    treeHash(b.parentDir),
    treeHash(b.deps.userDataDir),
    treeHash(source),
    treeHash(address),
  ];
  const before = hashes();
  const gitHubBefore = b.fake.state();
  b.fake.calls.length = 0;

  const plan = await planAdoptRepository(input, b.deps);
  assert.ok(plan.ok, plan.ok ? '' : plan.error.message);
  assert.equal(plan.value.target, 'half-made');
  assert.deepEqual(
    plan.value.steps.filter((step) => step.done).map((step) => step.stepId),
    ['space-repository', 'project', 'scaffold', 'corpus-entry', 'clone:plain'],
  );
  // The plan names the folder the install is written to, and the run writes there.
  const installLine = plan.value.steps.find((step) => step.stepId === 'install')?.lines[0];
  const space = join(b.parentDir, 'plain-space');
  assert.equal(installLine?.to, deskPaths(b.deps.userDataDir, space).install);

  const open = await planOpenSpaceByAddress(
    { address: github, parentDir: b.parentDir, folderName: 'opened' },
    b.deps,
  );
  assert.ok(open.ok);
  assert.deepEqual(hashes(), before);
  assert.deepEqual(b.fake.state(), gitHubBefore);
  assert.ok(b.fake.calls.length > 0);
  assert.ok(b.fake.calls.every((call) => !WRITES.has(call.operation)));

  const done = await adoptRepository(input, b.deps);
  assert.ok(done.ok, done.ok ? '' : done.error.message);
  assert.ok(existsSync(claudeCodeInstallPaths(installLine?.to ?? '').record));
});

// ---------- what is written ----------

test('hostile names and descriptions give valid cards, and first-seen is recorded once', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const numeric = await seedRepository(t, fake, '123');
  const description = [
    'key: value # not a comment, "quoted" and \'single\'',
    '---',
    'type: contract',
    '---',
    '# A heading of its own',
    '[ref]: ./nowhere.md',
    'A [link](./nowhere.md), an <a href="./nowhere.md">anchor</a> and <./nowhere.md>.',
    'x'.repeat(1500),
  ].join('\n');
  const input = {
    ...form,
    name: 'null',
    description,
    repositories: [{ name: '123', github: numeric }],
  };
  const made = await createSpace(input, deps);
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  const space = join(parentDir, 'null');
  await assertLoreIntegrity(space);
  const lore = await readLore(space);
  assert.ok(lore.ok);
  assert.deepEqual(lore.value.problems, []);
  const entry = parseLoreFrontmatter(readFileSync(join(space, 'lore/corpus/null.md'), 'utf8'));
  assert.ok(entry.ok);
  assert.deepEqual(entry.value.data, {
    type: 'corpus',
    term: 'null',
    points_at: ['lore/space.md'],
  });
  const mirror = parseLoreFrontmatter(readFileSync(join(space, 'lore/mirrors/123.md'), 'utf8'));
  assert.ok(mirror.ok);
  assert.equal(mirror.value.data.payload, '123');
  const manifest = await readSpaceManifest(space);
  assert.ok(manifest.ok);
  assert.equal(manifest.value.name, 'null');

  const long = await planCreateSpace({ ...form, description: 'x'.repeat(5000) }, deps);
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.error.problems[0]?.field, 'description');

  // .gitignore keeps the desk side out: nothing under repos/ or workbench/ is in the first commit.
  assert.equal(
    readFileSync(join(space, '.gitignore'), 'utf8'),
    readFileSync(join(loreTemplateDir(), 'gitignore.template'), 'utf8'),
  );
  writeFileSync(join(space, 'workbench', 'scratch', 'note.txt'), 'scratch\n');
  assert.deepEqual(await git.isClean(space), { ok: true, value: true });
  const tracked = await execFileRunner.run('git', ['ls-files'], { cwd: space });
  assert.ok(!/^(repos|workbench)\//m.test(tracked.stdout));

  // First-seen: a later commit and a later run do not move the record.
  const readSeen = (): unknown => {
    const desk = openDesk(deskPaths(deps.userDataDir, space));
    assert.ok(desk.ok);
    try {
      return listFirstSeen(desk.value);
    } finally {
      closeDesk(desk.value);
    }
  };
  const seen = readSeen();
  writeFileSync(join(space, 'publish', 'later.md'), '# later\n');
  assert.ok((await git.addAll(space)).ok);
  assert.ok((await git.commit(space, 'Later work\n')).ok);
  const again = await createSpace(input, deps);
  assert.ok(again.ok, again.ok ? '' : again.error.message);
  assert.deepEqual(readSeen(), seen);
  assert.deepEqual(again.value.completed, ['machine-check', 'project-layout']);
});

test('a repository with more files than the limit gets a skeleton of depth 2 that says so', async (t) => {
  const { fake, deps, form, parentDir } = bench(t);
  const created = await fake.createRepository({ owner: OWNER, name: 'big', private: true });
  assert.ok(created.ok);
  const seed = await useTempGitRepo(t);
  for (let index = 0; index < 2100; index += 1) {
    seed.write(`packages/p${index % 7}/src/file-${index}.ts`, '');
  }
  await seed.commitAll('Many files');
  assert.ok((await git.addRemote(seed.dir, 'origin', created.value.cloneUrl)).ok);
  assert.ok((await git.push(seed.dir, { setUpstream: true })).ok);

  const made = await createSpace(
    { ...form, repositories: [{ name: 'big', github: created.value.fullName }] },
    deps,
  );
  assert.ok(made.ok, made.ok ? '' : made.error.message);
  const space = join(parentDir, 'demo-space');
  const text = readFileSync(join(space, 'lore', 'mirrors', 'big.md'), 'utf8');
  const mirror = parseLoreFrontmatter(text);
  assert.ok(mirror.ok);
  const skeleton = mirror.value.data.skeleton;
  assert.ok(Array.isArray(skeleton));
  assert.ok(skeleton.length > 0 && skeleton.length < 50, String(skeleton.length));
  assert.match(text, /generated with `--depth 2`/);
  assert.match(text, /repository-skeleton\.py repos\/big --depth 2$/m);
  await assertLoreIntegrity(space);
});
