import { z } from 'zod';
import type { SpaceWindowResult } from '../../../shared/ipc.js';
import type { RegisterModule } from '../../ipc/types.js';
import { spaceRootIdSchema } from './roots.js';
import { absolutePathSchema, parseArg, relativePathSchema } from './validate.js';

const openFolderSchema = z.strictObject({ folder: absolutePathSchema.optional() });

// A root id of a Space (`lore`, `workbench`, `publish:<name>`, `repo:<name>`), as the root channels take it.
const openInFilesSchema = z.strictObject({
  rootId: spaceRootIdSchema,
  relPath: relativePathSchema.optional(),
});

const navigateSchema = z.discriminatedUnion('to', [
  z.strictObject({ to: z.literal('space-welcome') }),
  z.strictObject({ to: z.literal('machine-check') }),
  z.strictObject({
    to: z.literal('setup'),
    start: z.enum(['new', 'from-address', 'about-this-folder']),
  }),
  z.strictObject({ to: z.literal('space-files'), open: openInFilesSchema.optional() }),
]);

const noArgumentSchema = z.strictObject({});

const recentsRemoveSchema = z.strictObject({ path: absolutePathSchema });

const NOT_A_SPACE_WINDOW: SpaceWindowResult = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from an AI-Lore 1.0 window.',
  },
};

/**
 * The window channels of 1.0 (`shared/ipc/space/windows.contract.ts`). Every
 * handler accepts a call only from the own web contents of a 1.0 window, so a
 * page in an embedded browser tab is refused, and validates its argument.
 *
 * No handler opens a path on the renderer's word. `spaceOpenFolder` opens the
 * folder the Human Lead picks in the system's dialog, or a folder that is in
 * the recents of Spaces. `spaceOpenInCockpit` and "create a Space about this
 * folder" take no path and use the folder main recorded for the window.
 */
export const registerSpaceWindows: RegisterModule = (reg, deps) => {
  reg.handle('spaceOpenFolder', async (event, arg): Promise<SpaceWindowResult> => {
    const record = deps.space.windowFor(event);
    if (!record) return NOT_A_SPACE_WINDOW;
    const parsed = parseArg(openFolderSchema, arg);
    if (!parsed.ok) return parsed;
    const { folder } = parsed.value;
    if (folder === undefined) return deps.space.promptAndOpenFolder(record.window);
    const recent = deps.space.resolveRecentSpace(folder);
    if (recent.status !== 'found') {
      deps.space.log.warn('open-folder-refused', { folder, recent: recent.status });
      return {
        ok: false,
        error: {
          kind: 'not-allowed-here',
          message:
            recent.status === 'moved'
              ? 'The folder of this recent Space is no longer the folder that was opened. Open it with the folder dialog.'
              : 'Only a folder from the recents, or one chosen in the folder dialog, is opened.',
        },
      };
    }
    return deps.space.openFolder(record.window, recent.path);
  });

  reg.handle('spaceNavigate', async (event, arg): Promise<SpaceWindowResult> => {
    const record = deps.space.windowFor(event);
    if (!record) return NOT_A_SPACE_WINDOW;
    const parsed = parseArg(navigateSchema, arg);
    if (!parsed.ok) return parsed;
    return deps.space.navigate(record.window, parsed.value);
  });

  reg.handle('spaceOpenInCockpit', async (event, arg): Promise<SpaceWindowResult> => {
    const record = deps.space.windowFor(event);
    if (!record) return NOT_A_SPACE_WINDOW;
    const parsed = parseArg(noArgumentSchema, arg);
    if (!parsed.ok) return parsed;
    return deps.space.openInCockpit(record.window);
  });

  reg.handle('spaceRecentsRemove', (event, arg) => {
    // A caller that is not a 1.0 window changes nothing and is told nothing.
    if (!deps.space.windowFor(event)) return [];
    const parsed = parseArg(recentsRemoveSchema, arg);
    if (!parsed.ok) return deps.space.recentSpaces();
    return deps.space.removeRecentSpace(parsed.value.path);
  });
};
