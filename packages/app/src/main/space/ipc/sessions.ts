/**
 * The handlers of sessions (`shared/ipc/space/sessions.contract.ts`), phase
 * M4.4. A guarded session is started and ended from the Space window of its
 * Space only: its engine runs in that window's terminal service. The work is
 * in `main/space/sessions/`; this module checks where the call came from,
 * validates the argument, and hands over.
 */

import { z } from 'zod';
import type {
  SpaceSessionEndResult,
  SpaceSessionFailure,
  SpaceSessionReadinessResult,
  SpaceSessionStartResult,
} from '../../../shared/ipc.js';
import { loadEngines } from '../../engines.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import type { SpaceIpcEvent } from '../host.js';
import {
  type SpaceSessionParts,
  configureSpaceSessions,
  newSessionId,
  spaceSessions,
} from '../sessions/service.js';
import { readLoginShellPath, validLoginShell } from './machine.js';
import { parseArg } from './validate.js';

const engineSchema = z.strictObject({ engineId: z.string().min(1).max(256) });
const endSchema = z.strictObject({
  sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
});

const notASpaceWindow: { ok: false; error: SpaceSessionFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from the Space window of an AI-Lore 1.0 Space.',
  },
};

/** The parts the app builds the service with. */
function appParts(deps: Deps): SpaceSessionParts {
  return {
    engines: () => loadEngines(deps.space.userDataDir()),
    loginPath: () =>
      readLoginShellPath(
        deps.space.runner,
        validLoginShell(process.env.SHELL ?? '/bin/zsh'),
        process.platform,
      ),
    runner: () => deps.space.runner,
    newId: () => newSessionId(),
  };
}

/** The context of the call when it came from a Space window (not a Files window). */
function spaceWindowContext(deps: Deps, event: SpaceIpcEvent): SpaceContext | undefined {
  const record = deps.space.windowFor(event);
  if (!record || record.init.mode !== 'space') return undefined;
  return deps.space.contextFor(event);
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

    reg.handle(
      'spaceSessionReadiness',
      async (event, arg): Promise<SpaceSessionReadinessResult> => {
        const context = spaceWindowContext(deps, event);
        if (!context) return notASpaceWindow;
        const parsed = parseArg(engineSchema, arg);
        if (!parsed.ok) return parsed;
        const ready = await context.service(spaceSessions).readiness(parsed.value.engineId);
        return ready.ok ? { ok: true, value: { engineId: ready.value.engine.id } } : ready;
      },
    );

    reg.handle('spaceSessionStart', async (event, arg): Promise<SpaceSessionStartResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(engineSchema, arg);
      if (!parsed.ok) return parsed;
      return context.service(spaceSessions).start(parsed.value.engineId);
    });

    reg.handle('spaceSessionEnd', async (event, arg): Promise<SpaceSessionEndResult> => {
      const context = spaceWindowContext(deps, event);
      if (!context) return notASpaceWindow;
      const parsed = parseArg(endSchema, arg);
      if (!parsed.ok) return parsed;
      const ended = await context.service(spaceSessions).end(parsed.value.sessionId);
      if (!ended) {
        return {
          ok: false,
          error: {
            kind: 'unknown-session',
            message: 'No session of this Space with that id is running.',
          },
        };
      }
      return { ok: true, value: { sessionId: parsed.value.sessionId } };
    });
  };
}

/** The register module of sessions, as the module list holds it. */
export const registerSpaceSessions: RegisterModule = createSpaceSessionsRegister();
