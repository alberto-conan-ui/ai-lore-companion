/**
 * Reads of one file of a root for the Files window: its diff against a
 * baseline, its content at a commit, a blob, and its history. Added by phase
 * M5.1.
 *
 * They give what the v0.8 readers give to the Changes and History views
 * (`readDiffText` in core's `changes/changes.ts`, `fileLog`, `readBaselineText`
 * and `readBlobText` in `main/diff.ts`), with the same git commands and the
 * same shape of a history entry. Those readers start git themselves and take a
 * working tree; these run every git command through the command runner, with
 * an argument array, and take a root, so that a root that is a folder inside a
 * working tree is read with paths relative to the root.
 *
 * A path from the renderer is relative to the root's folder. `resolveRootFile`
 * joins it with core's `safeJoin`, which checks containment after symbolic
 * links are resolved, and refuses a path that enters a `.git` folder. What is
 * sent to the renderer is capped, and a binary file is reported as binary.
 */

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative as relativePath, sep } from 'node:path';
import {
  type CommandRunner,
  type Root,
  errorMessage,
  runGit,
  runSucceeded,
  safeJoin,
} from '@ai-lore-companion/core';
import type {
  RootDiff,
  RootFileContent,
  RootFileHistory,
  RootFileHistoryEntry,
  SpaceRootsFailure,
  SpaceRootsResult,
} from '../../shared/ipc/space/roots.types.js';

/** The most bytes of a file's content sent to the renderer. */
export const ROOT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** The most bytes of a diff's text sent to the renderer. */
export const ROOT_DIFF_MAX_BYTES = 4 * 1024 * 1024;

/** The most commits of a file's history unless the caller asks for fewer, and the most it may ask for. */
export const ROOT_HISTORY_DEFAULT_LIMIT = 200;
export const ROOT_HISTORY_MAX_LIMIT = 1000;

/** How long one git command of these reads may run. */
const GIT_TIMEOUT_MS = 30_000;

type TrackedRoot = Root & { tracking: Extract<Root['tracking'], { tracked: true }> };

const failure = <T>(
  kind: SpaceRootsFailure['kind'],
  message: string,
  cause?: string,
): SpaceRootsResult<T> => ({
  ok: false,
  error: cause === undefined ? { kind, message } : { kind, message, cause },
});

/** The root as a tracked root, or the failure `root-untracked` with the root's own sentence. */
export function trackedRoot(root: Root): SpaceRootsResult<TrackedRoot> {
  if (root.tracking.tracked) return { ok: true, value: root as TrackedRoot };
  return failure('root-untracked', root.tracking.message, root.tracking.reason);
}

/** A file of a root: its absolute path and its path relative to the working tree, with `/`. */
export type RootFile = { abs: string; gitPath: string };

/**
 * Whether a list of path segments enters a git folder. The name is compared
 * without case, because on a case-insensitive file system (macOS by default)
 * `.GIT` opens the same folder as `.git`.
 */
function entersGitFolder(segments: readonly string[]): boolean {
  return segments.some((segment) => segment.toLowerCase() === '.git');
}

