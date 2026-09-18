/**
 * Integration tests of the session lifecycle (`src/space/desk/lifecycle.ts`)
 * against a desk in the temporary folder, with the `write-guard` check script
 * of the Lore template run as a child process after each step. Everything is
 * under the temporary folder; the template is read and never written.
 *
 * A step that makes two writes is stopped between them in two ways: the option
 * `betweenWrites` throws, which leaves on disk what a stopped app leaves, or it
 * makes the second write fail while the process keeps running.
 */

import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ClaimablePayloads, WritingRefusal } from '../../src/space/claims/index.js';
import {
  DESK_OWNER_FILE,
  type Desk,
  type DeskFailure,
  addClaims,
  addSession,
  closeDesk,
  endSession,
  enterWriting,
  getSession,
  leaveWriting,
  listClaims,
  listSessions,
  openDesk,
  repairSessionRecords,
  startSession,
  updateSession,
} from '../../src/space/desk/index.js';
import type { RunResult } from '../../src/space/exec/runner.js';
import { type DeskPaths, deskFile, deskPaths } from '../../src/space/layout/index.js';
import { parseSpaceManifest } from '../../src/space/manifest/index.js';
import type { TempGitRepo } from '../../src/space/testing/git-repo.js';
import { loreTemplateDir, runPython, useTempDir, useTempGitRepo } from '../support/index.js';

const WRITE_GUARD = join(loreTemplateDir(), 'lore', 'contracts', 'core', 'write-guard.py');

const MANIFEST_TEXT = [
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
  '---',
  '',
  '# The manifest',
  '',
].join('\n');

type Fixture = {
  space: string;
  paths: DeskPaths;
  elsewhere: string;
  manifest: ClaimablePayloads;
  app: TempGitRepo;
  desk: Desk;
};

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function failure<E>(result: { ok: true } | { ok: false; error: E }): E {
  assert.equal(result.ok, false, 'the step fails');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

/** A Space folder with the manifest, two repositories on `main`, a publish area, and an open desk. */
async function makeFixture(t: TestContext): Promise<Fixture> {
  const root = useTempDir(t, 'ai-lore-lifecycle-');
  const space = join(root, 'space');
  const elsewhere = join(root, 'elsewhere');
  for (const folder of ['lore/corpus', 'publish', 'repos', 'workbench/scratch']) {
    mkdirSync(join(space, folder), { recursive: true });
  }
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(space, 'lore', 'space.md'), MANIFEST_TEXT);
  const app = await useTempGitRepo(t, { dir: join(space, 'repos', 'app') });
  await useTempGitRepo(t, { dir: join(space, 'repos', 'other') });
  // The rules read the manifest that the manifest module reads from the same text the script reads.
  const manifest = must(parseSpaceManifest(MANIFEST_TEXT));
  // A data folder with a space in its path, as on macOS.
  const paths = deskPaths(join(root, 'user data'), space);
  return { space, paths, elsewhere, manifest, app, desk: must(openDesk(paths)) };
}

function guardArgs(f: Fixture, sessionId: string, relativePath: string): string[] {
  return [
    '--space',
    f.space,
    '--desk',
    f.paths.desk,
    '--session',
    sessionId,
    '--path',
    join(f.space, relativePath),
  ];
}

function guard(f: Fixture, sessionId: string, relativePath: string): Promise<RunResult> {
  return runPython(WRITE_GUARD, guardArgs(f, sessionId, relativePath), { cwd: f.elsewhere });
}

type GuardRun = { code: number | null; stderr: string };

/** The check script run at once, for a look at the desk between two writes of one step. */
function guardNow(f: Fixture, sessionId: string, relativePath: string): GuardRun {
  const run = spawnSync('python3', [WRITE_GUARD, ...guardArgs(f, sessionId, relativePath)], {
    cwd: f.elsewhere,
    encoding: 'utf8',
  });
  if (run.error)
    throw new Error(`python3 could not be run; these tests need it: ${run.error.message}`);
  return { code: run.status, stderr: run.stderr };
}

async function assertAllowed(f: Fixture, sessionId: string, path: string): Promise<void> {
  const result = await guard(f, sessionId, path);
  assert.equal(result.code, 0, `${sessionId} → ${path}: ${result.stderr}`);
}

