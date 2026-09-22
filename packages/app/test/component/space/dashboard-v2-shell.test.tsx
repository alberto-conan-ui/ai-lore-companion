import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardV2 } from '../../../src/renderer/src/space/dashboard/v2/DashboardV2.js';
import { OverflowFooter, capItems } from '../../../src/renderer/src/space/dashboard/v2/overflow.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DashboardV2 shell', () => {
  it('renders three Band 1 slots and three row-2 slots', () => {
    render(<DashboardV2 />);
    expect(screen.getByTestId('dashboard-v2-header')).toBeTruthy();
    expect(screen.getByTestId('dashboard-v2-band1').children).toHaveLength(3);
    expect(screen.getByTestId('dashboard-v2-row2').children).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'NEEDS YOU' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHAT IS MOVING' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHAT IS WAITING' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'HANDOVERS' })).toBeTruthy();
  });
});

describe('v2 overflow', () => {
  it('caps visible rows and reports the hidden count without a scrollbar', () => {
    const result = capItems(
      Array.from({ length: 12 }, (_, index) => index),
      4,
    );
    expect(result.visible).toEqual([0, 1, 2, 3]);
    expect(result.hiddenCount).toBe(8);
    render(<OverflowFooter hiddenCount={result.hiddenCount} noun="in progress" />);
    expect(screen.getByTestId('dashboard-v2-overflow').textContent).toContain(
      '+8 more in progress',
    );
  });

  it('does not render an overflow footer when no rows are hidden', () => {
    render(<OverflowFooter hiddenCount={0} />);
    expect(screen.queryByTestId('dashboard-v2-overflow')).toBeNull();
  });
});
