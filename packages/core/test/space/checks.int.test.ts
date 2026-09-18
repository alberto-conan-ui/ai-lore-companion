/**
 * The three check scripts of the AI-Lore 1.0 template's core contracts
 * (`packages/spec/lore-1.0/lore/contracts/core/*.py`), each run with `python3`
 * as a child process against a Space, a desk folder and git repositories that
 * the test builds under the temporary folder.
 *
 * The scripts are read in place from the template and never copied or changed.
 * Every run starts from a working folder that is not the Space. The desk's
 * records are written here as JSON files in the format of the architecture
 * document, section 4.2: `{ "version": 1, "records": [...] }`.
 */
import { strict as assert } from 'node:assert';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import type { RunResult } from '../../src/space/exec/runner.js';
import { loreTemplateDir, runPython, useTempDir, useTempGitRepo } from '../support/index.js';

const CHECKS = join(loreTemplateDir(), 'lore', 'contracts', 'core');
const WRITE_GUARD = join(CHECKS, 'write-guard.py');
const LORE_INTEGRITY = join(CHECKS, 'lore-integrity.py');
const JOURNAL = join(CHECKS, 'journal-append-forward.py');

const ALLOW = 0;
const REFUSE = 2;

/** Write a file below `root`, creating its folders. */
function put(root: string, relativePath: string, text: string): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

const INDEX_HEAD = '---\ntype: index\n---\n\n# An index\n\n';

const MANIFEST = [
  '---',
  'type: space',
  'format: 1',
  'name: example-space',
  'github:',
  '  repository: example-owner/example-space',
  '  project: 1',
  'repositories:',
  '  - name: app',
  '    github: example-owner/app',
  '  - name: other',
  '    github: example-owner/other',
  'publish_areas:',
  '  - name: publish',
  '    path: publish',
  '  - name: handbook',
  '---',
  '',
  '# The manifest',
  '',
].join('\n');

type Claim = {
  sessionId: string;
  target:
    | { kind: 'lore' }
    | { kind: 'publish-area'; name: string }
    | { kind: 'repository'; name: string; branch: string };
  claimedAt: string;
};

type Fixture = {
  space: string;
  desk: string;
  /** A working folder that is neither the Space nor the desk. */
  elsewhere: string;
};

/** A Space folder with the fixed layout, a manifest, and an empty desk folder beside it. */
function makeSpace(t: TestContext): Fixture {
  const root = useTempDir(t, 'ai-lore-checks-');
  const space = join(root, 'space');
  const desk = join(root, 'user data', 'desk');
  const elsewhere = join(root, 'elsewhere');
  for (const folder of [
    'lore/corpus',
    'publish/specs',
    'repos',
    'workbench/drafts',
    'workbench/journal',
    'workbench/scratch',
  ]) {
    mkdirSync(join(space, folder), { recursive: true });
  }
  mkdirSync(desk, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  put(space, 'ai_readme.md', '# Read this first\n');
  put(space, 'lore/space.md', MANIFEST);
  put(space, 'lore/index.md', `${INDEX_HEAD}- [space.md](./space.md): the manifest.\n`);
  return { space, desk, elsewhere };
}

function writeDesk(
  desk: string,
  sessions: { id: string; mode: string }[],
  claims: Claim[] = [],
): void {
  const records = sessions.map((session) => ({
    engine: 'claude-code',
    attended: true,
    startedAt: '2026-09-18T10:00:00.000Z',
    ...session,
  }));
  writeFileSync(join(desk, 'sessions.json'), JSON.stringify({ version: 1, records }), 'utf8');
  writeFileSync(join(desk, 'claims.json'), JSON.stringify({ version: 1, records: claims }), 'utf8');
}

function claim(sessionId: string, target: Claim['target']): Claim {
  return { sessionId, target, claimedAt: '2026-09-18T10:05:00.000Z' };
}

function guard(f: Fixture, session: string, path: string): Promise<RunResult> {
  return runPython(
    WRITE_GUARD,
    ['--space', f.space, '--desk', f.desk, '--session', session, '--path', path],
    { cwd: f.elsewhere },
  );
}

function assertAllowed(result: RunResult, what: string): void {
  assert.equal(
    result.code,
    ALLOW,
    `${what}: expected exit 0, got ${result.code}: ${result.stderr}`,
  );
  assert.equal(result.stderr, '', `${what}: nothing on standard error`);
  assert.match(result.stdout, /^[a-z-]+ allows [^\n]+\.\n$/, `${what}: one sentence`);
}

function assertRefused(result: RunResult, what: string, ...mentions: string[]): void {
  assert.equal(result.code, REFUSE, `${what}: expected exit 2, got ${result.code}`);
  assert.equal(result.failure, undefined, `${what}: the script ran`);
  assert.equal(result.stdout, '', `${what}: nothing on standard output`);
  assert.match(result.stderr, /^[a-z-]+ refuses [^\n]+\.\n$/, `${what}: one sentence`);
  for (const mention of mentions) {
    assert.ok(result.stderr.includes(mention), `${what}: "${mention}" in: ${result.stderr}`);
  }
}

// ---------- write-guard ----------

test('write-guard: in Read only the Workbench is allowed and the Lore and the payloads are refused', async (t) => {
  const f = makeSpace(t);
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });

  for (const path of [
    'workbench/scratch/notes.md',
    'workbench/journal/2026-09-18-s1.md',
    'workbench/drafts/new-folder/deeper/draft.md',
  ]) {
    assertAllowed(await guard(f, 's1', join(f.space, path)), path);
  }
  for (const path of [
    'lore/corpus/term.md',
    'lore/space.md',
    'repos/app/src/a.ts',
    'publish/specs/a.md',
  ]) {
    const full = join(f.space, path);
    assertRefused(await guard(f, 's1', full), path, 'write-guard', full, 'Read only', '"s1"');
  }
});

