import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ATOMIC_TEMP_SUFFIX,
  DESK_FILES,
  DESK_OWNER_FILE,
  DESK_OWNER_VERSION,
  DESK_RECORD_VERSION,
  type Desk,
  type DeskFileName,
  type DeskInstance,
  type DeskPaths,
  type GateAnswerInput,
  type IssueRef,
  type SessionRecord,
  type WriteTarget,
  addClaims,
  addMark,
  addSession,
  addUnattendedTag,
  closeDesk,
  closeSession,
  confirmDeskOwnership,
  currentDeskInstance,
  deskFile,
  deskNotices,
  deskPaths,
  getFirstSeen,
  getSession,
  isClaim,
  isDeskOwner,
  isFirstSeen,
  isGateAnswer,
  isIssueRef,
  isProcessRunning,
  isReviewedMark,
  isSessionClose,
  isSessionRecord,
  isUnattendedTag,
  isWriteTarget,
  lastMark,
  listClaims,
  listFirstSeen,
  listGateAnswers,
  listMarks,
  listSessionCloses,
  listSessions,
  listUnattendedTags,
  openDesk,
  readDeskOwner,
  recordFirstSeen,
  recordGateAnswer,
  recordSessionClose,
  releaseClaim,
  releaseClaims,
  releaseDeskOwnership,
  removeUnattendedTag,
  sameWriteTarget,
  takeDeskOwnership,
  updateSession,
} from '../../src/index.js';
import * as api from '../../src/space/desk/index.js';
import { type CleanupHost, useTempDir } from '../support/temp.js';

const FIXED = '2026-09-18T10:11:12.345Z';
const FIXED_STAMP = '20260918T101112345Z';
const fixedNow = (): Date => new Date(FIXED);

/** The desk paths of a Space under a fresh temporary data folder. Nothing but temp folders is used. */
function tempPaths(t: CleanupHost): DeskPaths {
  const base = useTempDir(t, 'ai-lore-desk-');
  return deskPaths(join(base, 'user data'), join(base, 'space'));
}

function open(paths: DeskPaths, options: Parameters<typeof openDesk>[1] = {}): Desk {
  const opened = openDesk(paths, { now: fixedNow, ...options });
  assert.equal(opened.ok, true, opened.ok ? '' : opened.error.message);
  if (!opened.ok) throw new Error('unreachable');
  return opened.value;
}

function readJson(path: string): { version: unknown; records: unknown[]; [key: string]: unknown } {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeRaw(paths: DeskPaths, name: DeskFileName, text: string): string {
  mkdirSync(paths.desk, { recursive: true });
  const path = deskFile(paths, name);
  writeFileSync(path, text);
  return path;
}

/** The value of a successful result; fails the test otherwise. */
function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

/** The failure kind of a failed result; fails the test when it succeeded. */
function kindOf(result: { ok: true } | { ok: false; error: { kind: string } }): string {
  if (result.ok) assert.fail('expected a failure');
  return result.error.kind;
}

/** The id of a process that has ended. */
function endedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.ok(child.pid > 0);
  return child.pid;
}

const session = (id: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  engine: 'claude-code',
  attended: true,
  mode: 'read-only',
  startedAt: FIXED,
  ...extra,
});

const ISSUE: IssueRef = { repository: 'owner/space', number: 7, url: 'https://example.test/7' };
const LORE: WriteTarget = { kind: 'lore' };
const REPO: WriteTarget = { kind: 'repository', name: 'app', branch: 'feature/x' };
const AREA: WriteTarget = { kind: 'publish-area', name: 'publish' };

// ---------- opening, the format, the version field ----------

