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

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildDiffArgv } from '@ai-lore-companion/core';
import { spawnDetached } from './spawn-detached.js';

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

export type ReadBaselineTextResult =
  | { kind: 'ok'; text: string }
  | { kind: 'failed'; message: string };

/**
 * Read the baseline content of a file as text — `git show <commit>:<path>`,
 * decoded UTF-8. Backs the in-app side-by-side diff (Read-only IDE P3), which
 * needs both sides' full text rather than a tempfile to hand an external tool.
 * A file absent at the commit (non-zero status) yields empty text, so a diff of
 * a newly-added file still renders (empty "before" vs the current contents).
 */
export function readBaselineText(input: MaterialiseBaselineInput): ReadBaselineTextResult {
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
  if (result.status !== 0) return { kind: 'ok', text: '' };
  return { kind: 'ok', text: result.stdout.toString('utf8') };
}

/**
 * Read a git blob's content as text — `git cat-file blob <sha>`. The file's
 * `--follow` history carries each version's blob (path-independent), so this
 * fetches a past version correctly **even across renames/moves**, where
 * `git show <commit>:<current-path>` would miss it.
 */
export function readBlobText(workingTreeRoot: string, blob: string): ReadBaselineTextResult {
  // The all-zero blob marks "absent" (e.g. the add side's source) — empty text.
  if (/^0+$/.test(blob)) return { kind: 'ok', text: '' };
  let result: SpawnSyncReturns<Buffer>;
  try {
    result = spawnSync('git', ['-C', workingTreeRoot, 'cat-file', 'blob', blob], {
      encoding: 'buffer',
    });
  } catch (err) {
    return { kind: 'failed', message: `git cat-file failed to start: ${(err as Error).message}` };
  }
  if (result.error)
    return { kind: 'failed', message: `git cat-file error: ${result.error.message}` };
  if (result.status !== 0) return { kind: 'ok', text: '' };
  return { kind: 'ok', text: result.stdout.toString('utf8') };
}

export type FileLogEntry = {
  sha: string;
  subject: string;
  timestamp: number;
  /** The file's git blob at this commit (its content here). Read by blob → rename-safe. */
  blob: string;
  /** The file's blob *before* this commit's change. All-zero ⇒ the file was added here. */
  prevBlob: string;
  /** Raw `--raw` status: `A`(dd) · `M`(odify) · `D`(elete) · `R…`/`C…` (rename/copy). */
  change: string;
  /** Rename/copy source path (git-rel), set only for `R…`/`C…`. */
  oldPath?: string;
  /** Rename/copy destination path (git-rel) at this commit, set only for `R…`/`C…`. */
  newPath?: string;
};
export type FileLogResult =
  | { kind: 'ok'; entries: FileLogEntry[] }
  | { kind: 'failed'; message: string };

/**
 * The commit history of one file — `git log --follow --raw`, newest first — for
 * the in-editor diff's per-file history column (Read-only IDE P3+). `--raw`
 * appends, after each commit's `<sha>\x1f<unix-seconds>\x1f<subject>` line, a
 * line `:<m1> <m2> <srcblob> <dstblob> <status>\t<path…>`; `<dstblob>` is the
 * file's blob **at that commit**, which we carry so a past version can be read
 * by blob (rename-safe). A path with no history is an empty list, not an error.
 */
export function fileLog(input: { workingTreeRoot: string; gitRelPath: string }): FileLogResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(
      'git',
      [
        '-C',
        input.workingTreeRoot,
        'log',
        '--follow',
        '--raw',
        '--no-abbrev',
        '--format=%x01%H%x1f%ct%x1f%s',
        '--',
        input.gitRelPath,
      ],
      { encoding: 'utf8' },
    );
  } catch (err) {
    return { kind: 'failed', message: `git log failed to start: ${(err as Error).message}` };
  }
  if (result.error) return { kind: 'failed', message: `git log error: ${result.error.message}` };
  if (result.status !== 0) return { kind: 'ok', entries: [] };
  // Records are split on the \x01 we prefixed each commit's format line with.
  const entries: FileLogEntry[] = [];
  for (const record of result.stdout.split('\x01')) {
    if (record.length === 0) continue;
    const lines = record.split('\n');
    const [sha, ts, subject] = (lines[0] ?? '').split('\x1f');
    if (!sha) continue;
    // The raw line for the followed file:
    //   `:<m1> <m2> <srcblob> <dstblob> <status>\t<path>[\t<newpath>]`
    // We carry the dst blob (its content here), the src blob (its content *before*
    // this commit — all-zero ⇒ added), the status (A/M/D/R…/C…), and, for a
    // rename/copy, the old & new paths — so a structural change (move/add/delete)
    // can be *described* rather than shown as a blank or duplicate twin pane.
    const raw = lines.find((l) => l.startsWith(':'));
    const segs = raw ? raw.slice(1).split('\t') : [];
    const meta = (segs[0] ?? '').split(/\s+/);
    const change = meta[4] ?? '';
    const renamed = change.startsWith('R') || change.startsWith('C');
    entries.push({
      sha,
      subject: subject ?? '',
      timestamp: Number(ts) * 1000,
      blob: meta[3] ?? '',
      prevBlob: meta[2] ?? '',
      change,
      ...(renamed && segs[1] ? { oldPath: segs[1], newPath: segs[2] } : {}),
    });
  }
  return { kind: 'ok', entries };
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
 * the cockpit does not take the diff window with it. PATH augmentation and
 * async-error handling live in [`spawnDetached`](./spawn-detached.ts).
 */
export function launchDiff(
  input: LaunchDiffInput,
): { kind: 'ok' } | { kind: 'failed'; message: string } {
  const argv = buildDiffArgv({
    template: input.template,
    baseline: input.baseline,
    current: input.current,
  });
  return spawnDetached(input.cli, argv);
}
