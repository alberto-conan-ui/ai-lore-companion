/**
 * Step 10: commit and push the Space repository. The archive must be on
 * GitHub before step 11, because the issues link to archived files by
 * address. Done when the branch is on `origin` at the commit the folder is at,
 * and nothing is left uncommitted. Phase M6.3 builds `run`.
 */

import { stat } from 'node:fs/promises';
import { runGit } from '../../exec/git-port.js';
import { commandFailure, runSucceeded } from '../../exec/runner.js';
import { realpathNearest } from '../../fs/paths.js';
import { type Result, err, fail, ok } from '../../result.js';
import { firstCommitStep, gitHubStepError } from '../../setup/steps.js';
import type { StepError } from '../../steps/types.js';
import { inSpace } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { recordStepDone, stepStopped } from '../local/record.js';

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
    run: async (ctx) => {
      const made = await commitAndPush(ctx);
      if (!made.ok) return stepStopped(made.error.kind, TITLE, made.error.message);
      const head = await ctx.git.head(ctx.spaceRoot);
      return recordStepDone(ctx, 'commit-and-push', [
        `${ctx.repositoryName} at ${head.ok ? head.value : 'its pushed commit'}`,
      ]);
    },
  };
}

/** The message of the commit that holds what the migration wrote. */
export function migrationCommitMessage(ctx: MigrationContext): string {
  return `Migrate the AI-Lore v0.8 project ${ctx.source.project.name}\n`;
}

async function isOwnWorkTree(ctx: MigrationContext): Promise<boolean> {
  const top = await ctx.git.topLevel(ctx.spaceRoot);
  if (!top.ok || top.value === null) return false;
  try {
    return realpathNearest(top.value) === realpathNearest(ctx.spaceRoot);
  } catch {
    return false;
  }
}

/**
 * Make the Space folder a repository on `main` with the Space repository as
 * its origin, when it is not one yet; commit everything that is not
 * committed; and push, never with force. The archive is added with `--force`,
 * so a file the archive holds reaches GitHub even when an ignore rule (the
 * Space's own, or a `.gitignore` inside the archive) names it.
 */
async function commitAndPush(ctx: MigrationContext): Promise<Result<void, StepError>> {
  const { git, spaceRoot } = ctx;
  let found = ctx.setup.found.repository;
  if (found === null) {
    const looked = await ctx.deps.github.findRepository(ctx.repositoryName);
    if (!looked.ok) return err(gitHubStepError(looked.error));
    found = looked.value;
  }
  if (found === null) {
    return fail(
      'repository-not-found',
      `The repository ${ctx.repositoryName} was not found on GitHub.`,
    );
  }
  if (!(await isOwnWorkTree(ctx))) {
    const made = await git.init(spaceRoot, { initialBranch: 'main' });
    if (!made.ok) return made;
  }
  const origin = await git.originUrl(spaceRoot);
  if (!origin.ok) return origin;
  if (origin.value === null) {
    const added = await git.addRemote(spaceRoot, 'origin', found.cloneUrl);
    if (!added.ok) return added;
  } else if (origin.value !== found.cloneUrl) {
    return fail(
      'origin-differs',
      `The origin of ${spaceRoot} is ${origin.value} and not ${found.cloneUrl}, so nothing was committed or pushed.`,
    );
  }
  for (const [key, value] of Object.entries(ctx.deps.gitConfig ?? {})) {
    const set = await git.setConfig(spaceRoot, key, value);
    if (!set.ok) return set;
  }
  const staged = await git.addAll(spaceRoot);
  if (!staged.ok) return staged;
  if ((await stat(inSpace(ctx, ctx.targets.archiveDir)).catch(() => null)) !== null) {
    const args = ['add', '--force', '--all', '--', ctx.targets.archiveDir];
    const archive = await runGit(ctx.deps.runner, spaceRoot, args);
    if (!runSucceeded(archive)) return err(commandFailure('git', args, archive));
  }
  const clean = await git.isClean(spaceRoot);
  if (!clean.ok) return clean;
  if (!clean.value) {
    const committed = await git.commit(spaceRoot, migrationCommitMessage(ctx));
    if (!committed.ok) return committed;
  }
  const pushed = await git.push(spaceRoot, { setUpstream: true });
  return pushed.ok ? ok(undefined) : pushed;
}
