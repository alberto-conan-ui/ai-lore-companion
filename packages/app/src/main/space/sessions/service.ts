/**
 * The guarded AI sessions of one Space (phase M4.4), as a service of its
 * context.
 *
 * Starting a session, in this order (architecture document, section 5.6):
 * check the engine, `python3` and the install; record the session on the desk
 * in Read only (`startSession`); register it on the session server (its token
 * is returned once); write the session's folder; spawn the engine in the Space
 * window's PTY with the Space's folder as working directory and the session's
 * id in `SESSION_ID_ENV`. A step that fails undoes the steps before it.
 *
 * Ending a session, when its engine exits or when the window asks: the
 * refusals the adapter noted go into the log, the desk records the end with
 * the present commit of each root the session held (`endSession` with
 * `closes`), the session's issue on the Agents board takes the handover and
 * moves to Done (phase M4.7, bounded by `BOARD_UPDATE_WAIT_MS`), the session
 * leaves the server, and its folder is removed.
 *
 * When the service is built (the first time a Space's sessions are used in
 * this run of the app) it removes the session folders of that desk that no
 * open session record names: a session that was running when the app stopped
 * left its folder, and its token died with the app.
 */

import { randomBytes } from 'node:crypto';
import {
  type CommandRunner,
  type EngineEntry,
  endSession,
  listSessions,
  startSession,
} from '@ai-lore-companion/core';
import type { SpaceContext } from '../context.js';
import { defineSpaceService } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { boardWithin, sessionBoard } from '../session-server/board.js';
import { BOARD_UPDATE_WAIT_MS } from '../session-server/constants.js';
import { sessionCloseCommits, sessionServer } from '../session-server/index.js';
import { engineArgv } from './command-line.js';
import { MAX_LOGGED_REFUSALS, REQUIRED_CHECKS, SESSION_ID_ENV } from './constants.js';
import {
  type SessionFilePaths,
  readNotedRefusals,
  removeSessionFiles,
  removeSessionFoldersExcept,
  sessionToolNames,
  writeSessionFiles,
} from './files.js';
import {
  type SessionStartFailure,
  type VerifiedInstall,
  checkSessionEngine,
  findPython3,
  verifyInstall,
} from './preflight.js';

/** A started session, as the window receives it. */
export type StartedSession = { sessionId: string; ptyId: string; engineId: string };

type Started = { ok: true; value: StartedSession } | { ok: false; error: SessionStartFailure };

/** What is ready for a start: the engine, `python3` and the install. */
export type SessionReadiness =
  | { ok: true; value: { engine: EngineEntry; python: string; install: VerifiedInstall } }
  | { ok: false; error: SessionStartFailure };

export type SpaceSessions = {
  /** Check what a start needs, without starting. */
  readiness(engineId: string): Promise<SessionReadiness>;
  start(engineId: string): Promise<Started>;
  /** End a session of this service. `false` when it has no such session. The engine is stopped. */
  end(sessionId: string): Promise<boolean>;
  /** The ids of the sessions running now. */
  live(): string[];
};

/** What the service takes from its surroundings. A headless test replaces them. */
export type SpaceSessionParts = {
  /** The engines of the app's registry. */
  engines: () => readonly EngineEntry[];
  /** The `PATH` to look for `python3` with; `null` uses the app's own. */
  loginPath: () => Promise<string | null>;
  runner: (context: SpaceContext) => CommandRunner;
  /** A new session id. */
  newId: () => string;
};

let parts: SpaceSessionParts | null = null;

/** Set what the service is built with. The app sets it once from `main/space/ipc/sessions.ts`; a test sets its own. */
export function configureSpaceSessions(next: SpaceSessionParts): void {
  parts = next;
}

/**
 * A session id: `s-`, the date and time in UTC, and six random hexadecimal
 * characters, for example `s-20260918-2048-a1b2c3`. It matches the form the
 * session server and journal-append-forward accept.
 */
