/**
 * The positions of a Space's two windows across a restart (phase M5.7).
 *
 * Main reads and writes them itself: the Space window's in `space-window.json`
 * and the Files window's in `files-window.json`, through the Space's `ui`
 * service. A window created for a Space is given its saved position before it
 * is shown; a move or a resize is saved when no other window of the Space has
 * the focus. This file imports nothing from Electron: the app gives the part
 * of `BrowserWindow` it uses as `SpaceWindowBounds`.
 */

import type { SpaceContext } from './context.js';
import { type UiConcern, spaceUi } from './ui-store.js';

export type WindowRect = { x: number; y: number; width: number; height: number };

/** The part of a window this file uses. */
export type SpaceWindowBounds = {
  /** The window's position and size; `null` while it is minimised, maximised or full screen. */
  get(): WindowRect | null;
  /** Move and size the window. The app keeps a window on a connected display. */
  set(rect: WindowRect): void;
  /** Be told when the window moved or was resized, and when it is about to close. */
  onChange(listener: () => void): void;
};

/** The concern that holds the position of a window of `mode`, or `null`. */
export function boundsConcernFor(mode: string): Extract<UiConcern, `${string}-window`> | null {
  if (mode === 'space') return 'space-window';
  if (mode === 'space-files') return 'files-window';
  return null;
}

/** Give the window the position saved for `concern`, when one was saved. */
export function restoreWindowBounds(
  bounds: SpaceWindowBounds,
  context: SpaceContext,
  concern: 'space-window' | 'files-window',
): void {
  const { state } = context.service(spaceUi).read(concern);
  if (state === null) return;
  const { x, y, width, height } = state as WindowRect;
  bounds.set({ x, y, width, height });
}

/**
 * Save the window's position whenever it moves or is resized. `current` says,
 * at that moment, which Space and concern the window holds and whether it may
 * write; a window that holds none saves nothing.
 */
export function trackWindowBounds(
  bounds: SpaceWindowBounds,
  current: () => { context: SpaceContext; concern: 'space-window' | 'files-window' } | null,
): void {
  bounds.onChange(() => {
    const held = current();
    const rect = bounds.get();
    if (held === null || rect === null) return;
    held.context.service(spaceUi).save(held.concern, {
      version: 1,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  });
}
