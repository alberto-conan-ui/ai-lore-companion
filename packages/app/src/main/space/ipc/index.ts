import type { RegisterModule } from '../../ipc/types.js';
import { registerSpaceDialogs } from './dialogs.js';
import { registerSpaceFiles } from './files.js';
import { registerSpaceMachine } from './machine.js';
import { registerSpaceMigration } from './migration.js';
import { registerSpaceProject } from './project.js';
import { registerSpaceRoots } from './roots.js';
import { registerSpaceSessions } from './sessions.js';
import { registerSpaceSetup } from './setup.js';
import { registerSpaceWindows } from './windows.js';

/**
 * Every 1.0 register module, one per feature. `main/ipc/index.ts` spreads this
 * list into `MODULES`. The list is complete from phase M3.5 on: a later phase
 * fills its own module and edits neither this file nor `main/ipc/index.ts`.
 */
export const SPACE_MODULES: readonly RegisterModule[] = [
  registerSpaceWindows,
  registerSpaceSetup,
  registerSpaceMachine,
  registerSpaceSessions,
  registerSpaceDialogs,
  registerSpaceRoots,
  registerSpaceFiles,
  registerSpaceMigration,
  registerSpaceProject,
];
