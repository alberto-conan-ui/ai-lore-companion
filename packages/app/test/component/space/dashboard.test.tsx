import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Dashboard } from '../../../src/renderer/src/space/dashboard/Dashboard.js';
import type { DashboardDefinitionState } from '../../../src/renderer/src/space/dashboard/useDashboardDefinition.js';
import type { ProjectStateView } from '../../../src/renderer/src/space/dashboard/useProjectState.js';
import type { RepositoriesStateView } from '../../../src/renderer/src/space/dashboard/useRepositoriesState.js';
import { projectState, reportState, repositoriesState } from './dashboard-fixtures.js';

let project: ProjectStateView;
let reports: DashboardDefinitionState;
let repositories: RepositoriesStateView;
vi.mock('../../../src/renderer/src/space/dashboard/useProjectState.js', () => ({
  useProjectState: () => project,
}));
vi.mock('../../../src/renderer/src/space/dashboard/useDashboardDefinition.js', () => ({
  useDashboardDefinition: () => reports,
}));
vi.mock('../../../src/renderer/src/space/dashboard/useRepositoriesState.js', () => ({
  useRepositoriesState: () => repositories,
}));
vi.mock('../../../src/renderer/src/space/dashboard/StartSession.js', () => ({
  StartSession: ({ justCreated }: { justCreated: boolean }) => (
    <button type="button">{justCreated ? 'Start in the new Space' : 'Start a session'}</button>
  ),
}));
beforeEach(() => {
  project = { project: projectState(), problem: null, requested: false, refresh: vi.fn() };
  reports = { state: reportState(), problem: null, refreshing: false, refresh: vi.fn() };
  repositories = {
    repositories: repositoriesState(),
    problem: null,
    requested: false,
    refresh: vi.fn(),
  };
});
afterEach(cleanup);

test('the empty Space renders the new bands and can start a session before initial reads', () => {
  project.project = null;
  reports.state = null;
  render(<Dashboard justCreated />);
  expect(screen.getByTestId('dashboard-v2')).toBeTruthy();
  expect(screen.getByTestId('dashboard-state').textContent).toContain('Reading');
  expect(screen.getByRole('button', { name: 'Start in the new Space' })).toBeTruthy();
  expect(screen.queryByText('No data is available yet.')).toBeNull();
});

test('Refresh updates factual Project, repository and PM sources together', () => {
  render(<Dashboard />);
  fireEvent.click(screen.getByTestId('dashboard-refresh'));
  expect(project.refresh).toHaveBeenCalledOnce();
  expect(repositories.refresh).toHaveBeenCalledOnce();
  expect(reports.refresh).toHaveBeenCalledOnce();
});

test('a pending refresh disables another request and exposes source failures', () => {
  reports.refreshing = true;
  project.problem = 'GitHub authentication is required.';
  render(<Dashboard />);
  expect((screen.getByTestId('dashboard-refresh') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByTestId('dashboard-problem').textContent).toContain('authentication');
});

test('unsupported overrides remain visible with their fallback diagnostic', () => {
  const state = reportState();
  if (state.definition === null) throw Error('fixture');
  state.definition.source = 'packaged-default';
  state.definition.diagnostic = {
    kind: 'unsupported-version',
    message: 'This dashboard definition is version 1.',
  };
  reports.state = state;
  render(<Dashboard />);
  expect(screen.getByTestId('dashboard-definition-diagnostic').getAttribute('role')).toBe('alert');
  expect(screen.getByTestId('dashboard-definition-diagnostic').textContent).toContain(
    'Showing a valid fallback',
  );
  expect(screen.getByTestId('dashboard-refresh-status').textContent).toContain('packaged default');
});

test('provenance is hidden until Details is opened, while accepted data and refresh failures remain distinct', () => {
  const state = reportState();
  state.report = {
    components: [],
    definitionHash: 'hash',
    basis: 'Issue 42',
    sessionId: 'private-session-17',
    receivedAt: '2026-09-21T11:55:00Z',
    stale: true,
    staleReason: 'project-changed',
  };
  state.refresh = {
    ...state.refresh,
    status: 'failed',
    failure: { kind: 'failed', message: 'PM refresh unavailable' },
  };
  reports.state = state;
  project.project = projectState({
    state: 'offline',
    failure: { kind: 'unreachable', message: 'No network', at: '2026-09-21T11:56:00Z' },
  });
  render(<Dashboard />);
  expect(screen.queryByText(/private-session-17/)).toBeNull();
  expect(screen.getByTestId('dashboard-state-name').textContent).toBe('offline');
  expect(screen.getByTestId('dashboard-refresh-failure').textContent).toContain(
    'Previous accepted',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByTestId('dashboard-details').textContent).toContain('private-session-17');
  expect(screen.getByTestId('dashboard-details').textContent).toContain('Issue 42');
  expect(screen.getByTestId('dashboard-state-sentence').textContent).toContain('No network');
});
