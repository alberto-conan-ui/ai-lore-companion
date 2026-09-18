/**
 * The desk's records against real processes, real files and the real
 * `write-guard` check script. Everything is under the temporary folder.
 *
 * - Several processes open one desk at the same moment, with and without a
 *   stale owner file: one owns it, the others read.
 * - A process is killed between the temporary write and the rename.
 * - Files that are not what the store wrote: a symbolic link, a byte-order
 *   mark, text after the JSON, a file too large to be a record, a newer version.
 * - An owner file whose process id now belongs to another process.
 * - Sessions and claims written through this module, read by
 *   `packages/spec/lore-1.0/lore/contracts/core/write-guard.py`.
 */
import { strict as assert } from 'node:assert';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DESK_OWNER_FILE,
  DESK_RECORD_SIZE_LIMIT,
  type Desk,
  type DeskFileName,
  type DeskPaths,
  type SessionRecord,
  addClaims,
  addMark,
  addSession,
  closeDesk,
  currentDeskInstance,
  deskFile,
  deskNotices,
  deskPaths,
  isDeskOwnerRunning,
  listClaims,
  listGateAnswers,
  listMarks,
  listSessionCloses,
  listSessions,
  openDesk,
  readDeskOwner,
  releaseClaim,
  releaseClaims,
  updateSession,
} from '../../src/index.js';
import { readProcessStartedAt } from '../../src/space/exec/process-start.js';
import type { RunResult } from '../../src/space/exec/runner.js';
import { loreTemplateDir, runPython, useTempDir, useTempGitRepo } from '../support/index.js';

const DESK_MODULE = fileURLToPath(new URL('../../src/space/desk/index.js', import.meta.url));
const ATOMIC_MODULE = fileURLToPath(new URL('../../src/space/fs/atomic-write.js', import.meta.url));
const WRITE_GUARD = join(loreTemplateDir(), 'lore', 'contracts', 'core', 'write-guard.py');

function tempPaths(t: TestContext): DeskPaths {
  const base = useTempDir(t, 'ai-lore-desk-int-');
  return deskPaths(join(base, 'user data'), join(base, 'space'));
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

function kindOf(result: { ok: true } | { ok: false; error: { kind: string } }): string {
  if (result.ok) assert.fail('expected a failure');
  return result.error.kind;
}

function open(paths: DeskPaths): Desk {
  return must(openDesk(paths));
}

function writeRaw(paths: DeskPaths, name: DeskFileName, text: string | Buffer): string {
  mkdirSync(paths.desk, { recursive: true });
  const path = deskFile(paths, name);
  writeFileSync(path, text);
  return path;
}

function readRecords(path: string): unknown[] {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(typeof data === 'object' && data !== null && 'records' in data);
  assert.ok(Array.isArray(data.records));
  return data.records;
}

const session = (id: string, mode: SessionRecord['mode'] = 'read-only'): SessionRecord => ({
  id,
  engine: 'claude-code',
  attended: true,
  mode,
  startedAt: '2026-09-18T10:00:00.000Z',
});

/** Run `script` as an ES module in a new Node process and return what it printed. */
function runNode(script: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
      env: { ...process.env, AI_LORE_TEST: '1' },
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, out }));
  });
}

/** A process that does nothing until it is stopped. */
function startIdleProcess(t: TestContext): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  return child;
}

// ---------- several processes, one desk ----------

const RACER = `
import { addMark, openDesk } from ${JSON.stringify(DESK_MODULE)};
const [dir, startAt, marks] = process.argv.slice(1);
const paths = { dir, desk: dir + '/desk', install: dir + '/install', sessions: dir + '/sessions', ui: dir + '/ui' };
while (Date.now() < Number(startAt)) {}
const opened = openDesk(paths);
let written = 0;
const refusals = [];
if (opened.ok) {
  for (let n = 0; n < Number(marks); n += 1) {
    const mark = addMark(opened.value, 'lore', process.pid + '-' + n);
    if (mark.ok) written += 1; else refusals.push(mark.error.kind);
  }
}
process.stdout.write(JSON.stringify({
  pid: process.pid,
  opened: opened.ok ? null : opened.error.message,
  owned: opened.ok && opened.value.writable,
  written,
  refusals: [...new Set(refusals)],
}));
// The owner stays alive until every racer has looked at the owner file.
setTimeout(() => {}, 1000);
`;

