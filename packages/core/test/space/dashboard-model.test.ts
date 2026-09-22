import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type DashboardGate,
  type FocusItem,
  type IssueRef,
  type PlanItem,
  type ProjectSnapshot,
  type SessionIssue,
  type SessionRecord,
  dashboardModel,
} from '../../src/index.js';

// Phase M7.2: the Dashboard's model from snapshots (architecture document, section 8.6, "Shows").

const NOW = '2026-09-18T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const REPO = 'octo/space';

const ref = (number: number): IssueRef => ({
  repository: REPO,
  number,
  url: `https://github.com/${REPO}/issues/${number}`,
});

const item = (number: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  issue: ref(number),
  title: `Issue ${number}`,
  state: 'open',
  status: null,
  labels: [],
  ...extra,
});

const focus = (
  number: number,
  stage: string | null,
  extra: Partial<FocusItem> = {},
): FocusItem => ({
  ...item(number),
  stage,
  kind: 'feature',
  items: [],
  specUrl: null,
  ...extra,
});

const sessionIssue = (number: number, extra: Partial<SessionIssue> = {}): SessionIssue => ({
  issue: ref(number),
  title: `The claude-code session that started at ${NOW}`,
  column: 'Writing',
  targets: [{ kind: 'lore' }],
  attended: true,
  person: 'octo',
  machine: 'desk-1',
  updatedAt: NOW,
  ...extra,
});

const STAGES = ['Spec', 'Plan', 'Build', 'Review', 'Done'];

function snapshot(extra: Partial<ProjectSnapshot> = {}, stages = STAGES): ProjectSnapshot {
  return {
    problems: [],
    fetchedAt: NOW,
    project: {
      owner: 'octo',
      number: 1,
      title: 'space',
      url: 'https://github.com/users/octo/projects/1',
    },
    stageField: { id: 'F', options: stages.map((name, index) => ({ id: `o${index}`, name })) },
    focuses: [],
    standalone: [],
    sessions: [],
    ...extra,
  };
}

const record = (id: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  engine: 'claude-code',
  attended: true,
  mode: 'writing',
  startedAt: '2026-09-18T09:00:00.000Z',
  ...extra,
});

const gate = (sessionId: string, extra: Partial<DashboardGate> = {}): DashboardGate => ({
  ticket: `t-${sessionId}`,
  sessionId,
  askedAt: '2026-09-18T11:00:00.000Z',
  process: 'work',
  step: 'publish',
  question: 'Publish the spec?',
  ...extra,
});

test('the columns follow the Stage field in order; a sixth value gives a sixth column', () => {
  const five = dashboardModel({ snapshot: snapshot(), sessions: [], gates: [], now: NOW });
  assert.deepEqual(
    five.columns.map((column) => column.name),
    STAGES,
  );
  const six = dashboardModel({
    snapshot: snapshot({ focuses: [focus(1, 'Ship')] }, [
      'Spec',
      'Plan',
      'Build',
      'Review',
      'Ship',
      'Done',
    ]),
    sessions: [],
    gates: [],
    now: NOW,
  });
  assert.equal(six.columns.length, 6);
  assert.equal(six.columns[4]?.name, 'Ship');
  assert.deepEqual(
    six.columns[4]?.focuses.map((card) => card.issue.number),
    [1],
  );
});

test('a focus card carries its kind, its items done over items and its spec link', () => {
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [
        focus(1, 'Build', {
          kind: 'document',
          specUrl: 'https://example.test/spec.md',
          items: [
            item(2, { state: 'closed' }),
            item(3, { status: 'Done' }),
            item(4),
            item(5, { labels: ['session'] }),
          ],
        }),
      ],
    }),
    sessions: [],
    gates: [],
    now: NOW,
  });
  const card = model.columns.find((column) => column.name === 'Build')?.focuses[0];
  assert.ok(card);
  assert.equal(card.kind, 'document');
  assert.equal(card.specUrl, 'https://example.test/spec.md');
  assert.equal(card.itemsDone, 2, 'closed and Status Done both count as done');
  assert.equal(card.itemsTotal, 3, 'a session issue is not an item');
  assert.equal(card.gateNote, null);
});

