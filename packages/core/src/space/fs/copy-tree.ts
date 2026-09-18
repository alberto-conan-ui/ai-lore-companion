/**
 * Copying a folder tree with a SHA-256 per file.
 *
 * Used to scaffold the Lore template into a new Space and to archive a v0.8
 * source during migration. The copy can be run again: a file that is already
 * at the destination with the same content is not written a second time. The
 * tree is read and compared in full before the first file is written, so a
 * refusal leaves the destination as it was.
 */

import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import { atomicTempPathFor, isAtomicTempName } from './atomic-write.js';
import { isInsideLexically, realpathNearest } from './paths.js';

/** The kinds of failure `copyTree` and `sha256File` return. */
export type CopyFailureKind =
  | 'source-missing'
  | 'symlink-outside-source'
  | 'unsupported-entry'
  | 'destination-differs'
  | 'destination-outside'
  | 'copy-failed';

/** What happened to one file of the tree. */
export type CopiedFileStatus =
  /** The file was not at the destination and was written. */
  | 'copied'
  /** The file was at the destination with the same hash and was left alone. */
  | 'same'
  /** The file was at the destination with other content and was replaced. */
  | 'overwritten'
  /** The file was at the destination with other content and was left alone. */
  | 'kept';

/** One file of a copied tree. `relativePath` uses `/` on every platform. */
export type CopiedFile = {
  relativePath: string;
  /** The SHA-256 of the source file, in lower-case hexadecimal. */
  sha256: string;
  status: CopiedFileStatus;
};

/**
 * Which entries `copyTree` leaves out. A text with no `/` matches a file or
 * folder of that name at any depth (`'.git'`); a text with a `/` matches that
 * relative path and everything below it (`'lore/verbs/own'`). A function
 * receives the relative path and whether the entry is a folder.
 */
export type CopyExclude =
  | readonly string[]
  | ((relativePath: string, isDirectory: boolean) => boolean);

/** Options of `copyTree`. */
export type CopyTreeOptions = {
  exclude?: CopyExclude;
  /**
   * What to do with a file that is at the destination with other content.
   * `'fail'` (the default) copies nothing and returns `destination-differs`;
   * `'keep'` leaves that file alone; `'overwrite'` replaces it.
   */
  onConflict?: 'fail' | 'keep' | 'overwrite';
};

type PlannedFile = { relativePath: string; source: string; sha256: string; mode: number };

/** The SHA-256 of a file's content, in lower-case hexadecimal. */
export async function sha256File(path: string): Promise<Result<string, Failure<CopyFailureKind>>> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return ok(hash.digest('hex'));
  } catch (caught) {
    return fail('copy-failed', `cannot read ${path}: ${errorMessage(caught)}`);
  }
}

function isExcluded(exclude: CopyExclude | undefined, rel: string, isDirectory: boolean): boolean {
  if (exclude === undefined) return false;
  if (typeof exclude === 'function') return exclude(rel, isDirectory);
  const segments = rel.split('/');
  return exclude.some((pattern) => {
    const wanted = pattern.replace(/\/+$/, '');
    if (!wanted.includes('/')) return segments.includes(wanted);
    return rel === wanted || rel.startsWith(`${wanted}/`);
  });
}

/**
 * List the files under `dir` in name order. A symbolic link to a file inside
 * the source is listed as that file's content; one that points outside the
 * source, or to a folder, is refused.
 */
async function planFiles(
  sourceReal: string,
  dir: string,
  relDir: string,
  exclude: CopyExclude | undefined,
  out: PlannedFile[],
): Promise<Failure<CopyFailureKind> | null> {
  const names = (await readdir(dir)).sort();
  for (const name of names) {
    // What an interrupted atomic write or copy left behind is not content.
    if (isAtomicTempName(name)) continue;
    const rel = relDir === '' ? name : `${relDir}/${name}`;
    const full = join(dir, name);
    const info = await lstat(full);
    if (isExcluded(exclude, rel, info.isDirectory())) continue;
    if (info.isDirectory()) {
      const failure = await planFiles(sourceReal, full, rel, exclude, out);
      if (failure !== null) return failure;
      continue;
    }
    let mode = info.mode;
    if (info.isSymbolicLink()) {
      const target = realpathNearest(full);
      if (!isInsideLexically(sourceReal, target)) {
        return { kind: 'symlink-outside-source', message: `${rel} links outside the source` };
      }
      const targetInfo = await stat(full).catch(() => null);
      if (targetInfo === null || !targetInfo.isFile()) {
        return { kind: 'unsupported-entry', message: `${rel} is a link to something not a file` };
      }
      mode = targetInfo.mode;
    } else if (!info.isFile()) {
      return { kind: 'unsupported-entry', message: `${rel} is not a file or a folder` };
    }
    const hashed = await sha256File(full);
    if (!hashed.ok) return hashed.error;
    out.push({ relativePath: rel, source: full, sha256: hashed.value, mode: mode & 0o777 });
  }
  return null;
}

