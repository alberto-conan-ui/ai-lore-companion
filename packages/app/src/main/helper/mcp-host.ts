/**
 * The MCP host — the app-level localhost HTTP **MCP server** the read-only
 * helper reports through (AI Helper, CR10). It is the structured successor to
 * the {@link ./middleman.ts middleman}: where the middleman received the
 * assistant's answer as *free text the app must scrape out of stdout*, the MCP
 * host receives it as a **schema-validated tool call** — the assistant calls a
 * `report_*` tool and its argument arrives as typed data straight into the app.
 * No stdout, no CLI envelope, no parsing; a bad shape is rejected by the
 * protocol and the model self-corrects in its own loop.
 *
 * Like the middleman it is **Channel B** (session → app) over
 * `127.0.0.1:<ephemeral>`, bearer-token authed, with `sessionId → window`
 * routing — but speaking MCP's Streamable HTTP, not the CR1 verbs. One HTTP
 * server hosts every session; each registered session gets its own
 * `McpServer` + transport so a tool call closes over *that* session's report
 * callback (and therefore its window). The transport runs **stateless** with
 * direct JSON responses: every headless turn (`claude -p` / `gemini -p`) is a
 * fresh MCP client that initializes, calls one tool, and exits — no SSE stream,
 * no cross-turn session state to leak.
 *
 * Read-only is preserved: the report tool writes to *the app*, never the
 * project. It is a separate, *allowed* capability layered beside the unchanged
 * deny-writes profile — project mutation and web egress stay denied. See the
 * [`helper-read-only` contract](../../../../.ai-lore-ai-lore-companion/memory/blueprint/contracts/helper-read-only.contract.md).
 *
 * Routing is by `sessionId` in the URL path (`/mcp/<sessionId>`); the
 * `Authorization: Bearer <token>` header must match the token registered for
 * that session. An unknown session, a bad token, or an unknown route is
 * refused. The server binds to `127.0.0.1` only.
 *
 * Like the middleman, this module is deliberately **electron-free and PTY-free**
 * so it can be exercised end-to-end in the headless tier: a test registers a
 * session, connects a real MCP client over HTTP, calls a report tool, and
 * asserts the routing + auth + the payload arriving on the right callback.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/** A structured report the read-only assistant pushed by **calling a tool** —
 *  the tool's name and its validated argument. The argument's shape is the
 *  tool's `inputSchema`; consumers narrow `payload` by `tool`. */
export type McpReport = { tool: string; payload: unknown };

/** One registered helper session — its token and the callback the host fires
 *  when the session calls a report tool. */
export type McpHostSession = {
  sessionId: string;
  token: string;
  /** A report tool was called with a schema-validated argument. */
  onReport: (report: McpReport) => void;
};

/** What a tool of a {@link McpHostToolSession} answers: the text the model
 *  reads, and whether it is an error. */
export type McpHostToolResult = { text: string; isError?: boolean };

/** One tool a {@link McpHostToolSession} brings. `shape` is the tool's
 *  `inputSchema`; `call` receives the validated arguments and a signal that
 *  aborts when the client goes away, so a call that waits can stop waiting. */
export type McpHostTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  call: (
    args: Record<string, unknown>,
    extra: { signal: AbortSignal },
  ) => McpHostToolResult | Promise<McpHostToolResult>;
};

/** A refusal a {@link McpHostToolSession} gives before the MCP layer sees the
 *  request. Sent as `{ error }` with the status. */
export type McpHostRefusal = { status: number; error: string };

