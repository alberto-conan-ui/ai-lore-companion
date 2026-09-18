import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceSummary } from './filesTypes.js';

/**
 * The root the Files window shows, by id, or `null` for the first root, as
 * the layout (`FilesWindow.tsx`) reads and sets it. Phase M5.7: the choice is
 * remembered across a restart in `selected-root.json` of the Space's `ui/`
 * folder. It is read when the window opens and saved on every choice; a
 * choice made before the read came back is kept. A remembered root the Space
 * no longer has is dropped by `useFilesMemory`, which says so.
 */
export function useSelectedRoot(
  space: SpaceSummary,
): [selectedId: string | null, select: (rootId: string) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chosen = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again only for another Space.
  useEffect(() => {
    let alive = true;
    chosen.current = false;
    void window.cockpit.spaceUiRead({ concern: 'selected-root' }).then(
      (result) => {
        if (!alive || chosen.current || !result.ok) return;
        const state = result.value.state as { rootId?: unknown } | null;
        if (typeof state?.rootId === 'string') setSelectedId(state.rootId);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [space.key]);

  const select = useCallback((rootId: string): void => {
    chosen.current = true;
    setSelectedId(rootId);
    void window.cockpit
      .spaceUiSave({ concern: 'selected-root', state: { version: 1, rootId } })
      .catch(() => undefined);
  }, []);

  return [selectedId, select];
}
