/**
 * `readRepositoryStateIn`: one repository's branch, its operation in progress
 * and its comparison with its tracking branch, read from what the repository
 * already knows.
 *
 * Nothing here contacts a remote: there is no `fetch`, no `ls-remote` and no
 * network. Every git command is a read, run through `runGit` with
 * `--no-optional-locks`, so a repository the companion must leave untouched is
 * not rewritten. The commands and their exact order are architecture document
 * `dashboard-repositories-architecture.md`, section 3.3; what each one answers
 * was established by experiment and is recorded in section 2.
 *
 * The read fails as a whole only when the folder is missing, is not a git
 * working tree, or a command needed to establish the branch and the commit
 * (steps 1 to 4) could not be run. Once the branch is known, a failure of a
 * command that compares it with its tracking branch (step 8) is folded into
 * `remote.unknown` with `reason: 'git-failed'` instead, so the row still shows
 * the branch that was read.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from '../exec/git-port.js';
import {
  type CommandRunner,
  type RunResult,
  commandFailure,
  runSucceeded,
} from '../exec/runner.js';
import { type Result, fail, ok } from '../result.js';
import {
  ROOT_REPOSITORY_TIMEOUT_MS,
  type RemoteUnknownReason,
  type RootGitOperation,
  type RootHeadState,
  type RootRemoteComparison,
  type RootRepositoryFailure,
  type RootRepositoryState,
} from './types.js';

/** Options of `readRepositoryStateIn`. */
export type ReadRepositoryStateOptions = {
  /** Stop each git command after this many milliseconds. Default `ROOT_REPOSITORY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The time the read is stamped with. Default `() => new Date()`. A test passes a fixed one. */
  now?: () => Date;
};

/** The `\0`-separated fields `for-each-ref` prints: the upstream ref, its short form, its remote's name. */
const FOR_EACH_REF_FORMAT = '%(upstream)%00%(upstream:short)%00%(upstream:remotename)';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A failed `Result` built from a `RunResult` that did not succeed, whatever the failure was. */
function commandFailed(
  args: readonly string[],
  result: RunResult,
): { ok: false; error: RootRepositoryFailure } {
  return { ok: false, error: commandFailure('git', args, result) };
}

/**
 * The operation git records as in progress in `gitDir`, and, for a rebase, the
 * branch being rebased (`rebase-merge/head-name` or `rebase-apply/head-name`).
 */
function readOperation(gitDir: string): {
  operation: RootGitOperation | null;
  rebasing: string | null;
} {
  const has = (name: string): boolean => existsSync(join(gitDir, name));
  const rebaseFolder = has('rebase-merge')
    ? 'rebase-merge'
    : has('rebase-apply')
      ? 'rebase-apply'
      : null;
  if (rebaseFolder !== null) {
    let rebasing: string | null = null;
    try {
      const text = readFileSync(join(gitDir, rebaseFolder, 'head-name'), 'utf8');
      const firstLine = (text.split('\n')[0] ?? '').trim();
      rebasing = firstLine.startsWith('refs/heads/') ? firstLine.slice('refs/heads/'.length) : null;
    } catch {
      rebasing = null;
    }
    return { operation: 'rebase', rebasing };
  }
  if (has('MERGE_HEAD')) return { operation: 'merge', rebasing: null };
  if (has('CHERRY_PICK_HEAD')) return { operation: 'cherry-pick', rebasing: null };
  if (has('REVERT_HEAD')) return { operation: 'revert', rebasing: null };
  if (has('BISECT_LOG')) return { operation: 'bisect', rebasing: null };
  return { operation: null, rebasing: null };
}

/** The modification time of `<gitDir>/FETCH_HEAD`, ISO 8601, or `null` when there is no such file. */
function readLastFetchAt(gitDir: string): string | null {
  try {
    return statSync(join(gitDir, 'FETCH_HEAD')).mtime.toISOString();
  } catch {
    return null;
  }
}

function unknownComparison(
  reason: RemoteUnknownReason,
  message: string,
  lastFetchAt: string | null,
  remote: string | null = null,
  upstream: string | null = null,
): RootRemoteComparison {
  return { remote, upstream, ahead: null, behind: null, unknown: { reason, message }, lastFetchAt };
}

/**
 * The comparison of the branch `branch` (on which `HEAD` sits) with its
 * tracking branch, from what the repository already knows. Runs `for-each-ref`
 * and, when a tracking branch is configured and present, `rev-list
 * --left-right --count`; when none is configured, `remote` (no arguments), to
 * tell "no remote at all" from "no tracking branch on this repository that has
 * a remote". Every command failure here is folded into `unknown`, never fails
 * the read as a whole, because the branch is already known by this point.
 */