type RacerReport = {
  pid: number;
  opened: string | null;
  owned: boolean;
  written: number;
  refusals: string[];
};

async function race(paths: DeskPaths, racers: number, marks: number): Promise<RacerReport[]> {
  const startAt = String(Date.now() + 500);
  const runs = await Promise.all(
    Array.from({ length: racers }, () => runNode(RACER, [paths.dir, startAt, String(marks)])),
  );
  return runs.map((run) => {
    assert.equal(run.code, 0, run.out);
    return JSON.parse(run.out) as RacerReport;
  });
}

function assertOneOwner(paths: DeskPaths, reports: RacerReport[], marks: number): void {
  assert.deepEqual(
    reports.filter((report) => report.opened !== null),
    [],
    'every process opens the desk, to write or to read',
  );
  const owners = reports.filter((report) => report.owned);
  assert.equal(owners.length, 1, `exactly one process owns the desk: ${JSON.stringify(reports)}`);
  for (const report of reports) {
    if (report.owned) {
      assert.equal(report.written, marks);
    } else {
      assert.equal(report.written, 0);
      assert.deepEqual(report.refusals, ['not-writable']);
    }
  }
  // Every record of the owner is there, and none of another process.
  const records = readRecords(deskFile(paths, 'reviewedMarks'));
  assert.equal(records.length, marks);
  const owner = owners[0];
  assert.ok(owner);
  for (const record of records) {
    assert.ok(typeof record === 'object' && record !== null && 'commit' in record);
    assert.ok(String(record.commit).startsWith(`${owner.pid}-`));
  }
  assert.deepEqual(
    readdirSync(paths.desk).filter((name) => name.includes('.corrupt-')),
    [],
  );
}

test('of several processes that open a new desk at the same moment, one owns it and the others read', async (t) => {
  for (let round = 0; round < 2; round += 1) {
    const paths = tempPaths(t);
    assertOneOwner(paths, await race(paths, 5, 20), 20);
  }
});

test('of several processes that find a stale owner file at the same moment, one replaces it', async (t) => {
  for (let round = 0; round < 2; round += 1) {
    const paths = tempPaths(t);
    mkdirSync(paths.desk, { recursive: true });
    const ended = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(
      join(paths.desk, DESK_OWNER_FILE),
      JSON.stringify({
        version: 1,
        pid: ended,
        startedAt: '2026-09-17T08:00:00.000Z',
        openedAt: '2026-09-17T08:00:01.000Z',
      }),
    );
    assertOneOwner(paths, await race(paths, 5, 20), 20);
    assert.equal(existsSync(join(paths.desk, `${DESK_OWNER_FILE}.takeover`)), false);
  }
});

test('a takeover file left by a process that ended does not keep the desk from being taken', (t) => {
  const paths = tempPaths(t);
  mkdirSync(paths.desk, { recursive: true });
  const ended = spawnSync(process.execPath, ['-e', '']).pid;
  const dead = JSON.stringify({
    version: 1,
    pid: ended,
    startedAt: '2026-09-17T08:00:00.000Z',
    openedAt: '2026-09-17T08:00:01.000Z',
  });
  writeFileSync(join(paths.desk, DESK_OWNER_FILE), dead);
  writeFileSync(join(paths.desk, `${DESK_OWNER_FILE}.takeover`), dead);
  const desk = open(paths);
  assert.equal(desk.writable, true);
  assert.equal(existsSync(join(paths.desk, `${DESK_OWNER_FILE}.takeover`)), false);
  assert.equal(deskNotices(desk)[0]?.kind, 'stale-owner-replaced');
});

