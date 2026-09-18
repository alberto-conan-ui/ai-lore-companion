/** Filesystem helpers of the 1.0 library: containment, atomic writes, tree copy. */

export {
  type PathFailureKind,
  isInsideLexically,
  isPathInside,
  realpathNearest,
  safeJoin,
  toPosixRelative,
} from './paths.js';
export {
  ATOMIC_TEMP_SUFFIX,
  type AtomicWriteOptions,
  type WriteFailureKind,
  isAtomicTempName,
  writeFileAtomic,
  writeFileAtomicSync,
} from './atomic-write.js';
export {
  type CopiedFile,
  type CopiedFileStatus,
  type CopyExclude,
  type CopyFailureKind,
  type CopyTreeOptions,
  copyTree,
  sha256File,
} from './copy-tree.js';
