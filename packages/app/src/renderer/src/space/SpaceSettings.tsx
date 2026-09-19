import { type JSX, useEffect } from 'react';
import { create } from 'zustand';
import { SettingsSheetModal, type SettingsSheetSection } from '../components/SettingsSheet.js';

type SpaceSettingsState = {
  /** The rail section to open on, or `undefined` while closed. */
  section: SettingsSheetSection | undefined;
  open: (section?: SettingsSheetSection) => void;
  close: () => void;
};

/**
 * Whether the Settings sheet is open in this window, and at which section.
 * A store of its own (as `spaceNavStore.ts` is), so a fix elsewhere in a 1.0
 * screen (`EngineStartControl`'s "Edit the engine") can open Settings without
 * a prop passed down from `SpaceWindow`.
 */
export const useSpaceSettings = create<SpaceSettingsState>((set) => ({
  section: undefined,
  open: (section) => set({ section: section ?? null }),
  close: () => set({ section: undefined }),
}));

/**
 * Settings, reachable from every 1.0 window (architecture document M9.10):
 * the macOS App menu's `Settings…` (`⌘,`) pushes `onSettingsOpen` to the
 * focused window, as it already does for the v0.8 cockpit; this component
 * gives a 1.0 window the same modal. `SpaceSurface` mounts it beside every
 * screen.
 */
export function SpaceSettings(): JSX.Element | null {
  const section = useSpaceSettings((state) => state.section);
  const open = useSpaceSettings((state) => state.open);
  const close = useSpaceSettings((state) => state.close);

  useEffect(() => window.cockpit.onSettingsOpen(() => open()), [open]);

  if (section === undefined) return null;
  return <SettingsSheetModal onClose={close} initialSection={section} />;
}