test('write-guard: in Writing a write is allowed inside the claimed targets only', async (t) => {
  const f = makeSpace(t);
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'other') });
  writeDesk(
    f.desk,
    [
      { id: 's1', mode: 'writing' },
      { id: 's2', mode: 'writing' },
      { id: 's3', mode: 'writing' },
    ],
    [
      claim('s1', { kind: 'repository', name: 'app', branch: 'main' }),
      claim('s2', { kind: 'lore' }),
      claim('s2', { kind: 'publish-area', name: 'publish' }),
    ],
  );

  assertAllowed(
    await guard(f, 's1', join(f.space, 'repos/app/src/new/a.ts')),
    'claimed repository',
  );
  assertAllowed(
    await guard(f, 's1', join(f.space, 'workbench/scratch/a.md')),
    'Workbench in Writing',
  );
  assertAllowed(await guard(f, 's2', join(f.space, 'lore/corpus/term.md')), 'claimed Lore');
  assertAllowed(await guard(f, 's2', join(f.space, 'publish/specs/a.md')), 'claimed publish area');

  assertRefused(
    await guard(f, 's1', join(f.space, 'repos/other/a.ts')),
    'another repository',
    'Writing',
    '"other"',
  );
  assertRefused(
    await guard(f, 's1', join(f.space, 'lore/corpus/term.md')),
    'the Lore',
    'Writing',
    'the Lore',
  );
  assertRefused(
    await guard(f, 's1', join(f.space, 'publish/specs/a.md')),
    'a publish area',
    '"publish"',
  );
  assertRefused(
    await guard(f, 's2', join(f.space, 'repos/app/a.ts')),
    'held by another session',
    '"app"',
  );
  assertRefused(
    await guard(f, 's3', join(f.space, 'lore/index.md')),
    'a session with no claim',
    'Writing',
  );
});

test('write-guard: a repository is writable only on the claimed branch', async (t) => {
  const f = makeSpace(t);
  const app = await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'item-12' })],
  );
  const path = join(f.space, 'repos/app/a.ts');

  assertRefused(await guard(f, 's1', path), 'claim on another branch', '"item-12"', '"main"');

  await app.git('checkout', '--quiet', '-b', 'item-12');
  assertAllowed(await guard(f, 's1', path), 'the claimed branch is checked out');

  app.write('a.ts', 'export {};\n');
  await app.commitAll('First commit');
  await app.git('checkout', '--quiet', '--detach');
  assertRefused(await guard(f, 's1', path), 'detached HEAD', 'no branch checked out');
});

test('write-guard: a folder under repos/ that is not its own repository is refused', async (t) => {
  const f = makeSpace(t);
  // The Space is a repository on `main`; repos/plain is a plain folder inside it.
  await useTempGitRepo(t, { dir: f.space });
  mkdirSync(join(f.space, 'repos', 'plain'));
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [
      claim('s1', { kind: 'repository', name: 'plain', branch: 'main' }),
      claim('s1', { kind: 'repository', name: 'absent', branch: 'main' }),
    ],
  );
  assertRefused(
    await guard(f, 's1', join(f.space, 'repos/plain/a.ts')),
    'plain folder',
    'not the top folder',
  );
  assertRefused(
    await guard(f, 's1', join(f.space, 'repos/absent/a.ts')),
    'missing folder',
    'does not exist',
  );
});

test('write-guard: a symbolic link is judged by where it points', async (t) => {
  const f = makeSpace(t);
  const outside = join(dirname(f.space), 'outside');
  mkdirSync(outside);
  symlinkSync(join(f.space, 'lore'), join(f.space, 'workbench/scratch/lore-link'));
  symlinkSync(join(f.space, 'lore/index.md'), join(f.space, 'workbench/scratch/index-link.md'));
  symlinkSync(outside, join(f.space, 'workbench/scratch/outside-link'));
  symlinkSync(join(f.space, 'workbench/scratch'), join(f.space, 'lore/scratch-link'));
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);

  const intoLore = join(f.space, 'workbench/scratch/lore-link/corpus/term.md');
  assertRefused(await guard(f, 's1', intoLore), 'folder link into the Lore', intoLore, 'Read only');
  assertRefused(
    await guard(f, 's1', join(f.space, 'workbench/scratch/index-link.md')),
    'file link into the Lore',
    join(f.space, 'lore/index.md'),
  );
  assertRefused(
    await guard(f, 's1', join(f.space, 'workbench/scratch/outside-link/a.md')),
    'link out of the Space',
    'outside',
  );
  assertAllowed(
    await guard(f, 's1', join(f.space, 'lore/scratch-link/a.md')),
    'a link in the Lore that points into the Workbench',
  );
});

test('write-guard: the Space reached through a symbolic link is the same Space', async (t) => {
  const f = makeSpace(t);
  const alias = join(dirname(f.space), 'space-alias');
  symlinkSync(f.space, alias);
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  const viaAlias = { ...f, space: alias };
  assertAllowed(await guard(viaAlias, 's1', join(alias, 'workbench/scratch/a.md')), 'alias');
  assertAllowed(await guard(viaAlias, 's1', join(f.space, 'workbench/scratch/a.md')), 'real path');
  assertRefused(
    await guard(viaAlias, 's1', join(alias, 'lore/index.md')),
    'Lore by alias',
    'Read only',
  );
});

test('write-guard: ".." segments are removed before the decision', async (t) => {
  const f = makeSpace(t);
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  assertRefused(
    await guard(f, 's1', `${f.space}/workbench/scratch/../../lore/index.md`),
    'out of the Workbench',
    'Read only',
  );
  assertRefused(
    await guard(f, 's1', `${f.space}/workbench/../../outside.md`),
    'out of the Space',
    'outside',
  );
  assertAllowed(
    await guard(f, 's1', `${f.space}/lore/../workbench/scratch/a.md`),
    'into the Workbench',
  );
});

