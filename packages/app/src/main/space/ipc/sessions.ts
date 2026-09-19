/**
 * The handlers of sessions (`shared/ipc/space/sessions.contract.ts`), phase
 * M4.4. A guarded session is started and ended from the Space window of its
 * Space only: its engine runs in that window's terminal service. The work is
 * in `main/space/sessions/`; this module checks where the call came from,
 * validates the argument, and hands over. Phase M4.6 adds the session header
 * (read, pushed on a change of mode, Leave Writing) and the skills list.
 */

import { installClaudeCode, readLore } from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  SpaceSessionEndResult,
  SpaceSessionEnginesResult,
  SpaceSessionFailure,
  SpaceSessionHeaderResult,
  SpaceSessionLeaveWritingResult,
  SpaceSessionReadinessResult,
  SpaceSessionStartResult,
  SpaceSkillsResult,
} from '../../../shared/ipc.js';
import { SPACE_SESSIONS_CONTRACT } from '../../../shared/ipc/space/sessions.contract.js';
import { loadEngines } from '../../engines.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { probeEngineOfApp } from '../e2e-machine.js';
import type { SpaceIpcEvent } from '../host.js';
import { sessionServer } from '../session-server/index.js';
import { engineChoice } from '../sessions/engine-choice.js';
import { pushHeadersOnChange, readSessionHeader, readSpaceSkills } from '../sessions/header.js';
import {
  type SpaceSessionParts,
  configureSpaceSessions,
  newSessionId,
  spaceSessions,
} from '../sessions/service.js';
import { spaceUi } from '../ui-store.js';
import { readLoginShellPath, validLoginShell } from './machine.js';
import { parseArg } from './validate.js';

const engineSchema = z.strictObject({ engineId: z.string().min(1).max(256) });
const endSchema = z.strictObject({
  sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
});

const emptySchema = z.strictObject({});

const reinstallFailed = (message: string): { ok: false; error: SpaceSessionFailure } => ({
  ok: false,
  error: { kind: 'reinstall-failed', message },
});

const unknownSession: { ok: false; error: SpaceSessionFailure } = {
  ok: false,
  error: {
    kind: 'unknown-session',
    message: 'No session of this Space with that id is running.',
  },
};

const notASpaceWindow: { ok: false; error: SpaceSessionFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from the Space window of an AI-Lore 1.0 Space.',
  },
};

/** The parts the app builds the service with. */
function appParts(deps: Deps): SpaceSessionParts {
  const loginPath = () =>
    readLoginShellPath(
      deps.space.runner,
      validLoginShell(process.env.SHELL ?? '/bin/zsh'),
      process.platform,
    );
  return {
    engines: () => loadEngines(deps.space.userDataDir()),
    loginPath,
    runner: () => deps.space.runner,
    newId: () => newSessionId(),
    probeEngine: async (engine) => {
      const path = await loginPath();
      return probeEngineOfApp(deps.space.runner, engine, {
        platform: process.platform,
        ...(path === null ? {} : { env: { PATH: path } }),
      });
    },
  };
}

/** The context of the call when it came from a Space window (not a Files window). */
function spaceWindowContext(deps: Deps, event: SpaceIpcEvent): SpaceContext | undefined {
  const record = deps.space.windowFor(event);
  if (!record || record.init.mode !== 'space') return undefined;
  return deps.space.contextFor(event);
}

/** The engine id the `session-engine` concern remembers for this Space, or `null`. */
function rememberedEngine(context: SpaceContext): string | null {
  const engineId = context.service(spaceUi).read('session-engine').state?.engineId;
  return typeof engineId === 'string' ? engineId : null;
}

/** Remember `engineId` as the one this Space's sessions start with. */
function rememberEngine(context: SpaceContext, engineId: string): void {
  context.service(spaceUi).save('session-engine', { version: 1, engineId });
}

/**
 * Build the register module. `parts` replaces how the service is built; a
 * headless test passes its own engines, `PATH` and ids.
 */
