import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type BaselinePoint,
  type CommitPoint,
  assignSessions,
  groupBaselinePoints,
  orderBaselinePoints,
} from '../../src/index.js';

function commit(sha: string, at: string, sessionId?: string): CommitPoint {
  return {
    kind: 'commit',
    commit: sha,
    at,
    subject: `subject of ${sha}`,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

test('the four kinds are ordered newest first, and at the same time a reference point stands above the commit', () => {
  const at = '2026-02-01T10:00:00.000Z';
  const points: BaselinePoint[] = [
    commit('c-old', '2026-01-01T10:00:00.000Z'),
    commit('c-same', at),
    { kind: 'session-close', commit: 'c-same', at, sessionId: 's1' },
    { kind: 'merged-pull-request', commit: 'c-same', at, number: 4, title: 'Four' },
    { kind: 'reviewed-mark', commit: 'c-same', at },
    commit('c-new', '2026-03-01T10:00:00.000Z'),
    { kind: 'reviewed-mark', commit: 'c-old', at: 'not a date' },
  ];
  const ordered = orderBaselinePoints(points);
  assert.deepEqual(
    ordered.map((point) => `${point.kind}:${point.commit}`),
    [
      'commit:c-new',
      'reviewed-mark:c-same',
      'merged-pull-request:c-same',
      'session-close:c-same',
      'commit:c-same',
      'commit:c-old',
      'reviewed-mark:c-old',
    ],
  );
  assert.equal(points[0]?.commit, 'c-old', 'the input is not changed');
});

test('commits with the same date keep the order git gave', () => {
  const at = '2026-02-01T10:00:00.000Z';
  const ordered = orderBaselinePoints([commit('child', at), commit('parent', at)]);
  assert.deepEqual(
    ordered.map((point) => point.commit),
    ['child', 'parent'],
  );
});

test('a commit is grouped under the session whose start and close on the root hold it', () => {
  const commits = [
    commit('after', '2026-02-03T10:00:00.000Z'),
    commit('inside-2', '2026-02-02T11:00:00.000Z'),
    commit('inside-1', '2026-02-02T10:00:00.000Z'),
    commit('before', '2026-02-01T10:00:00.000Z'),
  ];
  const assigned = assignSessions(
    commits,
    [
      { sessionId: 's1', at: '2026-02-02T10:30:00.000Z' },
      { sessionId: 's1', at: '2026-02-02T12:00:00.000Z' },
    ],
    [{ id: 's1', startedAt: '2026-02-02T09:00:00.000Z' }],
  );
  assert.deepEqual(
    assigned.map((point) => point.sessionId),
    [undefined, 's1', 's1', undefined],
  );
});

test('a commit made in the second a session started is held by it, and one from the second before is not', () => {
  const assigned = assignSessions(
    [
      commit('same-second', '2026-02-02T09:00:00.000Z'),
      commit('second-before', '2026-02-02T08:59:59.000Z'),
    ],
    [{ sessionId: 's1', at: '2026-02-02T09:00:00.900Z' }],
    [{ id: 's1', startedAt: '2026-02-02T09:00:00.400Z' }],
  );
  assert.deepEqual(
    assigned.map((point) => point.sessionId),
    ['s1', undefined],
  );
});

test('without a close on the root, the start and end times of an ended session hold the commit', () => {
  const commits = [commit('c1', '2026-02-02T10:00:00.000Z')];
  const ended = { id: 'ended', startedAt: '2026-02-02T09:00:00.000Z' };
  assert.equal(
    assignSessions(commits, [], [{ ...ended, closedAt: '2026-02-02T11:00:00.000Z' }])[0]?.sessionId,
    'ended',
  );
  assert.equal(
    assignSessions(commits, [], [ended])[0]?.sessionId,
    undefined,
    'a session that has not ended and has no close on the root takes nothing',
  );
});

test('a session with a close on the root takes the commit before a session that only ran at that time', () => {
  const commits = [commit('c1', '2026-02-02T10:00:00.000Z')];
  const assigned = assignSessions(
    commits,
    [{ sessionId: 'writer', at: '2026-02-02T10:30:00.000Z' }],
    [
      { id: 'writer', startedAt: '2026-02-02T08:00:00.000Z' },
      {
        id: 'reader',
        startedAt: '2026-02-02T09:00:00.000Z',
        closedAt: '2026-02-02T11:00:00.000Z',
      },
    ],
  );
  assert.equal(assigned[0]?.sessionId, 'writer');
});

test('of two sessions that hold a commit, the one that started last takes it; bad dates take nothing', () => {
  const closes = [
    { sessionId: 'early', at: '2026-02-02T12:00:00.000Z' },
    { sessionId: 'late', at: '2026-02-02T12:00:00.000Z' },
    { sessionId: 'unknown', at: '2026-02-02T12:00:00.000Z' },
    { sessionId: 'bad', at: 'never' },
  ];
  const sessions = [
    { id: 'early', startedAt: '2026-02-02T08:00:00.000Z' },
    { id: 'late', startedAt: '2026-02-02T09:00:00.000Z' },
    { id: 'bad', startedAt: 'never' },
  ];
  const assigned = assignSessions(
    [commit('c1', '2026-02-02T10:00:00.000Z'), commit('c2', 'never', 'stale')],
    closes,
    sessions,
  );
  assert.equal(assigned[0]?.sessionId, 'late');
  assert.equal(assigned[1]?.sessionId, undefined);
});

test('grouping gives one row per session at the place of its newest member', () => {
  const close: BaselinePoint = {
    kind: 'session-close',
    commit: 'c3',
    at: '2026-02-02T12:00:00.000Z',
    sessionId: 's1',
  };
  const lonelyClose: BaselinePoint = {
    kind: 'session-close',
    commit: 'c1',
    at: '2026-02-01T09:00:00.000Z',
    sessionId: 's0',
  };
  const mark: BaselinePoint = {
    kind: 'reviewed-mark',
    commit: 'c2',
    at: '2026-02-02T10:30:00.000Z',
  };
  const c3 = commit('c3', '2026-02-02T11:00:00.000Z', 's1');
  const c2 = commit('c2', '2026-02-02T10:00:00.000Z', 's1');
  const c1 = commit('c1', '2026-02-01T08:00:00.000Z');
  const rows = groupBaselinePoints(orderBaselinePoints([c1, c2, c3, mark, lonelyClose, close]));
  assert.deepEqual(rows, [
    { kind: 'session', sessionId: 's1', at: close.at, closes: [close], commits: [c3, c2] },
    { kind: 'point', point: mark },
    { kind: 'session', sessionId: 's0', at: lonelyClose.at, closes: [lonelyClose], commits: [] },
    { kind: 'point', point: c1 },
  ]);
});