async function assertRefused(
  f: Fixture,
  sessionId: string,
  path: string,
  ...mentions: string[]
): Promise<void> {
  const result = await guard(f, sessionId, path);
  assert.equal(result.code, 2, `${sessionId} → ${path}: ${result.stdout}`);
  for (const mention of mentions) {
    assert.ok(result.stderr.includes(mention), `"${mention}" is not in: ${result.stderr}`);
  }
}

function records(f: Fixture, name: 'sessions' | 'claims'): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(readFileSync(deskFile(f.paths, name), 'utf8'));
  assert.ok(typeof parsed === 'object' && parsed !== null && 'records' in parsed);
  assert.ok(Array.isArray(parsed.records));
  return parsed.records as Array<Record<string, unknown>>;
}

function modeOnDisk(f: Fixture, sessionId: string): unknown {
  return records(f, 'sessions').find((record) => record.id === sessionId)?.mode;
}

function holdersOnDisk(f: Fixture): unknown[] {
  return records(f, 'claims').map((record) => record.sessionId);
}

function start(f: Fixture, ...ids: string[]): void {
  for (const id of ids) must(startSession(f.desk, { id, engine: 'claude-code' }));
}

const APP_MAIN = { kind: 'repository', name: 'app', branch: 'main' } as const;

class Stopped extends Error {}

function stop(): never {
  throw new Stopped('the app stops here');
}

// ---------- the steps, and what the check script makes of each ----------

test('a session starts in Read only and holds nothing', async (t) => {
  const f = await makeFixture(t);
  const session = must(startSession(f.desk, { id: 's1', engine: 'claude-code' }));
  assert.equal(session.mode, 'read-only');
  assert.equal(session.attended, true);
  assert.equal(session.closedAt, undefined);
  assert.equal(modeOnDisk(f, 's1'), 'read-only');
  assert.deepEqual(must(listClaims(f.desk)), []);

  await assertRefused(f, 's1', 'lore/corpus/a.md', 'Read only');
  await assertRefused(f, 's1', 'repos/app/a.ts', 'Read only');
  await assertRefused(f, 's1', 'publish/a.md', 'Read only');
  await assertAllowed(f, 's1', 'workbench/scratch/a.md');

  assert.equal(
    failure(startSession(f.desk, { id: 's1', engine: 'claude-code' })).kind,
    'duplicate',
  );
  const onItem = must(
    startSession(f.desk, {
      id: 's2',
      engine: 'claude-code',
      item: { repository: 'example-owner/example-space', number: 12, url: '' },
    }),
  );
  assert.equal(onItem.item?.number, 12);
});

test('after entering Writing a session writes the claimed repository on the claimed branch and nothing else', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first', 'second');
  const entered = must(
    enterWriting(f.desk, f.manifest, {
      sessionId: 'first',
      targets: [APP_MAIN],
      reason: 'item 12',
    }),
  );
  assert.equal(entered.session.mode, 'writing');
  assert.deepEqual(entered.grant.targets, [APP_MAIN]);
  assert.deepEqual(
    entered.claims.map((claim) => [claim.sessionId, claim.target]),
    [['first', APP_MAIN]],
  );
  assert.deepEqual(entered.repaired, { released: [], returnedToReadOnly: [] });
  // The claim is recorded on the desk.
  assert.equal(modeOnDisk(f, 'first'), 'writing');
  assert.deepEqual(
    records(f, 'claims').map((record) => record.target),
    [APP_MAIN],
  );

  await assertAllowed(f, 'first', 'repos/app/src/a.ts');
  await assertAllowed(f, 'first', 'workbench/scratch/a.md');
  await assertRefused(f, 'first', 'repos/other/a.ts', 'without having claimed');
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'without having claimed');
  await assertRefused(f, 'first', 'publish/a.md', 'without having claimed');

  // A second session is refused the held repository, on any branch, and nothing is written for it.
  const before = readFileSync(deskFile(f.paths, 'claims'), 'utf8');
  for (const branch of ['main', 'item-12']) {
    const refused = failure(
      enterWriting(f.desk, f.manifest, {
        sessionId: 'second',
        targets: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch }],
      }),
    ) as WritingRefusal;
    assert.equal(refused.kind, 'held');
    assert.equal(refused.reasons[0]?.holder?.sessionId, 'first');
    assert.match(refused.message, /held by the session "first" on the branch "main"/);
  }
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), before);
  assert.equal(modeOnDisk(f, 'second'), 'read-only');
  await assertRefused(f, 'second', 'repos/app/src/a.ts', 'Read only');
  await assertRefused(f, 'second', 'lore/corpus/a.md', 'Read only');

  // Another branch checked out than the claimed one.
  await f.app.git('checkout', '-b', 'item-12');
  await assertRefused(f, 'first', 'repos/app/src/a.ts', '"main"', '"item-12"');
});

