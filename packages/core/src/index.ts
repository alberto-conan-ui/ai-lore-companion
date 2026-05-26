export const CORE_VERSION = '0.1.0' as const;

export { readChain } from './chain/reader.js';
export { isChainError } from './chain/types.js';
export type {
  ChainError,
  ChainResult,
  ChainSuccess,
  NodeRef,
} from './chain/types.js';

export {
  findSection,
  listMemoryDir,
  type MemoryEntry,
  type MemorySections,
  parseMemoryFile,
  parseMemoryFileSync,
  parseMemorySections,
  updateFrontmatterField,
  updateFrontmatterFieldInFile,
} from './frontmatter/index.js';
export type {
  Altitude,
  ATNodeFrontmatter,
  ATNodeKind,
  BlueprintBranch,
  BlueprintFrontmatter,
  Commitment,
  CommonFrontmatter,
  Dials,
  FocusFrontmatter,
  FocusStatus,
  FocusType,
  IndexFrontmatter,
  JournalFrontmatter,
  KTBranch,
  KTNodeFrontmatter,
  MemoryFileType,
  MemoryFrontmatter,
  ParsedMemoryFile,
  Posture,
  ReferenceFrontmatter,
  ReferenceLink,
  SavePointFrontmatter,
  StatusFrontmatter,
} from './frontmatter/index.js';

export { openDb } from './db/db.js';
export type { CockpitDb, DbHandle } from './db/db.js';
export { queueEntries } from './db/schema.js';
export type { QueueEntryInsert, QueueEntryRow } from './db/schema.js';

export { createQueue } from './queue/queue.js';
export type { Queue } from './queue/queue.js';
export type {
  ChangeScope,
  ChangeType,
  QueueEntry,
  QueueEvent,
  QueueListener,
  QueuePushInput,
  TrackerSubject,
  TrackerSubjectKind,
} from './queue/types.js';

export {
  DEFAULT_IGNORE_RULES,
  createIgnoreMatcher,
  deriveIgnoreLists,
  isIgnoreRule,
  isUntrackedFile,
  mergeIgnoreRules,
  normalizeIgnorePattern,
} from './ignore.js';
export type { IgnoreLevel, IgnoreLists, IgnoreRule } from './ignore.js';

export {
  SETTINGS_REGISTRY,
  SETTINGS_SCHEMA_VERSION,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  emptySettingsFile,
  isValidValue,
  parseSettingsFile,
  resolveAll,
  resolveSetting,
  serializeSettingsFile,
  validateRegistry,
  withApps,
  withIgnores,
  withLayout,
  withSetting,
} from './settings/settings.js';
export type {
  LayoutPanel,
  LayoutTab,
  SettingDef,
  SettingTier,
  SettingType,
  SettingValue,
  SettingsFile,
  WorkspaceLayout,
  WriteTier,
} from './settings/types.js';

export {
  type AppEntry,
  type AppKind,
  type AppRole,
  type AppTarget,
  appsForNode,
  cleanAppLabel,
  dedupApps,
  findDiffApp,
  isAppEntry,
  parseAppEntries,
  parseAppEntry,
} from './apps/index.js';

export {
  type BuildDiffArgvInput,
  buildDiffArgv,
  templateUsesBothPlaceholders,
} from './diff/index.js';

export {
  type GitStatusResult,
  type GitStatusScope,
  type GitStatusSnapshot,
  type GitStatusTracker,
  type GitStatusTrackerOptions,
  type PorcelainEntry,
  attachGitStatusTracker,
  isAdded,
  isDeleted,
  isRenamed,
  parsePorcelainZ,
  readGitStatus,
} from './git-status/index.js';

export {
  attachTrackerReviewTracker,
  readTrackerReview,
  type TrackerReviewEntry,
  type TrackerReviewKind,
  type TrackerReviewTracker,
  type TrackerReviewTrackerOptions,
} from './tracker-review/index.js';

export {
  baselineCommit,
  latestSavePoint,
  listSavePoints,
  type SavePoint,
} from './save-points/index.js';

export { isTreeError, readDirectory } from './tree/tree.js';
export type {
  ReadDirectoryOptions,
  TreeError,
  TreeNode,
  TreeResult,
} from './tree/tree.js';

export { attachWatcher } from './watcher/watcher.js';
export type {
  DirEvent,
  FileChangeEvent,
  WatcherHandle,
  WatcherOptions,
  WatcherScope,
} from './watcher/watcher.js';
