export const CORE_VERSION = '0.1.0' as const;

export { readChain } from './chain/reader.js';
export { isChainError } from './chain/types.js';
export type {
  ChainError,
  ChainResult,
  ChainSuccess,
  NodeRef,
} from './chain/types.js';

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
  DEFAULT_IGNORED,
  createIgnoreMatcher,
  parseIgnorePatterns,
  readProjectIgnores,
} from './ignore.js';

export { isTreeError, readDirectory } from './tree/tree.js';
export type {
  ReadDirectoryOptions,
  TreeError,
  TreeNode,
  TreeResult,
} from './tree/tree.js';

export { attachWatcher } from './watcher/watcher.js';
export type { DirEvent, WatcherHandle, WatcherOptions } from './watcher/watcher.js';
