import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Handovers } from '../../../src/renderer/src/space/dashboard/v2/Handovers.js';
import type { DashboardReportState, DashboardWorkbenchHandover } from '../../../src/shared/ipc.js';

const now = Date.parse('2026-09-21T12:00:00.000Z');
const panels = [{ id: 'handovers', kind: 'handovers', source: 'companion' }] as const;

function state(handovers: DashboardWorkbenchHandover[]): DashboardReportState {
  return {
    version: 1,
    definition: null,
    context: {
      observedAt: '2026-09-21T12:00:00.000Z',
      documents: [],
      handovers,
      activity: [],
      problems: [],
    },
    report: null,
    refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
  };
}

function handover(overrides: Partial<DashboardWorkbenchHandover> = {}): DashboardWorkbenchHandover {
  return {
    id: 'h1',
    path: 'handover.md',
    title: 'Session one',
    sessionId: 's1',
    text: 'raw note',
    parts: {
      done: 'shipped it',
      inProgress: 'checking it',
      nextAction: 'Review the result',
      text: 'raw note',
      fallback: false,
    },
    timestamp: '2026-09-21T11:00:00.000Z',
    timestampKind: 'creation',
    modifiedAt: '2026-09-21T11:00:00.000Z',
    historical: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe('Handovers', () => {
  it('marks the newest card and uses the parsed next action as its headline', () => {
    render(
      <Handovers
        panels={panels}
        reportState={state([
          handover(),
          handover({
            id: 'h2',
            title: 'Older',
            timestamp: '2026-09-20T11:00:00.000Z',
            parts: {
              done: null,
              inProgress: null,
              nextAction: 'Older action',
              text: 'raw note',
              fallback: false,
            },
          }),
        ])}
        now={now}
      />,
    );
    expect(screen.getByText('● LATEST')).toBeTruthy();
    expect(screen.getByText('Review the result')).toBeTruthy();
    expect(screen.getByText('Session one')).toBeTruthy();
  });

  it('opens all non-null parts as sections and closes on Escape', () => {
    render(<Handovers panels={panels} reportState={state([handover()])} now={now} />);
    fireEvent.click(screen.getByTestId('handover-card'));
    expect(screen.getByTestId('handover-sheet')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'NEXT ACTION' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHAT HAPPENED' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHERE THINGS STAND' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('handover-sheet')).toBeNull();
  });

  it('closes from the backdrop and Close button and restores card focus', async () => {
    render(<Handovers panels={panels} reportState={state([handover()])} now={now} />);
    const card = screen.getByTestId('handover-card');
    card.focus();
    fireEvent.click(card);
    fireEvent.pointerDown(screen.getByTestId('handover-sheet-backdrop'));
    expect(screen.queryByTestId('handover-sheet')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(card));

    fireEvent.click(card);
    fireEvent.click(screen.getByTestId('handover-sheet-close'));
    expect(screen.queryByTestId('handover-sheet')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('renders the fallback note as typography when no part was parsed', () => {
    const empty = handover({
      parts: {
        done: null,
        inProgress: null,
        nextAction: null,
        text: '### A note\nKeep this exactly.',
        fallback: true,
      },
    });
    render(<Handovers panels={panels} reportState={state([empty])} now={now} />);
    expect(screen.getByText('A note')).toBeTruthy();
    fireEvent.click(screen.getByTestId('handover-card'));
    expect(screen.getByRole('heading', { name: 'NOTE' })).toBeTruthy();
    expect(
      screen.getByText(
        'The three parts of this handover could not be read; the note is shown as written.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText((text) => text.startsWith('###'))).toBeNull();
  });

  it('caps the column at five and reports omitted handovers', () => {
    const entries = Array.from({ length: 6 }, (_, index) =>
      handover({
        id: `h${index}`,
        title: `Session ${index}`,
        timestamp: `2026-09-${String(21 - index).padStart(2, '0')}T11:00:00.000Z`,
      }),
    );
    render(<Handovers panels={panels} reportState={state(entries)} now={now} />);
    expect(screen.getByText('6 RECENT')).toBeTruthy();
    expect(screen.getByText('+1 more handovers')).toBeTruthy();
  });
});

it('renders full handover formatting as safe typography', () => {
  const note = handover({
    parts: {
      done: '### Checks\n- **Verified** the `build` output.\n- No unsafe HTML: <script>alert(1)</script>',
      inProgress: null,
      nextAction: '**Review** the result',
      text: '',
      fallback: false,
    },
  });
  render(<Handovers panels={panels} reportState={state([note])} now={now} />);
  expect(screen.getByText('Review the result')).toBeTruthy();
  fireEvent.click(screen.getByTestId('handover-card'));
  expect(screen.getByRole('heading', { name: 'Checks' })).toBeTruthy();
  expect(screen.getByRole('list')).toBeTruthy();
  expect(screen.getByText('Verified').tagName).toBe('STRONG');
  expect(screen.getByText('build').tagName).toBe('CODE');
  expect(screen.getByTestId('handover-sheet').querySelector('script')).toBeNull();
  expect(screen.getByText(/No unsafe HTML/).textContent).toContain('<script>');
});