test('write-guard: a path that is neither Lore, payload nor Workbench is refused in both modes', async (t) => {
  const f = makeSpace(t);
  writeDesk(
    f.desk,
    [
      { id: 'reader', mode: 'read-only' },
      { id: 'writer', mode: 'writing' },
    ],
    [
      claim('writer', { kind: 'lore' }),
      claim('writer', { kind: 'publish-area', name: 'handbook' }),
    ],
  );
  const outside = join(dirname(f.space), 'outside.md');
  for (const session of ['reader', 'writer']) {
    for (const path of ['ai_readme.md', '.gitignore', 'repos/loose-file.md', 'workbench', 'lore']) {
      assertRefused(
        await guard(f, session, join(f.space, path)),
        `${session} ${path}`,
        'is not in the Lore',
      );
    }
    assertRefused(await guard(f, session, outside), `${session} outside`, 'outside the Space');
    assertRefused(
      await guard(f, session, join(f.desk, 'claims.json')),
      `${session} desk`,
      'outside',
    );
  }
});

test('write-guard: a session that the desk has no record of is in Read only', async (t) => {
  const f = makeSpace(t);
  const workbench = join(f.space, 'workbench/scratch/a.md');
  const lore = join(f.space, 'lore/corpus/term.md');
  const sessions = join(f.desk, 'sessions.json');

  // No desk file at all: the companion app reads a missing file as an empty one.
  assertAllowed(await guard(f, 's1', workbench), 'no desk files, the Workbench');
  assertRefused(await guard(f, 's1', lore), 'no desk files, the Lore', 'no record', 'Read only');
  const absent = { ...f, desk: join(f.desk, 'absent') };
  assertAllowed(await guard(absent, 's1', workbench), 'no desk folder, the Workbench');
  assertRefused(await guard(absent, 's1', lore), 'no desk folder, the Lore', 'Read only');

  // A record for another session only, and a claim without a session record.
  writeDesk(f.desk, [{ id: 's0', mode: 'writing' }], [claim('s1', { kind: 'lore' })]);
  assertAllowed(await guard(f, 's1', workbench), 'not recorded, the Workbench');
  assertRefused(
    await guard(f, 's1', lore),
    'a claim does not make a session that is not recorded write',
    'no record',
    'Read only',
    '"s1"',
  );

  // sessions.json without claims.json: Writing with no target.
  writeDesk(f.desk, [{ id: 's1', mode: 'writing' }]);
  rmSync(join(f.desk, 'claims.json'));
  assertAllowed(await guard(f, 's1', workbench), 'no claims file, the Workbench');
  assertRefused(await guard(f, 's1', lore), 'no claims file, the Lore', 'without having claimed');
  assert.equal(existsSync(sessions), true);
});

test('write-guard: a desk record that is there and cannot be read refuses every write, the Workbench included', async (t) => {
  const f = makeSpace(t);
  const path = join(f.space, 'workbench/scratch/a.md');
  const sessions = join(f.desk, 'sessions.json');
  const claims = join(f.desk, 'claims.json');

  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  assertAllowed(await guard(f, 's1', path), 'both records present');

  writeFileSync(claims, '{ "version": 1, "records": [', 'utf8');
  assertRefused(await guard(f, 's1', path), 'claims not JSON', claims, 'is not JSON');
  writeFileSync(claims, JSON.stringify({ version: 2, records: [] }), 'utf8');
  assertRefused(await guard(f, 's1', path), 'claims version 2', claims, 'format');
  writeFileSync(claims, JSON.stringify([]), 'utf8');
  assertRefused(await guard(f, 's1', path), 'claims is a list', claims, 'format');
  writeFileSync(
    claims,
    JSON.stringify({
      version: 1,
      records: [{ sessionId: 's1', target: { kind: 'repository', name: 'app' } }],
    }),
    'utf8',
  );
  assertRefused(
    await guard(f, 's1', path),
    'a repository claim without a branch',
    claims,
    'target',
  );

  writeDesk(f.desk, [{ id: 's1', mode: 'blocked' }]);
  assertRefused(await guard(f, 's1', path), 'unknown mode', sessions, 'mode');
  writeDesk(f.desk, [
    { id: 's1', mode: 'read-only' },
    { id: 's1', mode: 'writing' },
  ]);
  assertRefused(await guard(f, 's1', path), 'session twice', sessions, 'more than once');
  writeFileSync(sessions, 'not json', 'utf8');
  assertRefused(await guard(f, 's1', path), 'sessions not JSON', sessions, 'is not JSON');

  // One key twice in one object: readers do not agree on which value counts.
  writeFileSync(
    sessions,
    '{"version":1,"records":[{"id":"s1","mode":"read-only","mode":"writing"}]}',
    'utf8',
  );
  assertRefused(await guard(f, 's1', path), 'mode twice', sessions, 'twice');
  writeDesk(f.desk, [{ id: 's1', mode: 'writing' }]);
  writeFileSync(claims, JSON.stringify({ version: 1, records: ['lore'] }), 'utf8');
  assertRefused(await guard(f, 's1', path), 'a record that is not an object', claims, 'format');
  writeFileSync(
    claims,
    JSON.stringify({ version: 1, records: [{ sessionId: 's1', target: 'lore' }] }),
    'utf8',
  );
  assertRefused(await guard(f, 's1', path), 'a target that is text', claims, 'target');
  writeFileSync(
    claims,
    JSON.stringify({
      version: 1,
      records: [{ sessionId: 's1', target: { kind: 'repository', name: 'app', branch: 7 } }],
    }),
    'utf8',
  );
  assertRefused(await guard(f, 's1', path), 'a branch that is a number', claims, 'target');

  // Larger than the script reads.
  writeFileSync(
    claims,
    `{"version":1,"records":[],"padding":"${'x'.repeat(9 * 1024 * 1024)}"}`,
    'utf8',
  );
  assertRefused(await guard(f, 's1', path), 'a huge record', claims, 'larger than');

  // A folder where the file should be.
  rmSync(claims);
  mkdirSync(claims);
  assertRefused(await guard(f, 's1', path), 'a folder as the record', claims, 'not a file');
});

