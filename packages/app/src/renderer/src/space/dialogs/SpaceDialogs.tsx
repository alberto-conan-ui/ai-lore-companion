import type { JSX } from 'react';

/**
 * Where the two dialogs a session asks for are mounted: the Writing dialog and
 * the gate dialog. It shows nothing until phase M4.5 builds them; a dialog has
 * no place on the screen while none is asked for, so there is no placeholder
 * text here. M4.5 replaces this file and keeps the exported name; it takes no
 * props, subscribes to its own push channel, and uses the overlay primitives
 * of `components/overlay/`. The Space window mounts it once.
 */
export function SpaceDialogs(): JSX.Element | null {
  return null;
}
