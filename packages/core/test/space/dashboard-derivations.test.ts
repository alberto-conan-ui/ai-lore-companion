import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type DashboardModel,
  type FocusCard,
  type OpenPullRequest,
  type SessionRecord,
  dormantAggregate,
  focusAgeMs,
  nextActionHeadline,
  partitionMoving,
  pullRequestSummary,
  rankNextActions,
  spaceStats,
} from '../../src/index.js';

const now = '2026-09-21T12:00:00Z';
const issue = (number: number) => ({
  repository: 'owner/space',
  number,
  url: `https://github.com/owner/space/issues/${number}`,
});
function focus(number: number, overrides: Partial<FocusCard> = {}): FocusCard {
  return {
    issue: issue(number),
    title: `Focus ${number}`,
    state: 'open',
    status: null,
    labels: [],
    stage: 'Spec',
    stageChangedAt: '2026-09-20T12:00:00Z',
    kind: null,
    specUrl: null,
    updatedAt: now,
    items: [],
    itemsDone: 0,
    itemsTotal: 0,
    gateNote: null,
    done: false,
    ...overrides,
  };
}
function model(focuses: FocusCard[]): DashboardModel {
  return {
    columns: [{ id: 'stage', name: 'Spec', focuses }],
    unstaged: [],
    standalone: [],
    board: [],
    needsYou: [],
  };
}
const pull: OpenPullRequest = {
  repository: 'owner/app',
  number: 7,
  title: 'Change',
  url: 'https://github.com/owner/app/pull/7',
  headBranch: 'change',
  baseBranch: 'main',
  draft: false,
  createdAt: '2026-09-19T12:00:00Z',
  updatedAt: now,
  checks: 'failing',
  review: 'none',
  mergeable: 'unknown',
};

test('next action ranks gates, failing PRs, reviews, stale sessions and drafts with factual stable headlines', () => {
  const input = {
    now,
    pulls: [pull, { ...pull, number: 8, checks: 'passing' as const }],
    drafts: [
      { path: 'drafts/new.md', title: 'New draft', at: now },
      { path: 'drafts/old.md', title: 'Old draft', at: '2026-09-18T00:00:00Z' },
    ],
    needsYou: [
      { kind: 'review' as const, focus: issue(1), title: 'Design' },
      {
        kind: 'stale-session' as const,
        issue: issue(2),
        column: 'Writing' as const,
        idleMs: 1000,
        sessionId: null,
      },
      {
        kind: 'gate' as const,
        ticket: 'ticket',
        askedAt: now,
        sessionId: 's-1',
        process: 'work',
        step: 'claim',
        question: 'Claim the repository?',
        item: null,
      },
    ],
  };
  const actions = rankNextActions(input);
  assert.deepEqual(
    actions.map((action) => action.kind),
    ['gate', 'failing-pull-request', 'review', 'stale-session', 'draft', 'draft'],
  );
  assert.equal(actions[1]?.headline, 'PR #7 CI has failed');
  assert.equal(actions[4]?.headline, 'Review Old draft');
  assert.deepEqual(rankNextActions(input), actions);
  for (const action of actions) assert.equal(nextActionHeadline(action), action.headline);
});

