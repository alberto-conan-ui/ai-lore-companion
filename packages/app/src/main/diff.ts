/**
 * External diff invocation — main-process plumbing.
 *
 * Materialises a save-point baseline via `git show <commit>:<path>` into a
 * tempfile, then spawns the configured CLI with argv as an array. The
 * template is never passed through a shell — every token becomes one argv
 * element — so paths containing shell metacharacters cannot interpolate.
 *
 * Phase E of the [Companion v0.5 focus](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.5/E-ack-and-diff.phase.md).
 */

import { type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildDiffArgv } from '@ai-lore-companion/core';

export type MaterialiseBaselineInput = {
  /** Absolute path to the git working tree the file belongs to. */
  workingTreeRoot: string;
  /** The save-point's commit for this repo. */
  commit: string;
  /** Path relative to `workingTreeRoot` — the form `git show` accepts. */
  gitRelPath: string;
};

export type MaterialiseBaselineResult =
  | { kind: 'ok'; tempPath: string }
  | { kind: 'failed'; message: string };

/**
 * Materialise the baseline file for a diff into a tempfile.
 *
 * Runs `git -C <workingTreeRoot> show <commit>:<gitRelPath>` capturing
 * stdout into a tempfile whose name preserves the original extension (so
 * a diff tool that decides language by extension keeps doing so). When the
 * file did not exist at the commit, `git show` exits non-zero; an empty
 * tempfile is written and returned so a diff against a new file still opens.
 */
export function materialiseBaseline(input: MaterialiseBaselineInput): MaterialiseBaselineResult {
  const dir = mkdtempSync(join(tmpdir(), 'ai-lore-diff-'));
  // Preserve the working-tree file's basename (extension included) — diff
  // tools that infer syntax from extension stay happy.
  const tempPath = join(dir, basename(input.gitRelPath));
  let result: SpawnSyncReturns<Buffer>;
  try {
    result = spawnSync(
      'git',
      ['-C', input.workingTreeRoot, 'show', `${input.commit}:${input.gitRelPath}`],
      { encoding: 'buffer' },
    );
  } catch (err) {
    return { kind: 'failed', message: `git show failed to start: ${(err as Error).message}` };
  }
  if (result.error) {
    return { kind: 'failed', message: `git show error: ${result.error.message}` };
  }
  if (result.status === 0) {
    writeFileSync(tempPath, result.stdout);
    return { kind: 'ok', tempPath };
  }
  // Non-zero status — the most common case is "file didn't exist at commit".
  // Write an empty tempfile so a new-file diff still opens against something.
  writeFileSync(tempPath, '');
  return { kind: 'ok', tempPath };
}

export type LaunchDiffInput = {
  cli: string;
  template: string;
  baseline: string;
  current: string;
};

/**
 * Spawn the configured diff CLI detached, with argv built from the template
 * via [`buildDiffArgv`](../../../core/src/diff/argv.ts). Detached so closing
 * the cockpit does not take the diff window with it.
 */
export function launchDiff(
  input: LaunchDiffInput,
): { kind: 'ok' } | { kind: 'failed'; message: string } {
  const argv = buildDiffArgv({
    template: input.template,
    baseline: input.baseline,
    current: input.current,
  });
  try {
    const child = spawn(input.cli, argv, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { kind: 'ok' };
  } catch (err) {
    return { kind: 'failed', message: `spawn failed: ${(err as Error).message}` };
  }
}