test('write-guard: fields it does not know, other sessions and repeated claims change nothing', async (t) => {
  const f = makeSpace(t);
  writeFileSync(
    join(f.desk, 'sessions.json'),
    JSON.stringify({
      version: 1,
      future: { any: 'thing' },
      records: [
        { id: 's1', mode: 'writing', engine: 'claude-code', later: [1, 2] },
        { id: 7, mode: 'nonsense' },
        { mode: 'writing' },
      ],
    }),
    'utf8',
  );
  writeFileSync(
    join(f.desk, 'claims.json'),
    JSON.stringify({
      version: 1,
      records: [
        claim('s1', { kind: 'lore' }),
        claim('s1', { kind: 'lore' }),
        { sessionId: 's2', target: 'not read, it is another session' },
        { sessionId: null, target: { kind: 'publish-area', name: 'publish' } },
      ],
    }),
    'utf8',
  );
  assertAllowed(await guard(f, 's1', join(f.space, 'lore/corpus/term.md')), 'the Lore, claimed');
  assertRefused(
    await guard(f, 's1', join(f.space, 'publish/specs/a.md')),
    'a claim with no session is nobody’s',
    'without having claimed',
  );
});

test('write-guard: the .git folders are refused, in the Space and in a claimed repository, in any case of letters', async (t) => {
  const f = makeSpace(t);
  await useTempGitRepo(t, { dir: f.space });
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [
      claim('s1', { kind: 'lore' }),
      claim('s1', { kind: 'repository', name: 'app', branch: 'main' }),
    ],
  );
  assertAllowed(await guard(f, 's1', join(f.space, 'repos/app/src/a.ts')), 'the repository itself');
  for (const path of [
    '.git/config',
    '.git/hooks/pre-commit',
    'repos/app/.git/config',
    'repos/app/.git/hooks/pre-commit',
    'repos/app/.GIT/config',
    'repos/app/.Git/HEAD',
    'repos/app/src/.git',
    'workbench/scratch/clone/.git/config',
    'lore/.git/config',
  ]) {
    assertRefused(await guard(f, 's1', join(f.space, path)), path, '.git');
  }
});

test('write-guard: another repository inside the claimed repository is not covered by the claim', async (t) => {
  const f = makeSpace(t);
  const app = await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  app.write('a.ts', 'export {};\n');
  await app.commitAll('first');
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app', 'vendor', 'nested') });
  await app.git('worktree', 'add', '--quiet', '-b', 'other', join(app.dir, 'wt'));
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'main' })],
  );
  assertAllowed(await guard(f, 's1', join(app.dir, 'src/new/deeper/b.ts')), 'new folders');
  assertRefused(
    await guard(f, 's1', join(app.dir, 'vendor/nested/src/c.ts')),
    'a nested repository',
    'another git repository',
  );
  assertRefused(
    await guard(f, 's1', join(app.dir, 'wt/a.ts')),
    'a worktree on another branch, inside the repository',
    'another git repository',
  );
});

test('write-guard: a worktree as repos/<name> is judged by its own branch', async (t) => {
  const f = makeSpace(t);
  const main = await useTempGitRepo(t);
  main.write('a.ts', 'export {};\n');
  await main.commitAll('first');
  await main.git('worktree', 'add', '--quiet', '-b', 'item-12', join(f.space, 'repos', 'app'));
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'main' })],
  );
  const path = join(f.space, 'repos/app/a.ts');
  assertRefused(await guard(f, 's1', path), 'claimed main, worktree on item-12', '"item-12"');
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'item-12' })],
  );
  assertAllowed(await guard(f, 's1', path), 'claimed item-12');
});

test('write-guard: a tag with the name of the branch does not change the branch that is read', async (t) => {
  const f = makeSpace(t);
  const app = await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  app.write('a.ts', 'export {};\n');
  await app.commitAll('first');
  await app.git('tag', 'main');
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'main' })],
  );
  assertAllowed(await guard(f, 's1', join(app.dir, 'a.ts')), 'branch main with a tag main');
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'heads/main' })],
  );
  assertRefused(await guard(f, 's1', join(app.dir, 'a.ts')), 'heads/main is another name');
});

test('write-guard: git variables of the environment do not change the repository that is read', async (t) => {
  const f = makeSpace(t);
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  const other = await useTempGitRepo(t);
  await other.git('checkout', '--quiet', '-b', 'item-12');
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'repository', name: 'app', branch: 'item-12' })],
  );
  const result = await runPython(
    WRITE_GUARD,
    [
      '--space',
      f.space,
      '--desk',
      f.desk,
      '--session',
      's1',
      '--path',
      join(f.space, 'repos/app/a.ts'),
    ],
    { cwd: f.elsewhere, env: { GIT_DIR: join(other.dir, '.git'), GIT_WORK_TREE: other.dir } },
  );
  assertRefused(result, 'GIT_DIR names a repository on the claimed branch', '"main"');
});

test('write-guard: names that differ in case or in Unicode form from a claimed name are not the claimed name', async (t) => {
  const f = makeSpace(t);
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'app') });
  await useTempGitRepo(t, { dir: join(f.space, 'repos', 'café') });
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [
      claim('s1', { kind: 'repository', name: 'app', branch: 'main' }),
      claim('s1', { kind: 'repository', name: 'café', branch: 'main' }),
    ],
  );
  assertAllowed(await guard(f, 's1', join(f.space, 'repos/café/a.ts')), 'the claimed form');
  for (const path of [
    'repos/APP/a.ts',
    'repos/café/a.ts',
    'LORE/corpus/term.md',
    'Workbench/scratch/a.md',
    'REPOS/app/a.ts',
  ]) {
    assertRefused(await guard(f, 's1', join(f.space, path)), path);
  }
  const upper = { ...f, space: join(dirname(f.space), 'SPACE') };
  assertRefused(
    await guard(upper, 's1', join(f.space, 'workbench/scratch/a.md')),
    '--space in capitals',
  );
});

