export const CORE_VERSION = '0.1.0' as const;

export { readChain } from './chain/reader.js';
export { isChainError } from './chain/types.js';
export type {
  ChainError,
  ChainResult,
  ChainSuccess,
  NodeRef,
} from './chain/types.js';

export { parseMemoryFile, parseMemoryFileSync } from './frontmatter/index.js';
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

export { isTreeError, readDirectory } from './tree/tree.js';
export type {
  ReadDirectoryOptions,
  TreeError,
  TreeNode,
  TreeResult,
} from './tree/tree.js';

export { attachWatcher } from './watcher/watcher.js';
export type { DirEvent, WatcherHandle, WatcherOptions } from './watcher/watcher.js';
