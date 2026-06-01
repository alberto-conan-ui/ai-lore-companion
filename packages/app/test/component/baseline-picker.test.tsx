import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BaselinePicker } from '../../src/renderer/src/components/BaselinePicker.js';
import { useCockpitStore } from '../../src/renderer/src/store.js';
import type { CommitListEntry } from '../../src/shared/ipc.js';

const c = (sha: string, timestamp: number, subject = sha): CommitListEntry => ({
  sha,
  subject,
  timestamp,
});

beforeEach(() => {
  (window as unknown as { cockpit: { setBaseline: ReturnType<typeof vi.fn> } }).cockpit = {
    setBaseline: vi.fn().mockResolvedValue(undefined),
  };
  // One save-point with a later ack — the newest commit in its open run. Rollup
  // resolves the save-point to that bound ack (pAck/lAck), so the default
  // baseline is that pair — a baseline-only match highlights the save-point.
  useCockpitStore.setState({
    savePoints: [
      {
        name: 'SP',
        title: 'Save point',
        date: '2026-05-29',
        payloadCommit: 'pSP',
        loreCommit: 'lSP',
      },
    ],
    commitListByScope: {
      payload: [
        c('pAck', 300, 'latest ack'),
        c('pSP', 200, 'the save point'),
        c('p0', 100, 'seed'),
      ],
      lore: [c('lAck', 300, 'lore ack'), c('lSP', 200, 'lore sp'), c('l0', 100, 'lore seed')],
    },
    baselineByScope: { payload: 'pAck', lore: 'lAck' },
  });
});

afterEach(() => {
  cleanup();
});

test('rollup defaults on; turning it off un-rolls to the bound ack and lets the save-point select its own commit', () => {
  render(<BaselinePicker />);
  // Default: rollup on → the save-point is the active milestone, acks hidden.
  expect(screen.getByTestId('baseline-picker').textContent).toContain('Save point');
  fireEvent.click(screen.getByTestId('baseline-picker'));
  expect(screen.queryByTestId('baseline-option-ack:pAck')).toBeNull();

  // Turn rollup OFF → acks appear, and the highlight moves to the bound ack
  // the save-point rolled up to (the baseline itself didn't change).
  fireEvent.click(screen.getByTestId('baseline-rollup-acks'));
  expect(screen.getByTestId('baseline-option-ack:pAck')).toBeTruthy();
  expect(screen.getByTestId('baseline-picker').textContent).toContain('latest ack');

  // With rollup off, selecting the save-point selects its OWN commit (pSP/lSP),
  // not the rolled-up ack.
  fireEvent.click(screen.getByTestId('baseline-option-sp:SP'));
  const setBaseline = (window as unknown as { cockpit: { setBaseline: ReturnType<typeof vi.fn> } })
    .cockpit.setBaseline;
  expect(setBaseline).toHaveBeenCalledWith({ scope: 'payload', baseline: 'pSP' });
  expect(setBaseline).toHaveBeenCalledWith({ scope: 'lore', baseline: 'lSP' });
  expect(screen.getByTestId('baseline-picker').textContent).toContain('Save point');
});
