import { useCallback, useEffect, useState } from 'react';
import type { SpaceRepositoriesState } from '../../../../shared/ipc.js';

/** What the Repositories section knows of the Space's repositories, and its one action. */
export type RepositoriesStateView = {
  /** The last state main sent, or `null` before the first answer. */
  repositories: SpaceRepositoriesState | null;
  /** The message of a request main refused, or `null`. */
  problem: string | null;
  /** Whether a refresh asked from this window has not answered yet. */
  requested: boolean;
  refresh: () => void;
};

/**
 * The Space's repositories state as main pushes it (stage D1, phase D1.4).
 * Modelled on `useProjectState.ts`: it reads the state once with
 * `spaceRepositoriesState`, then takes every `onSpaceRepositoriesState` push.
 * When the window gains focus it calls `spaceRepositoriesFocus`, whose result
 * comes by push; `refresh` calls `spaceRepositoriesRefresh`, whose result also
 * comes by push. A state replaces the shown one only when its `version` is not
 * lower, so an older push or answer never replaces a newer one.
 */
export function useRepositoriesState(): RepositoriesStateView {
  const [repositories, setRepositories] = useState<SpaceRepositoriesState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    let live = true;
    // Pushes and answers can arrive out of order: keep the state main gave last.
    const take = (next: SpaceRepositoriesState): void =>
      setRepositories((current) =>
        current === null || next.version >= current.version ? next : current,
      );
    const off = window.cockpit.onSpaceRepositoriesState((next) => {
      take(next);
      setProblem(null);
    });
    void window.cockpit.spaceRepositoriesState({}).then((read) => {
      if (!live) return;
      if (read.ok) take(read.value);
      else setProblem(read.error.message);
    });
    const onFocus = (): void => {
      void window.cockpit.spaceRepositoriesFocus({}).then((read) => {
        if (live && !read.ok) setProblem(read.error.message);
      });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const refresh = useCallback((): void => {
    setRequested(true);
    void window.cockpit.spaceRepositoriesRefresh({}).then((read) => {
      setRequested(false);
      if (!read.ok) setProblem(read.error.message);
    });
  }, []);

  return { repositories, problem, requested, refresh };
}
