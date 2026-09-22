import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaitingBand } from '../../../src/renderer/src/space/dashboard/v2/WaitingBand.js';
import type {
  DashboardPanel,
  DashboardReportState,
  SpaceProjectState,
} from '../../../src/shared/ipc.js';

const now = Date.parse('2026-09-21T12:00:00.000Z');

function project(overrides: Partial<SpaceProjectState> = {}): SpaceProjectState {
  return {
    version: 1,
    snapshot: null,
    fetchedAt: null,
    state: 'fresh',
    failure: null,
    refreshing: false,
    model: { columns: [], unstaged: [], standalone: [], needsYou: [], board: [] },
    pullRequests: [],
    pullRequestsFailure: null,
    pullRequestSummary: {
      total: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      none: 0,
      approved: 0,
      changesRequested: 0,
      reviewRequired: 0,
      aggregate: 'NO OPEN PULL REQUESTS',
      broken: false,
    },
    nextActions: [],
    moving: { inProgress: [], queued: [], untriaged: [], dormant: [], done: [] },
    dormant: { count: 0, paused: 0, oldestAgeMs: null, medianAgeMs: null },
    stats: { focusesOpen: 2, itemsOpen: 4, openPullRequests: 0, liveSessions: 0 },
    ...overrides,
  } as SpaceProjectState;
}

function report(): DashboardReportState {
  return {
    version: 1,
    definition: null,
    context: null,
    report: null,
    refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
  };
}

const panels = [
  { id: 'prs', kind: 'pull-requests', source: 'companion' },
  { id: 'sessions', kind: 'live-sessions', source: 'companion' },
  { id: 'agents', kind: 'agents-board', source: 'companion' },
  { id: 'stats', kind: 'space-stats', source: 'companion' },
] as unknown as DashboardPanel[];

