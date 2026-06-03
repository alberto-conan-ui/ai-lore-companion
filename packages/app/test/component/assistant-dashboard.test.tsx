import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { AssistantDashboard } from '../../src/renderer/src/components/AssistantDashboard.js';

afterEach(() => {
  cleanup();
  (window as unknown as { cockpit?: unknown }).cockpit = undefined;
});

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

// CR10 — the structured egress: the dashboard hydrates from a `report_dashboard`
// MCP tool call delivered on `onHelperReport`, as validated data — not scraped
// from the `answer` text. Mock the channel, fire a report, assert the board swaps.
test('a report_dashboard tool call hydrates the board (structured, no text scrape)', () => {
  let cb: ((r: { sessionId: string; tool: string; payload: unknown }) => void) | undefined;
  (window as unknown as { cockpit: unknown }).cockpit = {
    onHelperReport: (fn: typeof cb) => {
      cb = fn;
      return () => {};
    },
  };
  render(<AssistantDashboard />);
  // Starts on the hand-written sample (the active focus is "AI Helper").
  expect(screen.queryByText('Injected Focus')).toBeNull();

  const board = {
    project: 'P',
    rollup: { inPlay: 1, active: 1, hanging: 0, looseEnds: 0 },
    focuses: [
      {
        id: 'x',
        name: 'Injected Focus',
        kind: 'active',
        line: 'the live line',
        estimate: 50,
        steps: [{ name: 'a step', line: 'l', verdict: 'in-progress', progress: 50, active: true }],
      },
    ],
  };
  act(() => cb?.({ sessionId: 's1', tool: 'report_dashboard', payload: board }));

  // The board swapped to the reported data — no parsing of stdout involved.
  expect(screen.getByText('Injected Focus')).toBeTruthy();
  expect(screen.queryByText('AI Helper')).toBeNull();
});

test('a report with an invalid board shape is rejected, not rendered', () => {
  let cb: ((r: { sessionId: string; tool: string; payload: unknown }) => void) | undefined;
  (window as unknown as { cockpit: unknown }).cockpit = {
    onHelperReport: (fn: typeof cb) => {
      cb = fn;
      return () => {};
    },
  };
  render(<AssistantDashboard />);
  act(() => cb?.({ sessionId: 's1', tool: 'report_dashboard', payload: { not: 'a board' } }));
  // The sample board still stands; the bad shape did not replace it.
  expect(screen.getByText('AI Helper')).toBeTruthy();
});

// CR10 — the curation ops report structured too: Humanize fires `helperHumanize`
// and the rewrites come back on `onHelperReport` as `report_humanized`, applied
// to the picked rows in order (no text scrape). Drive it end-to-end.
test('Humanize fires helperHumanize and a report_humanized call rewords the picked rows', () => {
  let reportCb: ((r: { sessionId: string; tool: string; payload: unknown }) => void) | undefined;
  let eventCb: ((e: { sessionId: string; phase: string; ptyId?: string }) => void) | undefined;
  const humanizeCalls: string[][] = [];
  (window as unknown as { cockpit: unknown }).cockpit = {
    onHelperReport: (fn: typeof reportCb) => {
      reportCb = fn;
      return () => {};
    },
    onHelperEvent: (fn: typeof eventCb) => {
      eventCb = fn;
      return () => {};
    },
    helperHumanize: (texts: string[]) => {
      humanizeCalls.push(texts);
      return Promise.resolve();
    },
  };
  render(<AssistantDashboard />);
  // Mark the session ready → connected, not busy → the op can fire.
  act(() => eventCb?.({ sessionId: 's1', phase: 'ready' }));

  // Pick the first two loose-ends and Humanize them.
  const looseRows = screen.getAllByTestId('loose-row');
  const looseChecks = looseRows.map(
    (row) => row.querySelector('[data-testid="item-check"]') as HTMLElement,
  );
  fireEvent.click(looseChecks[0]);
  fireEvent.click(looseChecks[1]);
  fireEvent.click(screen.getByTestId('op-humanize'));

  // The app sent the two picked rows' texts over the structured channel.
  expect(humanizeCalls).toHaveLength(1);
  expect(humanizeCalls[0]).toHaveLength(2);

  // The rewrites report back as a typed tool call and replace the picked rows.
  act(() =>
    reportCb?.({
      sessionId: 's1',
      tool: 'report_humanized',
      payload: ['a friendly first line', 'a friendly second line'],
    }),
  );
  expect(screen.getByText('a friendly first line')).toBeTruthy();
  expect(screen.getByText('a friendly second line')).toBeTruthy();
});

