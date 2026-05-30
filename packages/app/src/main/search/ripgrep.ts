/**
 * Resolve the `rg` binary the search spawns. Prefers the **bundled** ripgrep
 * from `@vscode/ripgrep` (so content search + the include-ignored name scan
 * work with no user install), and falls back to `'rg'` on PATH when the package
 * isn't present — keeping the old PATH-detect behaviour as a safety net.
 *
 * The require is dynamic + guarded so the app builds and runs whether or not
 * `@vscode/ripgrep` is installed yet; `rgPath` from that package already
 * rewrites an `app.asar` path to `app.asar.unpacked`, so it is valid in a
 * packaged build too. Resolved once and cached.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

let cached: string | null | undefined;

/** Absolute path to a bundled `rg`, or `'rg'` to fall back to PATH. */
export function ripgrepPath(): string {
  if (cached === undefined) {
    cached = resolveBundled();
  }
  return cached ?? 'rg';
}

function resolveBundled(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    return typeof rgPath === 'string' && existsSync(rgPath) ? rgPath : null;
  } catch {
    return null;
  }
}