test('write-guard: a hard link, a folder, a trailing slash, a long path and a line feed', async (t) => {
  const f = makeSpace(t);
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  linkSync(join(f.space, 'lore/index.md'), join(f.space, 'workbench/scratch/hard.md'));
  assertRefused(
    await guard(f, 's1', join(f.space, 'workbench/scratch/hard.md')),
    'a hard link to a file of the Lore',
    'hard link',
  );
  assertRefused(await guard(f, 's1', join(f.space, 'workbench/scratch')), 'a folder', 'not a file');
  assertRefused(await guard(f, 's1', `${f.space}/workbench/scratch/`), 'a trailing slash');
  assertRefused(await guard(f, 's1', `${f.space}/workbench/`), 'the Workbench itself');
  assertAllowed(await guard(f, 's1', `${f.space}//workbench/./scratch//b.md`), 'doubled slashes');

  const long = join(f.space, 'workbench', ...Array<string>(40).fill('n'.repeat(200)), 'a.md');
  assertRefused(await guard(f, 's1', long), 'a path longer than the system takes');

  const withLineFeed = await guard(f, 's1', join(f.space, 'lore/a\nwrite-guard allows.md'));
  assertRefused(withLineFeed, 'a line feed in the name', '\\x0A');
  assertRefused(
    await guard(f, 's1\nwrite-guard allows', join(f.space, 'workbench/scratch/b.md')),
    'a line feed in the session id',
    '--session',
  );
});

test('write-guard: a desk folder inside the Space, a relative --space and the Space as the desk are refused', async (t) => {
  const f = makeSpace(t);
  const inside = join(f.space, 'workbench/desk');
  mkdirSync(inside);
  writeDesk(inside, [{ id: 's1', mode: 'writing' }], [claim('s1', { kind: 'lore' })]);
  const path = join(f.space, 'workbench/scratch/a.md');
  assertRefused(await guard({ ...f, desk: inside }, 's1', path), 'desk in the Workbench', 'apart');
  assertRefused(await guard({ ...f, desk: f.space }, 's1', path), 'desk is the Space', 'apart');
  assertRefused(
    await guard({ ...f, desk: dirname(f.space) }, 's1', path),
    'desk around the Space',
    'apart',
  );
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  assertRefused(await guard({ ...f, space: 'space' }, 's1', path), 'relative --space', 'absolute');
  assertRefused(await guard({ ...f, desk: 'desk' }, 's1', path), 'relative --desk', 'absolute');
  // The desk's own files are outside the Space.
  assertRefused(await guard(f, 's1', join(f.desk, 'claims.json')), 'the desk record', 'outside');
});

test('write-guard: a broken manifest stops writes to a publish area and not to the Lore', async (t) => {
  const f = makeSpace(t);
  writeDesk(
    f.desk,
    [{ id: 's1', mode: 'writing' }],
    [claim('s1', { kind: 'lore' }), claim('s1', { kind: 'publish-area', name: 'publish' })],
  );
  put(f.space, 'lore/space.md', "---\ntype: 'space'\n---\n");
  assertRefused(await guard(f, 's1', join(f.space, 'publish/specs/a.md')), 'publish', 'space.md');
  assertAllowed(
    await guard(f, 's1', join(f.space, 'lore/space.md')),
    'the manifest can be repaired',
  );
});

test('write-guard: a wrong command line refuses, and the output is the same on every run', async (t) => {
  const f = makeSpace(t);
  writeDesk(f.desk, [{ id: 's1', mode: 'read-only' }]);
  const run = (args: string[]): Promise<RunResult> =>
    runPython(WRITE_GUARD, args, { cwd: f.elsewhere });
  const full = ['--space', f.space, '--desk', f.desk, '--session', 's1'];

  assertRefused(await run(full), 'no --path', 'command line');
  assertRefused(
    await run([...full, '--path', 'workbench/scratch/a.md']),
    'relative --path',
    'absolute',
  );
  assertRefused(
    await run([...full, '--path', join(f.space, 'workbench/a.md'), '--extra']),
    'unknown',
    'command line',
  );
  assertRefused(await run(['--help']), '--help is not an allow', 'command line');

  const path = join(f.space, 'lore/index.md');
  const first = await guard(f, 's1', path);
  const second = await guard(f, 's1', path);
  assert.deepEqual(first, second);
});

// ---------- lore-integrity ----------

const CORPUS_CARD = [
  '---',
  'type: corpus',
  'term: term',
  'points_at:',
  '  - lore/space.md',
  '  - "lore/contracts/core/sample.md#the-rule"',
  '  - lore/contracts/',
  '  - workbench/journal/',
  '  - repos/app/src/a.ts',
  '  - "https://example.invalid/page"',
  '---',
  '',
  '# Term',
  '',
  'See the [sample contract](../../contracts/core/sample.md#the-rule), [this section](#term),',
  'a [web page](https://example.invalid/page), and in code `[nothing](./nothing.md)`.',
  '',
  '```markdown',
  '- [absent.md](./absent.md): an example line inside a fenced block.',
  '```',
  '',
].join('\n');

const CONTRACT_CARD = [
  '---',
  'type: contract',
  'name: sample',
  'pillar: working',
  'target: everything',
  'check: lore/contracts/core/sample.py',
  'when: before',
  '---',
  '',
  '# sample',
  '',
].join('\n');

