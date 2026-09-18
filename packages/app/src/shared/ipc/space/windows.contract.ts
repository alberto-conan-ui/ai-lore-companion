/**
 * The window channels of 1.0: opening a folder through detection, moving
 * between the screens that have no folder, the "Open in the v0.8 cockpit"
 * action, and the recents of Spaces. Owned by phase M3.5; the handlers are in
 * `main/space/ipc/windows.ts`.
 */

import { invoke } from './describe.js';
import type {
  RecentSpace,
  SpaceNavigateArg,
  SpaceOpenFolderArg,
  SpaceRecentsRemoveArg,
  SpaceWindowResult,
} from './windows.types.js';

export const SPACE_WINDOWS_CONTRACT = {
  /** Open a folder through detection. See `SpaceOpenFolderArg` for which folders are accepted. */
  spaceOpenFolder: invoke<[arg: SpaceOpenFolderArg], SpaceWindowResult>('space:open-folder'),
  /** Show another screen in this window, or the Files window of this window's Space. */
  spaceNavigate: invoke<[arg: SpaceNavigateArg], SpaceWindowResult>('space:navigate'),
  /**
   * "Open in the v0.8 cockpit": open this window's folder the way the app
   * opens a folder without detection routing. It takes no path; main uses the
   * folder it recorded for the window, and accepts the call only from the
   * migration screen.
   */
  spaceOpenInCockpit: invoke<[arg: Record<string, never>], SpaceWindowResult>(
    'space:open-in-cockpit',
  ),
  /** Drop one Space from the recents of Spaces; resolves to the updated list. */
  spaceRecentsRemove: invoke<[arg: SpaceRecentsRemoveArg], RecentSpace[]>('space:recents-remove'),
} as const;