test('a session in Writing gets more targets beside those it holds, and a refused request writes nothing', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [APP_MAIN] }));
  const before = readFileSync(deskFile(f.paths, 'claims'), 'utf8');

  const refused = failure(
    enterWriting(f.desk, f.manifest, {
      sessionId: 'first',
      targets: [{ kind: 'lore' }, { kind: 'publish-area', name: 'handbook' }],
    }),
  );
  assert.equal(refused.kind, 'not-in-manifest');
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), before);
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'without having claimed');

  assert.equal(
    failure(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [APP_MAIN] })).kind,
    'already-held',
  );

  const item = {
    repository: 'example-owner/example-space',
    number: 12,
    url: 'https://example.invalid/12',
  };
  const more = must(
    enterWriting(
      f.desk,
      f.manifest,
      {
        sessionId: 'first',
        targets: [{ kind: 'lore' }, { kind: 'publish-area', name: 'publish' }],
      },
      { item },
    ),
  );
  assert.equal(more.grant.modeBefore, 'writing');
  assert.deepEqual(more.session.item, item);
  assert.equal(must(listClaims(f.desk)).length, 3);
  await assertAllowed(f, 'first', 'repos/app/src/a.ts');
  await assertAllowed(f, 'first', 'lore/corpus/a.md');
  await assertAllowed(f, 'first', 'publish/a.md');
  await assertRefused(f, 'first', 'repos/other/a.ts', 'without having claimed');
});

test('requests that the rules refuse leave the desk as it was', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  const sessionsBefore = readFileSync(deskFile(f.paths, 'sessions'), 'utf8');
  const claimsBefore = readFileSync(deskFile(f.paths, 'claims'), 'utf8');
  const kinds = [
    enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [] }),
    enterWriting(f.desk, f.manifest, { sessionId: 'stranger', targets: [{ kind: 'lore' }] }),
    enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'workbench' }] }),
    enterWriting(f.desk, f.manifest, {
      sessionId: 'first',
      targets: [{ kind: 'repository', name: 'app' }],
    }),
    enterWriting(f.desk, f.manifest, {
      sessionId: 'first',
      targets: [{ kind: 'repository', name: 'app', branch: 'a..b' }],
    }),
  ].map((result) => failure(result).kind);
  assert.deepEqual(kinds, [
    'empty-request',
    'session-unknown',
    'unknown-target',
    'branch-missing',
    'branch-invalid',
  ]);
  assert.equal(readFileSync(deskFile(f.paths, 'sessions'), 'utf8'), sessionsBefore);
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), claimsBefore);
  await assertRefused(f, 'first', 'repos/app/a.ts', 'Read only');
});

test('leaving Writing releases every target of the session, and another session can take them', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first', 'second');
  must(
    enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [APP_MAIN, { kind: 'lore' }] }),
  );
  must(
    enterWriting(f.desk, f.manifest, {
      sessionId: 'second',
      targets: [{ kind: 'publish-area', name: 'publish' }],
    }),
  );

  const left = must(leaveWriting(f.desk, 'first'));
  assert.equal(left.session.mode, 'read-only');
  assert.deepEqual(
    left.released.map((claim) => claim.target.kind),
    ['repository', 'lore'],
  );
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['second']);
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'Read only');
  await assertAllowed(f, 'first', 'workbench/scratch/a.md');
  // The other session keeps what it holds.
  await assertAllowed(f, 'second', 'publish/a.md');

  // Leaving again changes nothing.
  const again = must(leaveWriting(f.desk, 'first'));
  assert.deepEqual(again.released, []);
  assert.equal(failure(leaveWriting(f.desk, 'stranger')).kind, 'session-unknown');

  // To change the branch a session leaves and asks again; and the second session can take the repository now.
  must(
    enterWriting(f.desk, f.manifest, {
      sessionId: 'second',
      targets: [{ kind: 'repository', name: 'app', branch: 'main' }],
    }),
  );
  await assertAllowed(f, 'second', 'repos/app/src/a.ts');
});