/**
 * A session that brings **its own tools** in place of the helper's report
 * tools (the 1.0 session server, `main/space/session-server/`). It also brings
 * its own checks, so that the helper's sessions keep the behaviour they have:
 *
 * - `authorize` runs first and replaces the comparison with a stored token.
 *   The host keeps no token for such a session. A request it refuses is
 *   answered exactly as a request for a session that does not exist (404,
 *   `unknown session`), so that a caller without the session's token cannot
 *   learn which sessions exist.
 * - `admit` runs second and may refuse the request by its headers (`Host`,
 *   `Origin`). It receives the bound port.
 * - Only `POST` is served. The body is read here, refused over `maxBodyBytes`
 *   or when it has not arrived whole after `bodyTimeoutMs`, and handed to the
 *   transport parsed.
 */
export type McpHostToolSession = {
  sessionId: string;
  /** The MCP server name the client sees. */
  serverName: string;
  tools: readonly McpHostTool[];
  admit?: (req: IncomingMessage, port: number) => McpHostRefusal | null;
  authorize: (req: IncomingMessage) => boolean;
  maxBodyBytes: number;
  bodyTimeoutMs: number;
};

export type McpHost = {
  /** Start listening on an ephemeral `127.0.0.1` port; idempotent — repeated
   *  calls resolve to the same port. Returns the bound port. */
  listen: () => Promise<number>;
  /** The bound port, or null before `listen` has resolved. */
  port: () => number | null;
  /** The full MCP endpoint URL the engine's MCP client connects to for a
   *  session, or null before `listen` has resolved. */
  endpoint: (sessionId: string) => string | null;
  /** Register a session so its tool calls can route in. Builds the session's
   *  `McpServer` + transport; resolves once connected. */
  register: (session: McpHostSession) => Promise<void>;
  /** Register a session that brings its own tools and checks. It shares the
   *  path space of `register`; `unregister` drops it. */
  registerTools: (session: McpHostToolSession) => Promise<void>;
  /** Drop a session — later requests for it 404; tears down its server. */
  unregister: (sessionId: string) => Promise<void>;
  /** Stop the server and forget every session. */
  close: () => Promise<void>;
};

/** The report tools the host exposes. Each routes its validated argument to the
 *  session's `onReport` as `{ tool, payload }`. The **dashboard** stays a loose
 *  `z.unknown()` board (a typed `FocusBoard` schema would make a cheap model
 *  retry-loop formatting the big nested argument — Phase 2 still owes the shared
 *  schema; the renderer shape-guards meanwhile). The **curation** tools carry
 *  small payloads, so they are **typed** — MCP then validates/coerces the shape
 *  and the model self-corrects on a bad call, exactly the spike's recommendation
 *  (2026-06-03). `report_answer` (prose Q&A) still owes its move. */
const REPORT_TOOLS: ReadonlyArray<{
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** Pull the payload out of the validated args for this tool. */
  payload: (args: Record<string, unknown>) => unknown;
}> = [
  {
    name: 'report_dashboard',
    description:
      'Report the status dashboard (the focus board) for the project you read. ' +
      'Call this with the board instead of printing it — the app receives it directly.',
    shape: { board: z.unknown() },
    payload: (args) => args.board,
  },
  {
    name: 'report_humanized',
    description:
      'Report the plain-language rewrites of the items the user asked to humanize. ' +
      'Call this with the `rewrites` array — one rewrite per item, in the same order — instead of printing them.',
    shape: { rewrites: z.array(z.string()) },
    payload: (args) => args.rewrites,
  },
  {
    name: 'report_consolidation',
    description:
      'Report the single merged item for the rows the user selected to consolidate. ' +
      'Call this with `title` and `text` instead of printing them.',
    shape: { title: z.string(), text: z.string() },
    payload: (args) => ({ title: args.title, text: args.text }),
  },
];

/** Normalize a reported payload to structured data. Under a loose schema the
 *  engines disagree on the wire shape — **Gemini passes the argument as an
 *  object, Claude passes it as a JSON string** (verified against both CLIs,
 *  2026-06-03). Rather than impose a strict object schema (which makes a cheap
 *  model retry-loop trying to format a big nested argument), we accept either
 *  and parse a JSON string here so the renderer always receives an object. */
function normalizePayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // not JSON — hand it through as-is (e.g. a prose `report_answer`)
  }
}

/** Pull the bearer token out of an `Authorization: Bearer <token>` header. */
function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Build an `McpServer` with the report tools wired to this session's
 *  `onReport`, plus a **stateless** Streamable-HTTP transport that returns
 *  direct JSON (no SSE). Stateless is the right mode here: every headless turn
 *  (`claude -p` / `gemini -p`) is a fresh MCP client that initializes, calls one
 *  tool, and exits — there is no long-lived MCP session to maintain. The SDK's
 *  stateless contract is a fresh server+transport **per HTTP request**; the
 *  persistent thing is the session's `onReport`, which the tools close over. */
async function buildServer(
  session: Registered,
): Promise<{ server: McpServer; transport: StreamableHTTPServerTransport }> {
  const server = new McpServer({
    name: session.kind === 'tools' ? session.session.serverName : 'ai-lore-helper',
    version: '1.0.0',
  });
  if (session.kind === 'tools') {
    for (const tool of session.session.tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.shape },
        async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => {
          const result = await tool.call(args, { signal: extra.signal });
          return {
            content: [{ type: 'text' as const, text: result.text }],
            ...(result.isError ? { isError: true } : {}),
          };
        },
      );
    }
  } else {
    for (const tool of REPORT_TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.shape },
        async (args: Record<string, unknown>) => {
          session.onReport({ tool: tool.name, payload: normalizePayload(tool.payload(args)) });
          return { content: [{ type: 'text' as const, text: 'received' }] };
        },
      );
    }
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return { server, transport };
}

type Registered =
  | { kind: 'report'; token: string; onReport: (report: McpReport) => void }
  | { kind: 'tools'; session: McpHostToolSession };

type BodyOutcome = 'complete' | 'too-large' | 'too-slow' | 'broken';

/** Read a request body as JSON, stopping at `maxBytes` and after `timeoutMs`. A
 *  body over the cap is refused with 413 whether or not the request declared its
 *  length; a body that has not arrived whole in time is refused with 408. */
async function readCappedJson(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ ok: true; value: unknown } | { ok: false; refusal: McpHostRefusal }> {
  const tooLarge = { ok: false as const, refusal: { status: 413, error: 'body too large' } };
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge;
  // Listeners, not `for await`: leaving such a loop early destroys the socket the refusal is sent on.
  const chunks: Buffer[] = [];
  const outcome = await new Promise<BodyOutcome>((resolve) => {
    let size = 0;
    const stop = (result: BodyOutcome): void => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBytes) {
        req.pause();
        stop('too-large');
      } else chunks.push(chunk);
    };
    const onEnd = (): void => stop('complete');
    const onError = (): void => stop('broken');
    const timer = setTimeout(() => {
      req.pause();
      stop('too-slow');
    }, timeoutMs);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
  if (outcome === 'too-large') return tooLarge;
  if (outcome === 'too-slow')
    return { ok: false, refusal: { status: 408, error: 'body too slow' } };
  if (outcome === 'broken') return { ok: false, refusal: { status: 400, error: 'broken request' } };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, refusal: { status: 400, error: 'invalid json' } };
  }
}

/** Refuse a body. What the client still sends is discarded first, for a short time and up to a
 *  bound, so that the client reads the answer instead of a broken connection; nothing of it is
 *  kept. The connection ends with the answer. */
function refuseBody(req: IncomingMessage, res: ServerResponse, refusal: McpHostRefusal): void {
  let answered = false;
  const answer = (): void => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    req.off('data', onData);
    res.writeHead(refusal.status, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ error: refusal.error }), () => {
      if (!req.complete) req.destroy();
    });
  };
  let discarded = 0;
  const onData = (chunk: Buffer): void => {
    discarded += chunk.length;
    if (discarded > 8 * 1_048_576) answer();
  };
  const timer = setTimeout(answer, 1_000);
  req.on('data', onData);
  req.on('end', answer);
  req.on('error', answer);
  req.resume();
}