test('a reader in another process never sees a part of a write', async (t) => {
  const paths = tempPaths(t);
  const READER = `
import { listMarks, openDesk, deskNotices } from ${JSON.stringify(DESK_MODULE)};
const [dir, until] = process.argv.slice(1);
const paths = { dir, desk: dir + '/desk', install: dir + '/install', sessions: dir + '/sessions', ui: dir + '/ui' };
const opened = openDesk(paths);
let reads = 0; let failures = 0; let last = 0; let shrank = 0;
while (Date.now() < Number(until)) {
  const marks = listMarks(opened.value);
  reads += 1;
  if (!marks.ok) { failures += 1; continue; }
  if (marks.value.length < last) shrank += 1;
  last = marks.value.length;
}
process.stdout.write(JSON.stringify({ writable: opened.value.writable, reads, failures, shrank, notices: deskNotices(opened.value).length }));
`;
  const desk = open(paths);
  const until = Date.now() + 1200;
  const reading = runNode(READER, [paths.dir, String(until)]);
  let written = 0;
  while (Date.now() < until) {
    must(addMark(desk, 'lore', `c${written}`));
    written += 1;
    if (written % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  const run = await reading;
  assert.equal(run.code, 0, run.out);
  const report = JSON.parse(run.out) as Record<string, number | boolean>;
  assert.equal(report.writable, false);
  assert.ok(Number(report.reads) > 0);
  assert.equal(report.failures, 0);
  assert.equal(report.shrank, 0);
  assert.equal(report.notices, 0);
  assert.equal(must(listMarks(desk)).length, written);
});

test('a process killed between the temporary write and the rename loses nothing', async (t) => {
  const paths = tempPaths(t);
  const first = open(paths);
  must(addMark(first, 'lore', 'kept'));
  must(closeDesk(first));
  const KILLED = `
import { writeFileSync } from 'node:fs';
import { atomicTempPathFor } from ${JSON.stringify(ATOMIC_MODULE)};
const temp = atomicTempPathFor(process.argv[1]);
writeFileSync(temp, '{"version": 1, "records": [{"rootId": "lore", "comm');
process.stdout.write(temp);
process.kill(process.pid, 'SIGKILL');
`;
  const path = deskFile(paths, 'reviewedMarks');
  const run = await runNode(KILLED, [path]);
  assert.notEqual(run.code, 0);
  assert.equal(existsSync(run.out), true, 'the killed process left its temporary file');

  const desk = open(paths);
  assert.equal(existsSync(run.out), false, 'opening the desk removes it');
  assert.deepEqual(
    must(listMarks(desk)).map((mark) => mark.commit),
    ['kept'],
  );
  assert.deepEqual(deskNotices(desk), []);
});

// ---------- files that are not what the store wrote ----------

test('a symbolic link where a record should be is set aside, and what it points to is not touched', (t) => {
  const paths = tempPaths(t);
  const elsewhere = join(paths.dir, 'elsewhere.json');
  mkdirSync(paths.desk, { recursive: true });
  const foreign = JSON.stringify({
    version: 1,
    records: [
      { sessionId: 'intruder', target: { kind: 'lore' }, claimedAt: '2026-09-18T10:00:00Z' },
    ],
  });
  writeFileSync(elsewhere, foreign);
  symlinkSync(elsewhere, deskFile(paths, 'claims'));

  const desk = open(paths);
  assert.deepEqual(must(listClaims(desk)), [], 'the claims of the other file are not read');
  must(addClaims(desk, 's1', [{ kind: 'lore' }]));
  assert.equal(readFileSync(elsewhere, 'utf8'), foreign);
  assert.equal(lstatSync(deskFile(paths, 'claims')).isFile(), true);
  const aside = readdirSync(paths.desk).filter((name) => name.startsWith('claims.json.corrupt-'));
  assert.equal(aside.length, 1);
  assert.equal(lstatSync(join(paths.desk, aside[0] ?? '')).isSymbolicLink(), true);
  assert.equal(deskNotices(desk)[0]?.kind, 'corrupt-file');
});

test('a desk folder that is a symbolic link is used where it points, with the modes of the desk', (t) => {
  const paths = tempPaths(t);
  const real = join(paths.dir, 'real desk');
  mkdirSync(real, { recursive: true, mode: 0o755 });
  chmodSync(real, 0o755);
  symlinkSync(real, paths.desk);
  const desk = open(paths);
  must(addMark(desk, 'lore', 'abc'));
  assert.equal(lstatSync(paths.desk).isSymbolicLink(), true);
  assert.equal(statSync(join(real, 'reviewed-marks.json')).mode & 0o777, 0o600);
  assert.equal(
    statSync(real).mode & 0o777,
    0o755,
    'a folder behind a link is not the desk’s to change',
  );
});

test('the desk folder and every file in it are for the account only, also when they were more open', (t) => {
  const paths = tempPaths(t);
  mkdirSync(paths.desk, { recursive: true, mode: 0o755 });
  chmodSync(paths.desk, 0o755);
  const loose = writeRaw(paths, 'reviewedMarks', '{"version": 1, "records": []}');
  chmodSync(loose, 0o644);
  const previousMask = process.umask(0);
  t.after(() => process.umask(previousMask));
  const desk = open(paths);
  must(addMark(desk, 'lore', 'abc'));
  must(addSession(desk, session('s1')));
  writeRaw(paths, 'gateAnswers', 'not json');
  chmodSync(deskFile(paths, 'gateAnswers'), 0o644);
  assert.deepEqual(must(listGateAnswers(desk)), []);
  assert.equal(statSync(paths.desk).mode & 0o777, 0o700);
  for (const name of readdirSync(paths.desk)) {
    if (name.startsWith('gate-answers.json.corrupt-')) continue; // kept as it was found
    assert.equal(statSync(join(paths.desk, name)).mode & 0o777, 0o600, name);
  }
});

test('a byte-order mark is read; text after the JSON sets the file aside and keeps it', (t) => {
  const paths = tempPaths(t);
  const mark = { rootId: 'lore', commit: 'abc', markedAt: '2026-09-18T10:00:00.000Z', by: 'x' };
  const text = JSON.stringify({ version: 1, records: [mark] });
  writeRaw(paths, 'reviewedMarks', `﻿${text}`);
  const garbage = writeRaw(paths, 'sessionCloses', `${text}\n}}garbage`);
  const desk = open(paths);

  assert.deepEqual(must(listMarks(desk)), [mark]);
  must(addMark(desk, 'lore', 'def'));
  const written = readFileSync(deskFile(paths, 'reviewedMarks'), 'utf8');
  assert.equal(written.startsWith('﻿'), false);
  assert.deepEqual(readRecords(deskFile(paths, 'reviewedMarks'))[0], mark);

  // Reading it sets it aside; the text is kept byte for byte.
  const before = readFileSync(garbage, 'utf8');
  assert.deepEqual(must(listSessionCloses(desk)), []);
  const aside = readdirSync(paths.desk).find((name) =>
    name.startsWith('session-closes.json.corrupt-'),
  );
  assert.ok(aside);
  assert.equal(readFileSync(join(paths.desk, aside), 'utf8'), before);
});

test('a file too large to be a record, and a file of a newer version, are left as they are', (t) => {
  const paths = tempPaths(t);
  const filler = 'x'.repeat(1024);
  const records = Array.from({ length: 50 * 1024 }, (_, n) => ({
    rootId: 'lore',
    commit: `c${n}`,
    markedAt: '2026-09-18T10:00:00.000Z',
    filler,
  }));
  const big = writeRaw(paths, 'reviewedMarks', JSON.stringify({ version: 1, records }));
  assert.ok(statSync(big).size > 50 * 1024 * 1024);
  assert.ok(statSync(big).size > DESK_RECORD_SIZE_LIMIT);
  // A newer build may have changed the rest of the format, so only the version is looked at.
  const newerText = '{"version": 2, "records": {"by-id": {}}}';
  const newer = writeRaw(paths, 'claims', newerText);

  const desk = open(paths);
  assert.equal(kindOf(listMarks(desk)), 'read-failed');
  assert.equal(kindOf(addMark(desk, 'lore', 'abc')), 'read-failed');
  assert.ok(statSync(big).size > 50 * 1024 * 1024);
  assert.equal(kindOf(listClaims(desk)), 'newer-version');
  assert.equal(kindOf(addClaims(desk, 's1', [{ kind: 'lore' }])), 'newer-version');
  assert.equal(kindOf(releaseClaims(desk, 's1')), 'newer-version');
  assert.equal(readFileSync(newer, 'utf8'), newerText);
  assert.deepEqual(
    readdirSync(paths.desk).filter((name) => name.includes('.corrupt-')),
    [],
  );
});

test('an owner file of a newer version that this build cannot read is left, and the desk does not open', (t) => {
  const paths = tempPaths(t);
  mkdirSync(paths.desk, { recursive: true });
  const text = '{"version": 2, "instance": {"id": "abc"}}';
  writeFileSync(join(paths.desk, DESK_OWNER_FILE), text);
  assert.equal(kindOf(openDesk(paths)), 'newer-version');
  assert.equal(readFileSync(join(paths.desk, DESK_OWNER_FILE), 'utf8'), text);
});

test('unknown fields at any depth, records that are not understood and a repeated id come through a write', (t) => {
  const paths = tempPaths(t);
  const deep = {
    id: 's1',
    engine: 'claude-code',
    attended: true,
    mode: 'read-only',
    startedAt: '2026-09-18T10:00:00.000Z',
    item: {
      repository: 'o/s',
      number: 1,
      url: 'u',
      labels: [{ name: 'x', colour: { rgb: [1, 2] } }],
    },
    later: { a: { b: { c: [null, true, 1.5, 'text', { d: {} }] } } },
  };
  const twin = { ...deep, engine: 'other' };
  const stranger = { kind: 'something newer', nested: { list: [[1], [2, [3]]] } };
  writeRaw(
    paths,
    'sessions',
    JSON.stringify({
      version: 1,
      records: [deep, stranger, 7, 'text', null, twin],
      top: { k: [1] },
    }),
  );
  const desk = open(paths);
  assert.equal(must(listSessions(desk)).length, 2, 'both entries with the id are listed');
  must(updateSession(desk, 's1', { mode: 'writing', closedAt: undefined }));
  must(addSession(desk, session('s2')));

  const data: unknown = JSON.parse(readFileSync(deskFile(paths, 'sessions'), 'utf8'));
  assert.deepEqual(data, {
    top: { k: [1] },
    version: 1,
    records: [{ ...deep, mode: 'writing' }, stranger, 7, 'text', null, twin, session('s2')],
  });
  // A session that has ended stays ended, and is never left in Writing.
  must(updateSession(desk, 's2', { closedAt: '2026-09-18T11:00:00.000Z' }));
  must(updateSession(desk, 's2', { closedAt: undefined }));
  assert.equal(must(listSessions(desk)).at(-1)?.closedAt, '2026-09-18T11:00:00.000Z');
  assert.equal(kindOf(updateSession(desk, 's2', { mode: 'writing' })), 'invalid-record');
});

// ---------- the owner file and a process id that was given out again ----------

test('the start time of a process comes from the operating system and does not follow the clock', (t) => {
  const child = startIdleProcess(t);
  assert.ok(child.pid);
  const instance = currentDeskInstance();
  if (process.platform !== 'darwin') {
    assert.equal(readProcessStartedAt(child.pid), null);
    return;
  }
  const first = readProcessStartedAt(child.pid);
  assert.ok(first !== null && !Number.isNaN(Date.parse(first)));
  assert.ok(Math.abs(Date.parse(first) - Date.now()) < 60_000);
  assert.equal(instance.startedAt, readProcessStartedAt(process.pid));
  // What `Date.now()` says plays no part: the same answer under a clock moved by a day.
  const realNow = Date.now;
  Date.now = () => realNow() + 86_400_000;
  t.after(() => {
    Date.now = realNow;
  });
  assert.equal(readProcessStartedAt(child.pid), first);
  assert.deepEqual(currentDeskInstance(), instance);
  Date.now = realNow;
  assert.equal(readProcessStartedAt(spawnSync(process.execPath, ['-e', '']).pid), null);
});

test('a live owner is never replaced; an owner whose process id now names another process is', (t) => {
  const child = startIdleProcess(t);
  assert.ok(child.pid);
  const startedAt = readProcessStartedAt(child.pid) ?? new Date(Date.now() - 1000).toISOString();
  const live = { pid: child.pid, startedAt, openedAt: new Date().toISOString() };
  assert.equal(isDeskOwnerRunning(live), true);

  const paths = tempPaths(t);
  mkdirSync(paths.desk, { recursive: true });
  const ownerPath = join(paths.desk, DESK_OWNER_FILE);
  writeFileSync(ownerPath, JSON.stringify({ version: 1, ...live }));
  const text = readFileSync(ownerPath, 'utf8');

  // A second instance may read, and nothing it does reaches the desk or the owner file.
  const second = open(paths);
  assert.equal(second.writable, false);
  assert.equal(second.owner.pid, child.pid);
  assert.deepEqual(must(listSessions(second)), []);
  assert.deepEqual(must(listMarks(second)), []);
  assert.equal(kindOf(addSession(second, session('s1'))), 'not-writable');
  assert.equal(kindOf(addMark(second, 'lore', 'abc')), 'not-writable');
  must(closeDesk(second));
  assert.equal(readFileSync(ownerPath, 'utf8'), text);
  assert.deepEqual(
    readdirSync(paths.desk).filter((name) => name !== DESK_OWNER_FILE),
    [],
  );

  if (process.platform !== 'darwin') return;
  // The same process id with the start time of an earlier process: the owner ended, the id was reused.
  const reused = { ...live, startedAt: new Date(Date.parse(startedAt) - 3_600_000).toISOString() };
  assert.equal(isDeskOwnerRunning(reused), false);
  writeFileSync(ownerPath, JSON.stringify({ version: 1, ...reused }));
  const third = open(paths);
  assert.equal(third.writable, true);
  assert.equal(must(readDeskOwner(paths.desk))?.pid, process.pid);
  assert.equal(deskNotices(third)[0]?.kind, 'stale-owner-replaced');
});

test('a handle that lost the desk does not move a file aside when it reads', (t) => {
  const paths = tempPaths(t);
  const first = must(
    openDesk(paths, { instance: { pid: process.pid + 1, startedAt: '2026-09-18T09:00:00.000Z' } }),
  );
  const second = must(openDesk(paths, { isOwnerRunning: () => false }));
  assert.equal(second.writable, true);
  const path = writeRaw(paths, 'gateAnswers', 'not json');
  assert.equal(kindOf(addMark(first, 'lore', 'abc')), 'not-owner');
  assert.deepEqual(must(listGateAnswers(first)), []);
  assert.equal(readFileSync(path, 'utf8'), 'not json');
});

// ---------- one claim per target ----------

test('a target has one holder: a second claim is refused and names the holder', (t) => {
  const desk = open(tempPaths(t));
  const onMain = { kind: 'repository', name: 'app', branch: 'main' } as const;
  const onItem = { kind: 'repository', name: 'app', branch: 'item-12' } as const;
  must(
    addClaims(desk, 's1', [{ kind: 'lore' }, onMain, { kind: 'publish-area', name: 'publish' }]),
  );
  const before = readFileSync(deskFile(desk.paths, 'claims'), 'utf8');

  for (const target of [{ kind: 'lore' } as const, onMain, onItem]) {
    const refused = addClaims(desk, 's2', [
      { kind: 'repository', name: 'other', branch: 'main' },
      target,
    ]);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.error.kind, 'held');
    assert.match(refused.error.message, /held by the session "s1"/);
    if (refused.error.kind === 'held') {
      assert.deepEqual(
        refused.error.held.map((claim) => claim.sessionId),
        ['s1'],
      );
    }
  }
  const both = addClaims(desk, 's2', [{ kind: 'lore' }, { kind: 'publish-area', name: 'publish' }]);
  assert.ok(!both.ok && both.error.kind === 'held' && both.error.held.length === 2);
  assert.match(
    both.ok ? '' : both.error.message,
    /the Lore is held.*the publish area "publish" is held/,
  );

  // The holder itself does not claim twice, on the same branch or on another; nothing was written.
  assert.equal(kindOf(addClaims(desk, 's1', [onMain])), 'duplicate');
  assert.equal(kindOf(addClaims(desk, 's1', [onItem])), 'duplicate');
  assert.equal(kindOf(addClaims(desk, 's3', [onMain, onItem])), 'invalid-record');
  assert.equal(readFileSync(deskFile(desk.paths, 'claims'), 'utf8'), before);

  // To change the branch the holder releases first; once released, another session takes the target.
  must(releaseClaim(desk, 's1', onMain));
  must(addClaims(desk, 's2', [onItem]));
  assert.equal(kindOf(addClaims(desk, 's1', [onMain])), 'held');
  assert.deepEqual(
    must(listClaims(desk)).map((claim) => `${claim.sessionId}:${claim.target.kind}`),
    ['s1:lore', 's1:publish-area', 's2:repository'],
  );
});

// ---------- the claims record and the write-guard agree ----------

type GuardFixture = { space: string; paths: DeskPaths; elsewhere: string };

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
  '---',
  '',
  '# The manifest',
  '',
].join('\n');