export function newSessionId(now: Date = new Date()): string {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`;
  return `s-${stamp}-${randomBytes(3).toString('hex')}`;
}

type Live = { ptyId: string | null; paths: SessionFilePaths; ending: Promise<void> | null };

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function createSpaceSessions(context: SpaceContext, use: SpaceSessionParts): SpaceSessions {
  // The server first (it builds the desk first), so both are disposed after this service.
  const server = context.service(sessionServer);
  const desk = context.service(spaceDesk);
  const board = context.service(sessionBoard);
  const live = new Map<string, Live>();

  const cleanup = (async () => {
    const opened = desk.open();
    if (!opened.ok) return;
    const records = listSessions(opened.value);
    if (!records.ok) return;
    const keep = new Set(records.value.filter((s) => s.closedAt === undefined).map((s) => s.id));
    const removed = await removeSessionFoldersExcept(context.desk.sessions, keep);
    for (const id of removed)
      context.log.info('session-folder-removed', { space: context.key, session: id });
  })().catch((caught: unknown) => {
    context.log.warn('session-folder-cleanup-failed', {
      space: context.key,
      message: describe(caught),
    });
  });

  async function readiness(engineId: string): Promise<SessionReadiness> {
    const engine = checkSessionEngine(use.engines(), engineId);
    if (!engine.ok) return engine;
    const python = await findPython3(use.runner(context), await use.loginPath(), context.root);
    if (!python.ok) return python;
    const install = await verifyInstall(context.desk.install);
    if (!install.ok) return install;
    if (!install.value.beforeChecks[0]?.endsWith(REQUIRED_CHECKS[0])) {
      return {
        ok: false,
        error: {
          kind: 'check-missing',
          message: `No AI session was started: the install does not run ${REQUIRED_CHECKS[0]} before a write. Install the Lore again.`,
        },
      };
    }
    return {
      ok: true,
      value: { engine: engine.value, python: python.value, install: install.value },
    };
  }

  async function finish(sessionId: string, entry: Live): Promise<void> {
    const refusals = await readNotedRefusals(entry.paths, MAX_LOGGED_REFUSALS);
    for (const refusal of refusals) {
      context.log.info('write-guard-refused', {
        space: context.key,
        session: sessionId,
        kind: refusal.kind,
        tool: refusal.tool,
        path: refusal.path,
        reason: refusal.reason,
      });
    }
    const opened = desk.open();
    if (opened.ok) {
      const closes = await sessionCloseCommits(context, opened.value, sessionId);
      const ended = endSession(opened.value, sessionId, { closes });
      if (!ended.ok) {
        context.log.warn('session-end-not-recorded', {
          space: context.key,
          session: sessionId,
          kind: ended.error.kind,
        });
      }
      // The session's issue, when it has one, takes the handover and moves to Done. The board logs a failure.
      await boardWithin(board.closed(sessionId), BOARD_UPDATE_WAIT_MS);
    } else {
      context.log.warn('session-end-not-recorded', {
        space: context.key,
        session: sessionId,
        kind: opened.error.kind,
      });
    }
    await server.unregisterSession(sessionId);
    await removeSessionFiles(context.desk.sessions, sessionId);
    live.delete(sessionId);
    context.log.info('session-ended', { space: context.key, session: sessionId });
  }

  function ended(sessionId: string): Promise<void> {
    const entry = live.get(sessionId);
    if (!entry) return Promise.resolve();
    entry.ending ??= finish(sessionId, entry).catch((caught: unknown) => {
      live.delete(sessionId);
      context.log.error('session-end-failed', {
        space: context.key,
        session: sessionId,
        message: describe(caught),
      });
    });
    return entry.ending;
  }

  async function start(engineId: string): Promise<Started> {
    await cleanup;
    const pty = context.ptyService;
    if (!pty) {
      return {
        ok: false,
        error: {
          kind: 'no-terminal',
          message: 'No AI session was started: the Space window has no terminal service.',
        },
      };
    }
    const ready = await readiness(engineId);
    if (!ready.ok) {
      context.log.warn('session-not-started', { space: context.key, kind: ready.error.kind });
      return ready;
    }
    const { engine, python, install } = ready.value;
    const opened = desk.open();
    if (!opened.ok || !opened.value.writable) {
      return {
        ok: false,
        error: {
          kind: 'desk-unavailable',
          message: opened.ok
            ? 'No AI session was started: another running companion holds the desk of this Space.'
            : `No AI session was started: the desk of this Space cannot be opened (${opened.error.message}).`,
        },
      };
    }
    const sessionId = use.newId();
    const recorded = startSession(opened.value, { id: sessionId, engine: engine.id });
    if (!recorded.ok) {
      return {
        ok: false,
        error: {
          kind: 'desk-unavailable',
          message: `No AI session was started: the session could not be recorded (${recorded.error.message}).`,
        },
      };
    }
    const undoRecord = () => {
      const undone = endSession(opened.value, sessionId);
      if (!undone.ok)
        context.log.warn('session-end-not-recorded', {
          space: context.key,
          session: sessionId,
          kind: undone.error.kind,
        });
    };
    const connection = await server.registerSession(sessionId);
    if (!connection.ok) {
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'session-server-unavailable',
          message: `No AI session was started: the companion's session server did not take the session (${connection.error.message}).`,
        },
      };
    }
    let paths: SessionFilePaths;
    try {
      paths = await writeSessionFiles(context.desk.sessions, {
        sessionId,
        spaceRoot: context.root,
        deskDir: context.desk.desk,
        python,
        beforeChecks: install.beforeChecks,
        afterChecks: install.afterChecks,
        repositories: context.manifest.repositories.map((repository) => repository.name),
        connection: connection.value,
      });
    } catch (caught) {
      await server.unregisterSession(sessionId);
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'session-files-failed',
          message: `No AI session was started: its files could not be written (${describe(caught)}).`,
        },
      };
    }
    const entry: Live = { ptyId: null, paths, ending: null };
    live.set(sessionId, entry);
    try {
      entry.ptyId = pty.spawn(
        {
          binary: engine.binary,
          args: engineArgv({
            engineArgs: engine.args ?? [],
            settingsFile: paths.settings,
            mcpFile: paths.mcp,
            pluginDir: install.pluginDir,
            tools: sessionToolNames(connection.value),
          }),
        },
        {
          cwd: context.root,
          env: { [SESSION_ID_ENV]: sessionId },
          onExit: () => void ended(sessionId),
        },
      );
    } catch (caught) {
      await ended(sessionId);
      return {
        ok: false,
        error: {
          kind: 'start-failed',
          message: `No AI session was started: the engine could not be started (${describe(caught)}).`,
        },
      };
    }
    // The token is not logged; the session id and the engine are.
    context.log.info('session-started', {
      space: context.key,
      session: sessionId,
      engine: engine.id,
    });
    return { ok: true, value: { sessionId, ptyId: entry.ptyId, engineId: engine.id } };
  }

  return {
    readiness,
    start,
    async end(sessionId) {
      const entry = live.get(sessionId);
      if (!entry) return false;
      if (entry.ptyId !== null) context.ptyService?.kill(entry.ptyId);
      await ended(sessionId);
      return true;
    },
    live: () => [...live.keys()],
  };
}

type Held = SpaceSessions & { dispose(): Promise<void> };

/** The guarded sessions of a Space. `context.service(spaceSessions)` builds it on first use. */
export const spaceSessions = defineSpaceService<SpaceSessions>({
  id: 'sessions',
  create: (context): Held => {
    if (!parts) throw new Error('the sessions of a Space are used before configureSpaceSessions');
    const service = createSpaceSessions(context, parts);
    return {
      ...service,
      async dispose() {
        await Promise.all(service.live().map((id) => service.end(id)));
      },
    };
  },
  dispose: (service) => (service as Held).dispose(),
});
