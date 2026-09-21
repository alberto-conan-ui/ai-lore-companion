import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDashboardDefinition } from '../../../src/renderer/src/space/dashboard/useDashboardDefinition.js';
import type { DashboardReportState } from '../../../src/shared/ipc.js';

const snapshot = (
  version: number,
  status: 'idle' | 'updating' | 'updated',
): DashboardReportState => ({
  version,
  definition: null,
  context: null,
  report: null,
  refresh: { status, requestId: null, reason: null, requestedAt: null, failure: null },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(cleanup);

test('a late initial read cannot undo a pushed refresh lifecycle', async () => {
  const read = deferred<{ ok: true; value: DashboardReportState }>();
  let push!: (state: DashboardReportState) => void;
  const off = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceDashboardReport: () => read.promise,
    onSpaceDashboardReport: (listener: typeof push) => {
      push = listener;
      return off;
    },
  };
  const { result, unmount } = renderHook(useDashboardDefinition);
  act(() => push(snapshot(2, 'updating')));
  await act(async () => read.resolve({ ok: true, value: snapshot(1, 'idle') }));
  expect(result.current.state?.version).toBe(2);
  expect(result.current.refreshing).toBe(true);
  act(() => push(snapshot(3, 'updated')));
  expect(result.current.refreshing).toBe(false);
  unmount();
  expect(off).toHaveBeenCalledOnce();
});

test('an old refresh response cannot replace a newer accepted push', async () => {
  const refresh = deferred<{ ok: true; value: DashboardReportState }>();
  let push!: (state: DashboardReportState) => void;
  const request = vi.fn(() => refresh.promise);
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceDashboardReport: async () => ({ ok: true, value: snapshot(1, 'idle') }),
    spaceDashboardRefresh: request,
    onSpaceDashboardReport: (listener: typeof push) => {
      push = listener;
      return () => {};
    },
  };
  const { result } = renderHook(useDashboardDefinition);
  await waitFor(() => expect(result.current.state?.version).toBe(1));
  act(() => result.current.refresh());
  expect(request).toHaveBeenCalledWith({ reason: 'human' });
  act(() => push(snapshot(3, 'updated')));
  await act(async () => refresh.resolve({ ok: true, value: snapshot(2, 'updating') }));
  expect(result.current.state?.version).toBe(3);
  expect(result.current.refreshing).toBe(false);
});
