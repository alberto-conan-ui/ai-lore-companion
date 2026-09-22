import type {
  DashboardReportState,
  SpaceProjectState,
  SpaceRepositoriesState,
} from '../../../src/shared/ipc.js';

export const DASHBOARD_NOW = Date.parse('2026-09-21T12:00:00Z');
export function projectState(over: Partial<SpaceProjectState> = {}): SpaceProjectState {
  return {
    version: 1,
    snapshot: null,
    fetchedAt: '2026-09-21T11:55:00Z',
    state: 'fresh',
    failure: null,
    refreshing: false,
    model: { columns: [], unstaged: [], standalone: [], board: [], needsYou: [] },
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
    stats: { focusesOpen: 0, itemsOpen: 0, openPullRequests: 0, liveSessions: 0 },
    ...over,
  };
}
export function reportState(over: Partial<DashboardReportState> = {}): DashboardReportState {
  return {
    version: 1,
    definition: {
      definition: {
        version: 2,
        bands: [
          {
            id: 'needs-you',
            panels: [
              {
                id: 'action',
                source: 'companion',
                kind: 'next-action',
                pmLine: { id: 'note', instruction: 'Context' },
              },
              {
                id: 'docs',
                source: 'companion',
                kind: 'review-documents',
                limit: 3,
                recentDays: 14,
                order: 'newest',
              },
              { id: 'publish', source: 'companion', kind: 'publish-area' },
            ],
          },
          {
            id: 'moving',
            panels: [
              { id: 'active', source: 'companion', kind: 'in-progress', limit: 3, order: 'age' },
              { id: 'queued', source: 'companion', kind: 'queued', limit: 2, order: 'age' },
              { id: 'dormant', source: 'companion', kind: 'dormant' },
              { id: 'done', source: 'companion', kind: 'done-line' },
            ],
          },
          {
            id: 'waiting',
            panels: [
              { id: 'prs', source: 'companion', kind: 'pull-requests', limit: 3, order: 'state' },
              { id: 'live', source: 'companion', kind: 'live-sessions', limit: 2, order: 'newest' },
              { id: 'board', source: 'companion', kind: 'agents-board', limit: 2, order: 'newest' },
              { id: 'stats', source: 'companion', kind: 'space-stats' },
              { id: 'notes', source: 'companion', kind: 'handovers', limit: 3, order: 'newest' },
            ],
          },
        ],
      },
      hash: 'hash',
      source: 'space',
      path: '/space/lore/corpus/dashboard.json',
      diagnostic: null,
    },
    context: {
      observedAt: '2026-09-21T12:00:00Z',
      documents: [],
      handovers: [],
      activity: [],
      problems: [],
    },
    report: null,
    refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
    ...over,
  };
}
export function repositoriesState(): SpaceRepositoriesState {
  return { version: 1, reading: false, model: { rows: [] }, readAt: null, problem: null };
}
