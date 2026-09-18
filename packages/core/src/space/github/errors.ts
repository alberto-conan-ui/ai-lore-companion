/**
 * Why a GitHub operation failed, and how a failed `gh` run is sorted into
 * those kinds.
 *
 * Every error carries a `message` that can be shown as it is. Screens branch
 * on `kind`: not signed in and missing scope lead to the machine check,
 * unreachable is shown as offline, rate-limited shows when to try again.
 */

import type { RunResult } from '../exec/runner.js';
import { PROJECT_SCOPE } from './types.js';

/** The failure of a `GitHubPort` operation. */
export type GitHubError =
  /** GitHub could not be reached: no network, a timeout, or a gateway error. */
  | { kind: 'unreachable'; message: string }
  /** `gh` has no signed-in account, or its token is no longer accepted. */
  | { kind: 'not-signed-in'; message: string }
  /** The token lacks a scope. `scope` is the name `gh auth refresh -s` takes. */
  | { kind: 'missing-scope'; scope: string; message: string }
  /** What the operation names (a repository, a Project, an issue, a label) does not exist. */
  | { kind: 'not-found'; message: string }
  /** The primary limit, a secondary limit, or content created too quickly. */
  | { kind: 'rate-limited'; retryAfterSeconds: number | null; message: string }
  /** Anything else, with what `gh` or GitHub said. */
  | { kind: 'failed'; message: string };

/** The kinds of `GitHubError`. */
export type GitHubErrorKind = GitHubError['kind'];

/**
 * One entry of the `errors` array of a GraphQL answer. `type` is what GitHub
 * gives for an error met while answering (`NOT_FOUND`, `INSUFFICIENT_SCOPES`);
 * `code` is `extensions.code`, which GitHub gives instead when the document
 * does not fit the schema (`undefinedField`).
 */
export type GraphQlError = {
  type: string | null;
  code: string | null;
  message: string;
  path: string[];
};

/**
 * The `code` values that say the host's schema lacks what the document names:
 * a field, an argument, or a type. Recorded from github.com on 2026-09-18 by a
 * query that names a field and an input type that do not exist. A GitHub
 * Enterprise Server older than a mutation answers this way.
 */
const SCHEMA_ABSENCE_CODES: ReadonlySet<string> = new Set([
  'undefinedField',
  'undefinedType',
  'variableRequiresValidType',
  'argumentNotAccepted',
  // Follows from the others: a variable whose type is unknown counts as not used.
  'variableNotUsed',
]);

/** Whether every error says the schema lacks something the document names. `false` for no errors. */
export function isSchemaAbsence(errors: readonly GraphQlError[]): boolean {
  return (
    errors.length > 0 &&
    errors.every((error) => error.code !== null && SCHEMA_ABSENCE_CODES.has(error.code)) &&
    errors.some((error) => error.code !== 'variableNotUsed')
  );
}

/** An answer of `gh api -i`: the status line, the headers (names in lower case) and the body. */
export type GhApiResponse = {
  /** The HTTP status, or `null` when the output has no status line. */
  status: number | null;
  headers: Record<string, string>;
  body: string;
};

/** The `unreachable` error. */
export function unreachable(detail: string): GitHubError {
  return { kind: 'unreachable', message: `GitHub could not be reached: ${detail}` };
}

/** The `not-signed-in` error. */
export function notSignedIn(): GitHubError {
  return {
    kind: 'not-signed-in',
    message: 'gh is not signed in to github.com. Run: gh auth login',
  };
}

/** The `missing-scope` error. */
export function missingScope(scope: string): GitHubError {
  return {
    kind: 'missing-scope',
    scope,
    message: `The gh token lacks the ${scope} scope. Run: gh auth refresh -s ${scope}`,
  };
}

/** The `not-found` error. `what` names the thing, as in `the repository owner/name`. */
export function notFound(what: string): GitHubError {
  return { kind: 'not-found', message: `GitHub has no such thing: ${what}` };
}

/** The `rate-limited` error. */
export function rateLimited(retryAfterSeconds: number | null): GitHubError {
  const when =
    retryAfterSeconds === null
      ? 'Try again in a few minutes.'
      : `Try again in ${retryAfterSeconds} seconds.`;
  return {
    kind: 'rate-limited',
    retryAfterSeconds,
    message: `GitHub limited the rate of requests. ${when}`,
  };
}

/** The `failed` error. */
export function failed(message: string): GitHubError {
  return { kind: 'failed', message };
}

/**
 * Split the output of `gh api -i` into status, headers and body. Output that
 * does not begin with a status line is all body.
 */
export function parseGhApiResponse(stdout: string): GhApiResponse {
  const statusLine = /^HTTP\/[\d.]+ (\d{3})[^\n]*\r?\n/.exec(stdout);
  if (statusLine === null) return { status: null, headers: {}, body: stdout };
  const rest = stdout.slice(statusLine[0].length);
  const blank = /\r?\n\r?\n/.exec(rest);
  const headerText = blank === null ? rest : rest.slice(0, blank.index);
  const body = blank === null ? '' : rest.slice(blank.index + blank[0].length);
  const headers: Record<string, string> = {};
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(statusLine[1]), headers, body };
}

