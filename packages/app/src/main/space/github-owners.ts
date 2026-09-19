/**
 * The GitHub account and organisations of the last machine check, remembered
 * for this run of the app (phase M9.4). The Space from GitHub form (M9.6)
 * reads them to fill the owner list without asking `gh` again; the machine
 * check (`main/space/ipc/machine.ts`) is the only writer, right after each
 * check.
 *
 * Kept in memory only, for the life of this run — the same choice as the
 * machine check's own last-report cache in `machine.ts`.
 */

/** What `checkMachine`'s `github` field carries. */
export type GitHubOwners = { account: string | null; organisations: string[] };

let known: GitHubOwners | null = null;

/** Remember the account and organisations of the latest machine check. */
export function rememberGitHubOwners(value: GitHubOwners): void {
  known = value;
}

/** The account and organisations of the latest machine check, or `null` when none has run yet. */
export function knownGitHubOwners(): GitHubOwners | null {
  return known;
}