/** `abs` resolved through symbolic links; for a path that does not exist, its nearest existing parent. */
function realpathNearest(abs: string): string {
  let current = abs;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/** A path inside a root's folder: absolute, and relative to the root with `/` (`''` for the root's own folder). */
export type InRootPath = { abs: string; relative: string };

/**
 * Resolve `path`, relative to the folder `rootPath` of a root, tracked by git
 * or not, or refuse it. The empty path is the root's own folder, accepted only
 * for a folder. A path that names a git folder, in any case, is refused, and
 * so is one that leaves the root or reaches a git folder through a symbolic
 * link inside the root (`link -> .git`): the check is made on the path as
 * given and on the path after links are resolved. The one containment check
 * of the Files window's channels; the tree (`./ipc/root-tree.ts`) uses it too.
 */
export function resolveInRoot(
  rootPath: string,
  path: string,
  what: 'file' | 'folder',
): SpaceRootsResult<InRootPath> {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  if (
    (what === 'file' && segments.length === 0) ||
    segments.includes('..') ||
    entersGitFolder(segments)
  ) {
    return failure('path-refused', `The path is not a path of a ${what} inside the root.`);
  }
  if (segments.length === 0) return { ok: true, value: { abs: rootPath, relative: '' } };
  const relative = segments.join('/');
  const joined = safeJoin(rootPath, relative);
  if (!joined.ok) {
    return failure('path-refused', 'The path leaves the folder of the root.', joined.error.kind);
  }
  const real = relativePath(realpathNearest(rootPath), realpathNearest(joined.value));
  if (entersGitFolder(real.split(sep))) {
    return failure('path-refused', 'The path reaches a git folder through a symbolic link.');
  }
  return { ok: true, value: { abs: joined.value, relative } };
}

/**
 * Resolve `path`, relative to the root's folder, as a file of a tracked root,
 * or refuse it, by the rules of `resolveInRoot`.
 */
export function resolveRootFile(root: TrackedRoot, path: string): SpaceRootsResult<RootFile> {
  const inRoot = resolveInRoot(root.path, path, 'file');
  if (!inRoot.ok) return inRoot;
  const { abs, relative } = inRoot.value;
  const { subPath } = root.tracking;
  return {
    ok: true,
    value: { abs, gitPath: subPath === '' ? relative : `${subPath}/${relative}` },
  };
}

/** A path of the working tree as a path of the root, or `undefined` when it is outside the root's folder. */
function rootRelative(root: TrackedRoot, gitPath: string | undefined): string | undefined {
  if (gitPath === undefined || gitPath === '') return undefined;
  const { subPath } = root.tracking;
  if (subPath === '') return gitPath;
  return gitPath.startsWith(`${subPath}/`) ? gitPath.slice(subPath.length + 1) : undefined;
}

function git(runner: CommandRunner, root: TrackedRoot, args: readonly string[]) {
  return runGit(runner, root.tracking.workTree, args, {
    readOnly: true,
    timeoutMs: GIT_TIMEOUT_MS,
  });
}

/**
 * The full SHA of the commit `rev` names, or `null` when the repository has no
 * such commit. `rev` is `HEAD` or hex, as the handler's schema requires.
 */
export async function resolveRootCommit(
  runner: CommandRunner,
  root: TrackedRoot,
  rev: string,
): Promise<string | null> {
  if (rev.startsWith('-')) return null;
  const result = await git(runner, root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  const sha = result.stdout.trim();
  return runSucceeded(result) && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

/**
 * Whether content holds a NUL character, which marks a binary file. The whole
 * content is looked at, not its start: it is already capped at
 * `ROOT_FILE_MAX_BYTES` or `ROOT_DIFF_MAX_BYTES`, and git's own test looks at
 * the first 8,000 bytes only, so a NUL after them would reach the renderer.
 */
function isBinaryText(text: string): boolean {
  return text.includes('\0');
}

/** The content of a working-tree file as the added lines of a diff, as the v0.8 reader shapes a new file. */
function asNewFile(file: RootFile, path: string, baseline: string): RootDiff {
  const stat = lstatSync(file.abs);
  if (!stat.isFile()) return { kind: 'text', baseline, text: '' };
  if (stat.size > ROOT_FILE_MAX_BYTES) {
    return { kind: 'too-large', baseline, bytes: stat.size, limit: ROOT_FILE_MAX_BYTES };
  }
  const bytes = readFileSync(file.abs);
  if (bytes.includes(0)) return { kind: 'binary', baseline };
  const lines = bytes.toString('utf8').split('\n');
  return {
    kind: 'text',
    baseline,
    text: `+++ new file: ${path}\n${lines.map((line) => `+${line}`).join('\n')}`,
  };
}

/**
 * The unified diff of one file between `baseline` and the working tree. A file
 * git does not know (untracked) is given as added lines. `oldPath` makes git
 * read a renamed file as a rename.
 */
export async function readRootDiff(
  runner: CommandRunner,
  root: TrackedRoot,
  arg: { baseline: string; path: string; oldPath?: string },
): Promise<SpaceRootsResult<RootDiff>> {
  const file = resolveRootFile(root, arg.path);
  if (!file.ok) return file;
  const paths = [file.value.gitPath];
  if (arg.oldPath !== undefined) {
    const old = resolveRootFile(root, arg.oldPath);
    if (!old.ok) return old;
    paths.unshift(old.value.gitPath);
  }
  const { baseline } = arg;
  const diff = await git(runner, root, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '-M',
    baseline,
    '--',
    ...paths,
  ]);
  if (diff.failure === 'output-too-large') {
    return {
      ok: true,
      value: { kind: 'too-large', baseline, bytes: -1, limit: ROOT_DIFF_MAX_BYTES },
    };
  }
  if (runSucceeded(diff) && diff.stdout !== '') {
    const bytes = Buffer.byteLength(diff.stdout, 'utf8');
    if (bytes > ROOT_DIFF_MAX_BYTES) {
      return {
        ok: true,
        value: { kind: 'too-large', baseline, bytes, limit: ROOT_DIFF_MAX_BYTES },
      };
    }
    if (/^Binary files .* differ$/m.test(diff.stdout) || isBinaryText(diff.stdout)) {
      return { ok: true, value: { kind: 'binary', baseline } };
    }
    return { ok: true, value: { kind: 'text', baseline, text: diff.stdout } };
  }
  // Nothing from git: the file is unchanged, or git does not know it (untracked, or a
  // repository with no commit, where `git diff HEAD` fails).
  try {
    const known = await git(runner, root, [
      'ls-files',
      '--error-unmatch',
      '--',
      file.value.gitPath,
    ]);
    if (!runSucceeded(known)) {
      return { ok: true, value: asNewFile(file.value, arg.path, baseline) };
    }
  } catch (caught) {
    const code = (caught as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT')
      return failure('git-failed', `The file could not be read: ${errorMessage(caught)}`);
    // No file in the working tree and nothing from git: there is nothing to show.
  }
  if (!runSucceeded(diff)) {
    return failure('git-failed', `git diff failed: ${diff.stderr.trim()}`, diff.failure);
  }
  return { ok: true, value: { kind: 'text', baseline, text: '' } };
}

/** The content of the object `rev` names, capped, with a binary file reported as binary. */
async function readObject(
  runner: CommandRunner,
  root: TrackedRoot,
  rev: string,
): Promise<SpaceRootsResult<RootFileContent>> {
  // `rev` is a hex SHA, or a full SHA with `:` and a path: it cannot be read as an option.
  if (rev.startsWith('-')) return { ok: true, value: { kind: 'absent' } };
  const size = await git(runner, root, ['cat-file', '-s', rev]);
  if (!runSucceeded(size)) {
    if (size.failure !== undefined) {
      return failure('git-failed', `git cat-file failed: ${size.stderr.trim()}`, size.failure);
    }
    return { ok: true, value: { kind: 'absent' } };
  }
  const bytes = Number.parseInt(size.stdout.trim(), 10);
  if (!Number.isFinite(bytes)) return failure('git-failed', 'git cat-file gave no size.');
  if (bytes > ROOT_FILE_MAX_BYTES) {
    return { ok: true, value: { kind: 'too-large', bytes, limit: ROOT_FILE_MAX_BYTES } };
  }
  const content = await git(runner, root, ['cat-file', 'blob', rev]);
  if (!runSucceeded(content)) {
    // The object is there and is not a blob (a folder at the path, a commit's SHA).
    if (content.failure === undefined) return { ok: true, value: { kind: 'absent' } };
    return failure('git-failed', `git cat-file failed: ${content.stderr.trim()}`, content.failure);
  }
  if (isBinaryText(content.stdout)) return { ok: true, value: { kind: 'binary', bytes } };
  return { ok: true, value: { kind: 'text', text: content.stdout } };
}

/** The content of one file at a commit. */
export async function readRootFileAt(
  runner: CommandRunner,
  root: TrackedRoot,
  arg: { commit: string; path: string },
): Promise<SpaceRootsResult<RootFileContent>> {
  const file = resolveRootFile(root, arg.path);
  if (!file.ok) return file;
  const commit = await resolveRootCommit(runner, root, arg.commit);
  if (commit === null) {
    return failure('baseline-missing', 'The commit is not in the repository of this root.');
  }
  return readObject(runner, root, `${commit}:${file.value.gitPath}`);
}

/** The content of a blob, by its SHA. */
export function readRootBlob(
  runner: CommandRunner,
  root: TrackedRoot,
  blob: string,
): Promise<SpaceRootsResult<RootFileContent>> {
  return readObject(runner, root, blob);
}

/**
 * The commits that touched one file, newest first, following renames. The
 * format and the parse are the v0.8 `fileLog`'s: each commit's header starts
 * with `\x01`, its fields are separated by `\x1f`, and `\x02` closes it before
 * the `--raw` line. A path with no history gives an empty list.
 */
export async function readRootFileHistory(
  runner: CommandRunner,
  root: TrackedRoot,
  arg: { path: string; limit: number },
): Promise<SpaceRootsResult<RootFileHistory>> {
  const file = resolveRootFile(root, arg.path);
  if (!file.ok) return file;
  const limit = Math.min(Math.max(1, Math.floor(arg.limit)), ROOT_HISTORY_MAX_LIMIT);
  const log = await git(runner, root, [
    'log',
    '--follow',
    '--raw',
    '--no-abbrev',
    '-n',
    String(limit + 1),
    '--format=%x01%H%x1f%ct%x1f%an%x1f%s%x1f%b%x02',
    '--',
    file.value.gitPath,
  ]);
  if (log.failure !== undefined) {
    return failure('git-failed', `git log failed: ${log.stderr.trim()}`, log.failure);
  }
  // A repository with no commit makes `git log` fail; it has no history to show.
  if (!runSucceeded(log)) return { ok: true, value: { entries: [], truncated: false, limit } };
  const entries: RootFileHistoryEntry[] = [];
  for (const record of log.stdout.split('\x01')) {
    if (record.length === 0) continue;
    const sentinel = record.indexOf('\x02');
    const header = sentinel >= 0 ? record.slice(0, sentinel) : record;
    const rawBlock = sentinel >= 0 ? record.slice(sentinel + 1) : '';
    const [sha, seconds, author, subject, body] = header.split('\x1f');
    if (!sha) continue;
    const raw = rawBlock.split('\n').find((line) => line.startsWith(':'));
    const segments = raw ? raw.slice(1).split('\t') : [];
    const meta = (segments[0] ?? '').split(/\s+/);
    const change = meta[4] ?? '';
    const entry: RootFileHistoryEntry = {
      sha,
      subject: subject ?? '',
      author: author ?? '',
      body: (body ?? '').trimEnd(),
      timestamp: Number(seconds) * 1000,
      blob: meta[3] ?? '',
      prevBlob: meta[2] ?? '',
      change,
    };
    if (change.startsWith('R') || change.startsWith('C')) {
      const oldPath = rootRelative(root, segments[1]);
      const newPath = rootRelative(root, segments[2]);
      if (oldPath !== undefined) entry.oldPath = oldPath;
      if (newPath !== undefined) entry.newPath = newPath;
    }
    entries.push(entry);
  }
  const truncated = entries.length > limit;
  return { ok: true, value: { entries: entries.slice(0, limit), truncated, limit } };
}
