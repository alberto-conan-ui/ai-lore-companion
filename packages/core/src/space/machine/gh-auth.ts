/**
 * Reading the text `gh auth status` prints. Its text changed between
 * releases, so the reading looks for the few phrases that stayed and answers
 * `unknown` for anything else. The phrases were checked on 2026-09-18 against
 * the output of gh 2.92.0 with three accounts on one host, and against the
 * source of that release (`pkg/cmd/auth/status/status.go`). `gh` has a
 * `--json` form of the command since 2.81.0; the machine check reads the text,
 * which also answers for a `gh` too old to be asked in JSON.
 */

/**
 * What the text of `gh auth status` says.
 * `signed-in`: the account gh uses is signed in. `scopes` is `null` when the
 * text does not list the token's scopes. `gh` lists them only for a token
 * that begins with `ghp_` (a classic personal token) or `gho_` (the token of
 * `gh auth login`); a fine-grained token (`github_pat_`) or an app's token
 * has no scopes to list, wherever it comes from.
 * `not-signed-in`: no account, or a token GitHub no longer accepts.
 * `unreachable`: `gh` could not reach GitHub to check the token.
 * `unknown`: none of the phrases was found.
 */
export type GhAuthReading =
  | { kind: 'signed-in'; account: string | null; scopes: string[] | null }
  | { kind: 'not-signed-in' }
  | { kind: 'unreachable' }
  | { kind: 'unknown' };

const LOGGED_IN = /Logged in to \S+ (?:account|as) (\S+)/;
const FAILED_LOGIN = /Failed to log in/;
const TIMED_OUT_LOGIN = /Timeout trying to log in/;
const ACTIVE_ACCOUNT = /Active account:\s*(true|false)/i;
const TOKEN_SCOPES = /Token scopes:(.*)$/m;
const UNREACHABLE =
  /dial tcp|no such host|timed? ?out|connection refused|network is unreachable|api call failed|error connecting/i;
const NOT_SIGNED_IN =
  /not logged in|gh auth login|Failed to log in|token[^\n]* is (?:invalid|no longer valid)|authentication failed/i;

/** The scopes of a `Token scopes:` line: `'gist', 'project'`, `gist, project`, or `none`. */
function parseScopes(list: string): string[] {
  return list
    .split(',')
    .map((scope) => scope.trim().replace(/^['"]|['"]$/g, ''))
    .filter((scope) => scope !== '' && scope.toLowerCase() !== 'none');
}

/**
 * Read the output of `gh auth status --hostname <host>`; pass standard output
 * and standard error joined, because `gh` moved the text from one to the other.
 * When several accounts are listed, the one marked active is read; when none
 * is marked, the first.
 */
export function parseGhAuthStatus(text: string): GhAuthReading {
  // One block per account: it starts at the line that names the account and
  // says how its sign-in went (gh 2.92: "Logged in to", "Failed to log in to",
  // "Timeout trying to log in to").
  const blocks: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (LOGGED_IN.test(line) || FAILED_LOGIN.test(line) || TIMED_OUT_LOGIN.test(line)) {
      blocks.push(line);
    } else if (blocks.length > 0) blocks[blocks.length - 1] += `\n${line}`;
  }
  // The account gh uses is the one marked active. Text without the mark (gh
  // before 2.40 knew one account per host) is read by its first block.
  const used =
    blocks.find((block) => ACTIVE_ACCOUNT.exec(block)?.[1]?.toLowerCase() === 'true') ??
    blocks.find((block) => ACTIVE_ACCOUNT.exec(block) === null);
  if (used !== undefined && LOGGED_IN.test(used)) {
    const scopes = TOKEN_SCOPES.exec(used);
    return {
      kind: 'signed-in',
      account: LOGGED_IN.exec(used)?.[1] ?? null,
      scopes: scopes === null ? null : parseScopes(scopes[1] ?? ''),
    };
  }
  if (used !== undefined && TIMED_OUT_LOGIN.test(used)) return { kind: 'unreachable' };
  if (used !== undefined && FAILED_LOGIN.test(used)) return { kind: 'not-signed-in' };
  if (UNREACHABLE.test(text)) return { kind: 'unreachable' };
  if (NOT_SIGNED_IN.test(text)) return { kind: 'not-signed-in' };
  return { kind: 'unknown' };
}