/** A small Lore that passes lore-integrity. */
function makeLore(t: TestContext): Fixture {
  const f = makeSpace(t);
  const index = (relativePath: string, lines: string[]): void => {
    put(f.space, relativePath, `${INDEX_HEAD}${lines.join('\n')}\n`);
  };
  index('lore/index.md', [
    '- [space.md](./space.md): the manifest.',
    '- [corpus/](./corpus/index.md): the words.',
    '- [contracts/](./contracts/index.md): the contracts.',
  ]);
  index('lore/corpus/index.md', ['- [core/](./core/index.md): the core entries.']);
  index('lore/corpus/core/index.md', ['- [term.md](./term.md): a term.']);
  put(f.space, 'lore/corpus/core/term.md', CORPUS_CARD);
  index('lore/contracts/index.md', [
    '- [core/](./core/index.md): the core contracts.',
    '- [default/](./default/index.md): the default contracts.',
  ]);
  index('lore/contracts/core/index.md', [
    '- [sample.md](./sample.md): a contract.',
    '- [sample.py](./sample.py): its check script.',
  ]);
  put(f.space, 'lore/contracts/core/sample.md', CONTRACT_CARD);
  put(f.space, 'lore/contracts/core/sample.py', 'import sys\nsys.exit(0)\n');
  put(f.space, 'lore/contracts/default/index.md', `${INDEX_HEAD}This folder has no entries yet.\n`);
  put(f.space, 'lore/.DS_Store', 'a file whose name begins with a dot is not a child');
  return f;
}

function integrityAfter(f: Fixture): Promise<RunResult> {
  return runPython(LORE_INTEGRITY, ['--space', f.space, '--when', 'after'], { cwd: f.elsewhere });
}

function integrityBefore(f: Fixture, path: string): Promise<RunResult> {
  return runPython(
    LORE_INTEGRITY,
    ['--space', f.space, '--desk', f.desk, '--session', 's1', '--when', 'before', '--path', path],
    { cwd: f.elsewhere },
  );
}

/** Requires exit 2 and one finding line per expected pair of file and words. */
function assertFindings(result: RunResult, expected: [string, string][]): void {
  assert.equal(result.code, REFUSE, `expected exit 2: ${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, '');
  const lines = result.stderr.trimEnd().split('\n');
  const summary = lines.pop() ?? '';
  assert.match(
    summary,
    new RegExp(`fails the check with ${expected.length} findings\\.$`),
    result.stderr,
  );
  for (const [file, words] of expected) {
    assert.ok(
      lines.some((line) => line.startsWith(`lore-integrity: ${file}: `) && line.includes(words)),
      `a finding for ${file} with "${words}" in:\n${result.stderr}`,
    );
  }
  assert.deepEqual(lines, [...lines].sort(), 'the findings are sorted');
}

test('lore-integrity after: a sound Lore passes, from a working folder that is not the Space', async (t) => {
  const f = makeLore(t);
  const result = await integrityAfter(f);
  assert.equal(result.code, ALLOW, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /passes the check: 9 markdown files in 6 folders\.\n$/);
  assert.deepEqual(await integrityAfter(f), result);
});

test('lore-integrity after: an index that does not list exactly its children fails', async (t) => {
  const f = makeLore(t);
  put(
    f.space,
    'lore/corpus/core/unlisted.md',
    '---\ntype: corpus\nterm: unlisted\npoints_at: []\n---\n',
  );
  put(f.space, 'lore/corpus/core/notes.txt', 'a file that is not markdown is a child too');
  put(
    f.space,
    'lore/corpus/index.md',
    `${INDEX_HEAD}- [core/](./core/index.md): core.\n- [gone.md](./gone.md): gone.\n- [own/](./own/index.md): gone.\n- not an index line\n`,
  );
  mkdirSync(join(f.space, 'lore/verbs'));
  assertFindings(await integrityAfter(f), [
    ['lore/corpus/core/index.md', 'no line for the file unlisted.md'],
    ['lore/corpus/core/index.md', 'no line for the file notes.txt'],
    ['lore/corpus/index.md', 'lists the file gone.md'],
    ['lore/corpus/index.md', 'lists the folder own'],
    ['lore/corpus/index.md', 'form of an index line'],
    ['lore/index.md', 'no line for the folder verbs'],
    ['lore/verbs', 'has no index.md'],
  ]);
});

test('lore-integrity after: frontmatter outside the subset fails, file by file', async (t) => {
  const f = makeLore(t);
  const outside = [
    "term: 'single quotes'",
    'term: specify # a comment at the end of a line',
    'steps: [open, draft]',
    'github: { repository: a }',
    'text: |\n  several\n  lines',
    'github:\n  owner:\n    name: a',
    'steps:\n  - open\n  - name: draft',
    'date: 2026-09-18',
    'version: 1.0',
    'number: 007',
    'answer: yes',
    'answer: True',
    'empty:',
    'term: a\nterm: b',
    'steps:\n\t- open',
    'Name: a',
    'address: https://example.com',
  ];
  const expected: [string, string][] = [];
  const lines: string[] = ['- [term.md](./term.md): a term.'];
  outside.forEach((yaml, i) => {
    const name = `outside-${String(i).padStart(2, '0')}.md`;
    put(f.space, `lore/corpus/core/${name}`, `---\ntype: corpus\n${yaml}\n---\n\n# Outside\n`);
    lines.push(`- [${name}](./${name}): outside the subset.`);
    expected.push([`lore/corpus/core/${name}`, 'outside the subset']);
  });
  put(f.space, 'lore/corpus/core/no-frontmatter.md', '# No frontmatter\n');
  put(f.space, 'lore/corpus/core/no-type.md', '---\nterm: a\n---\n');
  put(f.space, 'lore/corpus/core/wrong-type.md', '---\ntype: index\n---\n');
  lines.push('- [no-frontmatter.md](./no-frontmatter.md): none.');
  lines.push('- [no-type.md](./no-type.md): none.');
  lines.push('- [wrong-type.md](./wrong-type.md): none.');
  expected.push(['lore/corpus/core/no-frontmatter.md', 'does not begin with frontmatter']);
  expected.push(['lore/corpus/core/no-type.md', 'no key type']);
  expected.push(['lore/corpus/core/wrong-type.md', 'index.md']);
  put(f.space, 'lore/corpus/core/index.md', `${INDEX_HEAD}${lines.join('\n')}\n`);
  assertFindings(await integrityAfter(f), expected);
});

