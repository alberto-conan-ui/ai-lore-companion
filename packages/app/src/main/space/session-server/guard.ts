/**
 * The checks of the session server on a request, before MCP sees it
 * (section 5.14 of the architecture document), and the token scheme.
 *
 * Per launch: a secret of 32 random bytes, made when this module loads and kept
 * in memory only. Per session: a token of 32 random bytes, made when the
 * session is registered and given to the caller once. The server keeps the
 * HMAC-SHA-256 of the token under the launch secret, not the token, and
 * compares digests with `timingSafeEqual`: the two sides have one length
 * whatever was presented, and a token of an earlier launch matches nothing.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { McpHostRefusal } from '../../helper/mcp-host.js';
import { HOST_ALLOW_LIST, TOKEN_BYTES, TOKEN_HEADER, TOKEN_SCHEME } from './constants.js';

const LAUNCH_SECRET = randomBytes(TOKEN_BYTES);

function digest(token: string): Buffer {
  return createHmac('sha256', LAUNCH_SECRET).update(token, 'utf8').digest();
}

/** A new session token, and what the server keeps of it. */
export function issueSessionToken(): { token: string; kept: Buffer } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, kept: digest(token) };
}

/** The token a request presents in `TOKEN_HEADER`, or `null`. */
export function presentedToken(req: IncomingMessage): string | null {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header !== 'string' || header.length === 0 || header.length > 512) return null;
  if (TOKEN_SCHEME === '') return header;
  const prefix = `${TOKEN_SCHEME} `;
  if (header.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

/** Whether the request presents the token that `kept` was made from. */
export function presentsToken(req: IncomingMessage, kept: Buffer): boolean {
  // A request without a token is compared as well, so every request takes the same path.
  const token = presentedToken(req);
  const matches = timingSafeEqual(digest(token ?? ''), kept);
  return token !== null && matches;
}

/**
 * Refuse a request by its headers. `Host` must be one of the allowed names with
 * the bound port: a page that reaches the server through a name of its own
 * carries that name. Any `Origin` header is refused: a browser sends one with a
 * cross-origin request, and the engine's MCP client sends none.
 */
export function admitRequest(req: IncomingMessage, port: number): McpHostRefusal | null {
  const host = req.headers.host;
  const allowed = HOST_ALLOW_LIST.map((name) => `${name}:${port}`);
  if (typeof host !== 'string' || !allowed.includes(host.toLowerCase())) {
    return { status: 403, error: 'forbidden host' };
  }
  if (req.headers.origin !== undefined) return { status: 403, error: 'forbidden origin' };
  return null;
}
