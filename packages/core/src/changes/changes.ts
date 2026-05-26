/**
 * Baseline-aware change reader. The cockpit's Changes panel asks "what is
 * different between the working tree and a baseline I picked?" — where the
 * baseline is `HEAD` (today's drift view, unchanged) or any commit SHA
 * (compare against a save-point or any past commit).
 *
 * - `HEAD` baseline → fast path, `git status --porcelain -z -uall`. Returns
 *   the porcelain entries unchanged; same coverage as today's drift list.
 * - Non-`HEAD` baseline → `git diff --name-status -z <baseline>` for tracked
 *   changes, ∪ `git ls-files --others --exclude-standard -z` for untracked.
 *   Untracked appears under any baseline because the working tree carries
 *   them whether or not the baseline knew about them.
 *
 * `readDiffText` and `readCommitList` round out the panel: the first powers
 * the inline diff preview, the second feeds the baseline dropdown.
 *
 * Spawn-only — every function is synchronous (`spawnSync`). The Changes
 * tracker debounces calls; see [tracker.ts](./tracker.ts).
 *
 * Phase B of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */

import { spawnSync } from 'node:child_process';
import { type ChangeEntry, parsePorcelainZ } from './porcelain.js';

/** Result of a single read — `ok` carries entries, `failed` carries why. */
export type ChangesResult =
  | { kind: 'ok'; entries: ChangeEntry[] }
  | { kind: 'failed'; message: string };

/** Result of a diff-text read — `ok` carries the unified-diff text. */
export type DiffTextResult =
  | { kind: 'ok'; text: string }
  | { kind: 'failed'; message: string };

/** Result of a commit-list read — `ok` carries the recent commits. */
export type CommitListResult =
  | { kind: 'ok'; commits: CommitListEntry[] }
  | { kind: 'failed'; message: string };

/** One recent-commit entry — SHA + subject line, newest first. */
export type CommitListEntry = {
  /** Full 40-char SHA. */
  sha: string;
  /** Commit subject (the first line of the message). */
  subject: string;
};

/**
 * Read the working tree's changes against `baseline`. When `baseline` is
 * `'HEAD'`, this is the porcelain status (includes untracked via `-uall`).
 * When `baseline` is any commit SHA, it's `git diff --name-status` ∪ the
 * untracked file list, giving a single coherent "what differs" view.
 */
export function readChanges(workingTreeRoot: string, baseline: string): ChangesResult {
  if (baseline === 'HEAD') {
    return readPorcelainStatus(workingTreeRoot);
  }
  return readDiffNameStatus(workingTreeRoot, baseline);
}

/**
 * Read the unified diff text for one path against `baseline`. Untracked and
 * deleted-at-baseline files get hand-shaped output (real `git diff` returns
 * empty for untracked, and a baseline-removed-against-working-tree diff for
 * deletes — the panel wants symmetric "new file" / "deleted file" framing).
 */
export function readDiffText(
  workingTreeRoot: string,
  baseline: string,
  relPath: string,
): DiffTextResult {
  const result = spawnSync(
    'git',
    ['-C', workingTreeRoot, 'diff', '--no-color', baseline, '--', relPath],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) {
    return { kind: 'failed', message: `git diff error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      kind: 'failed',
      message: `git diff exited ${result.status}: ${result.stderr.trim()}`,
    };
  }
  return { kind: 'ok', text: result.stdout };
}

/**
 * Read the most-recent commits on the repo's current branch, newest first.
 * Subjects come from `git log --format=%H%x09%s` (SHA tab subject), one
 * per line; the parser splits on TAB to handle subjects containing spaces.
 */
export function readCommitList(workingTreeRoot: string, limit: number): CommitListResult {
  const result = spawnSync(
    'git',
    ['-C', workingTreeRoot, 'log', `-n`, String(limit), '--format=%H%x09%s'],
    { encoding: 'utf8' },
  );
  if (result.error) {
    return { kind: 'failed', message: `git log error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      kind: 'failed',
      message: `git log exited ${result.status}: ${result.stderr.trim()}`,
    };
  }
  const commits: CommitListEntry[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    commits.push({ sha: line.slice(0, tab), subject: line.slice(tab + 1) });
  }
  return { kind: 'ok', commits };
}