test('lore-integrity after: the five forms of a value are read', async (t) => {
  const f = makeLore(t);
  const yaml = [
    '# a comment line',
    'type: space',
    'quoted: "a \\"b\\" c:\\\\d"',
    'count: 7',
    'flag: false',
    'nothing: null',
    'gates: []',
    'steps:',
    '  - open',
    '  - "1.0"',
    'github:',
    '  repository: example-owner/example-space',
    '  project: 1',
    'repositories:',
    '  - name: example-app',
    '    github: example-owner/example-app',
    '  - name: handbook',
  ].join('\n');
  put(f.space, 'lore/space.md', `---\n${yaml}\n---\n`);
  assert.equal((await integrityAfter(f)).code, ALLOW);
});

test('lore-integrity after: a reference that does not resolve fails', async (t) => {
  const f = makeLore(t);
  put(
    f.space,
    'lore/corpus/core/term.md',
    [
      '---',
      'type: corpus',
      'term: term',
      'points_at:',
      '  - lore/absent.md',
      '  - lore/../ai_readme.md',
      '  - "publish/specs/absent.md#section"',
      '---',
      '',
      'A [broken link](./absent.md), a [link out](../../../../outside.md) and an [absolute](/etc/hosts).',
      '',
    ].join('\n'),
  );
  put(f.space, 'lore/contracts/core/sample.md', CONTRACT_CARD.replace('sample.py', 'absent.py'));
  assertFindings(await integrityAfter(f), [
    ['lore/corpus/core/term.md', 'names "lore/absent.md", which does not exist'],
    ['lore/corpus/core/term.md', '"lore/../ai_readme.md", which is not a path relative'],
    ['lore/corpus/core/term.md', 'names "publish/specs/absent.md", which does not exist'],
    ['lore/corpus/core/term.md', 'the link "./absent.md" does not resolve'],
    ['lore/corpus/core/term.md', 'points outside'],
    ['lore/corpus/core/term.md', 'the link "/etc/hosts" is not relative'],
    ['lore/contracts/core/sample.md', 'the key check names "lore/contracts/core/absent.py"'],
  ]);
});

test('lore-integrity after: a missing Lore and a wrong command line fail', async (t) => {
  const f = makeSpace(t);
  const run = (args: string[]): Promise<RunResult> =>
    runPython(LORE_INTEGRITY, args, { cwd: f.elsewhere });
  assertRefused(
    await run(['--space', join(f.space, 'absent'), '--when', 'after']),
    'no Space',
    'does not exist',
  );
  assertRefused(await run(['--space', f.elsewhere, '--when', 'after']), 'no lore/', 'lore');
  assertRefused(await run(['--space', f.space]), 'no --when', 'command line');
  assertRefused(
    await run(['--space', f.space, '--when', 'before']),
    'before without --path',
    '--path',
  );
  assertRefused(await run(['--space', 'space', '--when', 'after']), 'relative --space', 'absolute');
});

test('lore-integrity before: a write under a core or default folder is refused', async (t) => {
  const f = makeLore(t);
  symlinkSync(join(f.space, 'lore/contracts/core'), join(f.space, 'workbench/scratch/core-link'));

  for (const path of [
    'lore/contracts/core/sample.md',
    'lore/contracts/core/new.md',
    'lore/contracts/default/new.md',
    'lore/contracts/default/deeper/new.md',
    'lore/contracts/own/../core/new.md',
    'workbench/scratch/core-link/new.md',
  ]) {
    const full = `${f.space}/${path}`;
    assertRefused(
      await integrityBefore(f, full),
      path,
      'lore-integrity',
      full,
      'not edited in place',
    );
  }
  for (const path of [
    'lore/contracts/own-contract.md',
    'lore/contracts/own-folder/core.md',
    'lore/space.md',
    'workbench/scratch/core/a.md',
    'repos/app/core/a.ts',
  ]) {
    assertAllowed(await integrityBefore(f, join(f.space, path)), path);
  }
});

test('lore-integrity before: capitals do not hide a core folder, and a file may not take the name of a core file', async (t) => {
  const f = makeLore(t);
  for (const path of [
    'lore/contracts/CORE/new.md',
    'lore/contracts/Default/new.md',
    'LORE/contracts/core/new.md',
  ]) {
    assertRefused(await integrityBefore(f, join(f.space, path)), path, 'not edited in place');
  }
  for (const path of ['lore/contracts/sample.md', 'lore/contracts/SAMPLE.md']) {
    assertRefused(await integrityBefore(f, join(f.space, path)), path, 'name of a core file');
  }
  assertAllowed(await integrityBefore(f, join(f.space, 'lore/contracts/index.md')), 'the index');
  assertAllowed(await integrityBefore(f, join(f.space, 'lore/corpus/sample.md')), 'another part');
});

test('lore-integrity after: a file that takes the name of a core file is a finding', async (t) => {
  const f = makeLore(t);
  assert.equal((await integrityAfter(f)).code, ALLOW, 'before the file is added');
  const core = readFileSync(join(f.space, 'lore/contracts/core/sample.md'), 'utf8');
  put(f.space, 'lore/contracts/sample.md', core);
  const index = join(f.space, 'lore/contracts/index.md');
  writeFileSync(
    index,
    `${readFileSync(index, 'utf8')}- [sample.md](./sample.md): an own file with the name of a core file.\n`,
    'utf8',
  );
  assertFindings(await integrityAfter(f), [
    ['lore/contracts/sample.md', 'takes the name of a file in lore/contracts/core/'],
  ]);
});

// ---------- journal-append-forward ----------