async function makeGuardFixture(t: TestContext): Promise<GuardFixture> {
  const root = useTempDir(t, 'ai-lore-desk-guard-');
  const space = join(root, 'space');
  const elsewhere = join(root, 'elsewhere');
  for (const folder of ['lore/corpus', 'publish', 'repos', 'workbench/scratch']) {
    mkdirSync(join(space, folder), { recursive: true });
  }
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(space, 'lore', 'space.md'), MANIFEST);
  await useTempGitRepo(t, { dir: join(space, 'repos', 'app') });
  await useTempGitRepo(t, { dir: join(space, 'repos', 'other') });
  // A data folder with a space in its path, as on macOS.
  return { space, paths: deskPaths(join(root, 'user data'), space), elsewhere };
}

/** Run the check script with the command line its own header states. */
function guard(f: GuardFixture, sessionId: string, relativePath: string): Promise<RunResult> {
  return runPython(
    WRITE_GUARD,
    [
      '--space',
      f.space,
      '--desk',
      f.paths.desk,
      '--session',
      sessionId,
      '--path',
      join(f.space, relativePath),
    ],
    { cwd: f.elsewhere },
  );
}

async function assertAllowed(f: GuardFixture, sessionId: string, path: string): Promise<void> {
  const result = await guard(f, sessionId, path);
  assert.equal(result.code, 0, `${sessionId} → ${path}: ${result.stderr}`);
}

