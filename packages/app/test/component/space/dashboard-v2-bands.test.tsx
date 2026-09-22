import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BandMoving } from '../../../src/renderer/src/space/dashboard/v2/BandMoving.js';
import { BandNeedsYou } from '../../../src/renderer/src/space/dashboard/v2/BandNeedsYou.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type { DashboardPanel } from '../../../src/shared/ipc.js';
import {
  DASHBOARD_NOW,
  projectState,
  reportState,
  repositoriesState,
} from './dashboard-fixtures.js';

const cockpit = {
  spaceNavigate: vi.fn().mockResolvedValue({ ok: true, value: { mode: 'space-files' } }),
  urlOpenExternal: vi.fn(),
};

function focus(number: number, stage: string | null = 'Build') {
  return {
    issue: { repository: 'repo', number, url: `https://github.com/repo/issues/${number}` },
    title: `Focus ${number}`,
    state: 'open',
    status: null,
    labels: [],
    stage,
    stageChangedAt: null,
    kind: null,
    specUrl: null,
    updatedAt: null,
    items: [],
    itemsDone: 0,
    itemsTotal: 0,
    gateNote: null,
    done: false,
  } as const;
}

beforeEach(() => {
  Object.defineProperty(window, 'cockpit', { configurable: true, value: cockpit });
  cockpit.spaceNavigate.mockClear();
  cockpit.urlOpenExternal.mockClear();
});

afterEach(cleanup);

describe('dashboard v2 Needs You and Moving bands', () => {
  it('opens a draft through Files and omits empty companion cards', () => {
    const state = projectState({
      nextActions: [{ kind: 'draft', path: 'spec.md', title: 'Spec', headline: 'Review Spec' }],
    });
    const report = reportState();
    render(
      <BandNeedsYou
        panels={
          [
            { id: 'action', source: 'companion', kind: 'next-action' },
            { id: 'docs', source: 'companion', kind: 'review-documents' },
            { id: 'publish', source: 'companion', kind: 'publish-area' },
          ] as DashboardPanel[]
        }
        project={state}
        reportState={report}
        repositories={repositoriesState()}
        now={DASHBOARD_NOW}
        onOpenFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open draft' }));
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({
      to: 'space-files',
      open: { rootId: 'workbench', relPath: 'spec.md' },
    });
    expect(screen.queryByText('drafts awaiting your review')).toBeNull();
    expect(screen.queryByText('PUBLISH AREA')).toBeNull();
  });

  it('rejects a PM value from a different definition hash', () => {
    const report = reportState({
      report: {
        definitionHash: 'old',
        components: [{ id: 'note', type: 'text', text: 'stale' }],
        basis: null,
        sessionId: 's',
        receivedAt: '2026-09-21T11:00:00Z',
        stale: false,
        staleReason: null,
      },
    });
    render(
      <BandNeedsYou
        panels={[{ id: 'note', source: 'pm', kind: 'text', title: 'PM note' }]}
        project={projectState()}
        reportState={report}
        repositories={null}
        now={DASHBOARD_NOW}
        onOpenFocus={vi.fn()}
      />,
    );
    expect(screen.queryByText('PM note')).toBeNull();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('routes a gate without an issue source to Sessions through the secondary action', () => {
    useSpaceNavStore.setState({ screen: 'dashboard' });
    render(
      <BandNeedsYou
        panels={[{ id: 'action', source: 'companion', kind: 'next-action' }]}
        project={projectState({
          nextActions: [
            {
              kind: 'gate',
              ticket: 't1',
              sessionId: 's1',
              askedAt: '2026-09-21T11:00:00Z',
              process: 'work',
              step: 'confirm',
              question: 'Confirm?',
              item: null,
              headline: 'Confirm?',
            },
          ],
        })}
        reportState={null}
        repositories={null}
        now={DASHBOARD_NOW}
        onOpenFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View sessions' }));
    expect(useSpaceNavStore.getState().screen).toBe('sessions');
  });

  it('caps active rows, keeps unknown stage age honest, and opens the full dormant backlog', async () => {
    const inProgress = Array.from({ length: 5 }, (_, index) => focus(index + 1));
    const dormant = [focus(20, null), focus(21, null)];
    render(
      <BandMoving
        panels={
          [
            { id: 'active', source: 'companion', kind: 'in-progress', limit: 10 },
            { id: 'queued', source: 'companion', kind: 'queued', limit: 4 },
            { id: 'dormant', source: 'companion', kind: 'dormant' },
          ] as DashboardPanel[]
        }
        project={projectState({
          moving: { inProgress, queued: [], untriaged: [], dormant, done: [] },
          dormant: { count: 2, paused: 0, oldestAgeMs: null, medianAgeMs: null },
        })}
        reportState={null}
        now={DASHBOARD_NOW}
        onOpenFocus={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Focus [1-3]/)).toHaveLength(3);
    expect(screen.getByText('+2 more in progress items')).toBeTruthy();
    expect(screen.getAllByText('age unknown').length).toBeGreaterThan(0);
    expect(screen.getByText('2 dormant focuses')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review backlog ›' }));
    expect(screen.getByTestId('dashboard-dormant-sheet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Focus 20/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Focus 21/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-dormant-sheet')).toBeNull());
  });
});

it('does not claim all clear when Workbench drafts arrive before Project actions refresh', () => {
  const report = reportState();
  if (report.context === null) throw new Error('fixture context');
  report.context.documents = [
    {
      id: 'draft:new',
      path: 'drafts/new.md',
      title: 'New draft',
      kind: 'document',
      reviewCandidate: true,
      timestamp: '2026-09-21T11:00:00Z',
      timestampKind: 'creation',
      modifiedAt: '2026-09-21T11:00:00Z',
    },
  ];
  render(
    <BandNeedsYou
      panels={[{ id: 'docs', source: 'companion', kind: 'review-documents' }]}
      project={projectState()}
      reportState={report}
      repositories={null}
      now={DASHBOARD_NOW}
      onOpenFocus={vi.fn()}
    />,
  );
  expect(screen.getByText('drafts awaiting your review')).toBeTruthy();
  expect(screen.queryByText(/NOTHING NEEDS YOU/)).toBeNull();
});