test('partition is exclusive: done beats paused, paused beats Build, and a live child session makes a focus active', () => {
  const active = focus(1, { stage: 'Build' });
  const paused = focus(2, { stage: 'Build', labels: ['paused'] });
  const done = focus(3, { labels: ['paused'], done: true });
  const unstaged = focus(4, { stage: null });
  const queued = focus(5);
  const child = {
    issue: issue(61),
    title: 'Child',
    state: 'open' as const,
    status: null,
    labels: [],
    done: false,
    paused: false,
    updatedAt: now,
  };
  const withSession = focus(6, { items: [child] });
  const session: SessionRecord = {
    id: 's-1',
    engine: 'codex',
    attended: true,
    mode: 'writing',
    startedAt: now,
    item: child.issue,
  };
  const all = [active, paused, done, unstaged, queued, withSession];
  const result = partitionMoving({ model: model(all), now, sessions: [session] });
  assert.deepEqual(
    result.inProgress.map((entry) => entry.issue.number),
    [1, 6],
  );
  assert.deepEqual(
    result.queued.map((entry) => entry.issue.number),
    [5],
  );
  assert.deepEqual(
    result.dormant.map((entry) => entry.issue.number),
    [2, 4],
  );
  assert.deepEqual(
    result.done.map((entry) => entry.issue.number),
    [3],
  );
  assert.equal(
    new Set(
      Object.values(result)
        .flat()
        .map((entry) => entry.issue.number),
    ).size,
    all.length,
  );
  const ended = partitionMoving({
    model: model([withSession]),
    now,
    sessions: [{ ...session, closedAt: now }],
  });
  assert.equal(ended.queued.length, 1);
});

test('ages use Stage changes only, clamp future dates, and ignore unknown ages in aggregates', () => {
  const unknown = focus(1, {
    stageChangedAt: null,
    updatedAt: '2000-01-01T00:00:00Z',
    labels: ['paused'],
  });
  assert.equal(focusAgeMs(unknown, now), null);
  assert.equal(focusAgeMs(focus(2, { stageChangedAt: 'invalid' }), now), null);
  assert.equal(focusAgeMs(focus(3, { stageChangedAt: '2099-01-01T00:00:00Z' }), now), 0);
  assert.deepEqual(
    dormantAggregate(
      [unknown, focus(4), focus(5, { stageChangedAt: '2026-09-18T12:00:00Z' })],
      now,
    ),
    { count: 3, paused: 1, oldestAgeMs: 3 * 86400000, medianAgeMs: 2 * 86400000 },
  );
});

test('PR summary keeps mixed CI and review states accurate without zero-count noise', () => {
  const summary = pullRequestSummary([
    pull,
    { ...pull, number: 8, checks: 'pending', review: 'approved' },
    { ...pull, number: 9, checks: 'none', review: 'review-required' },
    { ...pull, number: 10, checks: 'passing', review: 'changes-requested' },
  ]);
  assert.equal(summary.broken, true);
  assert.equal(summary.failing, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.none, 1);
  assert.equal(
    summary.aggregate,
    '1 CI FAILED · 1 RUNNING · 1 NO CI · 1 REVIEWED · 1 CHANGES REQUESTED · 1 REVIEW REQUIRED',
  );
});

test('an empty Space has empty actions and partitions, unknown dormant age and zero counts', () => {
  assert.deepEqual(rankNextActions({ needsYou: [], pulls: [], drafts: [], now }), []);
  assert.deepEqual(partitionMoving({ model: null, now }), {
    inProgress: [],
    queued: [],
    dormant: [],
    done: [],
  });
  assert.deepEqual(dormantAggregate([], now), {
    count: 0,
    paused: 0,
    oldestAgeMs: null,
    medianAgeMs: null,
  });
  assert.deepEqual(spaceStats({ model: null, pulls: [], sessions: [] }), {
    focusesOpen: 0,
    itemsOpen: 0,
    openPullRequests: 0,
    liveSessions: 0,
  });
});

test('Space counts exclude done focuses and closed sessions and deduplicate shared items', () => {
  const item = {
    issue: issue(10),
    title: 'Shared',
    state: 'open' as const,
    status: null,
    labels: [],
    done: false,
    paused: false,
    updatedAt: now,
  };
  const m = model([focus(1, { items: [item] }), focus(2, { done: true, items: [item] })]);
  m.standalone = [item];
  const session: SessionRecord = {
    id: 's',
    engine: 'codex',
    attended: true,
    mode: 'read-only',
    startedAt: now,
    closedAt: now,
  };
  assert.deepEqual(spaceStats({ model: m, pulls: [pull], sessions: [session] }), {
    focusesOpen: 1,
    itemsOpen: 1,
    openPullRequests: 1,
    liveSessions: 0,
  });
});
