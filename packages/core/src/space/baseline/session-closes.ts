/**
 * The present commit of each root a session holds, read before the session
 * leaves Writing or ends. What this gives is passed to `leaveWriting` or
 * `endSession` of `space/desk` as the option `closes`, and the desk records one
 * session close for each.
 *
 * The read writes nothing. A target the session holds whose root cannot give a
 * commit (it is not among `roots`, it has no change tracking, its repository
 * has no commit, git could not be asked) is left out and listed in `skipped`,
 * so that leaving Writing never waits on it.
 */

import { listClaims } from '../desk/claims.js';
import type { Desk } from '../desk/desk.js';
import type { SessionCloseCommit } from '../desk/lifecycle.js';
import type { WriteTarget } from '../desk/types.js';
import type { CommandRunner } from '../exec/runner.js';
import { type Result, ok } from '../result.js';
import { rootIdOf } from '../roots/resolve-roots.js';
import type { Root } from '../roots/types.js';
import { baselineFailure, openRootRepository } from './repository.js';
import type { BaselineFailure } from './types.js';

/** What `readSessionCloseCommits` takes. `roots` is what `resolveRoots` gave for the Space. */
export type SessionCloseCommitsInput = {
  runner: CommandRunner;
  desk: Desk;
  roots: readonly Root[];
  sessionId: string;
};

/** The commits to record, and the held roots that gave none, each with the reason. */
export type SessionCloseCommits = {
  closes: SessionCloseCommit[];
  skipped: { rootId: string; reason: string }[];
};

function rootIdOfTarget(target: WriteTarget): string {
  return target.kind === 'lore' ? rootIdOf('lore', '') : rootIdOf(target.kind, target.name);
}

/**
 * The present commit of every root that `sessionId` holds on the desk, in the
 * order of its claims. A session that holds nothing gives two empty lists. It
 * fails only when the desk's claims cannot be read.
 */
export async function readSessionCloseCommits(
  input: SessionCloseCommitsInput,
): Promise<Result<SessionCloseCommits, BaselineFailure>> {
  const { runner, desk, roots, sessionId } = input;
  const claims = listClaims(desk);
  if (!claims.ok) return baselineFailure('desk-failed', claims.error.message, claims.error.kind);

  const closes: SessionCloseCommit[] = [];
  const skipped: SessionCloseCommits['skipped'] = [];
  for (const claim of claims.value) {
    if (claim.sessionId !== sessionId) continue;
    const rootId = rootIdOfTarget(claim.target);
    const root = roots.find((candidate) => candidate.id === rootId);
    if (root === undefined) {
      skipped.push({ rootId, reason: 'the Space has no such root' });
      continue;
    }
    const repository = await openRootRepository(runner, root);
    if (!repository.ok) {
      skipped.push({ rootId, reason: repository.error.message });
      continue;
    }
    if (repository.value.head === null) {
      skipped.push({ rootId, reason: 'the repository has no commit yet' });
      continue;
    }
    closes.push({ rootId, commit: repository.value.head });
  }
  return ok({ closes, skipped });
}