/** Build an MCP host. Nothing binds until `listen` is called. */
export function createMcpHost(): McpHost {
  const sessions = new Map<string, Registered>();
  let server: Server | null = null;
  let listening: Promise<number> | null = null;
  let boundPort: number | null = null;

  /** A request for a session that brings its own tools: its own checks, in the
   *  order token, headers, method, body; then the same stateless MCP handling. */
  async function handleTools(
    session: McpHostToolSession,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // The same answer as for a session that does not exist: see `McpHostToolSession`.
    if (!session.authorize(req)) return send(res, 404, { error: 'unknown session' });
    const refused = session.admit?.(req, boundPort ?? 0) ?? null;
    if (refused) return send(res, refused.status, { error: refused.error });
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const body = await readCappedJson(req, session.maxBodyBytes, session.bodyTimeoutMs);
    if (!body.ok) return refuseBody(req, res, body.refusal);
    const { server: mcp, transport } = await buildServer({ kind: 'tools', session });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await transport.handleRequest(req, res, body.value);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Path is `/mcp/<sessionId>`; the MCP client drives POST/GET/DELETE on it.
    const route = (req.url ?? '').split('?')[0] ?? '';
    const match = /^\/mcp\/([^/]+)$/.exec(route);
    if (!match?.[1]) return send(res, 404, { error: 'not found' });
    const sessionId = decodeURIComponent(match[1]);

    const registered = sessions.get(sessionId);
    if (!registered) return send(res, 404, { error: 'unknown session' });
    if (registered.kind === 'tools') return handleTools(registered.session, req, res);
    // Constant set membership is fine — the token is a random UUID and the
    // surface is localhost-only; the check rejects a stray local process, not a
    // timing attacker. (Mirrors the middleman.)
    if (bearer(req) !== registered.token) return send(res, 401, { error: 'unauthorized' });

    // Stateless: a fresh server+transport per request, torn down once the
    // response closes. It reads the body, runs the JSON-RPC, dispatches any tool
    // call to this session's `onReport`, and writes the reply.
    const { server, transport } = await buildServer(registered);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req, res);
  }

  return {
    listen() {
      if (listening) return listening;
      listening = new Promise<number>((resolve, reject) => {
        const s = createServer((req, res) => {
          void handle(req, res).catch(() => {
            if (!res.headersSent) send(res, 500, { error: 'internal' });
          });
        });
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
          const addr = s.address();
          if (addr && typeof addr === 'object') {
            boundPort = addr.port;
            server = s;
            resolve(addr.port);
          } else {
            reject(new Error('no port bound'));
          }
        });
      });
      return listening;
    },
    port: () => boundPort,
    endpoint: (sessionId) =>
      boundPort === null
        ? null
        : `http://127.0.0.1:${boundPort}/mcp/${encodeURIComponent(sessionId)}`,
    // `register`/`unregister` are sync at heart — no transport is built until a
    // request arrives — but stay Promise-returning so the interface is stable if
    // a future phase needs async setup (e.g. lifting a shared schema).
    register: async (session) => {
      sessions.set(session.sessionId, {
        kind: 'report',
        token: session.token,
        onReport: session.onReport,
      });
    },
    registerTools: async (session) => {
      // One id is one session: a second registration would take the path of the first.
      if (sessions.has(session.sessionId)) {
        throw new Error('a session with this id is registered already');
      }
      sessions.set(session.sessionId, { kind: 'tools', session });
    },
    unregister: async (sessionId) => {
      sessions.delete(sessionId);
    },
    close: () =>
      new Promise<void>((resolve) => {
        sessions.clear();
        const s = server;
        server = null;
        listening = null;
        boundPort = null;
        if (!s) return resolve();
        s.close(() => resolve());
      }),
  };
}
