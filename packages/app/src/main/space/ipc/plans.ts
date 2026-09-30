/**
 * The handlers of the Plans band (`shared/ipc/space/plans.contract.ts`). The work is in `../plans.ts`; this module
 * finds the Space of the calling window, validates the argument, forwards every change of state to the windows of
 * that Space only, and opens a row's dashboard in the browser the way every other link does (`shell.openExternal`).
 */

import { shell } from 'electron';
import { z } from 'zod';
import type {
  SpacePlansFailure,
  SpacePlansOpenResult,
  SpacePlansStateResult,
} from '../../../shared/ipc.js';
import { SPACE_PLANS_CONTRACT } from '../../../shared/ipc/space/plans.contract.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import type { SpaceIpcEvent } from '../host.js';
import { type SpacePlans, spacePlans } from '../plans.js';
import { parseArg } from './validate.js';

const emptySchema = z.strictObject({});
const openSchema = z.strictObject({ number: z.number().int().positive() });

const notASpaceWindow: { ok: false; error: SpacePlansFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from a window of an AI-Lore 1.0 Space.',
  },
};

const forwarded = new WeakSet<SpaceContext>();

/** The plans service of the Space of the calling window, with its pushes forwarded once per Space. */
function plansFor(deps: Deps, event: SpaceIpcEvent): SpacePlans | undefined {
  const context = deps.space.contextFor(event);
  if (context === undefined) return undefined;
  const plans = context.service(spacePlans);
  if (!forwarded.has(context)) {
    forwarded.add(context);
    plans.subscribe((state) =>
      deps.space.sendToSpace(context.root, SPACE_PLANS_CONTRACT.onSpacePlansState.channel, state),
    );
  }
  return plans;
}

export const registerSpacePlans: RegisterModule = (reg, deps) => {
  reg.handle('spacePlansState', (event, arg): SpacePlansStateResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const plans = plansFor(deps, event);
    if (plans === undefined) return notASpaceWindow;
    return { ok: true, value: plans.current() };
  });

  reg.handle('spacePlansRefresh', async (event, arg): Promise<SpacePlansStateResult> => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const plans = plansFor(deps, event);
    if (plans === undefined) return notASpaceWindow;
    return { ok: true, value: await plans.refresh() };
  });

  reg.handle('spacePlansOpen', async (event, arg): Promise<SpacePlansOpenResult> => {
    const parsed = parseArg(openSchema, arg);
    if (!parsed.ok) return parsed;
    const plans = plansFor(deps, event);
    if (plans === undefined) return notASpaceWindow;
    const served = await plans.open(parsed.value.number);
    if (!served.ok) return served;
    try {
      await shell.openExternal(served.url);
    } catch (caught) {
      return {
        ok: false,
        error: {
          kind: 'not-opened',
          message: `The browser was not opened: ${caught instanceof Error ? caught.message : String(caught)}`,
        },
      };
    }
    return served;
  });
};
