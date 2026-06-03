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
  /** Drop a session — later requests for it 404; tears down its server. */
  unregister: (sessionId: string) => Promise<void>;
  /** Stop the server and forget every session. */
  close: () => Promise<void>;
};

/** The report tools the host exposes. CR10 Phase 1 hosts the one tool the
 *  dashboard crawl needs to prove the channel end-to-end; Phase 2 tightens the
 *  schema (a real `FocusBoard`) and adds `report_humanized` /
 *  `report_consolidation` / `report_answer` beside it. Each tool routes its
 *  validated argument to the session's `onReport` as `{ tool, payload }`. */
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
  const server = new McpServer({ name: 'ai-lore-helper', version: '1.0.0' });
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
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return { server, transport };
}

type Registered = {
  token: string;
  onReport: (report: McpReport) => void;
};

/** Build an MCP host. Nothing binds until `listen` is called. */
export function createMcpHost(): McpHost {
  const sessions = new Map<string, Registered>();
  let server: Server | null = null;
  let listening: Promise<number> | null = null;
  let boundPort: number | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Path is `/mcp/<sessionId>`; the MCP client drives POST/GET/DELETE on it.
    const route = (req.url ?? '').split('?')[0] ?? '';
    const match = /^\/mcp\/([^/]+)$/.exec(route);
    if (!match?.[1]) return send(res, 404, { error: 'not found' });
    const sessionId = decodeURIComponent(match[1]);

    const registered = sessions.get(sessionId);
    if (!registered) return send(res, 404, { error: 'unknown session' });
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
      sessions.set(session.sessionId, { token: session.token, onReport: session.onReport });
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