test('standalone items are beside the columns, paused ones marked; unknown stages are unstaged', () => {
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [focus(1, null), focus(2, 'Gone')],
      standalone: [item(10, { labels: ['paused'] }), item(11), item(12, { state: 'closed' })],
    }),
    sessions: [],
    gates: [],
    now: NOW,
  });
  assert.deepEqual(
    model.standalone.map((card) => [card.issue.number, card.paused, card.done]),
    [
      [10, true, false],
      [11, false, false],
      [12, false, true],
    ],
  );
  assert.deepEqual(
    model.unstaged.map((card) => card.issue.number),
    [1, 2],
  );
  assert.equal(
    model.columns.reduce((count, column) => count + column.focuses.length, 0),
    0,
  );
});

test('session issues are board rows and never focuses or items', () => {
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [focus(1, 'Build')],
      sessions: [sessionIssue(20), sessionIssue(21, { column: 'Done', person: 'other' })],
    }),
    sessions: [record('s-1', { issue: ref(20) })],
    gates: [],
    now: NOW,
  });
  assert.deepEqual(
    model.board.map((row) => [row.issue.number, row.column]),
    [
      [20, 'Writing'],
      [21, 'Done'],
    ],
  );
  assert.equal(model.board[0]?.local?.sessionId, 's-1');
  assert.equal(model.board[0]?.local?.engine, 'claude-code');
  assert.equal(model.board[0]?.title, `The claude-code session that started at ${NOW}`);
  assert.equal(model.board[0]?.local?.item, null);
  assert.deepEqual(model.board[0]?.local?.unguarded, []);
  assert.equal(model.board[1]?.local, null, 'a session of another desk');
  const numbers = [
    ...model.columns.flatMap((column) => column.focuses.map((card) => card.issue.number)),
    ...model.standalone.map((card) => card.issue.number),
  ];
  assert.ok(!numbers.includes(20) && !numbers.includes(21));
});

test('a board row carries the unguarded options of its local session record', () => {
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [],
      sessions: [sessionIssue(20)],
    }),
    sessions: [record('s-1', { issue: ref(20), unguarded: ['--dangerously-skip-permissions'] })],
    gates: [],
    now: NOW,
  });
  assert.deepEqual(model.board[0]?.local?.unguarded, ['--dangerously-skip-permissions']);
});

test('a session in Writing or Blocked without change for the threshold is stale; Done never is', () => {
  const old = new Date(Date.parse(NOW) - 2 * DAY).toISOString();
  const recent = new Date(Date.parse(NOW) - DAY / 2).toISOString();
  const model = dashboardModel({
    snapshot: snapshot({
      sessions: [
        sessionIssue(20, { updatedAt: old }),
        sessionIssue(21, { updatedAt: recent }),
        sessionIssue(22, { updatedAt: old, column: 'Done' }),
        sessionIssue(23, { updatedAt: old, column: 'Blocked' }),
      ],
    }),
    sessions: [],
    gates: [],
    now: NOW,
  });
  assert.deepEqual(
    model.board.map((row) => row.stale),
    [true, false, false, true],
  );
  assert.equal(model.board[0]?.idleMs, 2 * DAY);
  assert.deepEqual(
    model.needsYou.map((entry) => entry.kind),
    ['stale-session', 'stale-session'],
  );
  const shorter = dashboardModel({
    snapshot: snapshot({ sessions: [sessionIssue(21, { updatedAt: recent })] }),
    sessions: [],
    gates: [],
    now: NOW,
    staleAfterMs: DAY / 4,
  });
  assert.equal(shorter.board[0]?.stale, true, 'the threshold is a setting');
});

test('Needs you lists a pending gate, then a focus at Review, then a stale session', () => {
  const old = new Date(Date.parse(NOW) - 3 * DAY).toISOString();
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [
        focus(1, 'Review'),
        focus(2, 'Review', { state: 'closed' }),
        focus(3, 'Build', { items: [item(4)] }),
      ],
      sessions: [sessionIssue(20, { updatedAt: old }), sessionIssue(21, { column: 'Blocked' })],
    }),
    sessions: [record('s-gate', { issue: ref(21), item: ref(4) })],
    gates: [gate('s-gate')],
    now: NOW,
  });
  assert.deepEqual(
    model.needsYou.map((entry) => entry.kind),
    ['gate', 'review', 'stale-session'],
  );
  const first = model.needsYou[0];
  assert.ok(first?.kind === 'gate');
  assert.equal(first.ticket, 't-s-gate');
  assert.deepEqual(first.item, ref(4));
  const review = model.needsYou[1];
  assert.ok(review?.kind === 'review');
  assert.equal(review.focus.number, 1, 'a closed focus at Review does not need the Human Lead');
  const build = model.columns.find((column) => column.name === 'Build')?.focuses[0];
  assert.equal(
    build?.gateNote,
    'Publish the spec?',
    'the focus of the waiting session has the note',
  );
  const row = model.board.find((entry) => entry.issue.number === 21);
  assert.equal(row?.gateTicket, 't-s-gate');
});

