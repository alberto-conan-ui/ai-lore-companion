import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { AssistantDashboard } from '../../src/renderer/src/components/AssistantDashboard.js';

afterEach(() => cleanup());

// Design-first spike (hand-written sample data, no AI yet). The Status tab is a
// stack of focus widgets — one per focus in scope, flexing by state; Payload and
// Memory stay the scored "Direction A" dashboard.

test('Status tab: a slim roll-up line + a stack of focus widgets', () => {
  render(<AssistantDashboard />);
  expect(screen.getByTestId('focus-rollup').textContent).toMatch(/focuses in play/i);
  // Every focus in scope gets a widget — active + hanging + headless.
  expect(screen.getAllByTestId('focus-card').length).toBeGreaterThanOrEqual(3);
});

test('the active focus shows derived steps with a single "you are here"', () => {
  render(<AssistantDashboard />);
  const active = screen.getByText('AI Helper').closest('[data-focus-state]');
  expect(active?.getAttribute('data-focus-state')).toBe('active');
  expect(screen.getByTestId('focus-steps')).toBeTruthy();
  expect(screen.getAllByTestId('dashboard-here')).toHaveLength(1);
});

test('a hanging (achieved-but-unarchived) focus is shown and flagged', () => {
  render(<AssistantDashboard />);
  const hanging = screen.getByText('Companion v0.9.4').closest('[data-focus-state]');
  expect(hanging?.getAttribute('data-focus-state')).toBe('hanging');
  expect(screen.getByTestId('focus-hanging').textContent).toMatch(/archive/i);
});

test('the headless focus collects loose-ends from a project-wide sweep', () => {
  render(<AssistantDashboard />);
  expect(screen.getByTestId('headless-list')).toBeTruthy();
  expect(screen.getByTestId('headless-count').textContent).toMatch(/loose ends/i);
});

test('every focus step and loose-end is selectable (checkboxes on all items)', () => {
  render(<AssistantDashboard />);
  // 6 active-focus steps + 8 loose-ends; the hanging focus + staleness have no checkbox.
  expect(screen.getAllByTestId('item-check').length).toBe(14);
});

test('sign-off staleness is its own banner, not a loose-end', () => {
  render(<AssistantDashboard />);
  const stale = screen.getByTestId('staleness');
  expect(stale.textContent).toMatch(/sign-off/i);
  expect(stale.textContent).toMatch(/behind/i);
  // and it's no longer one of the loose-ends
  expect(screen.getAllByTestId('loose-row').length).toBe(8);
});

test('selecting items reveals the toolbar with the count + Humanize/Ask; Ask opens the drawer', () => {
  render(<AssistantDashboard />);
  expect(screen.queryByTestId('ask-batch')).toBeNull(); // nothing selected yet
  const checks = screen.getAllByTestId('item-check');
  fireEvent.click(checks[0]);
  fireEvent.click(checks[1]);
  expect(screen.getByTestId('ask-toolbar').textContent).toMatch(/2 selected/);
  // every selection offers Humanize + Ask
  expect(screen.getByTestId('op-humanize')).toBeTruthy();
  const ask = screen.getByTestId('ask-batch');
  expect(screen.queryByTestId('detail-drawer')).toBeNull(); // not until asked
  fireEvent.click(ask);
  expect(screen.getByTestId('detail-drawer')).toBeTruthy();
});

test('Consolidate appears only when 2+ loose-ends are selected', () => {
  render(<AssistantDashboard />);
  const looseChecks = screen
    .getAllByTestId('loose-row')
    .map((row) => row.querySelector('[data-testid="item-check"]') as HTMLElement);
  fireEvent.click(looseChecks[0]);
  expect(screen.queryByTestId('op-consolidate')).toBeNull(); // one isn't enough
  fireEvent.click(looseChecks[1]);
  expect(screen.getByTestId('op-consolidate')).toBeTruthy(); // two → mergeable
});

test('loose-ends expand on a single row-click, only when they carry extra info', () => {
  render(<AssistantDashboard />);
  const rows = screen.getAllByTestId('loose-row');
  const expanders = screen.getAllByTestId('loose-expand');
  // each of the 8 loose-ends carries an orienting note → expandable; the row is
  // gated on `detail`, so a bare item would show no chevron and not expand.
  expect(rows.length).toBe(8);
  expect(expanders.length).toBe(8);
  // a single click anywhere on the row toggles expansion, without selecting it
  const clickable = rows[0].querySelector('[aria-expanded]') as HTMLElement;
  expect(clickable.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(clickable);
  expect(clickable.getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByTestId('ask-batch')).toBeNull(); // expanding did not select
});

test('Payload / Memory tabs keep their scored dashboards', () => {
  render(<AssistantDashboard />);
  fireEvent.click(screen.getByTestId('assistant-tab-payload'));
  expect(screen.getByTestId('dashboard-headline').textContent).toMatch(/Electron/i);
  expect(screen.getAllByTestId('dashboard-signal').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByTestId('dashboard-caughtup')).toBeTruthy();
  fireEvent.click(screen.getByTestId('assistant-tab-memory'));
  expect(screen.getByTestId('dashboard-headline').textContent).toMatch(/memory/i);
});

test('a Payload score card toggles its detail (aria-expanded flips)', () => {
  render(<AssistantDashboard />);
  fireEvent.click(screen.getByTestId('assistant-tab-payload'));
  const toggle = screen.getAllByTestId('dashboard-toggle')[0];
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); // open by default
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