test('openDesk creates the desk folder, the owner file and the two files the write-guard reads', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  assert.equal(desk.writable, true);
  assert.deepEqual(desk.instance, currentDeskInstance());
  assert.deepEqual(deskNotices(desk), []);

  const owner = JSON.parse(readFileSync(join(paths.desk, DESK_OWNER_FILE), 'utf8'));
  assert.deepEqual(owner, {
    version: DESK_OWNER_VERSION,
    pid: process.pid,
    startedAt: currentDeskInstance().startedAt,
    openedAt: FIXED,
  });
  for (const name of ['sessions', 'claims'] as const) {
    assert.deepEqual(readJson(deskFile(paths, name)), { version: 1, records: [] });
  }
  if (process.platform !== 'win32') {
    assert.equal(statSync(paths.desk).mode & 0o777, 0o700);
    assert.equal(statSync(deskFile(paths, 'claims')).mode & 0o777, 0o600);
    assert.equal(statSync(join(paths.desk, DESK_OWNER_FILE)).mode & 0o777, 0o600);
  }
});

test('every desk file is { version, records } and the claims record has the shape the check script reads', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  must(addSession(desk, session('s1', { mode: 'writing', item: ISSUE })));
  must(addClaims(desk, 's1', [LORE, AREA, REPO]));
  must(
    recordGateAnswer(desk, {
      sessionId: 's1',
      process: 'work',
      step: 'review',
      question: 'Continue?',
      answer: 'yes',
    }),
  );
  must(addUnattendedTag(desk, ISSUE));
  must(addMark(desk, 'lore', 'abc123'));
  must(recordSessionClose(desk, { rootId: 'repo:app', commit: 'def456', sessionId: 's1' }));
  must(recordFirstSeen(desk, 'lore', '000aaa'));

  const written: DeskFileName[] = [
    'sessions',
    'claims',
    'gateAnswers',
    'unattendedTags',
    'reviewedMarks',
    'sessionCloses',
    'firstSeen',
  ];
  for (const name of written) {
    const doc = readJson(deskFile(paths, name));
    assert.deepEqual(Object.keys(doc).sort(), ['records', 'version'], DESK_FILES[name]);
    assert.equal(doc.version, DESK_RECORD_VERSION, DESK_FILES[name]);
    assert.equal(doc.records.length > 0, true, DESK_FILES[name]);
  }
  assert.deepEqual(readJson(deskFile(paths, 'claims')), {
    version: 1,
    records: [
      { sessionId: 's1', target: { kind: 'lore' }, claimedAt: FIXED },
      { sessionId: 's1', target: { kind: 'publish-area', name: 'publish' }, claimedAt: FIXED },
      {
        sessionId: 's1',
        target: { kind: 'repository', name: 'app', branch: 'feature/x' },
        claimedAt: FIXED,
      },
    ],
  });
  assert.deepEqual(readJson(deskFile(paths, 'sessions')).records, [
    {
      id: 's1',
      engine: 'claude-code',
      attended: true,
      mode: 'writing',
      startedAt: FIXED,
      item: ISSUE,
    },
  ]);
});

// ---------- atomic write under interruption ----------

test('a temporary file left by an interrupted write is ignored on read and removed on the next open', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  must(addMark(desk, 'lore', 'abc123'));

  // What a process leaves when it stops between the write and the rename.
  const leftovers = [
    join(paths.desk, `.${DESK_FILES.reviewedMarks}.4242-aabbccddeeff${ATOMIC_TEMP_SUFFIX}`),
    join(paths.desk, `.${DESK_FILES.gateAnswers}.4242-001122334455${ATOMIC_TEMP_SUFFIX}`),
  ];
  for (const leftover of leftovers) writeFileSync(leftover, '{"version":1,"records":[{"rootId":');

  assert.deepEqual(
    must(listMarks(desk)).map((mark) => mark.commit),
    ['abc123'],
  );
  // The record whose only trace is a temporary file is empty, and nothing is reported.
  assert.deepEqual(must(listGateAnswers(desk)), []);
  assert.deepEqual(deskNotices(desk), []);

  // A write beside the leftover succeeds and the file stays whole.
  must(addMark(desk, 'lore', 'def456'));
  assert.equal(readJson(deskFile(paths, 'reviewedMarks')).records.length, 2);

  must(closeDesk(desk));
  const again = open(paths);
  assert.deepEqual(
    readdirSync(paths.desk).filter((name) => name.endsWith(ATOMIC_TEMP_SUFFIX)),
    [],
  );
  assert.equal(must(listMarks(again)).length, 2);
});