test('a session that ends is in Read only, holds nothing, and cannot enter Writing again', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }));
  await assertAllowed(f, 'first', 'lore/corpus/a.md');

  const ended = must(endSession(f.desk, 'first'));
  assert.equal(ended.session.mode, 'read-only');
  assert.ok(ended.session.closedAt);
  assert.equal(ended.released.length, 1);
  assert.deepEqual(holdersOnDisk(f), []);
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'Read only');

  assert.equal(
    failure(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }))
      .kind,
    'session-ended',
  );
  // Ending again keeps the first close time; leaving is still allowed.
  const again = must(endSession(f.desk, 'first'));
  assert.equal(again.session.closedAt, ended.session.closedAt);
  must(leaveWriting(f.desk, 'first'));
  assert.equal(failure(endSession(f.desk, 'stranger')).kind, 'session-unknown');
});

// ---------- stopped between the two writes ----------

test('entering Writing writes the claims first: stopped in between, the session is in Read only with the claim recorded', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first', 'second');
  const between: GuardRun[] = [];
  assert.throws(
    () =>
      enterWriting(
        f.desk,
        f.manifest,
        { sessionId: 'first', targets: [APP_MAIN] },
        {
          betweenWrites: () => {
            between.push(guardNow(f, 'first', 'repos/app/src/a.ts'));
            stop();
          },
        },
      ),
    Stopped,
  );
  // What a reader sees between the writes, and after the app stopped there.
  assert.equal(between.length, 1);
  assert.equal(between[0]?.code, 2);
  assert.match(between[0]?.stderr ?? '', /Read only/);
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');
  await assertRefused(f, 'second', 'repos/app/src/a.ts', 'Read only');

  // The app starts again, opens the desk and repairs the records: the claim of no Writing session goes.
  const desk = must(openDesk(f.paths));
  const repaired = must(repairSessionRecords(desk));
  assert.deepEqual(
    repaired.released.map((claim) => claim.sessionId),
    ['first'],
  );
  assert.deepEqual(repaired.returnedToReadOnly, []);
  assert.deepEqual(holdersOnDisk(f), []);
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');
});

test('a claim left by a stopped step does not hold the target against the next request', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first', 'second');
  assert.throws(
    () =>
      enterWriting(
        f.desk,
        f.manifest,
        { sessionId: 'first', targets: [APP_MAIN] },
        { betweenWrites: stop },
      ),
    Stopped,
  );
  const entered = must(
    enterWriting(f.desk, f.manifest, { sessionId: 'second', targets: [APP_MAIN] }),
  );
  assert.deepEqual(
    entered.repaired.released.map((claim) => claim.sessionId),
    ['first'],
  );
  assert.deepEqual(holdersOnDisk(f), ['second']);
  await assertAllowed(f, 'second', 'repos/app/src/a.ts');
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');
});

test('leaving Writing writes the mode first: stopped in between, the session is in Read only and still holds', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }));
  const between: GuardRun[] = [];
  assert.throws(
    () =>
      leaveWriting(f.desk, 'first', {
        betweenWrites: () => {
          between.push(guardNow(f, 'first', 'lore/corpus/a.md'));
          stop();
        },
      }),
    Stopped,
  );
  assert.equal(between.length, 1);
  assert.equal(between[0]?.code, 2);
  assert.match(between[0]?.stderr ?? '', /Read only/);
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'Read only');

  // Leaving again finishes the step.
  const left = must(leaveWriting(f.desk, 'first'));
  assert.equal(left.released.length, 1);
  assert.deepEqual(holdersOnDisk(f), []);
});

test('ending a session writes the record first: stopped in between, the repair releases what it held', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }));
  assert.throws(() => endSession(f.desk, 'first', { betweenWrites: stop }), Stopped);
  const session = must(getSession(f.desk, 'first'));
  assert.equal(session?.mode, 'read-only');
  assert.ok(session?.closedAt);
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'Read only');

  assert.equal(must(repairSessionRecords(f.desk)).released.length, 1);
  assert.deepEqual(holdersOnDisk(f), []);
});

// ---------- the second write fails and the process keeps running ----------