describe('WaitingBand', () => {
  afterEach(cleanup);

  it('keeps live sessions separate from the Agents board and renders the four stats', () => {
    const state = report();
    state.context = {
      observedAt: '2026-09-21T12:00:00.000Z',
      documents: [],
      handovers: [],
      activity: [
        { id: 's1', startedAt: '2026-09-21T11:00:00.000Z', mode: 'writing', purpose: 'refresh' },
      ],
      problems: [],
    };
    const value = project({
      ...project(),
      model: {
        columns: [],
        unstaged: [],
        standalone: [],
        needsYou: [],
        board: [
          {
            issue: { repository: 'r', number: 4, url: 'https://github.com/r/issues/4' },
            title: 'agent issue',
            column: 'Blocked',
            targets: [],
            attended: true,
            person: '',
            machine: '',
            updatedAt: '2026-09-20T12:00:00.000Z',
            idleMs: 86_400_000,
            stale: true,
            local: null,
            gateTicket: null,
          },
        ],
      },
    });
    render(<WaitingBand panels={panels} project={value} reportState={state} now={now} />);
    expect(screen.getByText('WRITING')).toBeTruthy();
    expect(screen.getByText('BLOCKED')).toBeTruthy();
    expect(screen.getByText('FOCUSES OPEN')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('pairs pull request state marks with words and caps Agents rows', () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      issue: {
        repository: 'r',
        number: index + 1,
        url: `https://github.com/r/issues/${index + 1}`,
      },
      title: `agent ${index}`,
      column: 'Writing' as const,
      targets: [],
      attended: true,
      person: '',
      machine: '',
      updatedAt: null,
      idleMs: null,
      stale: false,
      local: null,
      gateTicket: null,
    }));
    render(
      <WaitingBand
        panels={panels}
        project={project({
          pullRequests: [
            {
              repository: 'r',
              number: 3,
              title: 'broken',
              url: 'https://github.com/r/pull/3',
              headBranch: 'x',
              baseBranch: 'main',
              draft: false,
              createdAt: '2026-09-20T00:00:00.000Z',
              updatedAt: '2026-09-21T11:00:00.000Z',
              checks: 'failing',
              review: 'none',
              mergeable: 'unknown',
            },
          ],
          pullRequestSummary: {
            total: 1,
            passing: 0,
            failing: 1,
            pending: 0,
            none: 0,
            approved: 0,
            changesRequested: 0,
            reviewRequired: 0,
            aggregate: '1 CI FAILED · NONE REVIEWED',
            broken: true,
          },
          model: { columns: [], unstaged: [], standalone: [], needsYou: [], board: rows },
        })}
        reportState={report()}
        now={now}
      />,
    );
    expect(screen.getByText('FAILED')).toBeTruthy();
    expect(screen.getByText('+1 more sessions')).toBeTruthy();
    expect(screen.getByText('1 CI FAILED · NONE REVIEWED')).toBeTruthy();
  });

  it('renders useful empty states without deriving a missing report', () => {
    render(
      <WaitingBand
        panels={panels}
        project={null}
        reportState={null}
        now={now}
        onOpenBoard={vi.fn()}
      />,
    );
    expect(screen.getByText('NO OPEN PULL REQUESTS')).toBeTruthy();
    expect(screen.getByText('No session is running on this desk.')).toBeTruthy();
    expect(screen.getByText('No session issue is open.')).toBeTruthy();
  });

  it('applies state, newest, and oldest ordering modes', () => {
    const orderedPanels = [
      { id: 'prs', kind: 'pull-requests', source: 'companion', order: 'state', limit: 3 },
      { id: 'sessions', kind: 'live-sessions', source: 'companion', order: 'newest', limit: 3 },
      { id: 'agents', kind: 'agents-board', source: 'companion', order: 'oldest', limit: 3 },
    ] as unknown as DashboardPanel[];
    const state = report();
    state.context = {
      observedAt: '2026-09-21T12:00:00.000Z',
      documents: [],
      handovers: [],
      activity: [
        {
          id: 'old-session',
          startedAt: '2026-09-21T10:00:00.000Z',
          mode: 'writing',
          purpose: 'old',
        },
        {
          id: 'new-session',
          startedAt: '2026-09-21T11:00:00.000Z',
          mode: 'writing',
          purpose: 'new',
        },
      ],
      problems: [],
    };
    const value = project({
      pullRequests: [
        {
          repository: 'r',
          number: 1,
          title: 'passing old',
          url: 'https://github.com/r/pull/1',
          headBranch: 'x',
          baseBranch: 'main',
          draft: false,
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-21T10:00:00.000Z',
          checks: 'passing',
          review: 'none',
          mergeable: 'unknown',
        },
        {
          repository: 'r',
          number: 2,
          title: 'failing new',
          url: 'https://github.com/r/pull/2',
          headBranch: 'x',
          baseBranch: 'main',
          draft: false,
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-21T11:00:00.000Z',
          checks: 'failing',
          review: 'none',
          mergeable: 'unknown',
        },
      ],
      pullRequestSummary: {
        total: 2,
        passing: 1,
        failing: 1,
        pending: 0,
        none: 0,
        approved: 0,
        changesRequested: 0,
        reviewRequired: 0,
        aggregate: '1 CI FAILED · 1 CI PASSED · NONE REVIEWED',
        broken: true,
      },
      model: {
        columns: [],
        unstaged: [],
        standalone: [],
        needsYou: [],
        board: [
          {
            issue: { repository: 'r', number: 4, url: 'https://github.com/r/issues/4' },
            title: 'new agent',
            column: 'Writing',
            targets: [],
            attended: true,
            person: '',
            machine: '',
            updatedAt: '2026-09-21T11:00:00.000Z',
            idleMs: 3_600_000,
            stale: false,
            local: null,
            gateTicket: null,
          },
          {
            issue: { repository: 'r', number: 5, url: 'https://github.com/r/issues/5' },
            title: 'old agent',
            column: 'Writing',
            targets: [],
            attended: true,
            person: '',
            machine: '',
            updatedAt: '2026-09-21T10:00:00.000Z',
            idleMs: 7_200_000,
            stale: false,
            local: null,
            gateTicket: null,
          },
        ],
      },
    });
    render(<WaitingBand panels={orderedPanels} project={value} reportState={state} now={now} />);
    const pullRequests = screen.getByText('PULL REQUESTS').closest('article') as HTMLElement;
    const sessions = screen.getByText('LIVE SESSIONS').closest('article') as HTMLElement;
    const agents = screen.getByText('AGENTS BOARD').closest('article') as HTMLElement;
    expect((pullRequests.textContent ?? '').indexOf('failing new')).toBeLessThan(
      (pullRequests.textContent ?? '').indexOf('passing old'),
    );
    expect((sessions.textContent ?? '').indexOf('new')).toBeLessThan(
      (sessions.textContent ?? '').indexOf('old'),
    );
    expect((agents.textContent ?? '').indexOf('old agent')).toBeLessThan(
      (agents.textContent ?? '').indexOf('new agent'),
    );
  });
});