test('a write leaves no temporary file behind', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  must(addSession(desk, session('s1')));
  must(addClaims(desk, 's1', [LORE]));
  assert.deepEqual(readdirSync(paths.desk).sort(), [
    DESK_FILES.claims,
    DESK_OWNER_FILE,
    DESK_FILES.sessions,
  ]);
});

// ---------- unknown fields ----------

test('unknown fields and records are kept across a read-modify-write', (t) => {
  const paths = tempPaths(t);
  const futureClaim = { holder: 'someone', scope: ['a', 'b'] };
  writeRaw(
    paths,
    'claims',
    JSON.stringify({
      version: 1,
      writtenBy: 'a newer build',
      records: [
        { sessionId: 's1', target: { kind: 'lore', note: 'kept' }, claimedAt: FIXED, reason: 'x' },
        futureClaim,
        { sessionId: 's2', target: { kind: 'publish-area', name: 'publish' }, claimedAt: FIXED },
      ],
    }),
  );
  writeRaw(
    paths,
    'sessions',
    JSON.stringify({
      version: 1,
      settings: { nested: true },
      records: [{ ...session('s1'), colour: 'blue', tags: [1, 2] }],
    }),
  );
  const desk = open(paths);

  assert.equal(must(listClaims(desk)).length, 2);
  const notices = deskNotices(desk);
  assert.equal(notices.length, 1);
  const notice = notices[0];
  assert.ok(notice && notice.kind === 'records-not-understood');
  assert.equal(notice.file, deskFile(paths, 'claims'));
  assert.equal(notice.count, 1);

  must(addClaims(desk, 's1', [REPO]));
  must(releaseClaims(desk, 's2'));
  assert.deepEqual(readJson(deskFile(paths, 'claims')), {
    writtenBy: 'a newer build',
    version: 1,
    records: [
      { sessionId: 's1', target: { kind: 'lore', note: 'kept' }, claimedAt: FIXED, reason: 'x' },
      futureClaim,
      { sessionId: 's1', target: REPO, claimedAt: FIXED },
    ],
  });

  must(updateSession(desk, 's1', { mode: 'writing', issue: ISSUE }));
  assert.deepEqual(readJson(deskFile(paths, 'sessions')), {
    settings: { nested: true },
    version: 1,
    records: [{ ...session('s1'), mode: 'writing', issue: ISSUE, colour: 'blue', tags: [1, 2] }],
  });
});

// ---------- corrupt files ----------

test('a corrupt file is set aside with a dated name and reported, and the record starts empty', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const garbage = '{"version":1,"records":[{"sessionId":"s1"';
  const path = writeRaw(paths, 'claims', garbage);

  assert.deepEqual(must(listClaims(desk)), []);
  const aside = `${path}.corrupt-${FIXED_STAMP}`;
  assert.equal(readFileSync(aside, 'utf8'), garbage);
  assert.deepEqual(readJson(path), { version: 1, records: [] });
  const notices = deskNotices(desk);
  assert.equal(notices.length, 1);
  const notice = notices[0];
  assert.ok(notice && notice.kind === 'corrupt-file');
  assert.equal(notice.file, path);
  assert.equal(notice.setAsideAs, aside);
  assert.equal(notice.at, FIXED);

  // The same moment again: the earlier set-aside file is not replaced.
  writeFileSync(path, 'again');
  assert.deepEqual(must(listClaims(desk)), []);
  assert.equal(readFileSync(aside, 'utf8'), garbage);
  assert.equal(readFileSync(`${aside}-1`, 'utf8'), 'again');
  assert.equal(deskNotices(desk).length, 2);
});