test('when the mode cannot be written, entering Writing releases the claims it wrote', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  const sessionsPath = deskFile(f.paths, 'sessions');
  const good = readFileSync(sessionsPath, 'utf8');
  const error = failure(
    enterWriting(
      f.desk,
      f.manifest,
      { sessionId: 'first', targets: [APP_MAIN] },
      {
        betweenWrites: () => {
          assert.deepEqual(holdersOnDisk(f), ['first']);
          // A newer build's file is left as it is, so the write of the mode fails.
          writeFileSync(sessionsPath, good.replace('"version": 1', '"version": 2'));
        },
      },
    ),
  ) as DeskFailure;
  assert.equal(error.kind, 'newer-version');
  assert.match(error.message, /were released again\.$/);
  assert.deepEqual(holdersOnDisk(f), []);
  writeFileSync(sessionsPath, good);
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');
});

test('when neither the mode nor the release can be written, the claim stays for the repair and the session cannot write', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  const error = failure(
    enterWriting(
      f.desk,
      f.manifest,
      { sessionId: 'first', targets: [APP_MAIN] },
      { betweenWrites: () => rmSync(join(f.paths.desk, DESK_OWNER_FILE)) },
    ),
  ) as DeskFailure;
  assert.equal(error.kind, 'not-owner');
  assert.match(error.message, /could not be released/);
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'repos/app/src/a.ts', 'Read only');

  const desk = must(openDesk(f.paths));
  assert.equal(must(repairSessionRecords(desk)).released.length, 1);
  assert.deepEqual(holdersOnDisk(f), []);
});

test('when the claims cannot be released, leaving Writing still leaves the session in Read only', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }));
  const claimsPath = deskFile(f.paths, 'claims');
  const good = readFileSync(claimsPath, 'utf8');
  const error = failure(
    leaveWriting(f.desk, 'first', {
      betweenWrites: () => writeFileSync(claimsPath, good.replace('"version": 1', '"version": 2')),
    }),
  ) as DeskFailure;
  assert.equal(error.kind, 'newer-version');
  assert.match(error.message, /The session is in Read only\./);
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  writeFileSync(claimsPath, good);
  await assertRefused(f, 'first', 'lore/corpus/a.md', 'Read only');
});

// ---------- the repair ----------

test('the repair writes nothing on a desk that follows the rule', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first', 'second');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [APP_MAIN] }));
  const sessionsBefore = readFileSync(deskFile(f.paths, 'sessions'), 'utf8');
  const claimsBefore = readFileSync(deskFile(f.paths, 'claims'), 'utf8');
  assert.deepEqual(must(repairSessionRecords(f.desk)), { released: [], returnedToReadOnly: [] });
  assert.equal(readFileSync(deskFile(f.paths, 'sessions'), 'utf8'), sessionsBefore);
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), claimsBefore);
});

test('the repair puts a session in Writing with no claim in Read only, and releases the claims of no Writing session', async (t) => {
  const f = await makeFixture(t);
  start(f, 'writer', 'reader', 'ended', 'bare');
  must(enterWriting(f.desk, f.manifest, { sessionId: 'writer', targets: [APP_MAIN] }));
  // Written past the lifecycle, as a claims file that was set aside or an older build leaves them.
  must(updateSession(f.desk, 'bare', { mode: 'writing' }));
  must(addClaims(f.desk, 'reader', [{ kind: 'lore' }]));
  must(addClaims(f.desk, 'ended', [{ kind: 'publish-area', name: 'publish' }]));
  must(endSessionRecordOnly(f.desk, 'ended'));
  must(addClaims(f.desk, 'nobody', [{ kind: 'repository', name: 'other', branch: 'main' }]));
  await assertRefused(f, 'bare', 'repos/app/a.ts', 'without having claimed');

  const repaired = must(repairSessionRecords(f.desk));
  assert.deepEqual(repaired.released.map((claim) => claim.sessionId).sort(), [
    'ended',
    'nobody',
    'reader',
  ]);
  assert.deepEqual(repaired.returnedToReadOnly, ['bare']);
  assert.deepEqual(holdersOnDisk(f), ['writer']);
  assert.equal(modeOnDisk(f, 'bare'), 'read-only');
  assert.equal(modeOnDisk(f, 'writer'), 'writing');
  await assertAllowed(f, 'writer', 'repos/app/src/a.ts');
  await assertRefused(f, 'bare', 'repos/app/a.ts', 'Read only');
});

