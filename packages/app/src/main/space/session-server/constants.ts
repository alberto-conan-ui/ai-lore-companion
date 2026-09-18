/**
 * The values of the session server that an observation of the real engine may
 * change (phase M4.1), and its limits. Each is read from here and from nowhere
 * else, so a finding is a change to one line of this file.
 */

/** The MCP server name. Claude Code names a tool `mcp__<server>__<tool>`, and the Lore's cards write `mcp__ailore__`. */
export const SESSION_SERVER_NAME = 'ailore';

/**
 * The host names a request may carry in its `Host` header, each followed by
 * `:<port>` of the bound port. The address handed to a session is
 * `http://127.0.0.1:<port>/…`, so its client sends `127.0.0.1:<port>`. A name
 * such as `localhost` is not listed: a page that reaches the server through a
 * name it controls (DNS rebinding) carries that name here. Observed in phase
 * M4.1: every request of Claude Code's client carries `127.0.0.1:<port>`, the
 * configured `Authorization` header, and no `Origin` header.
 */
export const HOST_ALLOW_LIST: readonly string[] = ['127.0.0.1'];

/** The request header that carries the session's token, in lower case. */
export const TOKEN_HEADER = 'authorization';

/** The scheme before the token in `TOKEN_HEADER`. Empty when the header holds the token alone. */
export const TOKEN_SCHEME: string = 'Bearer';

/**
 * How long one `await_answer` call waits before it answers pending. Observed in
 * phase M4.1 (`packages/docs/m4-1-claude-code-findings.md`, section 6): Claude
 * Code's MCP client abandons an HTTP tool call that has sent no byte after 60
 * seconds, unless `MCP_TOOL_TIMEOUT` is set in the session's settings (then 300
 * seconds is the limit). The server answers with one JSON response, so nothing
 * is sent before the answer. The wait is therefore under 60 seconds whatever
 * the session's settings are, and the session calls again while it reads pending.
 */
export const AWAIT_ANSWER_WAIT_MS = 45_000;

/** The largest request body the server reads: 1 MB, as `helper/middleman.ts`. */
export const MAX_BODY_BYTES = 1_048_576;

/** How long the server waits for the whole body of a request. A body that comes slower is refused with 408. */
export const BODY_READ_TIMEOUT_MS = 10_000;

/** The bytes of a session token and of the launch secret. */
export const TOKEN_BYTES = 32;

/** A ticket nobody answered is cancelled after this long. */
export const PENDING_TICKET_TTL_MS = 8 * 60 * 60 * 1000;

/** An answered ticket can be read again for this long, then it is forgotten. */
export const ANSWERED_TICKET_TTL_MS = 10 * 60 * 1000;

/** The tickets one session may have unanswered at a time. */
export const MAX_PENDING_TICKETS_PER_SESSION = 4;

/** The tickets kept for one session, answered ones included. */
export const MAX_TICKETS_PER_SESSION = 32;

/** The `await_answer` calls of one session that may wait at the same time; a further one answers pending at once. */
export const MAX_WAITERS_PER_SESSION = 4;

/** The window of the two rate limits. */
export const RATE_WINDOW_MS = 60_000;

/** Tool calls of any kind one session may make per window. */
export const MAX_CALLS_PER_WINDOW = 60;

/** Requests for a dialog (`request_writing`, `request_gate`) one session may make per window. */
export const MAX_DIALOG_REQUESTS_PER_WINDOW = 6;

/** The longest `reason`, `question` and `bearsOn` a request may carry, in characters. */
export const MAX_TEXT_LENGTH = 4_000;

/** The most targets one `request_writing` may name. */
export const MAX_TARGETS_PER_REQUEST = 32;

/** How long closing waits for the answers of open `await_answer` calls to leave. */
export const CLOSE_FLUSH_MS = 500;
