import type { JSX } from 'react';
import { Placeholder } from '../Placeholder.js';

/**
 * The header of a session in an AI tab: its mode, its claim, Leave Writing.
 * Placeholder until phase M4.6 builds it. M4.6 replaces this file, decides its
 * props, and mounts it from `components/AiTab.tsx`, which that phase edits.
 * Nothing mounts it before then.
 */
export function SessionHeader(): JSX.Element {
  return <Placeholder title="Session header" phase="M4.6" id="session-header" fill="parent" />;
}
