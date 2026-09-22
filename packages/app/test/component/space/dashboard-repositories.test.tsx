import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useProjectState } from '../../../src/renderer/src/space/dashboard/useProjectState.js';
import { useRepositoriesState } from '../../../src/renderer/src/space/dashboard/useRepositoriesState.js';
import type { SpaceProjectState, SpaceRepositoriesState } from '../../../src/shared/ipc.js';
import { projectState, repositoriesState } from './dashboard-fixtures.js';

afterEach(cleanup);
test('repository state keeps newer pushes over late initial replies and refreshes on focus', async () => {
  let resolve!: (value: unknown) => void;
  const initial = new Promise((done) => {
    resolve = done;
  });
  let push!: (value: SpaceRepositoriesState) => void;
  const focus = vi.fn(async () => ({ ok: true, value: repositoriesState() }));
  const refresh = vi.fn(async () => ({ ok: false, error: { message: 'Repository unavailable' } }));
  const off = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceRepositoriesState: () => initial,
    onSpaceRepositoriesState: (listener: typeof push) => {
      push = listener;
      return off;
    },
    spaceRepositoriesFocus: focus,
    spaceRepositoriesRefresh: refresh,
  };
  const { result, unmount } = renderHook(useRepositoriesState);
  act(() => push({ ...repositoriesState(), version: 3, readAt: '2026-09-21T12:00:00Z' }));
  await act(async () => resolve({ ok: true, value: { ...repositoriesState(), version: 1 } }));
  expect(result.current.repositories?.version).toBe(3);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(focus).toHaveBeenCalledOnce();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.problem).toBe('Repository unavailable'));
  expect(refresh).toHaveBeenCalledOnce();
  unmount();
  expect(off).toHaveBeenCalledOnce();
});

test('Project hook preserves monotonic state, source failures and focus refresh after renderer replacement', async () => {
  let resolve!: (value: unknown) => void;
  const initial = new Promise((done) => {
    resolve = done;
  });
  let push!: (value: SpaceProjectState) => void;
  const focus = vi.fn(async () => ({ ok: true, value: projectState() }));
  const refresh = vi.fn(async () => ({ ok: false, error: { message: 'Sign in to GitHub' } }));
  const off = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = {
    spaceProjectState: () => initial,
    onSpaceProjectState: (listener: typeof push) => {
      push = listener;
      return off;
    },
    spaceProjectFocus: focus,
    spaceProjectRefresh: refresh,
  };
  const { result, unmount } = renderHook(useProjectState);
  act(() => push(projectState({ version: 5, state: 'offline' })));
  await act(async () => resolve({ ok: true, value: projectState({ version: 1 }) }));
  expect(result.current.project?.version).toBe(5);
  expect(result.current.project?.state).toBe('offline');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(focus).toHaveBeenCalledOnce();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.problem).toBe('Sign in to GitHub'));
  expect(refresh).toHaveBeenCalledOnce();
  unmount();
  expect(off).toHaveBeenCalledOnce();
});
