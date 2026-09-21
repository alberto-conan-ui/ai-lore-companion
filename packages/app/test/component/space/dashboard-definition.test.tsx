import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { DashboardContent } from '../../../src/renderer/src/space/dashboard/v2/DashboardContent.js';
import {
  DASHBOARD_NOW,
  projectState,
  reportState,
  repositoriesState,
} from './dashboard-fixtures.js';

afterEach(cleanup);

test('custom v2 PM panels retain typed values and definition order within a band', () => {
  const state = reportState();
  if (state.definition === null) throw Error('fixture');
  state.definition.definition = {
    version: 2,
    bands: [
      {
        id: 'moving',
        panels: [
          { id: 'count', kind: 'metric', source: 'pm', title: 'Count' },
          { id: 'position', kind: 'text', source: 'pm', title: 'Position' },
          { id: 'blockers', kind: 'list', source: 'pm', title: 'Blockers', limit: 1 },
        ],
      },
    ],
  };
  state.report = {
    components: [
      { id: 'count', type: 'metric', value: 3, unit: 'items' },
      { id: 'position', type: 'text', text: 'Evidence is current.' },
      {
        id: 'blockers',
        type: 'list',
        items: [
          { id: 'one', label: 'One blocker' },
          { id: 'two', label: 'Hidden blocker' },
        ],
      },
    ],
    definitionHash: 'hash',
    basis: null,
    sessionId: 'pm',
    receivedAt: '2026-09-21T12:00:00Z',
    stale: false,
    staleReason: null,
  };
  render(
    <DashboardContent
      project={projectState()}
      repositories={repositoriesState()}
      reportState={state}
      now={DASHBOARD_NOW}
      header={<h1>Dashboard</h1>}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.getByText('Evidence is current.')).toBeTruthy();
  expect(screen.getByText('One blocker')).toBeTruthy();
  expect(screen.queryByText('Hidden blocker')).toBeNull();
  const body = screen.getByTestId('dashboard-v2').textContent ?? '';
  expect(body.indexOf('Count')).toBeLessThan(body.indexOf('Position'));
  expect(body.indexOf('Position')).toBeLessThan(body.indexOf('Blockers'));
});

test('a report for another definition never supplies a PM panel value', () => {
  const state = reportState();
  if (state.definition === null) throw Error('fixture');
  state.definition.definition = {
    version: 2,
    bands: [
      { id: 'moving', panels: [{ id: 'position', kind: 'text', source: 'pm', title: 'Position' }] },
    ],
  };
  state.report = {
    components: [{ id: 'position', type: 'text', text: 'Wrong definition prose' }],
    definitionHash: 'older-hash',
    basis: null,
    sessionId: 'pm',
    receivedAt: '2026-09-21T12:00:00Z',
    stale: false,
    staleReason: null,
  };
  render(
    <DashboardContent
      project={projectState()}
      repositories={repositoriesState()}
      reportState={state}
      now={DASHBOARD_NOW}
      header={<h1>Dashboard</h1>}
      onOpenFocus={() => {}}
    />,
  );
  expect(screen.queryByText('Wrong definition prose')).toBeNull();
});