test('a file of the wrong format is corrupt, and a write after it starts from empty', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const cases = ['[]', '{"records":[]}', '{"version":"1","records":[]}', '{"version":1}', ''];
  for (const [index, text] of cases.entries()) {
    const path = writeRaw(paths, 'reviewedMarks', text);
    const mark = must(addMark(desk, 'lore', `commit${index}`));
    assert.deepEqual(readJson(path), { version: 1, records: [mark] }, JSON.stringify(text));
  }
  const setAside = readdirSync(paths.desk).filter((name) => name.includes('.corrupt-'));
  assert.equal(setAside.length, cases.length);
  assert.equal(deskNotices(desk).length, cases.length);
});

test('a file of a newer version is left as it is, and reading or writing it fails', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const text = JSON.stringify({ version: 2, records: [], layout: 'new' });
  const path = writeRaw(paths, 'reviewedMarks', text);
  assert.equal(kindOf(listMarks(desk)), 'newer-version');
  assert.equal(kindOf(addMark(desk, 'lore', 'abc')), 'newer-version');
  assert.equal(readFileSync(path, 'utf8'), text);
  assert.deepEqual(deskNotices(desk), []);

  // A newer sessions file does not stop the desk from opening.
  must(closeDesk(desk));
  writeRaw(paths, 'sessions', text);
  const again = open(paths);
  assert.equal(kindOf(listSessions(again)), 'newer-version');
});

test('a record file that cannot be read fails with read-failed and nothing throws', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  mkdirSync(deskFile(paths, 'gateAnswers'));
  assert.equal(kindOf(listGateAnswers(desk)), 'read-failed');
  const input: GateAnswerInput = {
    sessionId: 's1',
    process: 'work',
    step: 'review',
    question: 'Continue?',
    answer: 'no',
  };
  assert.equal(kindOf(recordGateAnswer(desk, input)), 'read-failed');
});

// ---------- the owner file ----------

test('a second owner is refused: it opens read-only and none of its writes reaches the desk', (t) => {
  const paths = tempPaths(t);
  const first = open(paths);
  must(addSession(first, session('s1')));

  const other: DeskInstance = { pid: process.pid + 1, startedAt: '2026-09-18T09:00:00.000Z' };
  const second = open(paths, { instance: other });
  assert.equal(second.writable, false);
  assert.equal(second.owner.pid, process.pid);
  assert.equal(must(readDeskOwner(paths.desk))?.pid, process.pid);

  assert.deepEqual(
    must(listSessions(second)).map((s) => s.id),
    ['s1'],
  );
  assert.equal(kindOf(addSession(second, session('s2'))), 'not-writable');
  assert.equal(kindOf(addClaims(second, 's1', [LORE])), 'not-writable');
  assert.equal(kindOf(addMark(second, 'lore', 'abc')), 'not-writable');
  assert.equal(kindOf(recordFirstSeen(second, 'lore', 'abc')), 'not-writable');

  // A corrupt file is reported by the second instance and left for the owner to set aside.
  const path = writeRaw(paths, 'claims', 'not json');
  assert.deepEqual(must(listClaims(second)), []);
  assert.equal(readFileSync(path, 'utf8'), 'not json');
  const notice = deskNotices(second)[0];
  assert.ok(notice && notice.kind === 'corrupt-file');
  assert.equal(notice.setAsideAs, null);

  // Closing the second instance leaves the first one's owner file.
  must(closeDesk(second));
  assert.equal(must(readDeskOwner(paths.desk))?.pid, process.pid);
  must(addSession(first, session('s3')));

  // The caller's own probe decides: one that finds the owner gone lets the instance take the desk.
  const third = open(paths, { instance: other, isOwnerRunning: () => false });
  assert.equal(third.writable, true);
  assert.equal(must(readDeskOwner(paths.desk))?.pid, other.pid);
  assert.equal(kindOf(addSession(first, session('s4'))), 'not-owner');
});

test('the default probe finds this process running and an ended process not running', () => {
  assert.equal(isProcessRunning(process.pid), true);
  assert.equal(isProcessRunning(endedPid()), false);
});

