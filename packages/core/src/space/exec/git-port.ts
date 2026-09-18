/**
 * `GitPort`: the git commands of the 1.0 library, over a `CommandRunner`.
 *
 * Every command is an argument array. A value that comes from outside (an
 * address, a path, a branch name) is a separate argument placed after `--`
 * where git accepts it, and is refused when it begins with `-` where git does
 * not. Read commands carry `--no-optional-locks`, so that reading a folder the
 * companion must leave untouched does not rewrite its index file.
 *
 * The existing synchronous readers (`readChanges`, `readDiffText`,
 * `readCommitList`) stay in use for local reads; this port adds what they do
 * not cover and everything that reaches a remote.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Failure, type Result, errorMessage, fail, ok } from '../result.js';
import {
  type CommandFailureKind,
  type CommandRunner,
  type RunResult,
  commandFailure,
  runSucceeded,
} from './runner.js';

/** The kinds of failure a `GitPort` function returns. */
export type GitFailureKind = CommandFailureKind | 'no-commits' | 'invalid-argument';

/** The result of a `GitPort` function. */
export type GitResult<T> = Result<T, Failure<GitFailureKind>>;

/** The branch a repository is on. `branch` is empty when `detached` is true. */
export type GitBranch = { branch: string; detached: boolean };

/** One commit of a log, newest first. The first three fields match `CommitListEntry`. */
export type GitLogEntry = {
  /** The full 40-character SHA. */
  sha: string;
  /** The first line of the message. */
  subject: string;
  /** Committer date, Unix epoch seconds. */
  timestamp: number;
  /** The author's name. */
  author: string;
};

/** Options of `runGit`. */
export type RunGitOptions = {
  /** Add `--no-optional-locks`. Set for every command that only reads. */
  readOnly?: boolean;
  input?: string;
  timeoutMs?: number;
};

/** The git commands the 1.0 library uses. `dir` is a folder of the repository. */
export type GitPort = {
  /** Whether `dir` is inside a git repository (a working tree or a bare one). */
  isRepository(dir: string): Promise<GitResult<boolean>>;
  /** The top folder of the working tree that holds `dir`, or `null` when there is none. */
  topLevel(dir: string): Promise<GitResult<string | null>>;
  /** The SHA of `HEAD`. Fails with `no-commits` in a repository with no commit. */
  head(dir: string): Promise<GitResult<string>>;
  /** The checked-out branch; also answers in a repository with no commit. */
  currentBranch(dir: string): Promise<GitResult<GitBranch>>;
  /** The address of the remote `remote` (default `origin`), or `null` when it is not set. */
  originUrl(dir: string, remote?: string): Promise<GitResult<string | null>>;
  /** Whether the working tree has no change and no untracked file. */
  isClean(dir: string): Promise<GitResult<boolean>>;
  /** Clone `address` into the folder `into`, whose parent is created when missing. */
  clone(
    address: string,
    into: string,
    opts?: { branch?: string; bare?: boolean },
  ): Promise<GitResult<void>>;
  /** Create `dir` when missing and initialise a repository in it. Default branch `main`. */
  init(dir: string, opts?: { initialBranch?: string; bare?: boolean }): Promise<GitResult<void>>;
  /** Set one value in the repository's own configuration. */
  setConfig(dir: string, key: string, value: string): Promise<GitResult<void>>;
  /** Add a remote. */
  addRemote(dir: string, name: string, address: string): Promise<GitResult<void>>;
  /** Stage every change, including deletions and untracked files. */
  addAll(dir: string): Promise<GitResult<void>>;
  /** Commit what is staged and return the new SHA. The message goes on standard input. */
  commit(dir: string, message: string, opts?: { allowEmpty?: boolean }): Promise<GitResult<string>>;
  /** Push `branch` (default: the current branch) to `remote` (default `origin`). */
  push(
    dir: string,
    opts?: { remote?: string; branch?: string; setUpstream?: boolean },
  ): Promise<GitResult<void>>;
  /** The commits that touched `path` (relative to `dir`), newest first. */
  logForPath(
    dir: string,
    path: string,
    opts?: { limit?: number; since?: string },
  ): Promise<GitResult<GitLogEntry[]>>;
  /** The best common ancestor of two commits, or `null` when they share none. */
  mergeBase(dir: string, a: string, b: string): Promise<GitResult<string | null>>;
  /** Whether `name` is a valid branch name (`git check-ref-format --branch`). */
  isValidBranchName(name: string, dir: string): Promise<GitResult<boolean>>;
};

