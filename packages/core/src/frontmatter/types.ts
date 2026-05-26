/**
 * Frontmatter schema for AI-Lore Memory files (v0.5).
 *
 * Every Memory file is `---\n<yaml>\n---\n<body>`. The YAML carries common
 * fields and a per-type extension; the body is the human-read prose. See
 * `.ai-lore-<project>/process/memory.md` § "The file schema".
 */

export type MemoryFileType =
  | 'status'
  | 'focus'
  | 'at-node'
  | 'journal'
  | 'blueprint'
  | 'kt-node'
  | 'save-point'
  | 'index';

export type Posture = 'chat' | 'plan' | 'reshape' | 'execute';
export type Altitude = 'low' | 'mid' | 'high';
export type Commitment = 'go' | 'neutral' | 'challenge';

export type Dials = {
  altitude: Altitude;
  commitment: Commitment;
};

export type ReferenceLink = {
  /** Section grouping for the reference — e.g. "Parent", "Focus", "Playbook". */
  group: string;
  /** Relative or absolute path the reference points at. */
  path: string;
};

/** Every Memory file's frontmatter shares this skeleton. */
export type CommonFrontmatter = {
  type: MemoryFileType;
  title: string;
  /** Date the file was last written (`YYYY-MM-DD`). */
  updated: string;
  references: ReferenceLink[];
};

export type StatusFrontmatter = CommonFrontmatter & {
  type: 'status';
  /** Relative path to the active focus file. */
  active_focus: string;
  posture: Posture;
  dials: Dials;
};

export type FocusType = 'build' | 'goal';
export type FocusStatus = 'Pending' | 'Active' | 'Paused' | 'Review' | 'Done' | 'Achieved';

export type FocusFrontmatter = CommonFrontmatter & {
  type: 'focus';
  status: FocusStatus;
  focus_type: FocusType;
};

export type ATNodeKind = 'container' | 'leaf';

export type ATNodeFrontmatter = CommonFrontmatter & {
  type: 'at-node';
  node_kind: ATNodeKind;
  gated: boolean;
  status: FocusStatus;
};

export type JournalFrontmatter = CommonFrontmatter & {
  type: 'journal';
  /** Session date (`YYYY-MM-DD`). */
  date: string;
  /** Session number for the day (`"01"`, `"02"`, …). */
  session: string;
  /** Relative path to the focus the session worked under. */
  focus: string;
  dials: Dials;
  posture: Posture;
};

export type BlueprintBranch = 'contracts' | 'processes' | 'mirror';

export type BlueprintFrontmatter = CommonFrontmatter & {
  type: 'blueprint';
  branch: BlueprintBranch;
};

export type KTBranch = 'reconciled' | 'working' | 'notepad';

export type KTNodeFrontmatter = CommonFrontmatter & {
  type: 'kt-node';
  branch: KTBranch;
};

export type SavePointFrontmatter = CommonFrontmatter & {
  type: 'save-point';
  date: string;
  lore_commit: string;
  payload_commit: string;
};

export type IndexFrontmatter = CommonFrontmatter & {
  type: 'index';
};

export type MemoryFrontmatter =
  | StatusFrontmatter
  | FocusFrontmatter
  | ATNodeFrontmatter
  | JournalFrontmatter
  | BlueprintFrontmatter
  | KTNodeFrontmatter
  | SavePointFrontmatter
  | IndexFrontmatter;

/** Result of parsing a Memory file. Frontmatter is null when absent or malformed. */
export type ParsedMemoryFile = {
  frontmatter: MemoryFrontmatter | null;
  body: string;
  /** Warning message when frontmatter was expected but couldn't be validated. */
  warning?: string;
};
