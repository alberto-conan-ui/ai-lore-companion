import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PmReport } from '../../../src/renderer/src/space/dashboard/PmReport.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type { DashboardReportState } from '../../../src/shared/ipc.js';

const report = (over: Partial<NonNullable<DashboardReportState['report']>> = {}) => ({
  markdown: 'A literal report.',
  basis: null,
  sessionId: 'pm-1',
  receivedAt: '2026-09-20T18:00:00.000Z',
  stale: false,
  staleReason: null,
  ...over,
});

let pushed: ((state: DashboardReportState) => void) | null = null;
let unsubscribed = 0;
const cockpit = {
  spaceDashboardReport: vi.fn<(arg: unknown) => Promise<unknown>>(),
  onSpaceDashboardReport: vi.fn((listener: (state: DashboardReportState) => void) => {
    pushed = listener;
    return () => {
      unsubscribed += 1;
      pushed = null;
    };
  }),
};

beforeEach(() => {
  pushed = null;
  unsubscribed = 0;
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceDashboardReport.mockResolvedValue({
    ok: true,
    value: { version: 1, report: null },
  });
  useSpaceNavStore.setState({ screen: 'dashboard' });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test('reads a report and renders its Markdown as literal text, never HTML', async () => {
  const markdown = '<img src=x onerror=alert(1)>\n<script>alert(2)</script>\n**plain**';
  cockpit.spaceDashboardReport.mockResolvedValue({
    ok: true,
    value: { version: 3, report: report({ markdown, basis: 'Lore and Project cache' }) },
  });
  render(<PmReport />);

  const text = await screen.findByTestId('pm-report-text');
  expect(text.textContent).toBe(markdown);
  expect(text.querySelector('img')).toBeNull();
  expect(text.querySelector('script')).toBeNull();
  expect(screen.getByTestId('pm-report-basis').textContent).toContain('Lore and Project cache');
});

test('ignores an older initial or pushed state, then shows a stale newer report', async () => {
  let resolveRead: ((value: unknown) => void) | null = null;
  cockpit.spaceDashboardReport.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  render(<PmReport />);
  await waitFor(() => expect(cockpit.onSpaceDashboardReport).toHaveBeenCalledTimes(1));

  act(() =>
    pushed?.({
      version: 4,
      report: report({ markdown: 'Newest report.' }),
    }),
  );
  resolveRead?.({
    ok: true,
    value: { version: 3, report: report({ markdown: 'Older read.' }) },
  });
  await screen.findByText('Newest report.');

  act(() => pushed?.({ version: 3, report: report({ markdown: 'Older report.' }) }));
  expect(screen.getByTestId('pm-report-text').textContent).toBe('Newest report.');

  act(() =>
    pushed?.({
      version: 5,
      report: report({
        markdown: 'The Project changed after this report.',
        stale: true,
        staleReason: 'project-changed',
      }),
    }),
  );
  expect(screen.getByTestId('pm-report-text').textContent).toBe(
    'The Project changed after this report.',
  );
  expect(screen.getByTestId('pm-report-stale').textContent).toMatch(/out of date/i);
});

test('shows a read failure and unsubscribes when the Dashboard unmounts', async () => {
  cockpit.spaceDashboardReport.mockResolvedValue({
    ok: false,
    error: { kind: 'not-a-space-window', message: 'The report is unavailable.' },
  });
  const view = render(<PmReport />);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe('The report is unavailable.'),
  );
  view.unmount();
  expect(unsubscribed).toBe(1);
});

test('Talk to PM navigates to Sessions', async () => {
  render(<PmReport />);
  fireEvent.click(screen.getByRole('button', { name: 'Talk to PM in Sessions' }));
  expect(useSpaceNavStore.getState().screen).toBe('sessions');
});