async function compareWithUpstream(
  runner: CommandRunner,
  workTree: string,
  branch: string,
  timeoutMs: number,
  lastFetchAt: string | null,
): Promise<RootRemoteComparison> {
  const run = (args: string[]): Promise<RunResult> =>
    runGit(runner, workTree, args, { readOnly: true, timeoutMs });

  const forEachArgs = ['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, `refs/heads/${branch}`];
  const forEachResult = await run(forEachArgs);
  if (!runSucceeded(forEachResult)) {
    const failed = commandFailure('git', forEachArgs, forEachResult);
    const message = `Ahead and behind are not known: ${failed.message}.`;
    return unknownComparison('git-failed', message, lastFetchAt);
  }

  const firstRecord = forEachResult.stdout.split('\n')[0] ?? '';
  const [fullRef, shortRef, remoteName] = firstRecord.split('\0');

  if (fullRef === undefined || fullRef === '') {
    const remoteArgs = ['remote'];
    const remoteResult = await run(remoteArgs);
    if (!runSucceeded(remoteResult)) {
      const failed = commandFailure('git', remoteArgs, remoteResult);
      const message = `Ahead and behind are not known: ${failed.message}.`;
      return unknownComparison('git-failed', message, lastFetchAt);
    }
    const hasRemote = remoteResult.stdout.split('\n').some((line) => line.trim() !== '');
    return hasRemote
      ? unknownComparison(
          'no-upstream',
          `Ahead and behind are not known: the branch ${branch} has no tracking branch.`,
          lastFetchAt,
        )
      : unknownComparison(
          'no-remote',
          'Ahead and behind are not known: this repository has no remote.',
          lastFetchAt,
        );
  }

  const upstream = shortRef ?? null;
  const remote = remoteName === undefined || remoteName === '' ? null : remoteName;
  const revListArgs = ['rev-list', '--left-right', '--count', `${fullRef}...HEAD`, '--'];
  const revListResult = await run(revListArgs);
  if (runSucceeded(revListResult)) {
    const [behindText, aheadText] = revListResult.stdout.trim().split(/\s+/);
    const behind = Number.parseInt(behindText ?? '', 10);
    const ahead = Number.parseInt(aheadText ?? '', 10);
    if (Number.isFinite(behind) && Number.isFinite(ahead)) {
      return { remote, upstream, ahead, behind, unknown: null, lastFetchAt };
    }
    return unknownComparison(
      'git-failed',
      'Ahead and behind are not known: git rev-list gave an answer that could not be read.',
      lastFetchAt,
      remote,
      upstream,
    );
  }
  if (revListResult.failure === undefined) {
    const message = `Ahead and behind are not known: the tracking branch ${upstream ?? branch} is not in this repository. It has not been fetched, or it was deleted on the remote.`;
    return unknownComparison('upstream-missing', message, lastFetchAt, remote, upstream);
  }
  const revListFailed = commandFailure('git', revListArgs, revListResult);
  const message = `Ahead and behind are not known: ${revListFailed.message}.`;
  return unknownComparison('git-failed', message, lastFetchAt, remote, upstream);
}

/**
 * Read one repository's branch, its operation in progress and its comparison
 * with its tracking branch, from what the repository already knows. Nothing
 * here contacts a remote: there is no `fetch`, no `ls-remote` and no network.
 *
 * `workTree` is the top folder of a working tree, which is what
 * `Root.tracking.workTree` holds for a tracked root.
 */
export async function readRepositoryStateIn(
  runner: CommandRunner,
  workTree: string,
  options: ReadRepositoryStateOptions = {},
): Promise<Result<RootRepositoryState, RootRepositoryFailure>> {
  const timeoutMs = options.timeoutMs ?? ROOT_REPOSITORY_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  if (!isDirectory(workTree)) {
    return fail('folder-missing', `There is no folder at ${workTree}.`);
  }

  const run = (args: string[]): Promise<RunResult> =>
    runGit(runner, workTree, args, { readOnly: true, timeoutMs });

  // Step 2: the git folder.
  const gitDirArgs = ['rev-parse', '--absolute-git-dir'];
  const gitDirResult = await run(gitDirArgs);
  let gitDir: string;
  if (runSucceeded(gitDirResult) && gitDirResult.stdout.trim() !== '') {
    gitDir = gitDirResult.stdout.trim();
  } else if (gitDirResult.failure === undefined) {
    return fail('not-a-repository', `${workTree} is not a git repository.`);
  } else {
    return commandFailed(gitDirArgs, gitDirResult);
  }

  // Step 3: the branch, or a detached `HEAD`.
  const branchArgs = ['symbolic-ref', '--short', '--quiet', 'HEAD'];
  const branchResult = await run(branchArgs);
  let branchName: string | null = null;
  let detached = false;
  if (runSucceeded(branchResult)) {
    branchName = branchResult.stdout.trim();
  } else if (branchResult.failure === undefined && branchResult.code === 1) {
    detached = true;
  } else {
    return commandFailed(branchArgs, branchResult);
  }

  // Step 4: the commit `HEAD` names, or none for an unborn branch.
  const commitArgs = ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'];
  const commitResult = await run(commitArgs);
  let commit: string | null = null;
  if (runSucceeded(commitResult)) {
    commit = commitResult.stdout.trim();
  } else if (commitResult.failure === undefined && commitResult.code === 1) {
    commit = null;
  } else {
    return commandFailed(commitArgs, commitResult);
  }

  // Step 5: the operation in progress, if any.
  const { operation, rebasing } = readOperation(gitDir);

  // Step 6: `head`.
  const head: RootHeadState = detached
    ? {
        kind: 'detached',
        commit: commit ?? '',
        rebasing: operation === 'rebase' ? rebasing : null,
      }
    : commit === null
      ? { kind: 'unborn-branch', branch: branchName ?? '' }
      : { kind: 'branch', branch: branchName ?? '', commit };

  // Step 7: how old the remote knowledge is.
  const lastFetchAt = readLastFetchAt(gitDir);

  // Step 8: the comparison with the tracking branch.
  let remote: RootRemoteComparison;
  if (head.kind === 'detached') {
    remote = unknownComparison(
      'detached-head',
      'Ahead and behind are not known: this repository is not on a branch.',
      lastFetchAt,
    );
  } else if (head.kind === 'unborn-branch') {
    remote = unknownComparison(
      'unborn-branch',
      `Ahead and behind are not known: the branch ${head.branch} has no commit yet.`,
      lastFetchAt,
    );
  } else {
    remote = await compareWithUpstream(runner, workTree, head.branch, timeoutMs, lastFetchAt);
  }

  return ok({ workTree, head, operation, remote, readAt: now().toISOString() });
}
