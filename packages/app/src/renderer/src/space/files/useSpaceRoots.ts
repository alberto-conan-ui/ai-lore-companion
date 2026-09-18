import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RootSnapshot,
  SpaceRootsList,
  SpaceRootsResult,
} from '../../../../shared/ipc/space/roots.types.js';
import type { RootSummary } from './filesTypes.js';

/** The roots of the Space as the Files window holds them. */
export type SpaceRootsState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; roots: RootSummary[]; deskWritable: boolean; deskNotice: string | null };

/** Replace the snapshot of one root, and its baseline, which the snapshot carries. */
export function withSnapshot(roots: RootSummary[], snapshot: RootSnapshot): RootSummary[] {
  let changed = false;
  const next = roots.map((summary) => {
    if (summary.root.id !== snapshot.rootId) return summary;
    changed = true;
    return { ...summary, snapshot, baseline: snapshot.baseline };
  });
  return changed ? next : roots;
}

/**
 * The roots of the Space for the Files window (channels of phase M5.1): the
 * list, read when the window opens, again when main says the roots changed and
 * when the window gains focus, and each root's snapshot replaced when main
 * pushes it. `reload` reads the list again.
 */
export function useSpaceRoots(): { state: SpaceRootsState; reload: () => void } {
  const [state, setState] = useState<SpaceRootsState>({ status: 'loading' });
  const alive = useRef(true);

  const apply = useCallback((result: SpaceRootsResult<SpaceRootsList>): void => {
    if (!alive.current) return;
    if (!result.ok) {
      setState((previous) =>
        // A failed refresh keeps what is shown; a failed first read says why.
        previous.status === 'ready'
          ? previous
          : { status: 'failed', message: result.error.message },
      );
      return;
    }
    setState({ status: 'ready', ...result.value });
  }, []);

  const reload = useCallback((): void => {
    void window.cockpit
      .spaceRootsList({})
      .then(apply, (caught: unknown) =>
        apply({ ok: false, error: { kind: 'roots-unavailable', message: String(caught) } }),
      );
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    reload();
    const offChanges = window.cockpit.onSpaceRootChanges(({ snapshot }) => {
      if (!alive.current) return;
      setState((previous) =>
        previous.status === 'ready'
          ? { ...previous, roots: withSnapshot(previous.roots, snapshot) }
          : previous,
      );
    });
    const offReloaded = window.cockpit.onSpaceRootsReloaded(() => reload());
    const onFocus = (): void => {
      void window.cockpit.spaceRootsRefresh({}).then(apply, () => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      offChanges();
      offReloaded();
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, apply]);

  return { state, reload };
}
