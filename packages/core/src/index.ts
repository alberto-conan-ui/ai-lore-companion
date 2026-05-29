export const CORE_VERSION = '0.1.0' as const;

export { readChain } from './chain/reader.js';
export {
  compareVersions,
  type ProjectShape,
  type ProjectShapeResult,
  type PublishConfig,
  readCoreVersion,
  readProjectShape,
  versionMeetsMinimum,
} from './workspace/index.js';
export { locateLore, type LoreLocation } from './chain/lore.js';
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
  emptySettingsFile,
  isValidValue,
  parseSettingsFile,
  resolveAll,
  resolveSetting,
  serializeSettingsFile,
  validateRegistry,
  withApps,
  withIgnores,
  withSetting,
} from './settings/settings.js';
export type {
  SettingDef,
  SettingTier,
  SettingType,
  SettingValue,
  SettingsFile,
  WriteTier,
} from './settings/types.js';

export { type CatalogModel, dedupEntries, parseEntries } from './catalog/index.js';

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
  type EngineEntry,
  dedupEngines,
  isEngineEntry,
  parseEngineEntries,
  parseEngineEntry,
} from './engines/index.js';

export {
  type BuildDiffArgvInput,
  buildDiffArgv,
  templateUsesBothPlaceholders,
} from './diff/index.js';

export {
  type ChangeEntry,
  type ChangesResult,
  type ChangeScope,
  type ChangesSnapshot,
  type ChangesTracker,
  type ChangesTrackerOptions,
  type CommitListEntry,
  type CommitListResult,
  type DiffTextResult,
  attachChangesTracker,
  isAdded,
  isDeleted,
  isRenamed,
  parsePorcelainZ,
  readChanges,
  readCommitList,
  readDiffText,
} from './changes/index.js';

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
