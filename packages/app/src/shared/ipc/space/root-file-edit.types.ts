/**
 * Types of the channels that read and write a file of a root for the editor
 * of the Files window (phase M5.5). Plain data only. Re-exported by
 * `./files.types.ts`.
 *
 * A root is named by its id and a file by its path relative to the root's
 * folder, with `/`. No channel takes an absolute path.
 */

import type { SpaceRootsFailureKind } from './roots.types.js';

/** A file of a root, as it is in the working tree now. */
export type SpaceRootReadFileArg = { rootId: string; path: string };

/**
 * The content of a working-tree file. `mtimeMs` is the file's modification
 * time as read, given back on a save so that a file changed on disk since it
 * was read is not overwritten. `absent`: there is no file at the path.
 */
export type RootWorkingFile =
  | { kind: 'text'; text: string; mtimeMs: number }
  | { kind: 'binary'; bytes: number }
  | { kind: 'too-large'; bytes: number; limit: number }
  | { kind: 'absent' };

/**
 * Replace the text of an existing file of a root. `expectedMtimeMs` is the
 * `mtimeMs` of the read the editor holds; when the file's time differs, the
 * write is refused with `changed-on-disk`.
 */
export type SpaceRootWriteFileArg = {
  rootId: string;
  path: string;
  text: string;
  expectedMtimeMs?: number;
};

/** What a save gives: the file's new modification time and its size in bytes. */
export type RootFileWritten = { rootId: string; path: string; mtimeMs: number; bytes: number };

/**
 * Why reading or writing a file of a root gave nothing: every kind of the
 * channels of roots, and
 * `not-a-file`: the path names a folder or something that is not a regular file, or no file (a save never creates one);
 * `too-large`: the text to write is larger than the editor reads;
 * `changed-on-disk`: the file changed on disk since the editor read it;
 * `read-failed`: the file system refused the read; the message is its own;
 * `write-failed`: the file system refused the write; the message is its own.
 */
export type RootFileEditFailureKind =
  | SpaceRootsFailureKind
  | 'not-a-file'
  | 'read-failed'
  | 'too-large'
  | 'changed-on-disk'
  | 'write-failed';

export type RootFileEditFailure = {
  kind: RootFileEditFailureKind;
  message: string;
  cause?: string;
};

/** What both channels return. A handler never rejects. */
export type RootFileEditResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RootFileEditFailure };
