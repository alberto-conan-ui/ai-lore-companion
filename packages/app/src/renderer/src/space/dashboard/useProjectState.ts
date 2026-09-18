import { useCallback, useEffect, useState } from 'react';
import type { SpaceProjectState } from '../../../../shared/ipc.js';

/** What the Dashboard knows of the Project, and its one action. */
export type ProjectStateView = {
  /** The last state main sent, or `null` before the first answer. */
  project: SpaceProjectState | null;
  /** The message of a request main refused, or `null`. */
  problem: string | null;
  /** Whether a Refresh asked from this window has not answered yet. */
  requested: boolean;
  refresh: () => void;
};

/**
 * The Project's state as main pushes it (phase M7.3). It reads the state once,
 * then takes every `onSpaceProjectState` push. When the window gains focus it
 * calls `spaceProjectFocus`, whose result comes by push; Refresh calls
 * `spaceProjectRefresh`, whose result also comes by push. A state replaces the
 * shown one only when its `version` is not lower, so an older push or answer
 * never replaces a newer one.
 */
export function useProjectState(): ProjectStateView {
  const [project, setProject] = useState<SpaceProjectState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    let live = true;
    // Pushes and answers can arrive out of order: keep the state main gave last.
    const take = (next: SpaceProjectState): void =>
      setProject((current) =>
        current === null || next.version >= current.version ? next : current,
      );
    const off = window.cockpit.onSpaceProjectState((next) => {
      take(next);
      setProblem(null);
    });
    void window.cockpit.spaceProjectState({}).then((read) => {
      if (!live) return;
      if (read.ok) take(read.value);
      else setProblem(read.error.message);
    });
    const onFocus = (): void => {
      void window.cockpit.spaceProjectFocus({}).then((read) => {
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
    void window.cockpit.spaceProjectRefresh({}).then((read) => {
      setRequested(false);
      if (!read.ok) setProblem(read.error.message);
    });
  }, []);

  return { project, problem, requested, refresh };
}
