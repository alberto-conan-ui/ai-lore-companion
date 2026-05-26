/**
 * `git status --porcelain -z` runner. Spawn-only; the porcelain parser
 * lives in [porcelain.ts](./porcelain.ts) and is pure.
 *
 * The reader is synchronous (`spawnSync`) — `git status` is fast on small
 * repos and we want a single-shot snapshot, not a streamed feed. The host
 * calls this debounced from watcher events; see
 * [tracker.ts](./tracker.ts).
 */

import { spawnSync } from 'node:child_process';
import { type PorcelainEntry, parsePorcelainZ } from './porcelain.js';

export type GitStatusResult =
  | { kind: 'ok'; entries: PorcelainEntry[] }
  | { kind: 'failed'; message: string };

/**
 * Read porcelain status for a working tree. The `-z` flag gives us
 * NUL-separated output that is unambiguous against paths containing newlines
 * or spaces. A non-existent or non-repo path returns `{kind: 'failed'}`; the
 * caller treats that as "no drift to show" (the tracker keeps an empty
 * snapshot rather than crashing).
 */
export function readGitStatus(workingTreeRoot: string): GitStatusResult {
  // `-uall` expands untracked directories to their individual files. Without
  // it, git collapses an untracked dir into a single entry (e.g. `sub/`) and
  // we lose per-file drift granularity for new folders.
  const result = spawnSync('git', ['-C', workingTreeRoot, 'status', '--porcelain', '-z', '-uall'], {
    encoding: 'utf8',
  });
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
