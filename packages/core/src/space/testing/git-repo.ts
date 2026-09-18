/**
 * Temporary git repositories for tests and fixture builders.
 *
 * `git` here is the real `git`, run through the real command runner in test
 * mode, against repositories under the temporary folder. Each repository gets
 * its own `user.name`, `user.email` and `commit.gpgsign=false`, so that a test
 * does not depend on the machine's git configuration. Remotes are bare
 * repositories under the temporary folder.
 *
 * A builder throws when a step fails: a fixture that cannot be built is an
 * error of the test, not an outcome a caller handles.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileRunner } from '../exec/exec-file-runner.js';
import { createGitPort } from '../exec/git-port.js';
import { commandFailure, runSucceeded } from '../exec/runner.js';
import { safeJoin } from '../fs/paths.js';
import type { Result } from '../result.js';
import { enableTestMode, makeTempDir } from './temp.js';

/** A git repository under the temporary folder, with the few actions a fixture needs. */
export type TempGitRepo = {
  /** The repository's folder, as a real path. */
  dir: string;
  /** Run `git` with these arguments in the repository and return its trimmed output. */
  git: (...args: string[]) => Promise<string>;
  /** Write a file (path relative to the repository, with `/`), creating folders as needed. */
  write: (relativePath: string, text: string) => void;
  /** Remove a file or folder of the repository. */
  remove: (relativePath: string) => void;
  /**
   * Stage everything and commit; returns the new SHA. `date` (ISO 8601) fixes
   * the author and committer dates, for tests that order commits.
   */
  commitAll: (message: string, opts?: { date?: string }) => Promise<string>;
  /** Remove what the builder created. Safe to call twice. */
  cleanup: () => void;
};

/** Options of `makeTempGitRepo`. */
export type TempGitRepoOptions = {
  /**
   * Initialise in this folder, which must be under the temporary folder,
   * instead of a new one. `cleanup` then removes nothing: the folder belongs
   * to the caller.
   */
  dir?: string;
  /** The first branch. Default `main`. */
  branch?: string;
  /** Make a bare repository, to serve as a remote. */
  bare?: boolean;
  /** The start of the new folder's name. */
  prefix?: string;
};

/** What `makePlainRepository` returns. */
export type PlainRepositoryFixture = TempGitRepo & {
  /** The SHA of the repository's one commit. */
  head: string;
};

const git = createGitPort(execFileRunner);

function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.ok) throw new Error(`fixture: ${result.error.message}`);
  return result.value;
}

/** Wrap an existing repository under the temporary folder in a `TempGitRepo`. */
export function openTempGitRepo(dir: string, cleanup: () => void = () => undefined): TempGitRepo {
  enableTestMode();
  const inside = (relativePath: string): string => unwrap(safeJoin(dir, relativePath));
  const run = async (args: string[], env?: Record<string, string>): Promise<string> => {
    const result = await execFileRunner.run('git', args, { cwd: dir, env });
    if (!runSucceeded(result))
      throw new Error(`fixture: ${commandFailure('git', args, result).message}`);
    return result.stdout.trim();
  };
  return {
    dir,
    git: (...args: string[]) => run(args),
    write: (relativePath: string, text: string): void => {
      const path = inside(relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf8');
    },
    remove: (relativePath: string): void => {
      rmSync(inside(relativePath), { recursive: true, force: true });
    },
    commitAll: async (message: string, opts: { date?: string } = {}): Promise<string> => {
      const env =
        opts.date === undefined
          ? undefined
          : { GIT_AUTHOR_DATE: opts.date, GIT_COMMITTER_DATE: opts.date };
      await run(['add', '--all']);
      await run(['commit', '--quiet', '--allow-empty', '--message', message], env);
      return run(['rev-parse', 'HEAD']);
    },
    cleanup,
  };
}

/** Set the identity and signing configuration every test repository carries. */
export async function configureTestIdentity(dir: string): Promise<void> {
  enableTestMode();
  unwrap(await git.setConfig(dir, 'user.name', 'AI-Lore Test'));
  unwrap(await git.setConfig(dir, 'user.email', 'test@ai-lore.invalid'));
  unwrap(await git.setConfig(dir, 'commit.gpgsign', 'false'));
}

/** Create and initialise a repository under the temporary folder. It has no commit yet. */
export function makeTempGitRepo(options: TempGitRepoOptions = {}): Promise<TempGitRepo> {
  return inOwnedOrGivenDir(options.dir, options.prefix ?? 'ai-lore-repo-', '.', async (dir) => {
    unwrap(await git.init(dir, { initialBranch: options.branch ?? 'main', bare: options.bare }));
  });
}

/**
 * Build a repository in `given`, or in `child` of a new temporary folder that
 * the returned repository then owns. A build that throws removes the new
 * folder before the error is passed on, so a failed fixture leaves nothing.
 */
async function inOwnedOrGivenDir(
  given: string | undefined,
  prefix: string,
  child: string,
  build: (dir: string) => Promise<void>,
): Promise<TempGitRepo> {
  enableTestMode();
  const temp = given === undefined ? makeTempDir(prefix) : null;
  try {
    const dir = given ?? unwrap(safeJoin(temp?.dir ?? '', child));
    await build(dir);
    await configureTestIdentity(dir);
    return openTempGitRepo(dir, temp?.cleanup);
  } catch (caught) {
    temp?.cleanup();
    throw caught;
  }
}

/** Create a bare repository under the temporary folder, to serve as a remote. */
export function makeBareRemote(options: { branch?: string } = {}): Promise<TempGitRepo> {
  return makeTempGitRepo({ bare: true, branch: options.branch, prefix: 'ai-lore-remote-' });
}

/**
 * Clone `address` (a path under the temporary folder) into `into`, or into a
 * new temporary folder, and give the clone the test identity.
 */
export function cloneTempRepo(address: string, into?: string): Promise<TempGitRepo> {
  return inOwnedOrGivenDir(into, 'ai-lore-clone-', 'clone', async (dir) => {
    unwrap(await git.clone(address, dir));
  });
}

/**
 * The fixture "plain repository": a git repository with one commit (a
 * `README.md`) and no Lore.
 */
export async function makePlainRepository(): Promise<PlainRepositoryFixture> {
  const repo = await makeTempGitRepo({ prefix: 'ai-lore-plain-' });
  try {
    repo.write('README.md', '# A plain repository\n\nOne commit and no Lore.\n');
    const head = await repo.commitAll('First commit');
    return { ...repo, head };
  } catch (caught) {
    repo.cleanup();
    throw caught;
  }
}