function journal(f: Fixture, path: string, session: string | null = 's1'): Promise<RunResult> {
  const who = session === null ? [] : ['--session', session];
  return runPython(
    JOURNAL,
    ['--space', f.space, '--desk', f.desk, ...who, '--when', 'before', '--path', path],
    { cwd: f.elsewhere },
  );
}

test('journal-append-forward: a session writes its own entry again, and no entry of another session', async (t) => {
  const f = makeSpace(t);
  const own = put(f.space, 'workbench/journal/2026-09-18-1430-cards-s1.md', '# This session\n');
  const earlier = put(f.space, 'workbench/journal/2026-09-17-0900-cards-s0.md', '# Earlier\n');
  const unnamed = put(f.space, 'workbench/journal/2026-09-16-0900-cards.md', '# No id\n');
  const longer = put(f.space, 'workbench/journal/2026-09-15-0900-cards-xs1.md', '# Session xs1\n');

  assertAllowed(await journal(f, own), 'the entry of the session');
  assertAllowed(await journal(f, own.replace('/journal/', '/scratch/../journal/')), 'with ".."');
  for (const path of [earlier, unnamed, longer]) {
    assertRefused(await journal(f, path), path, 'another session');
  }
  assertRefused(await journal(f, own, 's0'), 'the entry of s1, asked by s0', 'another session');
  assertRefused(await journal(f, own, null), 'no --session', 'another session');
  assertRefused(await journal(f, own, '../x'), 'an id that cannot end a file name');
  assertRefused(await journal(f, own, '1'), 'an id that only ends the name by chance');

  // A link named like the session's entry is not the session's entry.
  symlinkSync(earlier, join(f.space, 'workbench/journal/link-s1.md'));
  assertRefused(await journal(f, join(f.space, 'workbench/journal/link-s1.md')), 'a link');
  symlinkSync(earlier, join(f.space, 'workbench/scratch/other-s1.md'));
  assertRefused(
    await journal(f, join(f.space, 'workbench/scratch/other-s1.md')),
    'a link from scratch',
  );
});

test('journal-append-forward: capitals do not hide the journal', async (t) => {
  const f = makeSpace(t);
  put(f.space, 'workbench/journal/2026-09-17-s0.md', '# An earlier entry\n');
  const result = await journal(f, join(f.space, 'workbench/JOURNAL/2026-09-17-s0.md'));
  if (existsSync(join(f.space, 'workbench/JOURNAL'))) {
    // This file system takes "JOURNAL" and "journal" for one name.
    assertRefused(result, 'capitals on a file system without case', 'another session');
  } else {
    assertAllowed(result, 'capitals on a file system with case: no such file');
  }
});

test('journal-append-forward: a new entry is allowed and an existing entry is refused', async (t) => {
  const f = makeSpace(t);
  const existing = put(f.space, 'workbench/journal/2026-09-17-s0.md', '# An earlier entry\n');
  put(f.space, 'workbench/drafts/draft.md', '# A draft\n');

  assertAllowed(await journal(f, join(f.space, 'workbench/journal/2026-09-18-s1.md')), 'new entry');
  assertAllowed(
    await journal(f, join(f.space, 'workbench/journal/2026/09/18-s1.md')),
    'new folder',
  );
  assertAllowed(
    await journal(f, join(f.space, 'workbench/drafts/draft.md')),
    'a draft that exists',
  );
  assertAllowed(await journal(f, join(f.space, 'lore/index.md')), 'a path outside the journal');

  assertRefused(
    await journal(f, existing),
    'existing entry',
    'journal-append-forward',
    existing,
    'exists',
  );
  const first = await journal(f, existing);
  assert.deepEqual(await journal(f, existing), first);
});

test('journal-append-forward: links and ".." segments do not hide an existing entry', async (t) => {
  const f = makeSpace(t);
  const existing = put(f.space, 'workbench/journal/2026-09-17-s0.md', '# An earlier entry\n');
  symlinkSync(existing, join(f.space, 'workbench/scratch/entry-link.md'));
  symlinkSync(join(f.space, 'workbench/journal'), join(f.space, 'workbench/scratch/journal-link'));
  symlinkSync(
    join(f.space, 'workbench/scratch/absent.md'),
    join(f.space, 'workbench/journal/dangling.md'),
  );

  assertRefused(
    await journal(f, `${f.space}/workbench/scratch/../journal/2026-09-17-s0.md`),
    '".." into the journal',
    'exists',
  );
  assertRefused(
    await journal(f, join(f.space, 'workbench/scratch/entry-link.md')),
    'file link',
    'exists',
  );
  assertRefused(
    await journal(f, join(f.space, 'workbench/scratch/journal-link/2026-09-17-s0.md')),
    'folder link',
    'exists',
  );
  assertRefused(
    await journal(f, join(f.space, 'workbench/journal/dangling.md')),
    'a link as an entry',
    'exists',
  );
  assertAllowed(
    await journal(f, join(f.space, 'workbench/scratch/journal-link/2026-09-18-s1.md')),
    'a new entry through the folder link',
  );
});

test('journal-append-forward: a wrong command line and a missing Space refuse', async (t) => {
  const f = makeSpace(t);
  const run = (args: string[]): Promise<RunResult> =>
    runPython(JOURNAL, args, { cwd: f.elsewhere });
  assertRefused(await run(['--space', f.space]), 'no --path', 'command line');
  assertRefused(
    await run(['--space', f.space, '--path', 'workbench/journal/a.md']),
    'relative',
    'absolute',
  );
  assertRefused(
    await run([
      '--space',
      join(f.space, 'absent'),
      '--path',
      join(f.space, 'workbench/journal/a.md'),
    ]),
    'no Space',
    'does not exist',
  );
});

// ---------- all three ----------

test('the check scripts leave no file behind in the template', () => {
  assert.equal(existsSync(join(CHECKS, '__pycache__')), false);
});