test('the repair puts a session that ended and was left in Writing in Read only in the same pass that releases its claims', async (t) => {
  const f = await makeFixture(t);
  start(f, 'ended');
  // `updateSession` refuses this state, so it is written as another build or a hand would leave it.
  const at = '2026-09-18T09:00:00.000Z';
  writeFileSync(
    deskFile(f.paths, 'sessions'),
    JSON.stringify({
      version: 1,
      records: [
        {
          id: 'ended',
          engine: 'claude-code',
          attended: true,
          mode: 'writing',
          startedAt: at,
          closedAt: at,
        },
      ],
    }),
  );
  writeFileSync(
    deskFile(f.paths, 'claims'),
    JSON.stringify({
      version: 1,
      records: [{ sessionId: 'ended', target: APP_MAIN, claimedAt: at }],
    }),
  );
  await assertAllowed(f, 'ended', 'repos/app/a.ts');

  const repaired = must(repairSessionRecords(f.desk));
  assert.deepEqual(
    repaired.released.map((claim) => claim.sessionId),
    ['ended'],
  );
  assert.deepEqual(repaired.returnedToReadOnly, ['ended']);
  assert.deepEqual(holdersOnDisk(f), []);
  assert.equal(modeOnDisk(f, 'ended'), 'read-only');
  await assertRefused(f, 'ended', 'repos/app/a.ts', 'Read only');
});

/** `closedAt` without the release, as `closeSession` of the desk leaves a session. */
function endSessionRecordOnly(desk: Desk, sessionId: string) {
  return updateSession(desk, sessionId, { mode: 'read-only', closedAt: desk.now().toISOString() });
}

test('the repair leaves the claims of a session whose record this build does not understand', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  must(addClaims(f.desk, 'newer', [{ kind: 'lore' }]));
  const sessionsPath = deskFile(f.paths, 'sessions');
  const document = JSON.parse(readFileSync(sessionsPath, 'utf8')) as { records: unknown[] };
  document.records.push({ id: 'newer', engine: 'claude-code', attended: false, mode: 'blocked' });
  writeFileSync(sessionsPath, JSON.stringify(document));

  assert.deepEqual(must(repairSessionRecords(f.desk)), { released: [], returnedToReadOnly: [] });
  assert.deepEqual(holdersOnDisk(f), ['newer']);
  // The Lore stays held against this build's sessions.
  assert.equal(
    failure(enterWriting(f.desk, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }))
      .kind,
    'held',
  );
});

test('an instance that does not own the desk enters nothing', async (t) => {
  const f = await makeFixture(t);
  start(f, 'first');
  const second = must(
    openDesk(f.paths, {
      instance: { pid: process.pid + 1, startedAt: '2026-09-18T09:00:00.000Z' },
    }),
  );
  assert.equal(second.writable, false);
  const before = readFileSync(deskFile(f.paths, 'claims'), 'utf8');
  assert.equal(
    failure(enterWriting(second, f.manifest, { sessionId: 'first', targets: [{ kind: 'lore' }] }))
      .kind,
    'not-writable',
  );
  assert.equal(
    failure(startSession(second, { id: 'x', engine: 'claude-code' })).kind,
    'not-writable',
  );
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), before);
  assert.equal(must(listSessions(f.desk)).length, 1);
  // `addSession` of the desk is still what `startSession` goes through.
  assert.equal(
    failure(
      addSession(f.desk, {
        id: 'first',
        engine: 'claude-code',
        attended: true,
        mode: 'read-only',
        startedAt: '2026-09-18T09:00:00.000Z',
      }),
    ).kind,
    'duplicate',
  );
});

// ---------- each step in a process of its own, stopped with SIGKILL ----------

const DESK_MODULE = fileURLToPath(new URL('../../src/space/desk/index.js', import.meta.url));

/**
 * One step on the desk, in a new process that opens the desk itself. `how` says
 * what happens between the two writes: `crash` ends the process with SIGKILL,
 * `hold` waits there until the file `go` is in the flag folder.
 */