// Consolidate: fire `helperConsolidate`, then a `report_consolidation` tool call
// opens the merge proposal — the typed successor to scraping a {title,text} blob.
test('Consolidate fires helperConsolidate and a report_consolidation call opens the proposal', () => {
  let reportCb: ((r: { sessionId: string; tool: string; payload: unknown }) => void) | undefined;
  let eventCb: ((e: { sessionId: string; phase: string; ptyId?: string }) => void) | undefined;
  const consolidateCalls: string[][] = [];
  (window as unknown as { cockpit: unknown }).cockpit = {
    onHelperReport: (fn: typeof reportCb) => {
      reportCb = fn;
      return () => {};
    },
    onHelperEvent: (fn: typeof eventCb) => {
      eventCb = fn;
      return () => {};
    },
    helperConsolidate: (texts: string[]) => {
      consolidateCalls.push(texts);
      return Promise.resolve();
    },
  };
  render(<AssistantDashboard />);
  act(() => eventCb?.({ sessionId: 's1', phase: 'ready' }));

  const looseChecks = screen
    .getAllByTestId('loose-row')
    .map((row) => row.querySelector('[data-testid="item-check"]') as HTMLElement);
  fireEvent.click(looseChecks[0]);
  fireEvent.click(looseChecks[1]);
  fireEvent.click(screen.getByTestId('op-consolidate'));

  expect(consolidateCalls).toHaveLength(1);
  expect(consolidateCalls[0]).toHaveLength(2);

  act(() =>
    reportCb?.({
      sessionId: 's1',
      tool: 'report_consolidation',
      payload: { title: 'Merged thing', text: 'one combined piece of work' },
    }),
  );
  expect(screen.getByTestId('consolidate-proposal')).toBeTruthy();
  expect(screen.getByText('Merged thing')).toBeTruthy();
});

/* ---------- parent toggle + separate select-all (CR10 UX) ---------- */

test('the header "select all" ticks every child box (without selecting the focus itself)', () => {
  render(<AssistantDashboard />);
  const card = screen.getByText('AI Helper').closest('[data-testid="focus-card"]') as HTMLElement;
  const selectAll = within(card).getByTestId('focus-selectall');
  const parent = within(card).getByTestId('focus-parent') as HTMLInputElement;
  const boxes = within(card).getAllByTestId('item-check') as HTMLInputElement[];
  expect(boxes.length).toBeGreaterThanOrEqual(2);

  fireEvent.click(selectAll); // ticks the children…
  expect(boxes.every((c) => c.checked)).toBe(true);
  expect(parent.checked).toBe(false); // …but NOT the parent (independent)
  expect(screen.getByTestId('ask-toolbar').textContent).toMatch(
    new RegExp(`${boxes.length} selected`),
  );

  fireEvent.click(selectAll); // toggles back to clear
  expect(boxes.some((c) => c.checked)).toBe(false);
});

test('the parent toggle selects the focus itself without ticking any child box', () => {
  render(<AssistantDashboard />);
  const card = screen.getByText('AI Helper').closest('[data-testid="focus-card"]') as HTMLElement;
  const parent = within(card).getByTestId('focus-parent') as HTMLInputElement;
  const boxes = within(card).getAllByTestId('item-check') as HTMLInputElement[];

  fireEvent.click(parent);
  expect(parent.checked).toBe(true);
  expect(boxes.some((c) => c.checked)).toBe(false); // children untouched — decoupled
  // The whole focus is the Consolidate clue; Humanize/Ask (child ops) don't show.
  expect(screen.getByTestId('op-consolidate')).toBeTruthy();
  expect(screen.queryByTestId('op-humanize')).toBeNull();
});

test('Consolidate offers for 2+ items in a single focus — steps, not just loose-ends', () => {
  render(<AssistantDashboard />);
  const card = screen.getByText('AI Helper').closest('[data-testid="focus-card"]') as HTMLElement;
  const steps = within(card).getAllByTestId('item-check') as HTMLInputElement[];
  fireEvent.click(steps[0]);
  expect(screen.queryByTestId('op-consolidate')).toBeNull(); // one isn't enough
  fireEvent.click(steps[1]);
  expect(screen.getByTestId('op-consolidate')).toBeTruthy(); // two steps in one focus → mergeable
});

test('Consolidate hides when the selection spans two focuses', () => {
  render(<AssistantDashboard />);
  const aiCard = screen.getByText('AI Helper').closest('[data-testid="focus-card"]') as HTMLElement;
  const step = within(aiCard).getAllByTestId('item-check')[0];
  const loose = screen
    .getAllByTestId('loose-row')[0]
    .querySelector('[data-testid="item-check"]') as HTMLElement;
  fireEvent.click(step);
  fireEvent.click(loose);
  expect(screen.getByTestId('ask-toolbar').textContent).toMatch(/2 selected/);
  expect(screen.queryByTestId('op-consolidate')).toBeNull(); // spans two focuses — ambiguous
});
