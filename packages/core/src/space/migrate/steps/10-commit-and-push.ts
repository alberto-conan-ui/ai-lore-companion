/**
 * Step 10: commit and push the Space repository. The archive must be on
 * GitHub before step 11, because the issues link to archived files by
 * address. Done when the branch is on `origin` at the commit the folder is at,
 * and nothing is left uncommitted. Phase M6.3 builds `run`.
 */

import { runGit } from '../../exec/git-port.js';
import { runSucceeded } from '../../exec/runner.js';
import { firstCommitStep } from '../../setup/steps.js';
import { notBuiltYet } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';

const TITLE = 'Commit and push the Space';

/** Whether the Space folder's branch and `origin`'s copy of it are at one commit, with nothing uncommitted. Reads only. */
export async function isPushedAndClean(ctx: MigrationContext): Promise<boolean> {
  if (!(await firstCommitStep().isDone(ctx.setup))) return false;
  const clean = await ctx.git.isClean(ctx.spaceRoot);
  if (!clean.ok || !clean.value) return false;
  const branch = await ctx.git.currentBranch(ctx.spaceRoot);
  if (!branch.ok || branch.value.detached) return false;
  const args = ['rev-parse', 'HEAD', `refs/remotes/origin/${branch.value.branch}`];
  const heads = await runGit(ctx.deps.runner, ctx.spaceRoot, args, { readOnly: true });
  if (!runSucceeded(heads)) return false;
  const [local, remote] = heads.stdout.trim().split('\n');
  return local !== undefined && local !== '' && local === remote;
}

/** Step 10. */
export function commitAndPushStep(): MigrationStep {
  return {
    id: 'commit-and-push',
    number: 10,
    title: TITLE,
    describe: async (ctx) => [
      ...(await firstCommitStep().describe(ctx.setup)),
      {
        what: 'The commit holds the archive, the contracts, the mirror and the corpus entry, so the issues of the next step can link to archived files.',
        to: ctx.repositoryName,
        count: ctx.targets.archived.length,
      },
    ],
    isDone: (ctx) => isPushedAndClean(ctx),
    run: async () => notBuiltYet(TITLE),
  };
}
