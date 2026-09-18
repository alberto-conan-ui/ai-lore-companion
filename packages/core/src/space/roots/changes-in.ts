/**
 * The changes of one root against a baseline.
 *
 * The Lore and the default publish area are folders inside the Space
 * repository, and git reports paths relative to the top of the working tree.
 * `readChangesIn` therefore restricts every command to the root's sub-path and
 * returns paths relative to the root. A repository root passes an empty
 * sub-path and gets the whole working tree.
 *
 * - Baseline `HEAD`: `git status --porcelain -z -uall -- <subPath>`.
 * - Baseline a commit: `git diff --name-status -z <commit> -- <subPath>` for
 *   tracked files, plus the untracked files under the sub-path, taken from the
 *   same `git status` that tells which paths are not committed. The untracked
 *   files are listed under any baseline, because they are in the working tree
 *   whatever the baseline knew.
 *
 * Every command is read-only and carries `--no-optional-locks`, so reading a
 * repository does not rewrite its index. Paths come from `-z` output, which git
 * never quotes, so a space or a non-ASCII character in a name arrives as it is.
 * The sub-path is passed after `--` under `--literal-pathspecs`, so no
 * character in it is read as pathspec magic or as a pattern.
 */

import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChangeEntry } from '../../changes/porcelain.js';
import { type GitFailureKind, createGitPort, runGit } from '../exec/git-port.js';
import {
  type CommandRunner,
  type RunResult,
  commandFailure,
  runSucceeded,
} from '../exec/runner.js';
import { type Failure, type Result, fail, ok } from '../result.js';
import {
  DEFAULT_ROOT_CHANGES_LIMIT,
  ROOT_CHANGES_TIMEOUT_MS,
  type ReadChangesInOptions,
  type RootChanges,
  type RootChangesFailure,
} from './types.js';

/** The result of `readChangesIn`. */
export type RootChangesResult = Result<RootChanges, RootChangesFailure>;

/** The baseline that compares the working tree with the present commit. */
export const HEAD_BASELINE = 'HEAD';

/** A baseline is `HEAD` or a commit SHA, short or full. A ref name or an option never is. */
const COMMIT_SHA = /^[0-9a-fA-F]{7,64}$/;

/** Options placed before the subcommand of every read. */
const READ_OPTIONS = ['--literal-pathspecs', '-c', 'core.quotepath=off'];

/**
 * Parse `git diff --name-status -z`: `<code>\0<path>\0` for a changed, added
 * or deleted file, and `R<score>\0<old>\0<new>\0` for a rename or a copy. The
 * codes are given the two-character form of `git status`, so that both readers
 * feed the same list: `M` becomes `'M '`, `R100` becomes `'R '`.
 */
export function parseDiffNameStatusZ(text: string): ChangeEntry[] {
  const parts = text.split('\0');
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const flag = parts[index]?.[0];
    if (flag === undefined) continue;
    if (flag === 'R' || flag === 'C') {
      const oldPath = parts[index + 1] ?? '';
      const path = parts[index + 2] ?? '';
      index += 2;
      if (path !== '') entries.push({ code: `${flag} `, path, oldPath });
    } else {
      const path = parts[index + 1] ?? '';
      index += 1;
      if (path !== '') entries.push({ code: `${flag} `, path });
    }
  }
  return entries;
}

/**
 * Parse `git status --porcelain -z`: `XY <path>\0`, and `XY <new>\0<old>\0`
 * for a rename or a copy. git marks a rename in either column: `R ` for one
 * that is staged, and ` R` for a file moved in the working tree whose new name
 * was added with `git add -N`. Today's `parsePorcelainZ` reads the old path
 * only for the first column and takes the old path of the second for an entry
 * of its own, so this reader has its own parser.
 */
export function parseStatusZ(text: string): ChangeEntry[] {
  const parts = text.split('\0');
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (part.length < 4 || part[2] !== ' ') continue;
    const code = part.slice(0, 2);
    const path = part.slice(3);
    if (/[RC]/.test(code)) {
      const oldPath = parts[index + 1] ?? '';
      index += 1;
      entries.push({ code, path, oldPath });
    } else {
      entries.push({ code, path });
    }
  }
  return entries;
}

