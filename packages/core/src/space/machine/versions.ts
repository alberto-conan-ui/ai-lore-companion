/**
 * Version numbers of the machine check: reading one out of a command's
 * `--version` output, comparing two, and the lowest each requirement accepts.
 */

/** A version as three numbers. A part the text does not give is `0`. */
export type ToolVersion = { major: number; minor: number; patch: number };

/**
 * The lowest `git` the companion accepts. The sources give none. This is the
 * choice of the session that built phase M3.2: `GitPort.init` passes
 * `--initial-branch`, which git has since 2.28.0 (git's release notes for
 * 2.28: "`git init --initial-branch=<name>`"), and that is the newest option
 * the 1.0 code relies on (`--no-optional-locks` is from 2.15.0). Checked again
 * on 2026-09-18 against every option `exec/git-port.ts` and the fixtures pass.
 */
export const MIN_GIT_VERSION: ToolVersion = { major: 2, minor: 28, patch: 0 };

/**
 * The lowest `gh` the companion accepts: the first release that has everything
 * the gh adapter (`github/gh-cli.ts`) asks of it. Checked on 2026-09-18
 * against the repository `cli/cli`:
 *
 * - `gh auth status --json hosts`, which the adapter's `auth` runs, is in gh
 *   since 2.81.0 (pull request 11544; the release notes of v2.81.0, published
 *   2025-10-01, have the heading "`gh auth status` Supports JSON Output").
 *   This is the newest, so it sets the number.
 * - `gh auth status --active` is in gh since 2.57.0 (pull request 9520).
 * - `gh issue develop --branch-repo`, together with `--repo` for the issue's
 *   repository, which `developBranch` runs, is in gh since 2.32.0 (pull request
 *   7656, in the release notes of v2.32.0, published 2023-07-11). The source
 *   of v2.31.0 (`pkg/cmd/issue/develop/develop.go`) has `--issue-repo` and no
 *   `--branch-repo`; the pull request also repairs the command outside a
 *   local repository, which is how the companion runs it.
 */
export const MIN_GH_VERSION: ToolVersion = { major: 2, minor: 81, patch: 0 };

/**
 * The lowest `python3` the companion accepts: the check scripts and the
 * skeleton generators of the Lore template are written for Python 3.8.
 */
export const MIN_PYTHON_VERSION: ToolVersion = { major: 3, minor: 8, patch: 0 };

/** The longest a version part may be, so that a long run of digits is not read as a number. */
const MAX_PART_DIGITS = 6;

/**
 * The first version number in `text`, or `null` when it holds none. A version
 * is two or three runs of digits joined by dots; what follows them is ignored.
 * Reads `git version 2.39.3 (Apple Git-146)`, `git version 2.41.0.windows.1`,
 * `gh version 2.92.0 (2026-04-28)`, `Python 3.13.0rc1` and `2.1.276 (Claude Code)`.
 */
export function parseToolVersion(text: string): ToolVersion | null {
  const part = `\\d{1,${MAX_PART_DIGITS}}`;
  const match = new RegExp(`(?<![\\d.])(${part})\\.(${part})(?:\\.(${part}))?`).exec(text);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/** Negative when `a` is older than `b`, zero when they are equal, positive when `a` is newer. */
export function compareToolVersions(a: ToolVersion, b: ToolVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** The version as text, `2.39.3`. */
export function formatToolVersion(version: ToolVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