test('a stale owner whose process no longer exists is replaced, and its handle stops writing', (t) => {
  const paths = tempPaths(t);
  const gone: DeskInstance = { pid: endedPid(), startedAt: '2026-09-17T08:00:00.000Z' };
  const old = open(paths, { instance: gone });
  assert.equal(old.writable, true);
  must(addMark(old, 'lore', 'abc'));

  const desk = open(paths);
  assert.equal(desk.writable, true);
  assert.equal(desk.owner.pid, process.pid);
  const notice = deskNotices(desk)[0];
  assert.ok(notice && notice.kind === 'stale-owner-replaced');
  assert.equal(notice.previous.pid, gone.pid);
  assert.deepEqual(
    readdirSync(paths.desk).filter((name) => name.includes('.stale-')),
    [],
  );
  must(addMark(desk, 'lore', 'def'));

  assert.equal(kindOf(addMark(old, 'lore', 'ghi')), 'not-owner');
  assert.equal(kindOf(confirmDeskOwnership(paths.desk, gone)), 'not-owner');
  assert.equal(must(listMarks(desk)).length, 2);
});

test('an owner file with this process id and another start time is stale', (t) => {
  const paths = tempPaths(t);
  const earlier: DeskInstance = { pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z' };
  must(takeDeskOwnership(paths.desk, earlier, { now: fixedNow }));
  const taken = must(takeDeskOwnership(paths.desk, currentDeskInstance(), { now: fixedNow }));
  assert.equal(taken.owned, true);
  assert.equal(taken.notices[0]?.kind, 'stale-owner-replaced');
  assert.equal(must(readDeskOwner(paths.desk))?.startedAt, currentDeskInstance().startedAt);
});

test('the same instance opens its desk again, and closing removes only its own owner file', (t) => {
  const paths = tempPaths(t);
  const first = open(paths);
  const again = open(paths);
  assert.equal(again.writable, true);
  assert.deepEqual(again.owner, first.owner);
  assert.deepEqual(confirmDeskOwnership(paths.desk, currentDeskInstance()), {
    ok: true,
    value: undefined,
  });

  const other: DeskInstance = { pid: process.pid + 1, startedAt: FIXED };
  must(releaseDeskOwnership(paths.desk, other));
  assert.equal(existsSync(join(paths.desk, DESK_OWNER_FILE)), true);
  must(closeDesk(first));
  assert.equal(existsSync(join(paths.desk, DESK_OWNER_FILE)), false);
  assert.deepEqual(readDeskOwner(paths.desk), { ok: true, value: null });
  assert.equal(kindOf(addMark(first, 'lore', 'abc')), 'not-owner');
});

test('an owner file that cannot be parsed is set aside and replaced', (t) => {
  const paths = tempPaths(t);
  mkdirSync(paths.desk, { recursive: true });
  const path = join(paths.desk, DESK_OWNER_FILE);
  writeFileSync(path, '{"pid": "one"}');
  const desk = open(paths);
  assert.equal(desk.writable, true);
  assert.equal(readFileSync(`${path}.corrupt-${FIXED_STAMP}`, 'utf8'), '{"pid": "one"}');
  assert.equal(deskNotices(desk)[0]?.kind, 'corrupt-file');
  assert.equal(must(readDeskOwner(paths.desk))?.pid, process.pid);
});

test('a desk folder that cannot be created is a failure, not an exception', (t) => {
  const paths = tempPaths(t);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.desk, 'a file where the folder should be');
  assert.equal(kindOf(openDesk(paths)), 'write-failed');
  rmSync(paths.desk);
});

// ---------- appended records ----------

