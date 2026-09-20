/**
 * The four channels of the Space's repositories (stage D1, phase D1.3): the
 * state as the service holds it, a read on demand, the window-focus read, and
 * the push of every change of state. Argument and result types are
 * `repositories.types.ts`.
 */

import { invoke, push } from './describe.js';
import type {
  SpaceRepositoriesArg,
  SpaceRepositoriesState,
  SpaceRepositoriesStateResult,
} from './repositories.types.js';

export const SPACE_REPOSITORIES_CONTRACT = {
  /** The rows as the service holds them now. The first request of a Space starts its first read. */
  spaceRepositoriesState: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
    'space:repositories-state',
  ),
  /** Read now, on demand. Answers when the run that serves this request ended. */
  spaceRepositoriesRefresh: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
    'space:repositories-refresh',
  ),
  /** The window gained focus: read, as the timer does. Answers at once with the state before the read. */
  spaceRepositoriesFocus: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
    'space:repositories-focus',
  ),
  /** The repositories state changed: a read started, a row arrived, or a root's changes moved. */
  onSpaceRepositoriesState: push<SpaceRepositoriesState>('space:on-repositories-state'),
} as const;
