/**
 * The follow-up note (phase M6.7), against `makeV08Fixture()` and
 * `FakeGitHub`, run through `runMigration` like `migrate-verify.int.test.ts`.
 *
 * The note exists after a full run; it carries the Project's Status mapping;
 * it lists every issue the run created with its real `repository#number` and
 * archived source; it is not in the Space repository, so the tree is clean
 * and no commit is added for it; and a second run rewrites it byte for byte,
 * the same as the first.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { execFileRunner, runGit } from '../../src/space/exec/index.js';
import type { MachineCheck } from '../../src/space/machine/index.js';
import { inSpace } from '../../src/space/migrate/checks.js';
import {
  MIGRATION_FOLLOW_UP_NOTE_PATH,
  type MigrationContext,
  type MigrationDeps,
  type MigrationInput,
  followUpNoteText,
  prepareMigration,
  runMigration,
} from '../../src/space/migrate/index.js';
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
  const temps = [makeTempDir('ai-lore-migrate-follow-up-'), makeTempDir('ai-lore-userdata-')];
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
  bench = { fixture, fake, deps, input, temps, ctx: prepared.value.ctx };
});

after(() => {
  bench?.fake.dispose();
  bench?.fixture.cleanup();
  for (const temp of bench?.temps ?? []) temp.cleanup();
});

function noteText(ctx: MigrationContext): string {
  return readFileSync(inSpace(ctx, MIGRATION_FOLLOW_UP_NOTE_PATH), 'utf8');
}

test('the note exists in the Workbench after a run and matches the pure function', () => {
  const { ctx } = b();
  const written = noteText(ctx);
  assert.equal(written, followUpNoteText(ctx));
  assert.match(written, /^# The follow-up from the migration of fixture-project/);
});

test("it carries the Project's Status mapping", () => {
  const { ctx } = b();
  const written = noteText(ctx);
  assert.match(written, /Todo/);
  assert.match(written, /In Progress/);
  assert.match(written, /Done/);
  assert.match(written, /`done` becomes Status `Done` and the issue is closed/);
  assert.match(written, /`in progress` becomes `In Progress`/);
  assert.match(written, /`draft`, `paused` and an unreadable status become `Todo`/);
  assert.match(written, /paused/);
  assert.match(written, /Stage.*focus issue alone/);
  assert.ok(written.includes('memory/status/status.stack.md'));
  assert.ok(written.includes('memory/status'));
});

test('it lists every issue the run created with its real repository#number and archived source', () => {
  const { ctx } = b();
  const written = noteText(ctx);
  assert.ok(ctx.issues.length > 0);
  for (const issue of ctx.issues) {
    const record = ctx.ledger.find(
      (r): r is Extract<(typeof ctx.ledger)[number], { kind: 'issue' }> =>
        r.kind === 'issue' && r.key === issue.key,
    );
    assert.ok(record, `no ledger record for ${issue.key}`);
    assert.ok(
      written.includes(`${record.issue.repository}#${record.issue.number}`),
      `note is missing ${record.issue.repository}#${record.issue.number}`,
    );
    assert.ok(written.includes(issue.title), `note is missing the title "${issue.title}"`);
    assert.ok(written.includes(issue.archived), `note is missing ${issue.archived}`);
  }
});

test('it says it is a record of the handover that can be deleted once the work is done', () => {
  const { ctx } = b();
  assert.match(noteText(ctx), /can be deleted once the work.*is done/);
});

test('it is not in the Space repository: the tree is clean and no commit was added for it', async () => {
  const { ctx } = b();
  const status = await runGit(execFileRunner, ctx.spaceRoot, ['status', '--porcelain'], {
    readOnly: true,
  });
  assert.equal(status.stdout.trim(), '', status.stdout);
  const tracked = await runGit(
    execFileRunner,
    ctx.spaceRoot,
    ['ls-files', MIGRATION_FOLLOW_UP_NOTE_PATH],
    { readOnly: true },
  );
  assert.equal(tracked.stdout.trim(), '', 'the note is not tracked by git');
});

test('a second run rewrites the note byte for byte; no timestamp or run-specific id appears', async () => {
  const { ctx, deps, input } = b();
  const before = noteText(ctx);
  const second = await runMigration(input, deps);
  assert.ok(second.ok, second.ok ? '' : second.error.message);
  assert.deepEqual(second.value.completed, ['verify']);
  const after = noteText(ctx);
  assert.equal(after, before, 'the note is byte-identical after a second run');
  // Deterministic: calling the pure function again reproduces the same text.
  assert.equal(followUpNoteText(ctx), before);
});
