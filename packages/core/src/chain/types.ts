import type { Dials, FocusStatus, FocusType, Posture } from '../frontmatter/types.js';

export type NodeRef = {
  title: string;
  /** Absolute path on disk. */
  path: string;
};

export type ChainSuccess = {
  /**
   * Backwards-compatible string label for the conversational register —
   * the v0.5 posture when frontmatter is present, the legacy "Mode" body row
   * otherwise. Kept on the result so renderer code that just wants a label
   * keeps working; structured `posture` and `dials` are the canonical fields.
   */
  mode: string;
  /** v0.5 posture from status frontmatter, or null if not addressable. */
  posture: Posture | null;
  /** v0.5 dials from status frontmatter, or null if not addressable. */
  dials: Dials | null;
  focus: NodeRef | null;
  /** v0.5 focus_type from the active focus file's frontmatter, or null. */
  focusType: FocusType | null;
  /** v0.5 focus status from the active focus file's frontmatter, or null. */
  focusStatus: FocusStatus | null;
  activeChild: NodeRef | null;
  root: string;
  lorePath: string;
};

export type ChainError = {
  error: string;
};

export type ChainResult = ChainSuccess | ChainError;

export function isChainError(result: ChainResult): result is ChainError {
  return 'error' in result;
}
