/**
 * Safe detached spawn for external app/CLI launches from the cockpit.
 *
 * Two failure modes the bare `child_process.spawn(cli, argv, { detached })` got
 * wrong, both observed in v0.6:
 *
 *   1. **PATH stripping.** A Finder-launched `.app` on macOS inherits a minimal
 *      PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Homebrew-installed CLIs and
 *      `/usr/local/bin/ksdiff`-style symlinks aren't on it, so `spawn('ksdiff')`
 *      fails with ENOENT even though `which ksdiff` works in a terminal.
 *   2. **Async `'error'` swallowed.** `spawn` does not throw ENOENT
 *      synchronously — it emits an `'error'` event on the ChildProcess. Without
 *      a listener, Node re-throws it as Uncaught Exception, surfacing as an
 *      Electron crash dialog instead of a graceful failure.
 *
 * This helper prepends the common Homebrew bin directories to PATH and attaches
 * an `'error'` listener that logs the failure. The synchronous return reports
 * only the synchronous spawn outcome — an async ENOENT after PATH augmentation
 * still returns `ok` and is logged.
 */

import { spawn } from 'node:child_process';

/** Bin directories often missing from a Finder-launched .app's PATH. */
const EXTRA_PATH_DIRS = ['/usr/local/bin', '/opt/homebrew/bin'];

/** Process PATH with the common Homebrew bin dirs prepended — for spawning CLIs
 *  (`ksdiff`, `rg`, …) a Finder-launched `.app` would otherwise miss on PATH. */
export function augmentedPath(): string {
  const current = process.env.PATH ?? '';
  const segments = current.split(':').filter((s) => s.length > 0);
  const present = new Set(segments);
  const missing = EXTRA_PATH_DIRS.filter((p) => !present.has(p));
  return missing.length ? [...missing, ...segments].join(':') : current;
}

export type SpawnDetachedResult = { kind: 'ok' } | { kind: 'failed'; message: string };

export function spawnDetached(cli: string, argv: readonly string[]): SpawnDetachedResult {
  try {
    const child = spawn(cli, [...argv], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: augmentedPath() },
    });
    child.on('error', (err) => {
      console.error(`spawn '${cli}' failed: ${err.message}`);
    });
    child.unref();
    return { kind: 'ok' };
  } catch (err) {
    return { kind: 'failed', message: `spawn failed: ${(err as Error).message}` };
  }
}
