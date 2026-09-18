/**
 * Reading and saving a file of a root for the editor of the Files window
 * (`shared/ipc/space/root-file-edit.contract.ts`), added by phase M5.5.
 * Registered from `./files.ts`.
 *
 * The v0.8 editor reads with `readFile` and saves with `fileWrite`
 * (`main/ipc/tree.ts`), which take an absolute path and check nothing. These
 * channels keep what those do (a size cap, a NUL byte marks a binary file, the
 * text is written as UTF-8 exactly as the editor holds it) and add the checks
 * of the Files window: only a window of an open Space may call them; the root
 * must be a root of that Space; the path is relative to the root and is held
 * with `resolveInRoot`, so a path that leaves the root, by its text or through
 * a symbolic link, or that enters `.git`, is refused. A save replaces the text
 * of an existing regular file and never creates one, refuses text larger than
 * the editor reads, and refuses when the file changed on disk since the editor
 * read it; the file is replaced atomically, keeps its permission bits, and a
 * symbolic link swapped in during the save is not followed (`replaceFile`).
 * The Human Lead saves here, in every root, the untracked Workbench included; this is not an AI session, and the
 * write-guard of sessions does not apply. After a save the root's changes are
 * read again.
 */

import { randomBytes } from 'node:crypto';
import {
  type Stats,
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative as relativePath, sep } from 'node:path';
import { z } from 'zod';
import type {
  RootFileEditFailure,
  RootFileEditResult,
  RootFileWritten,
  RootWorkingFile,
} from '../../../shared/ipc/space/root-file-edit.types.js';
import type { RegisterModule } from '../../ipc/types.js';
import { ROOT_FILE_MAX_BYTES, resolveInRoot } from '../root-files.js';
import { spaceRoots } from '../roots-service.js';
import { rootFolder } from './root-tree.js';
import { spaceRootIdSchema } from './roots.js';
import { parseArg, relativePathSchema } from './validate.js';

const readSchema = z.strictObject({ rootId: spaceRootIdSchema, path: relativePathSchema });

const writeSchema = z.strictObject({
  rootId: spaceRootIdSchema,
  path: relativePathSchema,
  // A JavaScript string of more characters than this cannot fit the byte limit.
  text: z.string().max(ROOT_FILE_MAX_BYTES),
  expectedMtimeMs: z.number().finite().nonnegative().optional(),
});

const notASpaceWindow = {
  ok: false as const,
  error: {
    kind: 'not-a-space-window' as const,
    message: 'The request did not come from a window of an open Space.',
  },
};

const failure = <T>(kind: RootFileEditFailure['kind'], message: string): RootFileEditResult<T> => ({
  ok: false,
  error: { kind, message },
});

/** The error code of a file-system error, or `undefined`. */
function codeOf(caught: unknown): string | undefined {
  return typeof caught === 'object' && caught !== null && 'code' in caught
    ? String((caught as { code: unknown }).code)
    : undefined;
}

/** The working-tree content of the file at `abs`. */
function readWorkingFile(abs: string): RootFileEditResult<RootWorkingFile> {
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return failure('not-a-file', 'The path is not a file.');
    if (stat.size > ROOT_FILE_MAX_BYTES) {
      return {
        ok: true,
        value: { kind: 'too-large', bytes: stat.size, limit: ROOT_FILE_MAX_BYTES },
      };
    }
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) return { ok: true, value: { kind: 'binary', bytes: bytes.length } };
    return {
      ok: true,
      value: { kind: 'text', text: bytes.toString('utf8'), mtimeMs: stat.mtimeMs },
    };
  } catch (caught) {
    if (codeOf(caught) === 'ENOENT') return { ok: true, value: { kind: 'absent' } };
    return failure('read-failed', caught instanceof Error ? caught.message : String(caught));
  }
}

const changedOnDisk = 'The file changed on disk since it was opened. Nothing was saved.';

