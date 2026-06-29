/**
 * Branch-read primitive — the one git fact the SP/ACK soundness rebuild needs.
 *
 * `currentBranch(repo)` reads a repo's current branch; `isAncestor(sha, repo)`
 * answers whether a baseline commit is reachable on the current branch. Today's
 * baseline diff (`git diff <sha>`) needs no ancestry, so after a `git checkout`
 * the "changes since save-point" view silently becomes a valid-but-enormous
 * cross-branch diff. These two reads are what later lets the companion *detect*
 * that — a baseline off the current branch — instead of presenting it as work.
 *
 * Lives beside the other git readers in `changes/`; pure `spawnSync`, no state.
 * **Nothing consumes these yet** — they land here as shell git infra (P0); the
 * git-soundness rejoin (parked, AI-Lore core) wires them in later.
 */

import { spawnSync } from 'node:child_process';

/** A repo's current branch, or why the read failed. `detached` is true when
 *  HEAD is not on a branch (a detached checkout), where `branch` is the empty
 *  string — callers render that state rather than treating it as a name. */
export type BranchResult =
  | { kind: 'ok'; branch: string; detached: boolean }
  | { kind: 'failed'; message: string };

/** An ancestry check — `ok` carries the boolean answer. A failed git invocation
 *  (not a "no" answer) is `failed`; callers must not collapse failure to `false`
 *  the way the legacy baseline read swallowed errors to `[]`. */
export type AncestorResult =
  | { kind: 'ok'; isAncestor: boolean }
  | { kind: 'failed'; message: string };

const GIT_OPTS = { encoding: 'utf8' as const, maxBuffer: 1024 * 1024 };

/**
 * Read `repo`'s current branch via `git rev-parse --abbrev-ref HEAD`. On a
 * detached HEAD git prints `HEAD`; we surface that as `detached: true` with an
 * empty `branch` so the caller can show an explicit state instead of a fake
 * branch named "HEAD".
 */
export function currentBranch(repo: string): BranchResult {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], GIT_OPTS);
  if (r.error) return { kind: 'failed', message: `git rev-parse error: ${r.error.message}` };
  if (r.status !== 0) {
    return { kind: 'failed', message: `git rev-parse exited ${r.status}: ${r.stderr.trim()}` };
  }
  const out = r.stdout.trim();
  if (out === 'HEAD') return { kind: 'ok', branch: '', detached: true };
  return { kind: 'ok', branch: out, detached: false };
}

/**
 * Answer whether `sha` is an ancestor of the repo's current `HEAD` via
 * `git merge-base --is-ancestor <sha> HEAD`. git exits 0 for yes, 1 for no, and
 * any other code for a real error (e.g. an unknown SHA) — only 0/1 are answers,
 * everything else is `failed`.
 */
export function isAncestor(sha: string, repo: string): AncestorResult {
  const r = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, 'HEAD'], GIT_OPTS);
  if (r.error) return { kind: 'failed', message: `git merge-base error: ${r.error.message}` };
  if (r.status === 0) return { kind: 'ok', isAncestor: true };
  if (r.status === 1) return { kind: 'ok', isAncestor: false };
  return { kind: 'failed', message: `git merge-base exited ${r.status}: ${r.stderr.trim()}` };
}
