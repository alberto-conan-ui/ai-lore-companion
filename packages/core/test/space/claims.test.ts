/**
 * Unit tests of the claim rules (`src/space/claims`): every rule of section
 * 3.4 of the architecture document, with concrete inputs. Nothing here reads or
 * writes a file.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type ClaimState,
  type ClaimablePayloads,
  type RequestedTarget,
  type WritingRefusal,
  type WritingRefusalKind,
  branchNameProblem,
  decideLeaveWriting,
  decideWritingRequest,
  describeWriteTarget,
  listClaimableTargets,
  resolveRequestedTarget,
  sessionModeAfter,
  tryClaim,
} from '../../src/space/claims/index.js';
import { heldReason, refusal } from '../../src/space/claims/rules.js';
import type { Claim, SessionRecord, WriteTarget } from '../../src/space/desk/index.js';

const MANIFEST: ClaimablePayloads = {
  repositories: [
    { name: 'app', github: 'example-owner/app' },
    { name: 'other', github: 'example-owner/other' },
  ],
  publishAreas: [
    { name: 'publish', path: 'publish' },
    { name: 'handbook', path: null },
  ],
};

const session = (id: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  engine: 'claude-code',
  attended: true,
  mode: 'read-only',
  startedAt: '2026-09-18T09:00:00.000Z',
  ...extra,
});

const claim = (sessionId: string, target: WriteTarget): Claim => ({
  sessionId,
  target,
  claimedAt: '2026-09-18T09:30:00.000Z',
});

const APP_MAIN: WriteTarget = { kind: 'repository', name: 'app', branch: 'main' };

function state(extra: Partial<ClaimState> = {}): ClaimState {
  return {
    manifest: MANIFEST,
    sessions: [session('first'), session('second')],
    claims: [],
    ...extra,
  };
}

function ask(current: ClaimState, sessionId: string, targets: readonly RequestedTarget[]) {
  return decideWritingRequest(current, { sessionId, targets, reason: 'a test writes' });
}

function refused(
  result: { ok: true } | { ok: false; error: WritingRefusal },
  ...kinds: WritingRefusalKind[]
): WritingRefusal {
  assert.equal(result.ok, false, 'the request is refused');
  if (result.ok) throw new Error('unreachable');
  assert.deepEqual(
    result.error.reasons.map((reason) => reason.kind),
    kinds,
  );
  assert.equal(result.error.kind, kinds[0]);
  for (const reason of result.error.reasons) {
    assert.match(reason.message, /^[A-Z].*\.$/s, `a sentence: ${reason.message}`);
    assert.ok(!reason.message.includes('\n'), 'the sentence is on one line');
    assert.ok(result.error.message.includes(reason.message));
  }
  return result.error;
}

// ---------- what is granted ----------

test('a session in Read only is granted a free repository on a branch, and its mode becomes Writing', () => {
  const result = ask(state(), 'first', [{ kind: 'repository', name: 'app', branch: 'item-12' }]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      sessionId: 'first',
      targets: [{ kind: 'repository', name: 'app', branch: 'item-12' }],
      modeBefore: 'read-only',
      mode: 'writing',
    },
  });
});

test('the Lore and a publish area are targets, and a publish area outside the Space is one too', () => {
  const result = ask(state(), 'first', [
    { kind: 'lore' },
    { kind: 'publish-area', name: 'publish' },
    { kind: 'publish-area', name: 'handbook' },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.value.targets, [
    { kind: 'lore' },
    { kind: 'publish-area', name: 'publish' },
    { kind: 'publish-area', name: 'handbook' },
  ]);
});

test('what a request adds to a target beyond its kind, name and branch is not granted', () => {
  const result = ask(state(), 'first', [
    { kind: 'lore', name: 'ignored', branch: 'ignored' },
    { kind: 'publish-area', name: 'publish', branch: 'ignored' },
  ]);
  assert.ok(result.ok);
  assert.deepEqual(result.value.targets, [
    { kind: 'lore' },
    { kind: 'publish-area', name: 'publish' },
  ]);
});

test('a session in Writing may ask for more targets and keeps its mode', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' })],
    claims: [claim('first', APP_MAIN)],
  });
  const result = ask(current, 'first', [{ kind: 'publish-area', name: 'publish' }]);
  assert.ok(result.ok);
  assert.equal(result.value.modeBefore, 'writing');
  assert.equal(result.value.mode, 'writing');
  assert.deepEqual(result.value.targets, [{ kind: 'publish-area', name: 'publish' }]);
});

test('two sessions hold different targets at the same time', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' }), session('second')],
    claims: [claim('first', APP_MAIN)],
  });
  const result = ask(current, 'second', [
    { kind: 'repository', name: 'other', branch: 'main' },
    { kind: 'lore' },
  ]);
  assert.ok(result.ok);
});

// ---------- what is refused ----------

test('a second session is refused a held repository, on the same branch and on another', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' }), session('second')],
    claims: [claim('first', APP_MAIN)],
  });
  for (const branch of ['main', 'item-12']) {
    const error = refused(
      ask(current, 'second', [{ kind: 'repository', name: 'app', branch }]),
      'held',
    );
    assert.deepEqual(error.reasons[0]?.holder, claim('first', APP_MAIN));
    assert.equal(
      error.message,
      'The repository "app" is held by the session "first" on the branch "main". One session holds a target at a time.',
    );
  }
});

test('the Lore and a publish area have one holder each', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' }), session('second')],
    claims: [
      claim('first', { kind: 'lore' }),
      claim('first', { kind: 'publish-area', name: 'publish' }),
    ],
  });
  const error = refused(
    ask(current, 'second', [{ kind: 'lore' }, { kind: 'publish-area', name: 'publish' }]),
    'held',
    'held',
  );
  assert.match(error.message, /^The Lore is held by the session "first"\. /);
  assert.match(error.message, /The publish area "publish" is held by the session "first"\./);
});

test('a request is granted whole or not at all: one held target refuses the free ones beside it', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' }), session('second')],
    claims: [claim('first', { kind: 'lore' })],
  });
  const error = refused(
    ask(current, 'second', [
      { kind: 'repository', name: 'app', branch: 'main' },
      { kind: 'lore' },
      { kind: 'publish-area', name: 'publish' },
    ]),
    'held',
  );
  assert.deepEqual(error.reasons[0]?.target, { kind: 'lore' });
});

test('a target the session holds already is refused, and a repository says how the branch is changed', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' })],
    claims: [claim('first', APP_MAIN), claim('first', { kind: 'lore' })],
  });
  const repository = refused(
    ask(current, 'first', [{ kind: 'repository', name: 'app', branch: 'item-12' }]),
    'already-held',
  );
  assert.equal(
    repository.message,
    'The repository "app" is already held by this session on the branch "main". A request names only targets that the session does not hold. To change the branch, the session leaves Writing and asks again.',
  );
  const lore = refused(ask(current, 'first', [{ kind: 'lore' }]), 'already-held');
  assert.equal(
    lore.message,
    'The Lore is already held by this session. A request names only targets that the session does not hold.',
  );
});

test('an empty request is refused', () => {
  refused(ask(state(), 'first', []), 'empty-request');
  const notAList = { sessionId: 'first', targets: undefined } as unknown as Parameters<
    typeof decideWritingRequest
  >[1];
  refused(decideWritingRequest(state(), notAList), 'empty-request');
});

test('a session the desk has no record of is refused, and it is named', () => {
  const error = refused(ask(state(), 'stranger', [{ kind: 'lore' }]), 'session-unknown');
  assert.match(error.message, /"stranger"/);
  assert.equal(error.reasons[0]?.target, undefined);
});

test('a session that has ended is refused', () => {
  const current = state({
    sessions: [session('first', { closedAt: '2026-09-18T10:00:00.000Z' })],
  });
  const error = refused(ask(current, 'first', [{ kind: 'lore' }]), 'session-ended');
  assert.match(error.message, /"first" ended at 2026-09-18T10:00:00\.000Z/);
});

test('a target of a kind the rules do not know is refused, and so is the Workbench', () => {
  const error = refused(ask(state(), 'first', [{ kind: 'workbench' }]), 'unknown-target');
  assert.match(error.message, /"workbench" is none of them/);
  assert.match(error.message, /The Workbench is always writable/);
  const malformed = [null, 'lore', 7, ['lore'], {}] as unknown as RequestedTarget[];
  refused(
    ask(state(), 'first', malformed),
    'unknown-target',
    'unknown-target',
    'unknown-target',
    'unknown-target',
    'unknown-target',
  );
});

test('a repository or a publish area without a name is refused', () => {
  refused(ask(state(), 'first', [{ kind: 'repository', branch: 'main' }]), 'unknown-target');
  refused(ask(state(), 'first', [{ kind: 'publish-area', name: '' }]), 'unknown-target');
});

test('a target the manifest does not list is refused, and the sentence lists what it has', () => {
  const repository = refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'missing', branch: 'main' }]),
    'not-in-manifest',
  );
  assert.equal(
    repository.message,
    'The Space\'s manifest (lore/space.md) lists no repository named "missing". It lists: "app", "other".',
  );
  // A publish area is not a repository of the same name, and names are compared letter by letter.
  refused(ask(state(), 'first', [{ kind: 'publish-area', name: 'app' }]), 'not-in-manifest');
  refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'APP', branch: 'main' }]),
    'not-in-manifest',
  );
  const none = refused(
    ask(state({ manifest: { repositories: [], publishAreas: [] } }), 'first', [
      { kind: 'publish-area', name: 'publish' },
    ]),
    'not-in-manifest',
  );
  assert.match(none.message, /It lists none\.$/);
});

test('a repository without a branch is refused', () => {
  const error = refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'app' }]),
    'branch-missing',
  );
  assert.match(error.message, /"app" is asked for without a branch/);
  refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'app', branch: '' }]),
    'branch-missing',
  );
});

test('a repository on a branch name git does not accept is refused', () => {
  const error = refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'app', branch: 'item 12' }]),
    'branch-invalid',
  );
  assert.match(
    error.message,
    /"item 12", which is not a branch name that git accepts: it has a space/,
  );
  const control = refused(
    ask(state(), 'first', [{ kind: 'repository', name: 'app', branch: 'a\nb' }]),
    'branch-invalid',
  );
  assert.ok(control.message.includes('"a\\nb"'), 'a control character is written as an escape');
});

test('one target named twice in a request is refused, whatever the branch', () => {
  refused(
    ask(state(), 'first', [
      { kind: 'repository', name: 'app', branch: 'main' },
      { kind: 'repository', name: 'app', branch: 'item-12' },
    ]),
    'asked-twice',
  );
  refused(ask(state(), 'first', [{ kind: 'lore' }, { kind: 'lore' }]), 'asked-twice');
});

test('every problem of a request is a reason, in the order of the request', () => {
  const current = state({
    sessions: [session('first', { mode: 'writing' }), session('second')],
    claims: [claim('first', { kind: 'lore' })],
  });
  const error = refused(
    ask(current, 'second', [
      { kind: 'repository', name: 'app' },
      { kind: 'lore' },
      { kind: 'runtime', name: 'x' },
    ]),
    'branch-missing',
    'held',
    'unknown-target',
  );
  assert.equal(error.reasons.length, 3);
});

// ---------- tryClaim: the holding rules alone ----------

test('tryClaim grants free targets and refuses held ones, naming each holder', () => {
  const claims = [claim('first', APP_MAIN), claim('third', { kind: 'lore' })];
  assert.deepEqual(tryClaim(claims, 'second', [{ kind: 'publish-area', name: 'publish' }]), {
    ok: true,
    value: [{ kind: 'publish-area', name: 'publish' }],
  });
  const error = refused(
    tryClaim(claims, 'second', [
      { kind: 'repository', name: 'app', branch: 'item-12' },
      { kind: 'lore' },
    ]),
    'held',
    'held',
  );
  assert.deepEqual(
    error.reasons.map((reason) => reason.holder?.sessionId),
    ['first', 'third'],
  );
  refused(tryClaim(claims, 'first', [APP_MAIN]), 'already-held');
  refused(tryClaim(claims, 'second', []), 'empty-request');
  refused(tryClaim([], 'second', [{ kind: 'lore' }, { kind: 'lore' }]), 'asked-twice');
});

// ---------- leaving Writing, and the mode ----------

test('leaving Writing releases every claim of the session and no other, and the mode becomes Read only', () => {
  const claims = [
    claim('first', APP_MAIN),
    claim('second', { kind: 'lore' }),
    claim('first', { kind: 'publish-area', name: 'publish' }),
  ];
  const sessions = [session('first', { mode: 'writing' }), session('second', { mode: 'writing' })];
  const result = decideLeaveWriting({ sessions, claims }, 'first');
  assert.deepEqual(result, {
    ok: true,
    value: {
      sessionId: 'first',
      release: [claims[0], claims[2]],
      modeBefore: 'writing',
      mode: 'read-only',
    },
  });
});

test('a session in Read only, or one that ended, may leave again; an unknown session may not', () => {
  const sessions = [session('first'), session('gone', { closedAt: '2026-09-18T10:00:00.000Z' })];
  const claims = [claim('gone', { kind: 'lore' })];
  const first = decideLeaveWriting({ sessions, claims }, 'first');
  assert.ok(first.ok);
  assert.deepEqual(first.value.release, []);
  assert.equal(first.value.modeBefore, 'read-only');
  const gone = decideLeaveWriting({ sessions, claims }, 'gone');
  assert.ok(gone.ok);
  assert.deepEqual(gone.value.release, claims);
  refused(decideLeaveWriting({ sessions, claims }, 'stranger'), 'session-unknown');
});

test('the mode after each event: there are two modes and no Blocked', () => {
  assert.equal(sessionModeAfter('read-only', 'writing-granted'), 'writing');
  assert.equal(sessionModeAfter('writing', 'writing-granted'), 'writing');
  assert.equal(sessionModeAfter('writing', 'writing-left'), 'read-only');
  assert.equal(sessionModeAfter('read-only', 'writing-left'), 'read-only');
  assert.equal(sessionModeAfter('writing', 'session-ended'), 'read-only');
  assert.equal(sessionModeAfter('read-only', 'session-ended'), 'read-only');
});

// ---------- the rows of the dialog ----------

test('the dialog lists the Lore, each repository and each publish area with its holder', () => {
  const claims = [claim('first', APP_MAIN), claim('second', { kind: 'lore' })];
  assert.deepEqual(listClaimableTargets(MANIFEST, claims, 'second'), [
    { kind: 'lore', name: null, holder: claims[1], heldByThisSession: true },
    { kind: 'repository', name: 'app', holder: claims[0], heldByThisSession: false },
    { kind: 'repository', name: 'other', holder: null, heldByThisSession: false },
    { kind: 'publish-area', name: 'publish', holder: null, heldByThisSession: false },
    { kind: 'publish-area', name: 'handbook', holder: null, heldByThisSession: false },
  ]);
  // A publish area and a repository of one name are two targets.
  const twins: ClaimablePayloads = {
    repositories: [{ name: 'docs', github: 'example-owner/docs' }],
    publishAreas: [{ name: 'docs', path: 'docs' }],
  };
  const rows = listClaimableTargets(
    twins,
    [claim('first', { kind: 'publish-area', name: 'docs' })],
    'x',
  );
  assert.deepEqual(
    rows.map((row) => row.holder?.sessionId ?? null),
    [null, null, 'first'],
  );
});

// ---------- the smaller functions ----------

test('resolveRequestedTarget gives the write target or the reason', () => {
  assert.deepEqual(
    resolveRequestedTarget(MANIFEST, { kind: 'repository', name: 'app', branch: 'a/b' }),
    {
      ok: true,
      value: { kind: 'repository', name: 'app', branch: 'a/b' },
    },
  );
  const missing = resolveRequestedTarget(MANIFEST, { kind: 'publish-area', name: 'nowhere' });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.kind, 'not-in-manifest');
    assert.deepEqual(missing.error.target, { kind: 'publish-area', name: 'nowhere' });
  }
});

test('describeWriteTarget names a target as a sentence does', () => {
  assert.equal(describeWriteTarget({ kind: 'lore' }), 'the Lore');
  assert.equal(
    describeWriteTarget({ kind: 'publish-area', name: 'publish' }),
    'the publish area "publish"',
  );
  assert.equal(describeWriteTarget(APP_MAIN), 'the repository "app"');
});

test('branchNameProblem accepts the names git accepts and says why it refuses the others', () => {
  for (const name of [
    'main',
    'item-12',
    '12-add-the-header',
    'feature/a.b',
    'a@b',
    'ünï',
    'a.lockx',
  ]) {
    assert.equal(branchNameProblem(name), null, name);
  }
  const bad = [
    '',
    'HEAD',
    '@',
    '-x',
    '/a',
    'a/',
    'a.',
    'a..b',
    'a@{1}',
    'a b',
    'a~1',
    'a^',
    'a:b',
    'a?',
    'a*',
    'a[',
    'a\\b',
    'a\tb',
    'ab',
    'a//b',
    '.a',
    'a/.b',
    'a.lock',
    'a.lock/b',
  ];
  for (const name of bad) {
    assert.equal(typeof branchNameProblem(name), 'string', JSON.stringify(name));
  }
});

test('the helpers the lifecycle shares build a held refusal', () => {
  const holder = claim('first', APP_MAIN);
  const error = refusal([heldReason({ kind: 'repository', name: 'app', branch: 'x' }, holder)]);
  assert.equal(error.kind, 'held');
  assert.deepEqual(error.reasons[0]?.holder, holder);
  assert.match(error.message, /held by the session "first" on the branch "main"/);
});
