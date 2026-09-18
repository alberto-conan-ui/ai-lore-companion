/**
 * The channels of the Space's GitHub Project (phase M7.1): the cached
 * snapshot with the Dashboard's model, its refresh, and the push of both. The
 * handlers are in `main/space/ipc/project.ts` and the types in
 * `./project.types.ts`. This fragment is spread into `CONTRACT`.
 */

import { invoke, push } from './describe.js';
import type {
  SpaceProjectArg,
  SpaceProjectState,
  SpaceProjectStateResult,
} from './project.types.js';

export const SPACE_PROJECT_CONTRACT = {
  /**
   * The Project as the cache holds it now. The first request of a Space starts
   * its refresh timer and a first refresh, whose result comes by push.
   */
  spaceProjectState: invoke<[arg: SpaceProjectArg], SpaceProjectStateResult>('space:project-state'),
  /**
   * Refresh now, on demand. Answers when the refresh ended; a request made
   * while one runs is served by the one run after it.
   */
  spaceProjectRefresh: invoke<[arg: SpaceProjectArg], SpaceProjectStateResult>(
    'space:project-refresh',
  ),
  /**
   * The window gained focus: refresh, as the timer does. Answers at once with
   * the state before the refresh; its result comes by push.
   */
  spaceProjectFocus: invoke<[arg: SpaceProjectArg], SpaceProjectStateResult>('space:project-focus'),
  /** The Project's state changed: a refresh started or ended, or a gate began or ended waiting. */
  onSpaceProjectState: push<SpaceProjectState>('space:on-project-state'),
} as const;