/**
 * Copy the tree under `from` into `to` and return one entry per file, in path
 * order. Folders are created as needed; an empty folder is not created. A file
 * keeps its permission bits, so a script stays executable.
 */
export async function copyTree(
  from: string,
  to: string,
  options: CopyTreeOptions = {},
): Promise<Result<CopiedFile[], Failure<CopyFailureKind>>> {
  const onConflict = options.onConflict ?? 'fail';
  try {
    const sourceInfo = await stat(from).catch(() => null);
    if (sourceInfo === null || !sourceInfo.isDirectory()) {
      return fail('source-missing', `${from} is not a folder`);
    }
    const planned: PlannedFile[] = [];
    const failure = await planFiles(realpathNearest(from), from, '', options.exclude, planned);
    if (failure !== null) return { ok: false, error: failure };

    const destinationReal = realpathNearest(to);
    const result: CopiedFile[] = [];
    for (const file of planned) {
      const destination = join(to, file.relativePath);
      // The folder the file lands in, with links resolved, must be in the
      // destination: a linked folder there would send the write elsewhere.
      if (!isInsideLexically(destinationReal, realpathNearest(dirname(destination)))) {
        return fail(
          'destination-outside',
          `${file.relativePath} would be written outside ${to}, through a symbolic link`,
        );
      }
      const status = await statusAtDestination(destination, file.sha256);
      if (!status.ok) return status;
      if (status.value === 'differs' && onConflict === 'fail') {
        return fail(
          'destination-differs',
          `${file.relativePath} is already in ${to} with other content`,
        );
      }
      result.push({
        relativePath: file.relativePath,
        sha256: file.sha256,
        status:
          status.value === 'missing'
            ? 'copied'
            : status.value === 'same'
              ? 'same'
              : onConflict === 'keep'
                ? 'kept'
                : 'overwritten',
      });
    }

    for (const [index, file] of planned.entries()) {
      const status = result[index]?.status;
      if (status !== 'copied' && status !== 'overwritten') continue;
      const destination = join(to, file.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      // Copy beside the destination and rename over it. A copy that is
      // interrupted leaves a temporary file (`isAtomicTempName`) and never a
      // part of the file, so a second run does not meet "other content"; and a
      // symbolic link at the destination is replaced, not written through.
      const temp = atomicTempPathFor(destination);
      try {
        await copyFile(file.source, temp, constants.COPYFILE_EXCL);
        await chmod(temp, file.mode);
        await rename(temp, destination);
      } catch (caught) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw caught;
      }
    }
    return ok(result);
  } catch (caught) {
    return fail('copy-failed', `cannot copy ${from} to ${to}: ${errorMessage(caught)}`);
  }
}

async function statusAtDestination(
  destination: string,
  sha256: string,
): Promise<Result<'missing' | 'same' | 'differs', Failure<CopyFailureKind>>> {
  try {
    const info = await lstat(destination);
    if (!info.isFile() && !info.isSymbolicLink()) {
      return fail('destination-differs', `${destination} is there and is not a file`);
    }
  } catch (caught) {
    if (errorCode(caught) === 'ENOENT' || errorCode(caught) === 'ENOTDIR') return ok('missing');
    return fail('copy-failed', `cannot read ${destination}: ${errorMessage(caught)}`);
  }
  const existing = await sha256File(destination);
  if (!existing.ok) return ok('differs');
  return ok(existing.value === sha256 ? 'same' : 'differs');
}