const STEP = `
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { endSession, enterWriting, leaveWriting, openDesk, repairSessionRecords } from ${JSON.stringify(DESK_MODULE)};
const [pathsText, manifestText, flags, op, sessionId, how] = process.argv.slice(1);
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
const waitFor = (name) => {
  const end = Date.now() + 20000;
  while (!existsSync(join(flags, name)) && Date.now() < end) pause();
};
if (how === 'together') waitFor('start');
const opened = openDesk(JSON.parse(pathsText));
if (!opened.ok) throw new Error(opened.error.message);
const desk = opened.value;
const betweenWrites = () => {
  if (how === 'crash') process.kill(process.pid, 'SIGKILL');
  if (how === 'hold') {
    writeFileSync(join(flags, 'holding'), '');
    waitFor('go');
  }
};
const target = { kind: 'repository', name: 'app', branch: 'main' };
const result =
  op === 'enter'
    ? enterWriting(desk, JSON.parse(manifestText), { sessionId, targets: [target] }, { betweenWrites })
    : op === 'leave'
      ? leaveWriting(desk, sessionId, { betweenWrites })
      : op === 'end'
        ? endSession(desk, sessionId, { betweenWrites })
        : repairSessionRecords(desk);
process.stdout.write(JSON.stringify({ writable: desk.writable, result }));
`;

type StepOutcome = {
  signal: NodeJS.Signals | null;
  writable?: boolean;
  result?:
    | {
        ok: true;
        value: { released?: Array<{ sessionId: string }>; returnedToReadOnly?: string[] };
      }
    | { ok: false; error: { kind: string; message: string } };
};

function flagsDir(f: Fixture): string {
  const dir = join(f.elsewhere, 'flags');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runStep(f: Fixture, op: string, sessionId: string, how = 'through'): Promise<StepOutcome> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        STEP,
        JSON.stringify(f.paths),
        JSON.stringify(f.manifest),
        flagsDir(f),
        op,
        sessionId,
        how,
      ],
      { env: { ...process.env, AI_LORE_TEST: '1' } },
    );
    let out = '';
    let problems = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      problems += chunk.toString('utf8');
    });
    child.on('close', (_code, signal) => {
      if (signal !== null) return resolve({ signal });
      assert.notEqual(out, '', `the step printed nothing: ${problems}`);
      const parsed = JSON.parse(out) as Omit<StepOutcome, 'signal'>;
      resolve({ signal, ...parsed });
    });
  });
}

function stepError(outcome: StepOutcome): { kind: string; message: string } {
  assert.ok(outcome.result !== undefined && !outcome.result.ok, JSON.stringify(outcome));
  return outcome.result.error;
}

function stepValue(outcome: StepOutcome): {
  released?: Array<{ sessionId: string }>;
  returnedToReadOnly?: string[];
} {
  assert.ok(outcome.result?.ok, JSON.stringify(outcome));
  return outcome.result.value;
}

