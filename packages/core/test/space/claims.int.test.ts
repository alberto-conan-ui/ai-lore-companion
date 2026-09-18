/**
 * The branch-name rule of the claim rules against `git` itself. The rule
 * functions start no process, so `branchNameProblem` writes the rules of
 * `git check-ref-format --branch` out; this test runs the real command, in a
 * repository under the temporary folder, on the same names.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { branchNameProblem } from '../../src/space/claims/index.js';
import { useTempGitRepo } from '../support/index.js';

/**
 * What `git check-ref-format --branch <name>` says, asked in `dir`, which is
 * under the temporary folder. The command reads and writes nothing. It is
 * started here and not through the command runner, which in test mode refuses
 * an argument such as `/a` as a path outside the temporary folder. An empty
 * name and a name that begins with a hyphen are not given to git, which would
 * read the second as an option; `GitPort.isValidBranchName` does the same.
 */
function acceptedByGit(dir: string, name: string): boolean {
  if (name === '' || name.startsWith('-')) return false;
  const run = spawnSync('git', ['check-ref-format', '--branch', name], { cwd: dir });
  if (run.error) throw new Error(`git could not be run: ${run.error.message}`);
  return run.status === 0;
}

const NAMES = [
  'main',
  'item-12',
  '12-add-the-header',
  'feature/a.b',
  'refs/heads/x',
  'a@b',
  '@/x',
  'a.lockx',
  'ünï',
  'a{b}',
  '',
  'HEAD',
  '-x',
  '--force',
  '/a',
  'a/',
  'a.',
  'a..b',
  'a@{1}',
  '@{-1}',
  'a b',
  ' a',
  'a~1',
  'a^',
  'a:b',
  'a?',
  'a*',
  'a[',
  'a\\b',
  'a\tb',
  'a\nb',
  'ab',
  'a//b',
  '.a',
  'a/.b',
  'a.lock',
  'a.lock/b',
];

test('branchNameProblem accepts and refuses the names that git check-ref-format --branch does', async (t) => {
  const repo = await useTempGitRepo(t);
  for (const name of NAMES) {
    const byGit = acceptedByGit(repo.dir, name);
    assert.equal(
      branchNameProblem(name) === null,
      byGit,
      `${JSON.stringify(name)}: git says ${byGit}, the rule says ${branchNameProblem(name)}`,
    );
  }
  // The one difference: with `--branch`, git accepts `@`, which in a git command stands for
  // HEAD. A claim names its branch literally, so the rule refuses it, as git's rule for a
  // reference name does when the name is looked at alone.
  assert.equal(acceptedByGit(repo.dir, '@'), true);
  const alone = spawnSync('git', ['check-ref-format', '--allow-onelevel', '@'], { cwd: repo.dir });
  assert.equal(alone.status, 1);
  assert.equal(
    branchNameProblem('@'),
    'a single @ stands for HEAD in git and is not the name of a branch',
  );
});
