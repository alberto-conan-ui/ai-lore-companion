/**
 * The session server of one Space: the broker, and the registration of the
 * Space's sessions on the app's local MCP server. Phase M4.3.
 *
 * Phase M4.4 starts a session like this: it writes the session's record on the
 * desk (`startSession`), calls `registerSession(sessionId)`, and writes the
 * connection it gets into the session's `mcp.json` (mode `0600`, in a folder
 * of mode `0700` outside the Space). The token is returned by that one call and
 * is kept nowhere else: the server keeps a digest of it. When the session ends
 * it reads `sessionCloseCommits`, passes them to core's `endSession` as
 * `closes`, and calls `unregisterSession`.
 *
 * Phase M4.5 attaches the two dialogs to `broker` (see `broker.ts`).
 *
 * When the last window of the Space closes, or the app quits, the context
 * disposes this service: every pending ticket is answered as cancelled with the
 * reason `companion-closed`, the `await_answer` calls that wait receive that
 * answer, and the sessions are then removed from the local server, so a later
 * call finds no server for the session.
 */

import {
  type Desk,
  type Failure,
  type Result,
  type SessionCloseCommit,
  fail,
  ok,
  readSessionCloseCommits,
  resolveRoots,
} from '@ai-lore-companion/core';
import type { McpHost } from '../../helper/mcp-host.js';
import { type SpaceContext, defineSpaceService } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { sessionBoard } from './board.js';
import { type DialogBroker, type DialogBrokerOptions, createDialogBroker } from './broker.js';
import {
  BODY_READ_TIMEOUT_MS,
  CLOSE_FLUSH_MS,
  MAX_BODY_BYTES,
  SESSION_SERVER_NAME,
  TOKEN_HEADER,
  TOKEN_SCHEME,
} from './constants.js';
import { admitRequest, issueSessionToken, presentsToken } from './guard.js';
import { SESSION_TOOL_NAMES, createSessionTools } from './tools.js';

export type {
  AwaitedAnswer,
  BrokerEvent,
  BrokerFailure,
  CancelReason,
  DialogBroker,
  DialogRequest,
  GateRequestInput,
  GateTicketAnswer,
  SessionPort,
  TicketAnswer,
  WritingAnswer,
  WritingDecision,
  WritingDialogView,
  WritingLeftAnswer,
  WritingRequestInput,
} from './broker.js';
export { SESSION_TOOL_NAMES } from './tools.js';
export { SESSION_SERVER_NAME } from './constants.js';

type HostPort = Pick<McpHost, 'listen' | 'endpoint' | 'registerTools' | 'unregister'>;

/** What a session's MCP configuration holds. The token is here and nowhere else. */
export type SessionConnection = {
  sessionId: string;
  /** The MCP server name: tools are `mcp__<serverName>__<tool>` in Claude Code. */
  serverName: string;
  url: string;
  /** The header the engine's MCP client must send with every request. */
  header: { name: string; value: string };
  /** The tool names to allow for the session. */
  tools: readonly string[];
};

export type SessionServerFailure = Failure<
  'closed' | 'invalid-session-id' | 'already-registered' | 'server-unavailable'
>;

export type SessionServer = {
  readonly broker: DialogBroker;
  /** Put the session on the local server and make its token. */
  registerSession(sessionId: string): Promise<Result<SessionConnection, SessionServerFailure>>;
  /** Take the session off the local server; its pending tickets are cancelled. */
  unregisterSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
};

export type SessionServerOptions = {
  host: () => Promise<HostPort>;
  broker: DialogBrokerOptions;
  /** How long one `await_answer` waits. Default: `AWAIT_ANSWER_WAIT_MS`. */
  awaitMs?: number;
  maxCallsPerWindow?: number;
  /** How long the whole body of a request may take. Default: `BODY_READ_TIMEOUT_MS`. */
  bodyTimeoutMs?: number;
};