test('reviewed marks and gate answers are append-only through the API', (t) => {
  const names = Object.keys(api).filter((name) => /mark|gateanswer/i.test(name));
  assert.deepEqual(names.sort(), [
    'addMark',
    'isGateAnswer',
    'isReviewedMark',
    'lastMark',
    'listGateAnswers',
    'listMarks',
    'recordGateAnswer',
  ]);
  // The generic store, which can rewrite any file, is not part of the public API.
  for (const name of ['updateDeskRecords', 'appendDeskRecord', 'readDeskRecords']) {
    assert.equal(name in api, false, name);
  }

  const paths = tempPaths(t);
  let tick = 0;
  const desk = open(paths, { now: () => new Date(Date.parse(FIXED) + 1000 * tick++) });
  const first = must(addMark(desk, 'lore', 'aaa'));
  must(addMark(desk, 'repo:app', 'bbb'));
  const third = must(addMark(desk, 'lore', 'ccc'));
  // The same commit marked again is a new record; nothing earlier changes.
  must(addMark(desk, 'lore', 'ccc'));
  assert.deepEqual(
    must(listMarks(desk)).map((mark) => [mark.rootId, mark.commit]),
    [
      ['lore', 'aaa'],
      ['repo:app', 'bbb'],
      ['lore', 'ccc'],
      ['lore', 'ccc'],
    ],
  );
  assert.deepEqual(must(listMarks(desk, 'lore')).slice(0, 2), [first, third]);
  assert.equal(must(lastMark(desk, 'repo:app'))?.commit, 'bbb');
  assert.equal(must(lastMark(desk, 'publish:publish')), null);
  assert.equal(kindOf(addMark(desk, '', 'aaa')), 'invalid-record');
  assert.equal(kindOf(addMark(desk, 'lore', '')), 'invalid-record');
});

test('gate answers get an id and the time, and are listed per session', (t) => {
  const desk = open(tempPaths(t));
  const input: GateAnswerInput = {
    sessionId: 's1',
    process: 'work',
    step: 'review',
    question: 'Merge the pull request?',
    answer: 'take-over',
  };
  const a = must(recordGateAnswer(desk, input));
  const b = must(recordGateAnswer(desk, { ...input, sessionId: 's2', answer: 'no' }));
  assert.deepEqual(a, { id: a.id, ...input, answeredAt: FIXED });
  assert.notEqual(a.id, b.id);
  assert.deepEqual(must(listGateAnswers(desk)), [a, b]);
  assert.deepEqual(must(listGateAnswers(desk, 's2')), [b]);
  const bad = { ...input, answer: 'maybe' } as unknown as GateAnswerInput;
  assert.equal(kindOf(recordGateAnswer(desk, bad)), 'invalid-record');
  assert.equal(must(listGateAnswers(desk)).length, 2);
});

test('session closes are appended, and a root has one first-seen record', (t) => {
  const desk = open(tempPaths(t));
  const close = must(recordSessionClose(desk, { rootId: 'lore', commit: 'aaa', sessionId: 's1' }));
  must(recordSessionClose(desk, { rootId: 'repo:app', commit: 'bbb', sessionId: 's1' }));
  assert.deepEqual(close, { rootId: 'lore', commit: 'aaa', sessionId: 's1', at: FIXED });
  assert.deepEqual(must(listSessionCloses(desk, 'lore')), [close]);
  assert.equal(must(listSessionCloses(desk)).length, 2);
  const noSession = { rootId: 'lore', commit: 'aaa', sessionId: '' };
  assert.equal(kindOf(recordSessionClose(desk, noSession)), 'invalid-record');

  assert.equal(must(getFirstSeen(desk, 'lore')), null);
  const seen = must(recordFirstSeen(desk, 'lore', 'aaa'));
  assert.deepEqual(seen, { rootId: 'lore', commit: 'aaa', at: FIXED });
  assert.deepEqual(must(recordFirstSeen(desk, 'lore', 'zzz')), seen);
  must(recordFirstSeen(desk, 'repo:app', 'bbb'));
  assert.deepEqual(must(getFirstSeen(desk, 'lore')), seen);
  assert.equal(must(listFirstSeen(desk)).length, 2);
  assert.equal(kindOf(recordFirstSeen(desk, 'lore2', '')), 'invalid-record');
});

// ---------- sessions, claims, unattended tags ----------