test('the model is pure: the same input gives the same model, and the input is not changed', () => {
  const input = {
    snapshot: snapshot({
      focuses: [focus(1, 'Spec', { items: [item(2)] })],
      sessions: [sessionIssue(20)],
    }),
    sessions: [record('s-1', { issue: ref(20) })],
    gates: [gate('s-1', { askedAt: '2026-09-18T11:30:00.000Z' }), gate('s-1', { ticket: 'early' })],
    now: NOW,
  };
  const before = JSON.stringify(input);
  const a = dashboardModel(input);
  const b = dashboardModel(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
  assert.equal(
    a.needsYou[0]?.kind === 'gate' ? a.needsYou[0].ticket : '',
    'early',
    'oldest gate first',
  );
});

test('an empty Project, and a Project with no Stage field, give no columns and invent nothing', () => {
  const empty = dashboardModel({ snapshot: snapshot(), sessions: [], gates: [], now: NOW });
  assert.equal(empty.columns.length, 5);
  assert.ok(empty.columns.every((column) => column.focuses.length === 0));
  assert.deepEqual(
    [empty.unstaged, empty.standalone, empty.board, empty.needsYou],
    [[], [], [], []],
  );
  const noField = dashboardModel({
    snapshot: {
      ...snapshot({ focuses: [focus(1, null), focus(2, 'Review')] }),
      stageField: { id: '', options: [] },
    },
    sessions: [],
    gates: [],
    now: NOW,
  });
  assert.deepEqual(noField.columns, []);
  assert.deepEqual(
    noField.unstaged.map((card) => card.issue.number),
    [1, 2],
  );
  assert.deepEqual(noField.needsYou, [], 'no Review column, so no focus at Review');
});

test('closed issues and items in Done count as done; a closed focus stays on its column', () => {
  const model = dashboardModel({
    snapshot: snapshot({
      focuses: [
        focus(1, 'Done', {
          state: 'closed',
          items: [item(2, { state: 'closed' }), item(3, { status: 'Done' }), item(4)],
        }),
      ],
      standalone: [item(5, { state: 'closed' }), item(6, { status: 'Done' })],
    }),
    sessions: [],
    gates: [],
    now: NOW,
  });
  const card = model.columns.find((column) => column.name === 'Done')?.focuses[0];
  assert.equal(card?.done, true);
  assert.deepEqual([card?.itemsDone, card?.itemsTotal], [2, 3]);
  assert.deepEqual(
    model.standalone.map((entry) => entry.done),
    [true, true],
  );
});

test('a stale snapshot still marks stale sessions by the current time', () => {
  const weekAgo = new Date(Date.parse(NOW) - 7 * DAY).toISOString();
  const model = dashboardModel({
    snapshot: snapshot({
      fetchedAt: weekAgo,
      sessions: [sessionIssue(20, { updatedAt: weekAgo })],
    }),
    sessions: [],
    gates: [],
    now: NOW,
  });
  assert.equal(model.board[0]?.stale, true);
  assert.equal(model.board[0]?.idleMs, 7 * DAY);
});

test('1,000 items are modelled quickly', () => {
  const focuses = Array.from({ length: 100 }, (_, index) =>
    focus(index + 1, STAGES[index % STAGES.length] ?? null, {
      items: Array.from({ length: 9 }, (_, sub) => item(1000 + index * 9 + sub)),
    }),
  );
  const sessions = Array.from({ length: 50 }, (_, index) => sessionIssue(5000 + index));
  const records = sessions.map((session, index) =>
    record(`s-${index}`, { issue: session.issue, item: ref(1000 + index) }),
  );
  const started = performance.now();
  const model = dashboardModel({
    snapshot: snapshot({ focuses, sessions }),
    sessions: records,
    gates: records.map((entry) => gate(entry.id)),
    now: NOW,
  });
  const elapsed = performance.now() - started;
  assert.equal(
    model.columns.reduce((sum, column) => sum + column.focuses.length, 0),
    100,
  );
  assert.equal(model.board.length, 50);
  assert.ok(elapsed < 200, `took ${elapsed} ms`);
});