function extensionsCode(extensions: unknown): string | null {
  if (typeof extensions !== 'object' || extensions === null) return null;
  const code = (extensions as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** The `errors` of a GraphQL answer's body; empty when the body has none or is not JSON. */
export function graphQlErrors(body: string): GraphQlError[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .map((entry) => ({
      type: typeof entry.type === 'string' ? entry.type : null,
      code: extensionsCode(entry.extensions),
      message: typeof entry.message === 'string' ? entry.message : '',
      path: Array.isArray(entry.path) ? entry.path.map((part) => String(part)) : [],
    }));
}

/**
 * The seconds to wait, from the headers of a limited answer: `Retry-After`
 * when GitHub gives it, otherwise the time from the answer's own `Date` to
 * `X-RateLimit-Reset` when no request is left. `null` when the headers say nothing.
 */
export function retryAfterSeconds(headers: Record<string, string>): number | null {
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.ceil(retryAfter);
  }
  const reset = Number(headers['x-ratelimit-reset']);
  const date = Date.parse(headers.date ?? '');
  if (headers['x-ratelimit-remaining'] !== '0' || !Number.isFinite(reset) || Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, Math.ceil(reset - date / 1000));
}

const NOT_SIGNED_IN =
  /gh auth login|not logged in|authentication required|bad credentials|http 401|requires authentication/i;
const MISSING_SCOPE = /required scopes|missing required scope|gh auth refresh|insufficient_scopes/i;
const RATE_LIMITED =
  /rate limit|submitted too quickly|abuse detection|too many requests|http 429|wait a few minutes/i;
const NOT_FOUND = /could not resolve to|http 404|not found/i;
const UNREACHABLE =
  /dial tcp|no such host|connection refused|connection reset|network is unreachable|i\/o timeout|timeout awaiting|context deadline exceeded|tls handshake|proxyconnect|error connecting to|temporary failure in name resolution|unexpected eof|http 50[234]/i;

/** The scope a message asks for, as `gh auth refresh -s` takes it (`read:project` is given by `project`). */
function scopeNamedIn(text: string): string {
  const list = /following scopes: \[([^\]]*)\]/.exec(text);
  const first = list === null ? null : /'([^']+)'/.exec(list[1] ?? '');
  const option = /gh auth refresh (?:-h \S+ )?-s ([\w:]+)/.exec(text);
  const named = first?.[1] ?? option?.[1] ?? PROJECT_SCOPE;
  return named.replace(/^(read|write):/, '');
}

/**
 * Sort a `gh` run that did not succeed into a `GitHubError`. `response` is the
 * parsed output of `gh api -i` when the command was one; the GraphQL error
 * types and the HTTP status decide first, the text `gh` printed decides after.
 */
export function classifyGhFailure(result: RunResult, response?: GhApiResponse): GitHubError {
  const text = `${result.stderr}\n${response === undefined ? result.stdout : ''}`.trim();
  if (result.failure === 'timeout') return unreachable('gh did not finish in time');
  if (result.failure === 'not-found') return failed('gh was not found on this machine');
  if (result.failure !== undefined) return failed(`gh did not run: ${text}`);

  const errors = response === undefined ? [] : graphQlErrors(response.body);
  const types = new Set(errors.map((error) => error.type));
  const graphQlText = errors.map((error) => error.message).join(' ');
  // An answer that is not GraphQL's (HTTP 401, 403) says why in the `message` of its body.
  const all = `${text}\n${graphQlText}\n${response === undefined ? '' : bodyMessage(response.body)}`;
  const status = response?.status ?? null;
  const headers = response?.headers ?? {};

  if (types.has('INSUFFICIENT_SCOPES')) return missingScope(scopeNamedIn(all));
  if (types.has('RATE_LIMITED') || status === 429) return rateLimited(retryAfterSeconds(headers));
  if (status === 403 && (RATE_LIMITED.test(all) || headers['retry-after'] !== undefined)) {
    return rateLimited(retryAfterSeconds(headers));
  }
  if (status === 401) return notSignedIn();
  if (status === 502 || status === 503 || status === 504) return unreachable(`HTTP ${status}`);
  if (types.has('NOT_FOUND') || status === 404) return notFound(graphQlText || text);

  if (MISSING_SCOPE.test(all)) return missingScope(scopeNamedIn(all));
  if (NOT_SIGNED_IN.test(all)) return notSignedIn();
  if (RATE_LIMITED.test(all)) return rateLimited(retryAfterSeconds(headers));
  if (UNREACHABLE.test(all)) return unreachable(firstLine(text));
  if (NOT_FOUND.test(all)) return notFound(firstLine(graphQlText || text));
  return failed(firstLine(graphQlText || text) || `gh exited ${result.code}`);
}

/** The `message` of a body that is a JSON object with one, otherwise nothing. */
function bodyMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const message =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { message?: unknown }).message
        : undefined;
    return typeof message === 'string' ? message : '';
  } catch {
    return '';
  }
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  ).replace(/^gh: /, '');
}