test('sessions are added once, changed by patch and closed', (t) => {
  const desk = open(tempPaths(t));
  const added = must(addSession(desk, session('s1')));
  assert.deepEqual(added, session('s1'));
  assert.equal(kindOf(addSession(desk, session('s1', { mode: 'writing' }))), 'duplicate');
  must(addSession(desk, session('s2')));

  const writing = must(updateSession(desk, 's1', { mode: 'writing', issue: ISSUE }));
  assert.deepEqual(writing, session('s1', { mode: 'writing', issue: ISSUE }));
  assert.deepEqual(must(getSession(desk, 's1')), writing);
  assert.equal(must(getSession(desk, 'nobody')), null);
  assert.equal(kindOf(updateSession(desk, 'nobody', { mode: 'writing' })), 'not-found');

  const badMode = { mode: 'blocked' } as unknown as { mode: 'writing' };
  assert.equal(kindOf(updateSession(desk, 's1', badMode)), 'invalid-record');
  const otherId = { id: 's9' } as unknown as { mode: 'writing' };
  assert.equal(kindOf(updateSession(desk, 's1', otherId)), 'invalid-record');
  assert.deepEqual(must(getSession(desk, 's1')), writing);

  const closed = must(closeSession(desk, 's1'));
  assert.deepEqual(closed, { ...writing, mode: 'read-only', closedAt: FIXED });
  assert.deepEqual(
    must(listSessions(desk)).map((s) => [s.id, s.mode]),
    [
      ['s1', 'read-only'],
      ['s2', 'read-only'],
    ],
  );
});

test('values that are not records are refused with invalid-record and nothing throws', (t) => {
  const desk = open(tempPaths(t));
  const circular: { id: string; self?: unknown } = { id: 's1' };
  circular.self = circular;
  const bad: unknown[] = [
    null,
    42,
    'text',
    [],
    {},
    circular,
    { ...session('s1'), attended: false },
  ];
  for (const value of bad) {
    assert.equal(kindOf(addSession(desk, value as SessionRecord)), 'invalid-record');
  }
  assert.equal(
    kindOf(addUnattendedTag(desk, { number: 1n } as unknown as IssueRef)),
    'invalid-record',
  );
  assert.deepEqual(must(listSessions(desk)), []);
});

test('claims are added in one write, and released by session or by target', (t) => {
  const paths = tempPaths(t);
  const desk = open(paths);
  const added = must(addClaims(desk, 's1', [LORE, REPO]));
  assert.deepEqual(added, [
    { sessionId: 's1', target: LORE, claimedAt: FIXED },
    { sessionId: 's1', target: REPO, claimedAt: FIXED },
  ]);
  must(addClaims(desk, 's2', [AREA]));
  assert.deepEqual(must(addClaims(desk, 's2', [])), []);

  // One malformed target: nothing of the call is written.
  const noBranch = { kind: 'repository', name: 'app' } as unknown as WriteTarget;
  assert.equal(kindOf(addClaims(desk, 's3', [AREA, noBranch])), 'invalid-record');
  assert.equal(kindOf(addClaims(desk, '', [LORE])), 'invalid-record');
  assert.equal(must(listClaims(desk)).length, 3);

  // A repository is one target whatever the branch.
  const otherBranch: WriteTarget = { kind: 'repository', name: 'app', branch: 'main' };
  assert.deepEqual(must(releaseClaim(desk, 's2', otherBranch)), []);
  assert.deepEqual(must(releaseClaim(desk, 's1', otherBranch)), [added[1]]);
  assert.equal(kindOf(releaseClaim(desk, 's1', noBranch)), 'invalid-record');
  assert.deepEqual(must(releaseClaims(desk, 's1')), [added[0]]);
  assert.deepEqual(must(releaseClaims(desk, 's1')), []);
  assert.deepEqual(
    must(listClaims(desk)).map((claim) => claim.sessionId),
    ['s2'],
  );
});