/** Whether `real` is inside `realRoot` and outside every git folder. Both are resolved paths. */
function insideRoot(realRoot: string, real: string): boolean {
  const rel = relativePath(realRoot, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return !rel.split(sep).some((segment) => segment.toLowerCase() === '.git');
}

/**
 * Replace the text of the existing regular file at `abs` (already held inside
 * the root by `resolveInRoot`) with `text`, atomically. The file written is
 * the one `abs` resolves to, so a symbolic link inside the root keeps being a
 * link. The text goes to a new file beside it, created exclusively (a link
 * already there is not followed) with the file's permission bits, flushed to
 * disk, and renamed over the file; a rename replaces what is at the path and
 * never follows a link, so the app dying half way leaves the old file whole.
 * Just before the rename the file is checked again: still a regular file, the
 * same file, not changed since the editor read it, and its folder still the
 * same folder.
 */
function replaceFile(
  rootPath: string,
  abs: string,
  text: string,
  expectedMtimeMs: number | undefined,
): RootFileEditResult<{ mtimeMs: number }> {
  let real: string;
  let before: Stats;
  try {
    real = realpathSync(abs);
    if (!insideRoot(realpathSync(rootPath), real)) {
      return failure('path-refused', 'The path leaves the folder of the root.');
    }
    before = lstatSync(real);
  } catch (caught) {
    if (codeOf(caught) === 'ENOENT') {
      return failure('not-a-file', 'There is no file at this path. A save does not create one.');
    }
    return failure('write-failed', caught instanceof Error ? caught.message : String(caught));
  }
  if (!before.isFile()) return failure('not-a-file', 'The path is not a file.');
  if (expectedMtimeMs !== undefined && before.mtimeMs !== expectedMtimeMs) {
    return failure('changed-on-disk', changedOnDisk);
  }
  const folder = dirname(real);
  const temp = join(folder, `.${basename(real)}.ai-lore-save-${randomBytes(6).toString('hex')}`);
  const mode = before.mode & 0o7777;
  let tempMade = false;
  try {
    const fd = openSync(temp, 'wx', mode);
    tempMade = true;
    try {
      writeSync(fd, text, null, 'utf8');
      // The mode given to `open` is reduced by the umask; set it as the file had it.
      fchmodSync(fd, mode);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const now = lstatSync(real);
    if (
      !now.isFile() ||
      now.ino !== before.ino ||
      now.dev !== before.dev ||
      now.mtimeMs !== before.mtimeMs ||
      now.size !== before.size ||
      realpathSync(folder) !== folder
    ) {
      unlinkSync(temp);
      return failure('changed-on-disk', changedOnDisk);
    }
    renameSync(temp, real);
    tempMade = false;
    return { ok: true, value: { mtimeMs: lstatSync(real).mtimeMs } };
  } catch (caught) {
    if (tempMade) {
      try {
        unlinkSync(temp);
      } catch {
        // Already gone.
      }
    }
    if (codeOf(caught) === 'ENOENT') return failure('changed-on-disk', changedOnDisk);
    return failure('write-failed', caught instanceof Error ? caught.message : String(caught));
  }
}

/** Register `spaceRootReadFile` and `spaceRootWriteFile`. Called by `registerSpaceFiles`. */
export const registerSpaceRootFileEdit: RegisterModule = (reg, deps) => {
  const sendToSpace = (root: string, channel: string, payload: unknown): void =>
    deps.space.sendToSpace(root, channel, payload);

  reg.handle(
    'spaceRootReadFile',
    async (event, arg): Promise<RootFileEditResult<RootWorkingFile>> => {
      const context = deps.space.contextFor(event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(readSchema, arg);
      if (!parsed.ok) return parsed;
      const rootPath = await rootFolder(context, sendToSpace, parsed.value.rootId);
      if (!rootPath.ok) return rootPath;
      const file = resolveInRoot(rootPath.value, parsed.value.path, 'file');
      if (!file.ok) return file;
      return readWorkingFile(file.value.abs);
    },
  );

  reg.handle(
    'spaceRootWriteFile',
    async (event, arg): Promise<RootFileEditResult<RootFileWritten>> => {
      const context = deps.space.contextFor(event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(writeSchema, arg);
      if (!parsed.ok) return parsed;
      const { rootId, path, text, expectedMtimeMs } = parsed.value;
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > ROOT_FILE_MAX_BYTES) {
        return failure(
          'too-large',
          `The text is ${bytes} bytes; the editor saves at most ${ROOT_FILE_MAX_BYTES}.`,
        );
      }
      const rootPath = await rootFolder(context, sendToSpace, rootId);
      if (!rootPath.ok) return rootPath;
      const file = resolveInRoot(rootPath.value, path, 'file');
      if (!file.ok) return file;
      const { abs, relative } = file.value;
      const saved = replaceFile(rootPath.value, abs, text, expectedMtimeMs);
      if (!saved.ok) return saved;
      const { mtimeMs } = saved.value;
      context.log.info('root-file-saved', {
        space: context.key,
        root: rootId,
        path: relative,
        bytes,
      });
      // Read the root's changes again now, rather than wait for the watcher.
      const held = await context.service(spaceRoots).running();
      if (held.ok) held.value.tracker.scheduleRefresh(rootId);
      return { ok: true, value: { rootId, path: relative, mtimeMs, bytes } };
    },
  );
};
