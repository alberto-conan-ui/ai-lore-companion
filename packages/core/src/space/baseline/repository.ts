/**
 * What the baseline functions ask git: the present commit of a root's working
 * tree, its newest commits, and which recorded commits are still there.
 *
 * Every command is read-only and carries `--no-optional-locks`. Each read is
 * bounded: the commit list by `--max-count`, the existence check by the number
 * of records the caller passes.
 */

import { statSync } from 'node:fs';
import { createGitPort, runGit } from '../exec/git-port.js';
import { type CommandRunner, commandFailure, runSucceeded } from '../exec/runner.js';
import { type Result, ok } from '../result.js';
import { ROOT_CHANGES_TIMEOUT_MS } from '../roots/types.js';
import type { Root } from '../roots/types.js';
import type { BaselineFailure, BaselineFailureKind, CommitPoint } from './types.js';

const FIELD = '\x1f';
const RECORD = '\x1e';

/** A recorded commit is a SHA, short or full. Anything else is never given to git. */
const COMMIT_SHA = /^[0-9a-fA-F]{7,64}$/;

/** A failure of a baseline operation. */
export function baselineFailure(
  kind: BaselineFailureKind,
  message: string,
  cause?: string,
): { ok: false; error: BaselineFailure } {
  return { ok: false, error: cause === undefined ? { kind, message } : { kind, message, cause } };
}

/** The working tree of a root and its present commit. */
export type RootRepository = { workTree: string; head: string | null };

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The working tree that holds `root` and the SHA of its `HEAD` (`null` in a
 * repository with no commit). A root with no change tracking fails with
 * `root-untracked` and the sentence the root carries.
 */
export async function openRootRepository(
  runner: CommandRunner,
  root: Root,
): Promise<Result<RootRepository, BaselineFailure>> {
  if (!root.tracking.tracked) {
    return baselineFailure(
      'root-untracked',
      `${root.name} has no change tracking, so it has no baseline: ${root.tracking.message}`,
      root.tracking.reason,
    );
  }
  const { workTree } = root.tracking;
  if (!isFolder(workTree)) {
    return baselineFailure('folder-missing', `there is no folder at ${workTree}`);
  }
  const git = createGitPort(runner);
  const top = await git.topLevel(workTree);
  if (!top.ok) return baselineFailure('git-failed', top.error.message, top.error.kind);
  if (top.value === null) {
    return baselineFailure('not-a-repository', `${workTree} is not in a git repository`);
  }
  const head = await git.head(workTree);
  if (head.ok) return ok({ workTree, head: head.value });
  if (head.error.kind === 'no-commits') return ok({ workTree, head: null });
  return baselineFailure('git-failed', head.error.message, head.error.kind);
}

/**
 * The newest commits reachable from `HEAD`, newest first as git orders them,
 * at most `limit`. `truncated` says whether there are more. The list is that of
 * the whole working tree, also for a root that is a folder inside it.
 */
export async function readCommitPoints(
  runner: CommandRunner,
  workTree: string,
  limit: number,
): Promise<Result<{ commits: CommitPoint[]; truncated: boolean }, BaselineFailure>> {
  const args = [
    'log',
    `--format=%H${FIELD}%ct${FIELD}%s${RECORD}`,
    '--max-count',
    String(limit + 1),
    'HEAD',
    '--',
  ];
  const result = await runGit(runner, workTree, args, {
    readOnly: true,
    timeoutMs: ROOT_CHANGES_TIMEOUT_MS,
  });
  if (!runSucceeded(result)) {
    const failure = commandFailure('git', args, result);
    return baselineFailure('git-failed', failure.message, failure.kind);
  }
  const commits: CommitPoint[] = [];
  for (const record of result.stdout.split(RECORD)) {
    const [sha, time, subject] = record.replace(/^\n/, '').split(FIELD);
    if (sha === undefined || sha === '' || time === undefined) continue;
    const seconds = Number.parseInt(time, 10);
    const at = new Date(Number.isFinite(seconds) ? seconds * 1000 : 0).toISOString();
    commits.push({ kind: 'commit', commit: sha, at, subject: subject ?? '' });
  }
  return ok({ commits: commits.slice(0, limit), truncated: commits.length > limit });
}

/**
 * Which of `commits` are commits of the repository: a map from each given
 * value to its full SHA. A value that is not a SHA, names no object, names
 * something that is not a commit, or is a short SHA that fits several objects,
 * is left out. One git command answers for all of them.
 */
export async function resolveCommits(
  runner: CommandRunner,
  workTree: string,
  commits: readonly string[],
): Promise<Result<Map<string, string>, BaselineFailure>> {
  const asked = [...new Set(commits)].filter((commit) => COMMIT_SHA.test(commit));
  const found = new Map<string, string>();
  if (asked.length === 0) return ok(found);
  const args = ['cat-file', '--batch-check=%(objecttype) %(objectname)'];
  const result = await runGit(runner, workTree, args, {
    readOnly: true,
    input: `${asked.map((commit) => `${commit}^{commit}`).join('\n')}\n`,
    timeoutMs: ROOT_CHANGES_TIMEOUT_MS,
  });
  if (!runSucceeded(result)) {
    const failure = commandFailure('git', args, result);
    return baselineFailure('git-failed', failure.message, failure.kind);
  }
  // One line per asked value, in order: `commit <sha>`, or `<value> missing` and the like.
  const lines = result.stdout.split('\n');
  asked.forEach((commit, index) => {
    const match = /^commit ([0-9a-f]{40,64})$/.exec(lines[index] ?? '');
    if (match?.[1] !== undefined) found.set(commit, match[1]);
  });
  return ok(found);
}
