import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DashboardDefinitionRenderer } from '../../../src/renderer/src/space/dashboard/DashboardDefinition.js';
import type { DashboardReportState } from '../../../src/shared/ipc.js';

const definition = {
  version: 1 as const,
  sections: [
    { id: 'custom', title: 'Custom order', columns: [['metric'], ['text', 'list', 'docs']] },
  ],
  components: [
    { id: 'metric', type: 'metric' as const, source: 'pm' as const, title: 'Count' },
    { id: 'text', type: 'text' as const, source: 'pm' as const, title: 'Position' },
    { id: 'list', type: 'list' as const, source: 'pm' as const, title: 'Blockers' },
    {
      id: 'docs',
      type: 'workbench-docs' as const,
      source: 'companion' as const,
      title: 'Review',
      limit: 10,
    },
  ],
};

const state = (over: Partial<DashboardReportState> = {}): DashboardReportState => ({
  version: 1,
  definition: {
    definition,
    hash: 'definition-hash',
    source: 'space',
    path: '/space/lore/corpus/dashboard.json',
    diagnostic: null,
  },
  context: {
    observedAt: '2026-09-21T10:00:00.000Z',
    documents: [
      {
        id: 'doc-1',
        path: 'drafts/review.md',
        title: 'Review draft',
        kind: 'document',
        reviewCandidate: true,
        timestamp: '2026-09-21T09:00:00.000Z',
        timestampKind: 'creation',
        modifiedAt: '2026-09-21T09:00:00.000Z',
      },
    ],
    handovers: [],
    activity: [],
    problems: [],
  },
  report: {
    components: [
      { id: 'metric', type: 'metric', value: 3, unit: 'items' },
      { id: 'text', type: 'text', text: 'Evidence is current.' },
      { id: 'list', type: 'list', items: [{ id: 'b1', label: 'One blocker', status: 'open' }] },
    ],
    definitionHash: 'definition-hash',
    basis: 'Project and Workbench',
    sessionId: 'pm-1',
    receivedAt: '2026-09-21T09:30:00.000Z',
    stale: false,
    staleReason: null,
  },
  refresh: { status: 'updated', requestId: null, reason: null, requestedAt: null, failure: null },
  ...over,
});

