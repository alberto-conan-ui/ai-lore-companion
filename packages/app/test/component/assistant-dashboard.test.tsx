import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { AssistantDashboard } from '../../src/renderer/src/components/AssistantDashboard.js';

afterEach(() => cleanup());

// Design-first spike: a near-verbatim port of the Claude "Direction A" mock,
// rendered from hand-written sample data (no AI yet). These pin the shape — a
// portfolio of work-streams plus scored Lore & Code signals.

test('renders the header — project headline + an overall verdict', () => {
  render(<AssistantDashboard />);
  expect(screen.getByTestId('dashboard-headline').textContent).toBeTruthy();
  expect(screen.getByTestId('dashboard-overall').textContent).toMatch(
    /track|progress|risk|blocked|started/i,
  );
});

test('one row per focus, with a single "you are here" on the active stream', () => {
  render(<AssistantDashboard />);
  expect(screen.getByTestId('dashboard-streams')).toBeTruthy();
  expect(screen.getAllByTestId('dashboard-here')).toHaveLength(1);
});

test('renders domain-specific scored health cards', () => {
  render(<AssistantDashboard />);
  // Status has 2+ signals; each shows a score out of 100.
  expect(screen.getAllByTestId('dashboard-signal').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByTestId('dashboard-score')[0].textContent).toMatch(/^\d+$/);
});

test('a score card toggles its detail (aria-expanded flips)', () => {
  render(<AssistantDashboard />);
  const toggle = screen.getAllByTestId('dashboard-toggle')[0];
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); // open by default
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

test('keeps the save-point "caught up" anchor and the watch list', () => {
  render(<AssistantDashboard />);
  expect(screen.getByTestId('dashboard-caughtup')).toBeTruthy();
  expect(screen.getByTestId('dashboard-watch')).toBeTruthy();
});

test('Status / Payload / Memory tabs each swap in their own dashboard', () => {
  render(<AssistantDashboard />);
  // Status (default) shows the project headline.
  expect(screen.getByTestId('dashboard-headline').textContent).toMatch(/AI assistant/i);
  fireEvent.click(screen.getByTestId('assistant-tab-payload'));
  expect(screen.getByTestId('dashboard-headline').textContent).toMatch(/Electron/i);
  fireEvent.click(screen.getByTestId('assistant-tab-memory'));
  expect(screen.getByTestId('dashboard-headline').textContent).toMatch(/memory/i);
});