async function assertRefused(
  f: GuardFixture,
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

test('the write-guard check script reads the sessions and claims this module writes', async (t) => {
  assert.match(
    readFileSync(WRITE_GUARD, 'utf8'),
    /--space <Space folder> --desk <desk folder>\s+--session <session id> --path <file to be written>/,
    'the command line in the header of the script is the one this test uses',
  );
  const f = await makeGuardFixture(t);
  const desk = open(f.paths);

  // A desk that was only opened: both files are there and empty, and every session is in Read only.
  await assertRefused(f, 'reader', 'lore/corpus/a.md', 'no record of the session');
  await assertAllowed(f, 'reader', 'workbench/scratch/a.md');

  must(addSession(desk, session('reader')));
  must(addSession(desk, session('writer')));
  must(addSession(desk, session('other')));

  // Read only.
  await assertRefused(f, 'reader', 'lore/corpus/a.md', 'Read only');
  await assertRefused(f, 'reader', 'repos/app/a.ts', 'Read only');
  await assertRefused(f, 'reader', 'publish/a.md', 'Read only');
  await assertAllowed(f, 'reader', 'workbench/scratch/a.md');

  // Writing, with a repository claimed on the branch that is checked out.
  must(updateSession(desk, 'writer', { mode: 'writing' }));
  must(addClaims(desk, 'writer', [{ kind: 'repository', name: 'app', branch: 'main' }]));
  await assertAllowed(f, 'writer', 'repos/app/src/a.ts');
  await assertRefused(f, 'writer', 'repos/other/a.ts', 'without having claimed');
  await assertRefused(f, 'writer', 'lore/corpus/a.md', 'without having claimed');
  await assertRefused(f, 'writer', 'publish/a.md', 'without having claimed');
  await assertRefused(f, 'reader', 'repos/app/src/a.ts', 'Read only');

  // A claim without the mode does not let a session write, and the desk refuses the second claim anyway.
  assert.equal(
    kindOf(addClaims(desk, 'other', [{ kind: 'repository', name: 'app', branch: 'main' }])),
    'held',
  );
  must(addClaims(desk, 'other', [{ kind: 'lore' }]));
  await assertRefused(f, 'other', 'lore/corpus/a.md', 'Read only');
  must(updateSession(desk, 'other', { mode: 'writing' }));
  await assertAllowed(f, 'other', 'lore/corpus/a.md');
  await assertRefused(f, 'other', 'repos/app/src/a.ts', 'without having claimed');

  // The repository on another branch than the claimed one.
  must(releaseClaim(desk, 'writer', { kind: 'repository', name: 'app', branch: 'main' }));
  await assertRefused(f, 'writer', 'repos/app/src/a.ts', 'without having claimed');
  must(addClaims(desk, 'writer', [{ kind: 'repository', name: 'app', branch: 'item-12' }]));
  await assertRefused(f, 'writer', 'repos/app/src/a.ts', '"item-12"', '"main"');

  // Leaving Writing, and a session that ended.
  must(releaseClaims(desk, 'other'));
  must(updateSession(desk, 'other', { mode: 'read-only' }));
  await assertRefused(f, 'other', 'lore/corpus/a.md', 'Read only');

  // A second instance that reads the desk changes nothing of what the script sees.
  const before = readFileSync(deskFile(f.paths, 'claims'), 'utf8');
  const second = must(
    openDesk(f.paths, {
      instance: { pid: process.pid + 1, startedAt: '2026-09-18T09:00:00.000Z' },
    }),
  );
  assert.equal(second.writable, false);
  assert.equal(kindOf(addClaims(second, 'reader', [{ kind: 'lore' }])), 'not-writable');
  assert.equal(readFileSync(deskFile(f.paths, 'claims'), 'utf8'), before);
});

test('after a record file was set aside the check script sees an empty record, not a missing one', async (t) => {
  const f = await makeGuardFixture(t);
  const desk = open(f.paths);
  must(addSession(desk, session('writer', 'writing')));
  must(addClaims(desk, 'writer', [{ kind: 'lore' }]));
  await assertAllowed(f, 'writer', 'lore/corpus/a.md');

  writeFileSync(deskFile(f.paths, 'claims'), '{"version": 1, "records": [');
  await assertRefused(f, 'writer', 'lore/corpus/a.md', 'is not JSON');
  assert.deepEqual(must(listClaims(desk)), []);
  await assertRefused(f, 'writer', 'lore/corpus/a.md', 'without having claimed');
  assert.deepEqual(readRecords(deskFile(f.paths, 'claims')), []);
});