/** `path` relative to `subPath`, or `null` when it is not under it. Both use `/`. */
function under(subPath: string, path: string): string | null {
  if (subPath === '') return path;
  return path.startsWith(`${subPath}/`) ? path.slice(subPath.length + 1) : null;
}

/**
 * Make the paths of `entries` relative to `subPath` and drop what is outside
 * it. A rename whose old path is outside the sub-path is an added file for
 * this root, and one whose new path is outside is a deleted file. git already
 * reports them that way under a path restriction; this keeps the rule in one
 * place for an entry that arrives otherwise.
 */
export function entriesRelativeTo(subPath: string, entries: readonly ChangeEntry[]): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const entry of entries) {
    const path = under(subPath, entry.path);
    const oldPath = entry.oldPath === undefined ? undefined : under(subPath, entry.oldPath);
    if (path === null) {
      if (typeof oldPath === 'string') out.push({ code: 'D ', path: oldPath });
      continue;
    }
    if (entry.oldPath === undefined) out.push({ code: entry.code, path });
    else if (typeof oldPath === 'string') out.push({ code: entry.code, path, oldPath });
    else out.push({ code: 'A ', path });
  }
  return out;
}

/** The sub-path with `/` and no trailing `/`, or `null` when it is not a path inside a working tree. */
function cleanSubPath(subPath: string): string | null {
  if (subPath === '') return '';
  if (subPath.includes('\0') || subPath.includes('\\')) return null;
  if (subPath.startsWith('/') || /^[A-Za-z]:/.test(subPath)) return null;
  const trimmed = subPath.replace(/\/+$/, '');
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return trimmed;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sameFolder(a: string, b: string): boolean {
  try {
    return realpathSync.native(a) === realpathSync.native(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

function gitFailed(
  args: readonly string[],
  result: RunResult,
): { ok: false; error: RootChangesFailure } {
  if (result.failure === 'output-too-large') {
    return fail(
      'change-set-too-large',
      'git listed more changed files than the companion reads at once, so no list was read',
    );
  }
  return { ok: false, error: commandFailure('git', args, result) };
}

/** A failure of the `GitPort`, with the one kind a change read has no use for folded into `command-failed`. */
function portFailed(error: Failure<GitFailureKind>): { ok: false; error: RootChangesFailure } {
  const kind = error.kind === 'no-commits' ? 'command-failed' : error.kind;
  return { ok: false, error: { kind, message: error.message } };
}

/**
 * Read the changes under `subPath` of the working tree `workTree` against
 * `baseline`, which is `'HEAD'` or a commit SHA. `subPath` is relative to
 * `workTree` with `/`, and empty for the whole working tree.
 *
 * What is returned is bounded: at most `limit` entries (default 5000), tracked
 * changes first. `total` holds the full count and `truncated` says whether the
 * list was cut. When git's own output passes the command runner's limit, the
 * read fails with `change-set-too-large` and returns no list.
 *
 * Nothing here throws for a state of the folder: a missing folder, a folder
 * that is not the top of a working tree, and a baseline commit that is not in
 * the repository are failures with their own kind. A repository with no commit
 * is read against `HEAD` like any other, and every file in it is untracked or
 * added. A detached `HEAD` is reported in `branch`.
 */
export async function readChangesIn(
  runner: CommandRunner,
  workTree: string,
  baseline: string,
  subPath: string,
  options: ReadChangesInOptions = {},
): Promise<RootChangesResult> {
  const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_ROOT_CHANGES_LIMIT));
  const timeoutMs = options.timeoutMs ?? ROOT_CHANGES_TIMEOUT_MS;
  const sub = cleanSubPath(subPath);
  if (sub === null) {
    return fail('invalid-argument', `not a path inside a working tree: ${subPath}`);
  }
  if (baseline !== HEAD_BASELINE && !COMMIT_SHA.test(baseline)) {
    return fail('invalid-argument', `a baseline is HEAD or a commit SHA, not: ${baseline}`);
  }
  if (!isFolder(workTree)) return fail('folder-missing', `there is no folder at ${workTree}`);

  const git = createGitPort(runner);
  const top = await git.topLevel(workTree);
  if (!top.ok) return portFailed(top.error);
  if (top.value === null || !sameFolder(top.value, workTree)) {
    return fail('not-a-repository', `${workTree} is not the top folder of a git working tree`);
  }
  const branch = await git.currentBranch(workTree);
  if (!branch.ok) return portFailed(branch.error);
  const headResult = await git.head(workTree);
  if (!headResult.ok && headResult.error.kind !== 'no-commits') {
    return portFailed(headResult.error);
  }
  const head = headResult.ok ? headResult.value : null;

  const read = (args: string[]): Promise<RunResult> =>
    runGit(runner, workTree, [...READ_OPTIONS, ...args], { readOnly: true, timeoutMs });
  const pathspec = sub === '' ? [] : ['--', sub];

  let baselineCommit: string | null = head;
  let baselineIsAncestor: boolean | null = head === null ? null : true;
  let found: ChangeEntry[];
  /** The paths, relative to the root, that differ between `HEAD` and the working tree; `null` when every entry does. */
  let notCommitted: Set<string> | null = null;
  const statusArgs = ['status', '--porcelain', '-z', '-uall', '--find-renames', ...pathspec];

  if (baseline === HEAD_BASELINE) {
    const status = await read(statusArgs);
    if (!runSucceeded(status)) return gitFailed(statusArgs, status);
    found = parseStatusZ(status.stdout);
  } else {
    const verifyArgs = ['rev-parse', '--verify', '--quiet', `${baseline}^{commit}`];
    const verified = await read(verifyArgs);
    if (!runSucceeded(verified)) {
      if (verified.failure !== undefined) return gitFailed(verifyArgs, verified);
      return fail(
        'baseline-missing',
        `the commit ${baseline} is not in this repository any more, so there is nothing to compare with`,
      );
    }
    baselineCommit = verified.stdout.trim();

    if (head === null) {
      baselineIsAncestor = null;
    } else {
      const ancestorArgs = ['merge-base', '--is-ancestor', baselineCommit, head];
      const ancestor = await read(ancestorArgs);
      if (ancestor.failure !== undefined) return gitFailed(ancestorArgs, ancestor);
      baselineIsAncestor = ancestor.code === 0 ? true : ancestor.code === 1 ? false : null;
    }

    const diffArgs = ['diff', '--name-status', '-z', '--find-renames', baselineCommit, ...pathspec];
    // One `git status` gives both the untracked files (its `??` entries, the
    // same set as `ls-files --others --exclude-standard`) and the paths not
    // committed, so the working tree is walked once per read.
    const [diff, status] = await Promise.all([read(diffArgs), read(statusArgs)]);
    if (!runSucceeded(diff)) return gitFailed(diffArgs, diff);
    if (!runSucceeded(status)) return gitFailed(statusArgs, status);
    const working = parseStatusZ(status.stdout);
    found = parseDiffNameStatusZ(diff.stdout);
    for (const entry of working) {
      if (entry.code === '??') found.push({ code: '??', path: entry.path });
    }
    notCommitted = new Set();
    for (const entry of entriesRelativeTo(sub, working)) {
      notCommitted.add(entry.path);
      // A rename not committed leaves its old name not committed too, whether
      // the diff against the baseline pairs the two names or not.
      if (entry.oldPath !== undefined) notCommitted.add(entry.oldPath);
    }
  }

  const entries = entriesRelativeTo(sub, found);
  const listed = entries.slice(0, limit);
  return ok({
    baseline,
    baselineCommit,
    baselineIsAncestor,
    head,
    branch: branch.value,
    entries: listed,
    uncommitted: listed
      .filter((entry) => notCommitted === null || notCommitted.has(entry.path))
      .map((entry) => entry.path),
    total: entries.length,
    truncated: entries.length > limit,
    limit,
  });
}