export function createSpaceSessionsRegister(
  parts?: (deps: Deps) => SpaceSessionParts,
): RegisterModule {
  return (reg, deps) => {
    configureSpaceSessions((parts ?? appParts)(deps));

    /** Push the header of a session of `context` to its windows when its mode changes (M4.6). */
    const watchHeaders = (context: SpaceContext): void => {
      const desk = context.service(spaceDesk);
      pushHeadersOnChange(
        context,
        () => desk.open(),
        (header) =>
          deps.space.sendToSpace(
            context.root,
            SPACE_SESSIONS_CONTRACT.onSpaceSessionHeader.channel,
            header,
          ),
      );
    };

    reg.handle(
      'spaceSessionReadiness',
      async (event, arg): Promise<SpaceSessionReadinessResult> => {
        const context = spaceWindowContext(deps, event);
        if (!context) return notASpaceWindow;
        const parsed = parseArg(engineSchema, arg);
        if (!parsed.ok) return parsed;
        const ready = await context.service(spaceSessions).readiness(parsed.value.engineId);
        if (!ready.ok) return ready;
        // M4.6: the start also needs the desk, and `+ AI` says why before it is pressed.
        const opened = context.service(spaceDesk).open();
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
        return { ok: true, value: { engineId: ready.value.engine.id } };
      },
    );

    reg.handle('spaceSessionStart', async (event, arg): Promise<SpaceSessionStartResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(engineSchema, arg);
      if (!parsed.ok) return parsed;
      context.log.info('TRACE: main spaceSessionStart called', { engineId: parsed.value.engineId });
      watchHeaders(context);
      const started = await context.service(spaceSessions).start(parsed.value.engineId);
      if (started.ok) rememberEngine(context, parsed.value.engineId);
      return started;
    });

    reg.handle('spaceSessionEngines', async (event, arg): Promise<SpaceSessionEnginesResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const sessions = context.service(spaceSessions);
      const engines = loadEngines(deps.space.userDataDir());
      const choice = await engineChoice(
        engines,
        (id) => sessions.readiness(id),
        rememberedEngine(context),
      );
      return { ok: true, value: choice };
    });

    reg.handle('spaceSessionEnginePick', async (event, arg): Promise<SpaceSessionEnginesResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(engineSchema, arg);
      if (!parsed.ok) return parsed;
      const sessions = context.service(spaceSessions);
      const engines = loadEngines(deps.space.userDataDir());
      const readiness = (id: string) => sessions.readiness(id);
      const attempted = await engineChoice(engines, readiness, parsed.value.engineId);
      if (attempted.engineId === parsed.value.engineId) {
        rememberEngine(context, parsed.value.engineId);
        return { ok: true, value: attempted };
      }
      // The picked engine cannot start: nothing changes, and the choice stays what it was.
      const unchanged = await engineChoice(engines, readiness, rememberedEngine(context));
      return { ok: true, value: unchanged };
    });

    reg.handle('spaceSessionReinstall', async (event, arg): Promise<SpaceSessionEnginesResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const lore = await readLore(context.root);
      if (!lore.ok) return reinstallFailed(lore.error.message);
      const installed = await installClaudeCode(lore.value, context.desk.install);
      if (!installed.ok) return reinstallFailed(installed.error.message);
      context.log.info('lore-reinstalled', { space: context.key });
      const sessions = context.service(spaceSessions);
      const engines = loadEngines(deps.space.userDataDir());
      const choice = await engineChoice(
        engines,
        (id) => sessions.readiness(id),
        rememberedEngine(context),
      );
      return { ok: true, value: choice };
    });

    reg.handle('spaceSessionHeader', async (event, arg): Promise<SpaceSessionHeaderResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(endSchema, arg);
      if (!parsed.ok) return parsed;
      watchHeaders(context);
      const opened = context.service(spaceDesk).open();
      if (!opened.ok) {
        return {
          ok: false,
          error: {
            kind: 'desk-unavailable',
            message: `The header cannot be read: the desk of this Space cannot be opened (${opened.error.message}).`,
          },
        };
      }
      const header = readSessionHeader(opened.value, parsed.value.sessionId);
      if (!header.ok) {
        return {
          ok: false,
          error: {
            kind: 'desk-unavailable',
            message: `The header cannot be read from the desk (${header.error.message}).`,
          },
        };
      }
      return header.value === null ? unknownSession : { ok: true, value: header.value };
    });

    reg.handle(
      'spaceSessionLeaveWriting',
      async (event, arg): Promise<SpaceSessionLeaveWritingResult> => {
        const context = spaceWindowContext(deps, event);
        if (!context) return notASpaceWindow;
        const parsed = parseArg(endSchema, arg);
        if (!parsed.ok) return parsed;
        const { sessionId } = parsed.value;
        // Only a session this window's Space runs now: the header of a live AI tab.
        if (!context.service(spaceSessions).live().includes(sessionId)) return unknownSession;
        watchHeaders(context);
        const left = await context.service(sessionServer).broker.leaveWriting(sessionId);
        if (!left.ok) {
          return {
            ok: false,
            error: { kind: 'leave-failed', message: `Writing was not left: ${left.error.message}` },
          };
        }
        return { ok: true, value: { sessionId, released: left.value.released } };
      },
    );

    reg.handle('spaceSkillsList', async (event, arg): Promise<SpaceSkillsResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      return readSpaceSkills(context.root, context.desk.install);
    });

    reg.handle('spaceSessionEnd', async (event, arg): Promise<SpaceSessionEndResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(endSchema, arg);
      if (!parsed.ok) return parsed;
      const ended = await context.service(spaceSessions).end(parsed.value.sessionId);
      if (!ended) return unknownSession;
      return { ok: true, value: { sessionId: parsed.value.sessionId } };
    });
  };
}

/** The register module of sessions, as the module list holds it. */
export const registerSpaceSessions: RegisterModule = createSpaceSessionsRegister();
