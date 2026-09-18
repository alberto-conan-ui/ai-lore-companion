/**
 * The handlers of the Space's GitHub Project
 * (`shared/ipc/space/project.contract.ts`), phase M7.1. The work is in
 * `../project-refresh.ts`; this module finds the Space of the calling window,
 * validates the argument, and forwards every change of state to the windows of
 * that Space only.
 */

import { z } from 'zod';
import type { SpaceProjectFailure, SpaceProjectStateResult } from '../../../shared/ipc.js';
import { SPACE_PROJECT_CONTRACT } from '../../../shared/ipc/space/project.contract.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import type { SpaceIpcEvent } from '../host.js';
import { type ProjectRefresh, spaceProjectRefresh } from '../project-refresh.js';
import { parseArg } from './validate.js';

const emptySchema = z.strictObject({});

const notASpaceWindow: { ok: false; error: SpaceProjectFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from a window of an AI-Lore 1.0 Space.',
  },
};

const forwarded = new WeakSet<SpaceContext>();

/** The refresh service of the Space of the calling window, with its pushes forwarded once per Space. */
function refreshFor(deps: Deps, event: SpaceIpcEvent): ProjectRefresh | undefined {
  const context = deps.space.contextFor(event);
  if (context === undefined) return undefined;
  const refresh = context.service(spaceProjectRefresh);
  if (!forwarded.has(context)) {
    forwarded.add(context);
    refresh.subscribe((state) =>
      deps.space.sendToSpace(
        context.root,
        SPACE_PROJECT_CONTRACT.onSpaceProjectState.channel,
        state,
      ),
    );
  }
  return refresh;
}

export const registerSpaceProject: RegisterModule = (reg, deps) => {
  reg.handle('spaceProjectState', (event, arg): SpaceProjectStateResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const refresh = refreshFor(deps, event);
    if (refresh === undefined) return notASpaceWindow;
    // The first request of a Space in this run reads GitHub; the result comes by push.
    refresh.readOnce();
    return { ok: true, value: refresh.current() };
  });

  reg.handle('spaceProjectRefresh', async (event, arg): Promise<SpaceProjectStateResult> => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const refresh = refreshFor(deps, event);
    if (refresh === undefined) return notASpaceWindow;
    return { ok: true, value: await refresh.refresh() };
  });

  reg.handle('spaceProjectFocus', (event, arg): SpaceProjectStateResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const refresh = refreshFor(deps, event);
    if (refresh === undefined) return notASpaceWindow;
    const before = refresh.current();
    refresh.windowFocused();
    return { ok: true, value: before };
  });
};