beforeEach(() => {
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceNavigate: vi.fn(async () => ({ ok: true, value: {} })),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('renders custom section and column order with typed PM values', () => {
  render(
    <DashboardDefinitionRenderer
      state={state()}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  const section = screen.getByTestId('dashboard-definition-section-custom');
  const columns = within(section).getAllByTestId('dashboard-definition-column');
  expect(columns).toHaveLength(2);
  expect(columns[0].textContent).toContain('Count3items');
  expect(columns[1].textContent).toContain('PositionEvidence is current.');
  expect(screen.getByText('One blocker')).toBeTruthy();
});

test('renders explicit unavailable and malformed-definition diagnostics', () => {
  const acceptedReport = state().report;
  if (acceptedReport === null) throw new Error('test state needs a report');
  const unavailable = state({
    report: {
      ...acceptedReport,
      components: [{ id: 'metric', unavailable: true, reason: 'PM could not inspect the source.' }],
    },
  });
  render(
    <DashboardDefinitionRenderer
      state={unavailable}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.getByText('Unavailable: PM could not inspect the source.')).toBeTruthy();
  expect(screen.queryByText('Evidence is current.')).toBeNull();
  render(
    <DashboardDefinitionRenderer
      state={state({ definition: null })}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.getByTestId('dashboard-definition-diagnostic').textContent).toContain(
    'No valid dashboard definition',
  );
});

test('keeps refresh lifecycle and failure separate from accepted PM values', () => {
  render(
    <DashboardDefinitionRenderer
      state={state({
        refresh: {
          status: 'failed',
          requestId: 'request-1',
          reason: 'human',
          requestedAt: '2026-09-21T09:00:00.000Z',
          failure: { kind: 'timeout', message: 'The PM did not respond in time.' },
        },
      })}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.getByTestId('dashboard-refresh-status').getAttribute('data-refresh-status')).toBe(
    'failed',
  );
  expect(screen.getByTestId('dashboard-refresh-failure').textContent).toContain(
    'Previous accepted dashboard data is retained.',
  );
  expect(screen.getByText('Evidence is current.')).toBeTruthy();
});

test('opens the exact Workbench document through the existing Files window route', () => {
  render(
    <DashboardDefinitionRenderer
      state={state()}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  fireEvent.click(
    within(screen.getByTestId('dashboard-component-docs')).getByRole('button', {
      name: 'Review draft',
    }),
  );
  expect(
    (window.cockpit as { spaceNavigate: ReturnType<typeof vi.fn> }).spaceNavigate,
  ).toHaveBeenCalledWith({
    to: 'space-files',
    open: { rootId: 'workbench', relPath: 'drafts/review.md' },
  });
});

test('a changed definition hides the incompatible PM snapshot', () => {
  const prior = state();
  if (!prior.definition) throw new Error('definition required');
  render(
    <DashboardDefinitionRenderer
      state={{ ...prior, definition: { ...prior.definition, hash: 'new-hash' } }}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.queryByText('Evidence is current.')).toBeNull();
  expect(screen.getAllByText('No data is available yet.')).toHaveLength(3);
});

test('each document component applies its own recency window', () => {
  const prior = state();
  if (!prior.definition || !prior.context) throw new Error('definition and context required');
  const original = prior.context.documents[0];
  const custom = {
    ...prior.definition,
    definition: {
      version: 1 as const,
      sections: [{ id: 'docs', title: 'Drafts', columns: [['recent'], ['older']] }],
      components: [
        {
          id: 'recent',
          type: 'workbench-docs' as const,
          source: 'companion' as const,
          title: 'Today',
          recentDays: 1,
        },
        {
          id: 'older',
          type: 'workbench-docs' as const,
          source: 'companion' as const,
          title: 'Month',
          recentDays: 30,
        },
      ],
    },
  };
  render(
    <DashboardDefinitionRenderer
      state={{
        ...prior,
        definition: custom,
        context: {
          ...prior.context,
          documents: [{ ...original, timestamp: '2026-09-18T09:00:00Z' }],
        },
      }}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(
    within(screen.getByTestId('dashboard-component-recent')).queryByText('Review draft'),
  ).toBeNull();
  expect(
    within(screen.getByTestId('dashboard-component-older')).getByText('Review draft'),
  ).toBeTruthy();
  expect(screen.getByText(/Draft document/)).toBeTruthy();
});

test('a failed quick-open shows an actionable error', async () => {
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceNavigate: vi.fn(async () => ({
      ok: false,
      error: { message: 'The file was moved or deleted.' },
    })),
  };
  render(
    <DashboardDefinitionRenderer
      state={state()}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'drafts/review.md: The file was moved or deleted.',
  );
});

test('historical handovers and current Read only work are labelled separately', () => {
  const prior = state();
  if (!prior.definition || !prior.context) throw new Error('definition and context required');
  const historical = {
    id: 'handover',
    path: 'journal/previous.md',
    title: 'Previous session',
    sessionId: 'old-session',
    text: 'Review the draft next.',
    timestamp: '2026-09-20T09:00:00Z',
    timestampKind: 'creation' as const,
    modifiedAt: '2026-09-20T09:00:00Z',
    historical: true as const,
  };
  render(
    <DashboardDefinitionRenderer
      state={{
        ...prior,
        definition: {
          ...prior.definition,
          definition: {
            version: 1,
            sections: [{ id: 'work', title: 'Workbench', columns: [['handover', 'activity']] }],
            components: [
              { id: 'handover', type: 'handovers', source: 'companion', title: 'History' },
              { id: 'activity', type: 'activity', source: 'companion', title: 'Now' },
            ],
          },
        },
        context: {
          ...prior.context,
          handovers: [historical],
          activity: [
            {
              id: 'open-session',
              startedAt: '2026-09-21T09:00:00Z',
              mode: 'read-only',
              item: { title: 'Drafting dashboard spec', url: 'https://example.test/item' },
            },
          ],
        },
      }}
      model={null}
      now={Date.parse('2026-09-21T10:00:00Z')}
      onOpenFocus={() => {}}
    />,
  );
  expect(
    within(screen.getByTestId('dashboard-component-handover')).getByText(/Historical handover/),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('dashboard-component-activity')).getByText(
      /read-only · Drafting dashboard spec/,
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous session' }));
  expect(window.cockpit.spaceNavigate).toHaveBeenCalledWith({
    to: 'space-files',
    open: { rootId: 'workbench', relPath: 'journal/previous.md' },
  });
});
