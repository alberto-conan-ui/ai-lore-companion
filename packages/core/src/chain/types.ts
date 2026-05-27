import type { Dials, FocusStatus, FocusType, Posture } from '../frontmatter/types.js';
import type { ProjectShape, PublishConfig } from '../workspace/shape.js';

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
  /**
   * `true` when at least one save-point is recorded in
   * `<lorePath>/memory/save-points/`. The Companion uses this to enable the
   * diff-against-latest-save-point affordance — without a save-point there is
   * no baseline. The latest save-point itself is read on demand.
   */
  hasSavePoint: boolean;
  /**
   * v0.8 Phase A — the project's lore version from `workspace.yaml.core_version`.
   * `null` for legacy manifests that don't carry the field; the header chip
   * hides in that case.
   */
  coreVersion: string | null;
  /**
   * v0.8 Phase A — the project's declared shape. `'default'` when the
   * Payload sits at the project root; `'publishing'` when `workspace.yaml`
   * declares a `publish:` block and the Payload lives in `payload/`.
   */
  shape: ProjectShape;
  /**
   * v0.8 Phase A — the parsed `publish:` block, set when `shape === 'publishing'`.
   * Absent in the default shape.
   */
  publish?: PublishConfig;
};

export type ChainError = {
  error: string;
};

export type ChainResult = ChainSuccess | ChainError;

export function isChainError(result: ChainResult): result is ChainError {
  return 'error' in result;
}