async function untilFlag(f: Fixture, name: string): Promise<void> {
  const end = Date.now() + 20_000;
  while (!existsSync(join(flagsDir(f), name))) {
    assert.ok(Date.now() < end, `the flag ${name} did not appear`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** On the desk as it is on disk, every session in Writing holds a claim. */
function assertNoWritingWithoutClaim(f: Fixture): void {
  for (const record of records(f, 'sessions')) {
    if (record.mode === 'writing') {
      assert.ok(
        holdersOnDisk(f).includes(record.id),
        `${String(record.id)} is in Writing and holds nothing`,
      );
    }
  }
}

/** The fixture with its sessions started and the desk given up, so that a child process owns it. */
async function makeChildFixture(t: TestContext, ...ids: string[]): Promise<Fixture> {
  const f = await makeFixture(t);
  start(f, ...ids);
  must(closeDesk(f.desk));
  return f;
}

test('a process killed between the two writes of entering leaves Read only with the claim, and the next process repairs it', async (t) => {
  const f = await makeChildFixture(t, 'first', 'second');
  assert.equal((await runStep(f, 'enter', 'first', 'crash')).signal, 'SIGKILL');
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'repos/app/a.ts', 'Read only');
  await assertRefused(f, 'second', 'repos/app/a.ts', 'Read only');
  await assertAllowed(f, 'first', 'workbench/scratch/a.md');

  // The next request repairs first, so the claim of the step that was killed does not hold the target.
  stepValue(await runStep(f, 'enter', 'second'));
  assert.deepEqual(holdersOnDisk(f), ['second']);
  assert.equal(modeOnDisk(f, 'second'), 'writing');
  assertNoWritingWithoutClaim(f);
  await assertAllowed(f, 'second', 'repos/app/a.ts');
  await assertRefused(f, 'first', 'repos/app/a.ts', 'Read only');
});

for (const op of ['leave', 'end'] as const) {
  test(`a process killed between the two writes of ${op} leaves Read only with the claim, and the repair releases it`, async (t) => {
    const f = await makeChildFixture(t, 'first', 'second');
    stepValue(await runStep(f, 'enter', 'first'));
    await assertAllowed(f, 'first', 'repos/app/a.ts');
    assert.equal((await runStep(f, op, 'first', 'crash')).signal, 'SIGKILL');
    assert.equal(modeOnDisk(f, 'first'), 'read-only');
    assert.deepEqual(holdersOnDisk(f), ['first']);
    await assertRefused(f, 'first', 'repos/app/a.ts', 'Read only');

    const repaired = stepValue(await runStep(f, 'repair', '-'));
    assert.deepEqual(
      repaired.released?.map((claim) => claim.sessionId),
      ['first'],
    );
    assert.deepEqual(repaired.returnedToReadOnly, []);
    assert.deepEqual(holdersOnDisk(f), []);
    stepValue(await runStep(f, 'enter', 'second'));
    await assertAllowed(f, 'second', 'repos/app/a.ts');
  });
}

test('a repair and a second request from other processes, run between the two writes of entering, change nothing', async (t) => {
  const f = await makeChildFixture(t, 'first', 'second');
  const entering = runStep(f, 'enter', 'first', 'hold');
  await untilFlag(f, 'holding');
  // Between the two writes: the claim is recorded and the session is in Read only.
  assert.equal(modeOnDisk(f, 'first'), 'read-only');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertRefused(f, 'first', 'repos/app/a.ts', 'Read only');

  const repair = await runStep(f, 'repair', '-');
  assert.equal(repair.writable, false);
  assert.equal(stepError(repair).kind, 'not-writable');
  assert.equal(stepError(await runStep(f, 'enter', 'second')).kind, 'not-writable');
  assert.deepEqual(holdersOnDisk(f), ['first']);

  writeFileSync(join(flagsDir(f), 'go'), '');
  stepValue(await entering);
  assert.equal(modeOnDisk(f, 'first'), 'writing');
  assert.deepEqual(holdersOnDisk(f), ['first']);
  await assertAllowed(f, 'first', 'repos/app/a.ts');

  // The repair releases nothing of a session that is in Writing, and the second session is told who holds the repository.
  assert.deepEqual(stepValue(await runStep(f, 'repair', '-')), {
    released: [],
    returnedToReadOnly: [],
  });
  const held = stepError(await runStep(f, 'enter', 'second'));
  assert.equal(held.kind, 'held');
  assert.equal(
    held.message,
    'The repository "app" is held by the session "first" on the branch "main". One session holds a target at a time.',
  );
  assert.deepEqual(holdersOnDisk(f), ['first']);
  assertNoWritingWithoutClaim(f);
});

test('of two processes that enter Writing on one repository at the same moment, one is granted', async (t) => {
  for (let round = 0; round < 3; round += 1) {
    const f = await makeChildFixture(t, 'first', 'second');
    const both = [
      runStep(f, 'enter', 'first', 'together'),
      runStep(f, 'enter', 'second', 'together'),
    ];
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(join(flagsDir(f), 'start'), '');
    const outcomes = await Promise.all(both);
    const granted = outcomes.filter((outcome) => outcome.result?.ok === true);
    assert.equal(granted.length, 1, JSON.stringify(outcomes));
    const winner = granted[0] === outcomes[0] ? 'first' : 'second';
    const loser = winner === 'first' ? 'second' : 'first';
    const refusedOutcome = outcomes.find((outcome) => outcome.result?.ok !== true);
    assert.ok(refusedOutcome !== undefined);
    // The other process does not own the desk, or it opened the desk after the first had gone and is told who holds.
    const error = stepError(refusedOutcome);
    assert.ok(['not-writable', 'held'].includes(error.kind), error.message);
    if (error.kind === 'held') assert.ok(error.message.includes(`"${winner}"`), error.message);
    assert.deepEqual(holdersOnDisk(f), [winner]);
    assert.equal(modeOnDisk(f, loser), 'read-only');
    await assertAllowed(f, winner, 'repos/app/a.ts');
    await assertRefused(f, loser, 'repos/app/a.ts', 'Read only');
  }
});
