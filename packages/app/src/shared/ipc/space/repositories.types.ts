/**
 * Argument, result and push types of the channels of the Space's
 * repositories (stage D1). Plain data only; types from core are imported with
 * `import type`. `shared/ipc.ts` already re-exports this file.
 */

import type { RepositoriesModel } from '@ai-lore-companion/core';

/** What the Repositories section receives, by push and as the result of its requests. */
export type SpaceRepositoriesState = {
  /** The number of this state among those the Space's service has given; a later state is higher. */
  version: number;
  /** Whether a read is running now. */
  reading: boolean;
  /** The rows, or `null` before the roots have been resolved. */
  model: RepositoriesModel | null;
  /** When the last run finished, ISO 8601, or `null` when none has. */
  readAt: string | null;
  /** Why the Space's roots could not be resolved at all, or `null`. */
  problem: string | null;
};

/** Argument of every channel of the repositories: nothing. The Space is the window's. */
export type SpaceRepositoriesArg = Record<string, never>;

/** Why a request was not served. `message` can be shown as it is. */
export type SpaceRepositoriesFailure = {
  kind: 'invalid-argument' | 'not-a-space-window';
  message: string;
};

export type SpaceRepositoriesStateResult =
  | { ok: true; value: SpaceRepositoriesState }
  | { ok: false; error: SpaceRepositoriesFailure };
