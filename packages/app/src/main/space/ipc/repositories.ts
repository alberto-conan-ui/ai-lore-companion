/**
 * The handlers of the Space's repositories
 * (`shared/ipc/space/repositories.contract.ts`), stage D1, phase D1.3. The
 * work is in `../repositories.ts`; this module finds the Space of the calling
 * window, validates the argument, and forwards every change of state to the
 * windows of that Space only.
 */

import { z } from 'zod';
import type {
  SpaceRepositoriesFailure,
  SpaceRepositoriesStateResult,
} from '../../../shared/ipc.js';
import { SPACE_REPOSITORIES_CONTRACT } from '../../../shared/ipc/space/repositories.contract.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import type { SpaceIpcEvent } from '../host.js';
import { type SpaceRepositories, spaceRepositories } from '../repositories.js';
import { parseArg } from './validate.js';

const emptySchema = z.strictObject({});

const notASpaceWindow: { ok: false; error: SpaceRepositoriesFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from a window of an AI-Lore 1.0 Space.',
  },
};

const forwarded = new WeakSet<SpaceContext>();

/** The repositories service of the Space of the calling window, with its pushes forwarded once per Space. */
function repositoriesFor(deps: Deps, event: SpaceIpcEvent): SpaceRepositories | undefined {
  const context = deps.space.contextFor(event);
  if (context === undefined) return undefined;
  const repositories = context.service(spaceRepositories);
  if (!forwarded.has(context)) {
    forwarded.add(context);
    repositories.subscribe((state) =>
      deps.space.sendToSpace(
        context.root,
        SPACE_REPOSITORIES_CONTRACT.onSpaceRepositoriesState.channel,
        state,
      ),
    );
  }
  return repositories;
}

export const registerSpaceRepositories: RegisterModule = (reg, deps) => {
  reg.handle('spaceRepositoriesState', (event, arg): SpaceRepositoriesStateResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const repositories = repositoriesFor(deps, event);
    if (repositories === undefined) return notASpaceWindow;
    // The first request of a Space in this run starts the reads; the result comes by push.
    repositories.readOnce();
    return { ok: true, value: repositories.current() };
  });

  reg.handle(
    'spaceRepositoriesRefresh',
    async (event, arg): Promise<SpaceRepositoriesStateResult> => {
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const repositories = repositoriesFor(deps, event);
      if (repositories === undefined) return notASpaceWindow;
      return { ok: true, value: await repositories.refresh() };
    },
  );

  reg.handle('spaceRepositoriesFocus', (event, arg): SpaceRepositoriesStateResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const repositories = repositoriesFor(deps, event);
    if (repositories === undefined) return notASpaceWindow;
    const before = repositories.current();
    repositories.windowFocused();
    return { ok: true, value: before };
  });
};