/** A session id is made by the companion. It is part of a URL path and of log lines, so its form is checked. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createSessionServer(options: SessionServerOptions): SessionServer {
  const { log } = options.broker;
  const broker = createDialogBroker(options.broker);
  const registered = new Set<string>();
  let inFlight = 0;
  let closed = false;

  return {
    broker,

    async registerSession(sessionId) {
      if (closed) return fail('closed', 'The Space is closed.');
      if (!SESSION_ID.test(sessionId)) {
        return fail('invalid-session-id', 'The session id is not one the companion makes.');
      }
      if (registered.has(sessionId)) {
        return fail('already-registered', 'The session is on the local server already.');
      }
      // Taken before the first wait, so that two calls with one id cannot both pass.
      registered.add(sessionId);
      const unavailable = (caught: unknown): Result<SessionConnection, SessionServerFailure> => {
        registered.delete(sessionId);
        return fail(
          'server-unavailable',
          `The local server could not be used: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      };
      let host: HostPort;
      let url: string | null;
      try {
        host = await options.host();
        await host.listen();
        url = host.endpoint(sessionId);
      } catch (caught) {
        return unavailable(caught);
      }
      if (url === null) return unavailable('it has no address');
      const { token, kept } = issueSessionToken();
      const tools = {
        sessionId,
        serverName: SESSION_SERVER_NAME,
        admit: admitRequest,
        authorize: (req: Parameters<typeof presentsToken>[0]) => presentsToken(req, kept),
        maxBodyBytes: MAX_BODY_BYTES,
        bodyTimeoutMs: options.bodyTimeoutMs ?? BODY_READ_TIMEOUT_MS,
        tools: createSessionTools({
          sessionId,
          port: broker.forSession(sessionId),
          log,
          ...(options.broker.now ? { now: options.broker.now } : {}),
          ...(options.awaitMs !== undefined ? { awaitMs: options.awaitMs } : {}),
          ...(options.maxCallsPerWindow !== undefined
            ? { maxCallsPerWindow: options.maxCallsPerWindow }
            : {}),
          onCall: (phase) => {
            inFlight += phase === 'start' ? 1 : -1;
          },
        }),
      };
      try {
        // Refused when the local server has a session of this id already, the helper's included.
        await host.registerTools(tools);
      } catch (caught) {
        return unavailable(caught);
      }
      log.info('session-registered', { session: sessionId });
      return ok({
        sessionId,
        serverName: SESSION_SERVER_NAME,
        url,
        header: {
          name: TOKEN_HEADER,
          value: TOKEN_SCHEME === '' ? token : `${TOKEN_SCHEME} ${token}`,
        },
        tools: SESSION_TOOL_NAMES,
      });
    },

    async unregisterSession(sessionId) {
      if (!registered.delete(sessionId)) return;
      broker.sessionEnded(sessionId);
      try {
        await (await options.host()).unregister(sessionId);
      } catch {
        // No server, so nothing is registered on it.
      }
      log.info('session-unregistered', { session: sessionId });
    },

    async close() {
      if (closed) return;
      closed = true;
      broker.close();
      // The calls that waited have their answer now; give it time to leave before the sessions go.
      const until = Date.now() + CLOSE_FLUSH_MS;
      while (inFlight > 0 && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      const sessions = [...registered];
      registered.clear();
      if (sessions.length === 0) return;
      try {
        const host = await options.host();
        for (const sessionId of sessions) await host.unregister(sessionId);
      } catch {
        // No server, so nothing is registered on it.
      }
    },
  };
}

/** The app's local server: the MCP host the helper uses. Loaded when first needed, because its module loads Electron. */
const appHost = async (): Promise<HostPort> => (await import('../../helper/index.js')).mcpHost();

/**
 * The present commit of each root the session holds, for a session close. The
 * broker passes it to core's `leaveWriting`; phase M4.4 passes it to core's
 * `endSession` as `closes` when a session ends while it is in Writing. A root
 * that gives no commit is left out and logged: leaving Writing does not wait on it.
 */
export async function sessionCloseCommits(
  context: SpaceContext,
  desk: Desk,
  sessionId: string,
): Promise<SessionCloseCommit[]> {
  const roots = await resolveRoots({
    spaceRoot: context.root,
    runner: context.runner,
    manifest: context.manifest,
  });
  if (!roots.ok) {
    context.log.warn('session-close-roots-not-resolved', {
      session: sessionId,
      kind: roots.error.kind,
    });
    return [];
  }
  const read = await readSessionCloseCommits({
    runner: context.runner,
    desk,
    roots: roots.value,
    sessionId,
  });
  if (!read.ok) {
    context.log.warn('session-close-commits-not-read', {
      session: sessionId,
      kind: read.error.kind,
    });
    return [];
  }
  for (const skipped of read.value.skipped) {
    context.log.warn('session-close-skipped', {
      session: sessionId,
      root: skipped.rootId,
      reason: skipped.reason,
    });
  }
  return read.value.closes;
}

type ServiceOverrides = Pick<
  SessionServerOptions,
  'awaitMs' | 'maxCallsPerWindow' | 'bodyTimeoutMs'
> & {
  host?: () => Promise<HostPort>;
  limits?: DialogBrokerOptions['limits'];
  boardWaitMs?: number;
};

let overrides: ServiceOverrides = {};

/**
 * Replace what the service is built with. A headless test passes its own local
 * server and a short wait; `null` restores the app's. It applies to a service
 * built after the call.
 */
export function configureSessionServer(next: ServiceOverrides | null): void {
  overrides = next ?? {};
}

/** The session server of a Space. `context.service(sessionServer)` builds it on first use. */
export const sessionServer = defineSpaceService<SessionServer>({
  id: 'session-server',
  create: (context: SpaceContext) => {
    // The desk first, so that it is disposed after this service.
    const desk = context.service(spaceDesk);
    const board = context.service(sessionBoard);
    const { host, limits, awaitMs, maxCallsPerWindow, bodyTimeoutMs, boardWaitMs } = overrides;
    return createSessionServer({
      host: host ?? appHost,
      broker: {
        desk: () => desk.open(),
        manifest: () => context.manifest,
        closeCommits: (open, sessionId) => sessionCloseCommits(context, open, sessionId),
        board,
        ...(boardWaitMs !== undefined ? { boardWaitMs } : {}),
        log: context.log,
        ...(limits ? { limits } : {}),
      },
      ...(awaitMs !== undefined ? { awaitMs } : {}),
      ...(maxCallsPerWindow !== undefined ? { maxCallsPerWindow } : {}),
      ...(bodyTimeoutMs !== undefined ? { bodyTimeoutMs } : {}),
    });
  },
  dispose: (service) => service.close(),
});
