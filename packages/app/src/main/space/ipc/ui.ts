/**
 * Reading and saving what the Files window remembers
 * (`shared/ipc/space/ui.contract.ts`), added by phase M5.7. Registered from
 * `./files.ts`.
 *
 * Only the Files window of an open Space may call them, and each call is about
 * that window's Space. A save is validated against the concern's shape and
 * handed to the Space's `ui` service, which writes it shortly after; it is not
 * taken while another window of the Space has the focus.
 */

import { z } from 'zod';
import type {
  SpaceUiRead,
  SpaceUiResult,
  SpaceUiSaved,
} from '../../../shared/ipc/space/ui.types.js';
import type { RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import type { SpaceIpcEvent } from '../host.js';
import { UI_SAVE_SCHEMAS, spaceUi } from '../ui-store.js';
import { parseArg } from './validate.js';

const rendererConcern = z.enum(['files-editor', 'selected-root', 'baselines']);

const readSchema = z.strictObject({ concern: rendererConcern });

const saveSchema = z.discriminatedUnion('concern', [
  z.strictObject({ concern: z.literal('files-editor'), state: UI_SAVE_SCHEMAS['files-editor'] }),
  z.strictObject({
    concern: z.literal('selected-root'),
    state: UI_SAVE_SCHEMAS['selected-root'],
  }),
  z.strictObject({ concern: z.literal('baselines'), state: UI_SAVE_SCHEMAS.baselines }),
]);

const notAFilesWindow = {
  ok: false as const,
  error: {
    kind: 'not-a-space-window' as const,
    message: 'The request did not come from the Files window of an open Space.',
  },
};

/** Register `spaceUiRead` and `spaceUiSave`. Called by `registerSpaceFiles`. */
export const registerSpaceUi: RegisterModule = (reg, deps) => {
  /** The context and window id of a call from a Files window, or `undefined`. */
  const filesWindowOf = (
    event: SpaceIpcEvent,
  ): { context: SpaceContext; windowId: number } | undefined => {
    const record = deps.space.windowFor(event);
    if (record?.init.mode !== 'space-files') return undefined;
    const context = deps.space.contextFor(event);
    return context ? { context, windowId: record.window.id } : undefined;
  };

  reg.handle('spaceUiRead', async (event, arg): Promise<SpaceUiResult<SpaceUiRead>> => {
    const caller = filesWindowOf(event);
    if (!caller) return notAFilesWindow;
    const parsed = parseArg(readSchema, arg);
    if (!parsed.ok) return parsed;
    const read = caller.context.service(spaceUi).read(parsed.value.concern);
    return { ok: true, value: read as SpaceUiRead };
  });

  reg.handle('spaceUiSave', async (event, arg): Promise<SpaceUiResult<SpaceUiSaved>> => {
    const caller = filesWindowOf(event);
    if (!caller) return notAFilesWindow;
    const parsed = parseArg(saveSchema, arg);
    if (!parsed.ok) return parsed;
    if (!deps.space.mayRemember(caller.windowId)) {
      return { ok: true, value: { outcome: 'not-focused' } };
    }
    const { concern, state } = parsed.value;
    const outcome = caller.context.service(spaceUi).save(concern, state);
    return { ok: true, value: { outcome } };
  });
};
