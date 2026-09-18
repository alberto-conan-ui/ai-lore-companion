import { create } from 'zustand';
import type { SpaceSummary, SpaceWindowInitPayload } from '../../../shared/ipc.js';

/**
 * What a 1.0 window was told it is. `App.tsx` writes it when main sends a 1.0
 * window mode; any 1.0 component reads it, so the Space's summary does not
 * travel through props. It is a store of its own: no 1.0 field is added to the
 * cockpit's `store.ts`. A feature that needs shared state adds a store file of
 * its own beside its components.
 */
type SpaceWindowState = {
  /** The payload of this window, or `null` while the window is not a 1.0 window. */
  init: SpaceWindowInitPayload | null;
  setInit: (init: SpaceWindowInitPayload | null) => void;
};

export const useSpaceWindowStore = create<SpaceWindowState>((set) => ({
  init: null,
  setInit: (init) => set({ init }),
}));

/** The Space this window shows, or `null` in a window that shows no Space. */
export function useSpaceSummary(): SpaceSummary | null {
  return useSpaceWindowStore((state) =>
    state.init?.mode === 'space' || state.init?.mode === 'space-files' ? state.init.space : null,
  );
}