/**
 * Read porcelain status — the `HEAD` baseline fast path. `-uall` expands
 * untracked directories to their individual files so the per-file drift
 * granularity matches the rest of the cockpit.
 */
function readPorcelainStatus(workingTreeRoot: string): ChangesResult {
  const result = spawnSync(
    'git',
    ['-C', workingTreeRoot, 'status', '--porcelain', '-z', '-uall'],
    { encoding: 'utf8' },
  );
  if (result.error) {
    return { kind: 'failed', message: `git status error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      kind: 'failed',
      message: `git status exited ${result.status}: ${result.stderr.trim()}`,
    };
  }
  return { kind: 'ok', entries: parsePorcelainZ(result.stdout) };
}

/**
 * Read tracked changes against `baseline` via `git diff --name-status` plus
 * untracked files via `git ls-files --others --exclude-standard`. The two
 * lists are concatenated (untracked is disjoint from diff output by
 * definition — untracked files are unknown to either baseline or HEAD).
 */
function readDiffNameStatus(workingTreeRoot: string, baseline: string): ChangesResult {
  const diff = spawnSync(
    'git',
    ['-C', workingTreeRoot, 'diff', '--name-status', '-z', baseline],
    { encoding: 'utf8' },
  );
  if (diff.error) {
    return { kind: 'failed', message: `git diff error: ${diff.error.message}` };
  }
  if (diff.status !== 0) {
    return {
      kind: 'failed',
      message: `git diff exited ${diff.status}: ${diff.stderr.trim()}`,
    };
  }

  const untracked = spawnSync(
    'git',
    ['-C', workingTreeRoot, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  if (untracked.error) {
    return { kind: 'failed', message: `git ls-files error: ${untracked.error.message}` };
  }
  if (untracked.status !== 0) {
    return {
      kind: 'failed',
      message: `git ls-files exited ${untracked.status}: ${untracked.stderr.trim()}`,
    };
  }

  const entries = [...parseNameStatusZ(diff.stdout), ...parseUntrackedZ(untracked.stdout)];
  return { kind: 'ok', entries };
}

/**
 * Parse `git diff --name-status -z` — NUL-separated alternating fields:
 *
 *   `<code>\0<path>\0`              (M/A/D)
 *   `R<score>\0<old>\0<new>\0`      (renames; code shape `R100`)
 *   `C<score>\0<old>\0<new>\0`      (copies; code shape `C75`)
 *
 * The score on R/C is dropped — the panel only cares about the operation
 * and the new path. Codes are normalised to the porcelain XY shape so the
 * downstream UI (glyphs, sort) treats both readers' output uniformly:
 * `M` → `M `, `A` → `A `, `D` → `D `, `R…` → `R `, `C…` → `C `.
 */
function parseNameStatusZ(text: string): ChangeEntry[] {
  if (text.length === 0) return [];
  const parts = text.split('\0');
  const out: ChangeEntry[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i];
    if (!raw) continue;
    const flag = raw[0];
    if (!flag) continue;
    if (flag === 'R' || flag === 'C') {
      const oldPath = parts[i + 1] ?? '';
      const newPath = parts[i + 2] ?? '';
      i += 2;
      if (!newPath) continue;
      out.push({ code: `${flag} `, path: newPath, oldPath });
    } else {
      const path = parts[i + 1] ?? '';
      i += 1;
      if (!path) continue;
      out.push({ code: `${flag} `, path });
    }
  }
  return out;
}

/**
 * Parse `git ls-files --others --exclude-standard -z` — NUL-separated
 * untracked paths. Each becomes a `??` ChangeEntry (porcelain's untracked
 * code) so the downstream UI treats them like the `HEAD`-baseline
 * untracked entries.
 */
function parseUntrackedZ(text: string): ChangeEntry[] {
  if (text.length === 0) return [];
  const out: ChangeEntry[] = [];
  for (const path of text.split('\0')) {
    if (!path) continue;
    out.push({ code: '??', path });
  }
  return out;
}
