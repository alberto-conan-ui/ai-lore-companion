/**
 * Atomic file writes for the 1.0 library, with `node:fs` only so that core
 * gains no dependency.
 *
 * The text goes to a temporary file in the destination's folder, the file is
 * flushed to disk, and it is renamed over the destination. A reader sees the
 * old content or the new content, never a part of either. A process that stops
 * between the write and the rename leaves a temporary file behind; its name is
 * recognised by `isAtomicTempName`, and readers of a folder ignore it.
 *
 * The rename replaces the destination's directory entry. A symbolic link at
 * the destination is therefore replaced by a file and is not written through.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type Failure, type Result, errorMessage, fail, ok } from '../result.js';

/** The ending of every temporary file an atomic write creates. */
export const ATOMIC_TEMP_SUFFIX = '.atomic-tmp';

/** The failure kind of an atomic write. */
export type WriteFailureKind = 'write-failed';

/** Options of an atomic write. */
export type AtomicWriteOptions = {
  /**
   * Permission bits of the file, for example `0o600`, applied exactly. Default:
   * the bits of the file being replaced, so that a rewrite does not open up a
   * file written with `0o600`; for a new file `0o644` less the process's umask.
   */
  mode?: number;
  /** Permission bits of a parent folder the write has to create. Default `0o755`. */
  dirMode?: number;
};

const DEFAULT_FILE_MODE = 0o644;

/**
 * The temporary path for a write to `path`: a hidden file in the same folder,
 * so that the rename stays on one filesystem. Shared with `copyTree`.
 */
export function atomicTempPathFor(path: string): string {
  const unique = `${process.pid}-${randomBytes(6).toString('hex')}`;
  return join(dirname(path), `.${basename(path)}.${unique}${ATOMIC_TEMP_SUFFIX}`);
}

/** Whether `name` is a file name an atomic write uses for its temporary file. */
export function isAtomicTempName(name: string): boolean {
  return name.startsWith('.') && name.endsWith(ATOMIC_TEMP_SUFFIX);
}

/**
 * Write `text` to `path` atomically. Parent folders are created when missing.
 * On failure the temporary file is removed and the destination is unchanged.
 */
export async function writeFileAtomic(
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<Result<void, Failure<WriteFailureKind>>> {
  const temp = atomicTempPathFor(path);
  try {
    await mkdir(dirname(path), { recursive: true, mode: options.dirMode ?? 0o755 });
    const existing = await stat(path).catch(() => null);
    const mode = options.mode ?? (existing?.isFile() === true ? existing.mode & 0o777 : undefined);
    const handle = await open(temp, 'wx', mode ?? DEFAULT_FILE_MODE);
    try {
      if (mode !== undefined) await handle.chmod(mode);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    return ok(undefined);
  } catch (caught) {
    await rm(temp, { force: true }).catch(() => undefined);
    return fail('write-failed', `cannot write ${path}: ${errorMessage(caught)}`);
  }
}

function existingFileMode(path: string): number | undefined {
  try {
    const info = statSync(path);
    return info.isFile() ? info.mode & 0o777 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The synchronous form of `writeFileAtomic`, for the small JSON files of the
 * desk, which are read and written synchronously.
 */
export function writeFileAtomicSync(
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Result<void, Failure<WriteFailureKind>> {
  const temp = atomicTempPathFor(path);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: options.dirMode ?? 0o755 });
    const mode = options.mode ?? existingFileMode(path);
    const fd = openSync(temp, 'wx', mode ?? DEFAULT_FILE_MODE);
    try {
      if (mode !== undefined) fchmodSync(fd, mode);
      // `writeFileSync` on a descriptor repeats the write until the whole text is out.
      writeFileSync(fd, text, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    return ok(undefined);
  } catch (caught) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // The temporary file could not be removed; readers ignore it by its name.
    }
    return fail('write-failed', `cannot write ${path}: ${errorMessage(caught)}`);
  }
}
