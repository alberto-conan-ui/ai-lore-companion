import type { JSX } from 'react';
import { Placeholder } from '../Placeholder.js';

/**
 * The Dashboard of a Space: focuses by Stage, the Agents board, Needs you.
 * Placeholder until phase M7.3 builds its container. M7.3 replaces this file
 * and keeps the exported name; it takes no props and reads the Space from
 * `useSpaceSummary()` in `../spaceStore.js`. The Space window mounts it inside
 * the Dashboard entry of its rail, so it fills its parent, not the window.
 */
export function Dashboard(): JSX.Element {
  return <Placeholder title="Dashboard" phase="M7.3" id="dashboard" fill="parent" />;
}
