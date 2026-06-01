/**
 * The middleman — the app-level localhost HTTP ingress the read-only helper's
 * hooks POST to (AI Helper, CR1). It is the **Channel B** of the communication
 * protocol: session → app, over `127.0.0.1:<ephemeral>`, bearer-token authed.
 *
 * Two verbs in CR1 (the seam grows per CR):
 *   - `POST /session/started  { sessionId }`            ← SessionStart hook
 *   - `POST /session/result   { sessionId, answer }`    ← Stop hook
 *
 * Routing is by `sessionId` in the body; the `Authorization: Bearer <token>`
 * header must match the token registered for that session. Anything else — an
 * unknown session, a bad token, a malformed body, an unknown route — is
 * refused. The server binds to `127.0.0.1` only.
 *
 * This module is deliberately **electron-free and PTY-free** so it can be
 * exercised end-to-end in the headless tier: a test registers a session with
 * callbacks, POSTs to the real server, and asserts the routing + auth.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

/** One registered helper session — its token and the callbacks the ingress
 *  fires when its hooks report in. */
export type MiddlemanSession = {
  sessionId: string;
  token: string;
  /** The SessionStart hook reported the session is up. */
  onStarted: () => void;
  /** The Stop hook returned the assistant's answer for the in-flight turn. */
  onResult: (answer: string) => void;
};

export type Middleman = {
  /** Start listening on an ephemeral `127.0.0.1` port; idempotent — repeated
   *  calls resolve to the same port. Returns the bound port. */
  listen: () => Promise<number>;
  /** The bound port, or null before `listen` has resolved. */
  port: () => number | null;
  /** Register a session so its hooks can route in. */
  register: (session: MiddlemanSession) => void;
  /** Drop a session — later POSTs for it 404. */
  unregister: (sessionId: string) => void;
  /** Stop the server and forget every session. */
  close: () => Promise<void>;
};

/** Read a request body to a string, capped so a runaway POST can't grow
 *  unbounded. The hook payloads are tiny (an answer is a few KB at most). */
function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Pull the bearer token out of an `Authorization: Bearer <token>` header. */
function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

/** Build a middleman. Nothing binds until `listen` is called. */
export function createMiddleman(): Middleman {
  const sessions = new Map<string, MiddlemanSession>();
  let server: Server | null = null;
  let listening: Promise<number> | null = null;
  let boundPort: number | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const route = (req.url ?? '').split('?')[0];
    if (route !== '/session/started' && route !== '/session/result') {
      return send(res, 404, { error: 'not found' });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'bad body' });
    }
    const { sessionId, answer } = (body ?? {}) as { sessionId?: string; answer?: string };
    if (typeof sessionId !== 'string') return send(res, 400, { error: 'missing sessionId' });

    const session = sessions.get(sessionId);
    if (!session) return send(res, 404, { error: 'unknown session' });
    // Constant set membership is fine here — the token is a random UUID and the
    // surface is localhost-only; the check exists to reject a stray process on
    // the box, not to resist a timing attacker.
    if (bearer(req) !== session.token) return send(res, 401, { error: 'unauthorized' });

    if (route === '/session/started') {
      session.onStarted();
    } else {
      session.onResult(typeof answer === 'string' ? answer : '');
    }
    return send(res, 200, { ok: true });
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
    register: (session) => {
      sessions.set(session.sessionId, session);
    },
    unregister: (sessionId) => {
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