const FIELD = '\x1f';
const RECORD = '\x1e';

/**
 * Run one git command in `dir` and return the raw `RunResult`. For a command
 * the port has no function for; the rules in this file's header apply to the
 * caller's arguments.
 */
export function runGit(
  runner: CommandRunner,
  dir: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<RunResult> {
  const full = opts.readOnly === true ? ['--no-optional-locks', ...args] : [...args];
  return runner.run('git', full, { cwd: dir, input: opts.input, timeoutMs: opts.timeoutMs });
}

function gitFailure(
  args: readonly string[],
  result: RunResult,
): { ok: false; error: Failure<GitFailureKind> } {
  return { ok: false, error: commandFailure('git', args, result) };
}

/** A value that git would read as an option is refused before git sees it. */
function optionLike(
  label: string,
  value: string,
): { ok: false; error: Failure<GitFailureKind> } | null {
  if (value !== '' && !value.startsWith('-')) return null;
  return fail('invalid-argument', `${label} may not be empty or begin with "-": ${value}`);
}

function parseLog(stdout: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  for (const record of stdout.split(RECORD)) {
    const [sha, time, author, subject] = record.replace(/^\n/, '').split(FIELD);
    if (sha === undefined || sha === '' || time === undefined) continue;
    const timestamp = Number.parseInt(time, 10);
    entries.push({
      sha,
      subject: subject ?? '',
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      author: author ?? '',
    });
  }
  return entries;
}

/** Build the `GitPort` that runs its commands through `runner`. */
export function createGitPort(runner: CommandRunner): GitPort {
  /** Run a command whose only answer is success. */
  async function simple(dir: string, args: string[], input?: string): Promise<GitResult<void>> {
    const result = await runGit(runner, dir, args, { input });
    return runSucceeded(result) ? ok(undefined) : gitFailure(args, result);
  }

  async function ensureDir(dir: string): Promise<GitResult<void>> {
    try {
      await mkdir(dir, { recursive: true });
      return ok(undefined);
    } catch (caught) {
      return fail('command-failed', `cannot create ${dir}: ${errorMessage(caught)}`);
    }
  }

  const port: GitPort = {
    async isRepository(dir) {
      const args = ['rev-parse', '--git-dir'];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(true);
      return result.failure === undefined ? ok(false) : gitFailure(args, result);
    },

    async topLevel(dir) {
      const args = ['rev-parse', '--show-toplevel'];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(result.stdout.trim() || null);
      return result.failure === undefined ? ok(null) : gitFailure(args, result);
    },

    async head(dir) {
      const args = ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(result.stdout.trim());
      if (result.failure === undefined && result.code === 1) {
        return fail('no-commits', `${dir} has no commit yet`);
      }
      return gitFailure(args, result);
    },

    async currentBranch(dir) {
      const inside = await port.isRepository(dir);
      if (!inside.ok) return inside;
      if (!inside.value) return fail('command-failed', `${dir} is not a git repository`);
      const args = ['symbolic-ref', '--short', '--quiet', 'HEAD'];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok({ branch: result.stdout.trim(), detached: false });
      if (result.failure === undefined && result.code === 1) {
        return ok({ branch: '', detached: true });
      }
      return gitFailure(args, result);
    },

    async originUrl(dir, remote = 'origin') {
      if (!/^[A-Za-z0-9._-]+$/.test(remote)) {
        return fail('invalid-argument', `not a remote name: ${remote}`);
      }
      const inside = await port.isRepository(dir);
      if (!inside.ok) return inside;
      if (!inside.value) return fail('command-failed', `${dir} is not a git repository`);
      const args = ['config', '--get', `remote.${remote}.url`];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(result.stdout.trim() || null);
      if (result.failure === undefined && result.code === 1) return ok(null);
      return gitFailure(args, result);
    },

    async isClean(dir) {
      const args = ['status', '--porcelain'];
      const result = await runGit(runner, dir, args, { readOnly: true });
      return runSucceeded(result) ? ok(result.stdout.trim() === '') : gitFailure(args, result);
    },

    async clone(address, into, opts = {}) {
      const bad = optionLike('a clone address', address) ?? optionLike('a clone folder', into);
      if (bad !== null) return bad;
      if (opts.branch !== undefined) {
        const badBranch = optionLike('a branch name', opts.branch);
        if (badBranch !== null) return badBranch;
      }
      const parent = dirname(into);
      const made = await ensureDir(parent);
      if (!made.ok) return made;
      const args = [
        'clone',
        '--quiet',
        ...(opts.bare === true ? ['--bare'] : []),
        ...(opts.branch !== undefined ? ['--branch', opts.branch] : []),
        '--',
        address,
        into,
      ];
      return simple(parent, args);
    },

    async init(dir, opts = {}) {
      const branch = opts.initialBranch ?? 'main';
      const badBranch = optionLike('a branch name', branch);
      if (badBranch !== null) return badBranch;
      const made = await ensureDir(dir);
      if (!made.ok) return made;
      return simple(dir, [
        'init',
        '--quiet',
        ...(opts.bare === true ? ['--bare'] : []),
        '--initial-branch',
        branch,
      ]);
    },

    async setConfig(dir, key, value) {
      const bad = optionLike('a configuration key', key);
      if (bad !== null) return bad;
      return simple(dir, ['config', '--local', '--', key, value]);
    },

    async addRemote(dir, name, address) {
      const bad = optionLike('a remote name', name) ?? optionLike('a remote address', address);
      if (bad !== null) return bad;
      return simple(dir, ['remote', 'add', '--', name, address]);
    },

    addAll(dir) {
      return simple(dir, ['add', '--all']);
    },

    async commit(dir, message, opts = {}) {
      const args = [
        'commit',
        '--quiet',
        ...(opts.allowEmpty === true ? ['--allow-empty'] : []),
        '--file',
        '-',
      ];
      const done = await simple(dir, args, message);
      if (!done.ok) return done;
      return port.head(dir);
    },

    async push(dir, opts = {}) {
      const remote = opts.remote ?? 'origin';
      let branch = opts.branch;
      if (branch === undefined) {
        const current = await port.currentBranch(dir);
        if (!current.ok) return current;
        if (current.value.detached) {
          return fail('invalid-argument', `${dir} is not on a branch, so there is nothing to push`);
        }
        branch = current.value.branch;
      }
      const bad = optionLike('a remote name', remote) ?? optionLike('a branch name', branch);
      if (bad !== null) return bad;
      return simple(dir, [
        'push',
        '--quiet',
        ...(opts.setUpstream === true ? ['--set-upstream'] : []),
        '--',
        remote,
        branch,
      ]);
    },

    async logForPath(dir, path, opts = {}) {
      if (opts.since !== undefined) {
        const bad = optionLike('a commit', opts.since);
        if (bad !== null) return bad;
      }
      const args = [
        'log',
        `--format=%H${FIELD}%ct${FIELD}%an${FIELD}%s${RECORD}`,
        ...(opts.limit !== undefined ? ['--max-count', String(Math.max(0, opts.limit))] : []),
        ...(opts.since !== undefined ? [`${opts.since}..HEAD`] : []),
        '--',
        path,
      ];
      const result = await runGit(runner, dir, args, { readOnly: true });
      return runSucceeded(result) ? ok(parseLog(result.stdout)) : gitFailure(args, result);
    },

    async mergeBase(dir, a, b) {
      const bad = optionLike('a commit', a) ?? optionLike('a commit', b);
      if (bad !== null) return bad;
      const args = ['merge-base', a, b];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(result.stdout.trim() || null);
      if (result.failure === undefined && result.code === 1) return ok(null);
      return gitFailure(args, result);
    },

    async isValidBranchName(name, dir) {
      if (name === '' || name.startsWith('-')) return ok(false);
      const args = ['check-ref-format', '--branch', name];
      const result = await runGit(runner, dir, args, { readOnly: true });
      if (runSucceeded(result)) return ok(true);
      return result.failure === undefined ? ok(false) : gitFailure(args, result);
    },
  };
  return port;
}
