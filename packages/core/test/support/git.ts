/**
 * Temporary git repositories for core's own tests: the builders of
 * `src/space/testing`, removed when the test ends.
 */

import {
  type PlainRepositoryFixture,
  type TempGitRepo,
  type TempGitRepoOptions,
  cloneTempRepo,
  makeBareRemote,
  makePlainRepository,
  makeTempGitRepo,
} from '../../src/space/testing/git-repo.js';
import type { CleanupHost } from './temp.js';
import './temp.js';

/** A new repository with the test identity and no commit, removed when `t` ends. */
export async function useTempGitRepo(
  t: CleanupHost,
  options?: TempGitRepoOptions,
): Promise<TempGitRepo> {
  const repo = await makeTempGitRepo(options);
  t.after(() => repo.cleanup());
  return repo;
}

/** A new bare repository to serve as a remote, removed when `t` ends. */
export async function useBareRemote(t: CleanupHost): Promise<TempGitRepo> {
  const remote = await makeBareRemote();
  t.after(() => remote.cleanup());
  return remote;
}

/** A clone of `address` in a new temporary folder, removed when `t` ends. */
export async function useClone(t: CleanupHost, address: string): Promise<TempGitRepo> {
  const clone = await cloneTempRepo(address);
  t.after(() => clone.cleanup());
  return clone;
}

/** The plain-repository fixture (one commit, no Lore), removed when `t` ends. */
export async function usePlainRepository(t: CleanupHost): Promise<PlainRepositoryFixture> {
  const repo = await makePlainRepository();
  t.after(() => repo.cleanup());
  return repo;
}
