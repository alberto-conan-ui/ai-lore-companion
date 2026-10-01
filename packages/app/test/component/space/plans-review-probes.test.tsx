import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { usePlansState } from '../../../src/renderer/src/space/dashboard/usePlansState.js';
import { BandPlans } from '../../../src/renderer/src/space/dashboard/v2/BandPlans.js';

const T0 = 1800000000000;
function Hook() {
  const view = usePlansState();
  return <BandPlans view={view} now={Date.now()} />;
}
function state(version = 1) {
  return {
    version,
    reading: false,
    outcome: 'complete',
    units: [],
    readAt: Date.now(),
    lastReadAt: Date.now(),
    head: '',
    text: '',
    missing: [],
    note: '',
    leftOut: [],
    demo: false,
  };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a read finishing after unmount must not restart polling', async () => {
  vi.useFakeTimers({ now: T0 });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  let finish!: (x: unknown) => void;
  const refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockImplementation(async () => ({ ok: true, value: state(10) }));
  Object.assign(window, {
    cockpit: {
      onSpacePlansState: () => () => {},
      spacePlansState: async () => ({ ok: true, value: { ...state(), outcome: null } }),
      spacePlansRefresh: refresh,
    },
  });
  const mounted = render(<Hook />);
  await act(async () => {});
  expect(refresh).toHaveBeenCalledTimes(1);
  mounted.unmount();
  await act(async () => {
    finish({ ok: true, value: state(2) });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(95000);
  });
  console.log('refresh calls after closing the dashboard:', refresh.mock.calls.length);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('a slow refresh must withdraw the minute promise before its timeout', async () => {
  vi.useFakeTimers({ now: T0 });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  let push: (x: unknown) => void = () => {};
  const initial = state();
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, value: initial })
    .mockImplementation(() => {
      push({ ...initial, version: 2, reading: true });
      return new Promise(() => {});
    });
  Object.assign(window, {
    cockpit: {
      onSpacePlansState: (fn: (x: unknown) => void) => {
        push = fn;
        return () => {};
      },
      spacePlansState: async () => ({ ok: true, value: initial }),
      spacePlansRefresh: refresh,
    },
  });
  const mounted = render(<Hook />);
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100000);
  });
  mounted.rerender(<Hook />);
  console.log('band at 100 seconds:', screen.getByTestId('dashboard-v2-plans').textContent);
  expect(screen.getByTestId('dashboard-v2-plans').textContent).toMatch(
    /minute is not promised|not current|too long/i,
  );
});
