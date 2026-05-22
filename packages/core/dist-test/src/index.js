export const CORE_VERSION = '0.1.0';
export { readChain } from './chain/reader.js';
export { isChainError } from './chain/types.js';
export { openDb } from './db/db.js';
export { queueEntries } from './db/schema.js';
export { createQueue } from './queue/queue.js';
export { DEFAULT_IGNORED, createIgnoreMatcher, isUntrackedFile, parseIgnorePatterns, readProjectIgnores, } from './ignore.js';
export { isTreeError, readDirectory } from './tree/tree.js';
export { attachWatcher } from './watcher/watcher.js';
//# sourceMappingURL=index.js.map