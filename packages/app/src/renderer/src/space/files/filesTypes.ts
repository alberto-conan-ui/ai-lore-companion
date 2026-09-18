/**
 * The shapes the Files window's layout (`FilesWindow.tsx`, phase M5.2) passes
 * to its parts: the Changes panel (M5.3), the baseline picker (M5.4) and the
 * editor (M5.5). Each of those phases replaces its own part's file and keeps
 * the part's exported name and props; M5.7 replaces `useSelectedRoot.ts` the
 * same way. The layout and this file stay as M5.2 left them.
 */

import type { RootSummary } from '../../../../shared/ipc/space/roots.types.js';
import type { SpaceSummary } from '../../../../shared/ipc/space/windows.types.js';

export type { RootSummary, SpaceSummary };

/** A root whose changes git tracks. The Changes panel and the baseline picker are given only these. */
export type TrackedRootSummary = RootSummary & {
  root: RootSummary['root'] & { tracking: { tracked: true } };
};

/** Whether a root's changes are tracked by git. */
export function isTrackedRoot(summary: RootSummary): summary is TrackedRootSummary {
  return summary.root.tracking.tracked;
}

/** The mode a document opens in. Preview is chosen inside the editor, for markdown. */
export type FilesOpenMode = 'code' | 'diff';

/**
 * Ask the editor to open a file of a root. The tree sends `code` (double
 * click or Enter on a file), the Changes panel sends `diff` (double click on a
 * change), and "Open in Files" with a file sends `code`. `seq` grows with every
 * request, so a request for the file already open is still seen as new.
 */
export type FilesOpenRequest = {
  seq: number;
  rootId: string;
  /** Relative to the root's folder, with `/`. */
  path: string;
  mode: FilesOpenMode;
  /** The path a renamed file had, relative to the root, for a diff read as a rename. */
  oldPath?: string;
};

/** What a part passes to the layout to open a file of the selected root. */
export type FilesOpenFile = (file: { path: string; mode: FilesOpenMode; oldPath?: string }) => void;