test('sameWriteTarget compares the kind and the name, not the branch', () => {
  assert.equal(sameWriteTarget(LORE, { kind: 'lore' }), true);
  assert.equal(sameWriteTarget(LORE, AREA), false);
  assert.equal(sameWriteTarget(AREA, { kind: 'publish-area', name: 'publish' }), true);
  assert.equal(sameWriteTarget(AREA, { kind: 'publish-area', name: 'docs' }), false);
  assert.equal(sameWriteTarget(REPO, { kind: 'repository', name: 'app', branch: 'main' }), true);
  assert.equal(sameWriteTarget(REPO, { kind: 'publish-area', name: 'app' }), false);
});

test('unattended tags are added once and removed', (t) => {
  const desk = open(tempPaths(t));
  const tag = must(addUnattendedTag(desk, ISSUE));
  assert.deepEqual(tag, { item: ISSUE, taggedAt: FIXED });
  assert.equal(kindOf(addUnattendedTag(desk, ISSUE)), 'duplicate');
  must(addUnattendedTag(desk, { ...ISSUE, number: 8 }));
  assert.deepEqual(must(removeUnattendedTag(desk, { repository: 'owner/space', number: 7 })), [
    tag,
  ]);
  assert.deepEqual(must(removeUnattendedTag(desk, ISSUE)), []);
  assert.deepEqual(
    must(listUnattendedTags(desk)).map((entry) => entry.item.number),
    [8],
  );
});

// ---------- the guards ----------

test('the guards accept the record shapes with extra fields and refuse anything else', () => {
  const nonRecords: unknown[] = [undefined, null, 0, 'x', [], {}];
  const guards = [
    isIssueRef,
    isWriteTarget,
    isSessionRecord,
    isClaim,
    isGateAnswer,
    isUnattendedTag,
    isReviewedMark,
    isSessionClose,
    isFirstSeen,
    isDeskOwner,
  ];
  for (const guard of guards) {
    for (const value of nonRecords) assert.equal(guard(value), false, guard.name);
  }

  assert.equal(isIssueRef({ ...ISSUE, extra: 1 }), true);
  assert.equal(isIssueRef({ ...ISSUE, number: 1.5 }), false);
  assert.equal(isWriteTarget({ kind: 'lore', extra: 1 }), true);
  assert.equal(isWriteTarget({ kind: 'publish-area', name: '' }), false);
  assert.equal(isWriteTarget({ kind: 'repository', name: 'app', branch: '' }), false);
  assert.equal(isWriteTarget({ kind: 'workbench' }), false);
  assert.equal(isSessionRecord({ ...session('s1'), extra: 1 }), true);
  assert.equal(isSessionRecord({ ...session('s1'), startedAt: 'yesterday' }), false);
  assert.equal(isSessionRecord({ ...session('s1'), item: { number: 1 } }), false);
  assert.equal(isSessionRecord({ ...session('s1'), unguarded: ['--x'] }), true);
  assert.equal(isSessionRecord({ ...session('s1'), unguarded: [1] }), false);
  assert.equal(isClaim({ sessionId: 's1', target: REPO, claimedAt: FIXED }), true);
  assert.equal(
    isClaim({ sessionId: 's1', target: { kind: 'repository' }, claimedAt: FIXED }),
    false,
  );
  assert.equal(isUnattendedTag({ item: ISSUE, taggedAt: FIXED }), true);
  assert.equal(isReviewedMark({ rootId: 'lore', commit: 'abc', markedAt: FIXED }), true);
  assert.equal(isReviewedMark({ rootId: 'lore', commit: 'abc' }), false);
  assert.equal(isSessionClose({ rootId: 'lore', commit: 'abc', sessionId: 's1', at: FIXED }), true);
  assert.equal(isFirstSeen({ rootId: 'lore', commit: 'abc', at: FIXED }), true);
  assert.equal(isDeskOwner({ pid: 12, startedAt: FIXED, openedAt: FIXED }), true);
  assert.equal(isDeskOwner({ pid: -1, startedAt: FIXED, openedAt: FIXED }), false);
  assert.equal(
    isGateAnswer({
      id: 'g1',
      sessionId: 's1',
      process: 'work',
      step: 'review',
      question: '',
      answer: 'yes',
      answeredAt: FIXED,
    }),
    true,
  );
});
