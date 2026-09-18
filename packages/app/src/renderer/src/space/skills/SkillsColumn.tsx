import type { JSX } from 'react';
import { Placeholder } from '../Placeholder.js';

/**
 * The Skills column of an AI tab in a Space window: the verbs and processes
 * read from the Space's Lore. Placeholder until phase M4.6 builds it. M4.6
 * replaces this file, decides its props, and mounts it from
 * `components/AiTab.tsx`, which that phase edits. Nothing mounts it before
 * then.
 */
export function SkillsColumn(): JSX.Element {
  return <Placeholder title="Skills" phase="M4.6" id="skills" fill="parent" />;
}
