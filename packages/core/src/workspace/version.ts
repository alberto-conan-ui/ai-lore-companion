/**
 * `core_version` reader + comparator. The companion needs to know a
 * project's AI-Lore version before deciding how to render — pre-v0.5.1
 * projects are routed to the altered window with an upgrade hint rather
 * than rendered with surfaces (frontmatter chips, save-point badges)
 * they don't have.
 *
 * Only fields read here: `project_name` (for the lore path) and
 * `core_version`. `workspace.yaml` may grow more fields (e.g. v0.5.1's
 * `publish:` block); this reader does not parse them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE_VERSION_LINE = /^core_version\s*:\s*"?([0-9]+(?:\.[0-9]+)*)"?\s*$/m;

/**
 * Read `core_version` from a project's lore workspace.yaml. Returns the
 * version string (e.g. `"0.5.1"`) or `null` when the manifest is missing,
 * unreadable, or has no `core_version` line.
 */
export function readCoreVersion(lorePath: string): string | null {
  const manifestPath = join(lorePath, 'workspace.yaml');
  if (!existsSync(manifestPath)) return null;
  try {
    const text = readFileSync(manifestPath, 'utf8');
    const match = text.match(CORE_VERSION_LINE);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare two dot-separated numeric versions — negative when `a < b`,
 * `0` when equal, positive when `a > b`. Trailing missing components
 * compare as `0` (`"0.5"` ≡ `"0.5.0"`). Non-numeric segments are not
 * supported — this is for `core_version`, which is always numeric.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10));
  const pb = b.split('.').map((p) => Number.parseInt(p, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** `true` when `version` is `>= minimum`. Both as dot-separated numbers. */
export function versionMeetsMinimum(version: string, minimum: string): boolean {
  return compareVersions(version, minimum) >= 0;
}
