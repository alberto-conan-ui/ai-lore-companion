/**
 * The handlers of roots (`shared/ipc/space/roots.contract.ts`), filled by
 * phase M5.1.
 *
 * Every handler accepts a call only from a window of an open Space
 * (`deps.space.contextFor`), validates its argument with `parseArg`, and
 * returns a failure as its result; none rejects. A root is named by its id,
 * a file by a path relative to the root, resolved with core's `safeJoin`
 * (`../root-files.ts`), and a baseline or a commit is `HEAD` or hex.
 *
 * The roots, their tracker and their watchers are the service `spaceRoots`
 * (`../roots-service.ts`); the first call of a Space starts it, and it ends
 * with the Space's last window. Pushes go to the windows of that Space only,
 * through `deps.space.sendToSpace`.
 */

import {
  type MergedPullRequestSource,
  groupBaselinePoints,
  listBaselinePoints,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  RootBaselinePoints,
  SpaceRootsFailure,
  SpaceRootsResult,
} from '../../../shared/ipc/space/roots.types.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import { spaceGitHub } from '../github-service.js';
import type { SpaceIpcEvent } from '../host.js';
import {
  ROOT_HISTORY_DEFAULT_LIMIT,
  ROOT_HISTORY_MAX_LIMIT,
  readRootBlob,
  readRootDiff,
  readRootFileAt,
  readRootFileHistory,
  resolveRootCommit,
  trackedRoot,
} from '../root-files.js';
import { type SpaceRoots, spaceRoots } from '../roots-service.js';
import { parseArg, relativePathSchema } from './validate.js';

/**
 * The id of a root as `resolveRoots` gives it: `lore`, `workbench`,
 * `publish:<name>` or `repo:<name>`, the name as the manifest allows it.
 * (The shared `rootIdSchema` of `./validate.js` has no `:`, so it refuses the
 * ids of publish areas and repositories.)
 */
export const spaceRootIdSchema = z
  .string()
  .max(200)
  .regex(/^(?:lore|workbench|(?:publish|repo):[A-Za-z0-9._-]+)$/)
  .refine((id) => !/:\.{1,2}$/.test(id), 'a name that is not . or ..');

const rootIdSchema = spaceRootIdSchema;

/** `HEAD`, or a commit SHA in hex. Nothing else reaches git as a revision. */
export const revisionSchema = z.union([z.literal('HEAD'), z.string().regex(/^[0-9a-f]{7,64}$/)]);

const blobSchema = z.string().regex(/^[0-9a-f]{40,64}$/);
const limitSchema = z.number().int().min(1).max(ROOT_HISTORY_MAX_LIMIT);

const schemas = {
  list: z.strictObject({}),
  refresh: z.strictObject({ rootId: rootIdSchema.optional() }),
  root: z.strictObject({ rootId: rootIdSchema }),
  setBaseline: z.strictObject({ rootId: rootIdSchema, baseline: revisionSchema }),
  points: z.strictObject({ rootId: rootIdSchema, commitLimit: limitSchema.optional() }),
  diff: z.strictObject({
    rootId: rootIdSchema,
    path: relativePathSchema,
    oldPath: relativePathSchema.optional(),
    baseline: revisionSchema.optional(),
  }),
  fileAt: z.strictObject({
    rootId: rootIdSchema,
    path: relativePathSchema,
    commit: revisionSchema,
  }),
  blob: z.strictObject({ rootId: rootIdSchema, blob: blobSchema }),
  history: z.strictObject({
    rootId: rootIdSchema,
    path: relativePathSchema,
    limit: limitSchema.optional(),
  }),
};

const NOT_A_SPACE_WINDOW: { ok: false; error: SpaceRootsFailure } = {
  ok: false,
  error: {
    kind: 'not-a-space-window',
    message: 'The request did not come from a window of an open Space.',
  },
};

type Call<T> = { context: SpaceContext; roots: SpaceRoots; arg: T };

/**
 * The start every handler shares: the Space of the calling window, the
 * validated argument, and the roots service bound to push to that Space.
 */
function begin<T>(
  deps: Deps,
  event: SpaceIpcEvent,
  schema: z.ZodType<T>,
  arg: unknown,
): { ok: true; value: Call<T> } | { ok: false; error: SpaceRootsFailure } {
  const context = deps.space.contextFor(event);
  if (!context) return NOT_A_SPACE_WINDOW;
  const parsed = parseArg(schema, arg);
  if (!parsed.ok) return parsed;
  const roots = context.service(spaceRoots);
  const spaceRoot = context.root;
  roots.bind((channel, payload) => deps.space.sendToSpace(spaceRoot, channel, payload));
  return { ok: true, value: { context, roots, arg: parsed.value } };
}

/** A handler never rejects: what it throws is returned as a failure. */
async function guarded<T>(
  context: SpaceContext | undefined,
  work: () => Promise<SpaceRootsResult<T>>,
): Promise<SpaceRootsResult<T>> {
  try {
    return await work();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    context?.log.error('roots-handler-failed', { space: context.key, message });
    return { ok: false, error: { kind: 'git-failed', message } };
  }
}

/** `GitHubPort.mergedPullRequests` as the source `listBaselinePoints` takes. */
function mergedPullRequestSource(context: SpaceContext): MergedPullRequestSource {
  return async ({ repository, limit }) => {
    const port = await context.service(spaceGitHub).port();
    const answer = await port.mergedPullRequests({ repository, limit });
    if (answer.ok) return answer;
    return { ok: false, error: { kind: answer.error.kind, message: answer.error.message } };
  };
}

export const registerSpaceRoots: RegisterModule = (reg, deps) => {
  reg.handle('spaceRootsList', async (event, arg) => {
    const call = begin(deps, event, schemas.list, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      return { ok: true, value: roots.list(held.value) };
    });
  });

  reg.handle('spaceRootsRefresh', async (event, arg) => {
    const call = begin(deps, event, schemas.refresh, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.refresh(call.value.arg.rootId);
      if (!held.ok) return held;
      return { ok: true, value: roots.list(held.value) };
    });
  });

  reg.handle('spaceRootChanges', async (event, arg) => {
    const call = begin(deps, event, schemas.root, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const snapshot = held.value.tracker.snapshot(root.value.id);
      if (snapshot === null)
        return {
          ok: false,
          error: { kind: 'unknown-root', message: 'The Space has no such root.' },
        };
      return { ok: true, value: snapshot };
    });
  });

  reg.handle('spaceRootSetBaseline', async (event, arg) => {
    const call = begin(deps, event, schemas.setBaseline, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, () =>
      roots.setBaseline(call.value.arg.rootId, call.value.arg.baseline),
    );
  });

  reg.handle('spaceRootResetBaseline', async (event, arg) => {
    const call = begin(deps, event, schemas.root, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, () => roots.resetBaseline(call.value.arg.rootId));
  });

  reg.handle('spaceRootMarkReviewed', async (event, arg) => {
    const call = begin(deps, event, schemas.root, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, () => roots.markReviewed(call.value.arg.rootId));
  });

  reg.handle('spaceRootBaselinePoints', async (event, arg) => {
    const call = begin(deps, event, schemas.points, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded<RootBaselinePoints>(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const tracked = trackedRoot(root.value);
      if (!tracked.ok) return tracked;
      const desk = roots.desk();
      if (!desk.ok) return desk;
      const summary = roots.list(held.value).roots.find((entry) => entry.root.id === root.value.id);
      const repository = summary?.github ?? null;
      const read = await listBaselinePoints({
        runner: context.runner,
        desk: desk.value,
        root: root.value,
        pullRequests:
          repository === null ? null : { source: mergedPullRequestSource(context), repository },
        commitLimit: call.value.arg.commitLimit,
      });
      if (!read.ok) {
        const { kind, message, cause } = read.error;
        return {
          ok: false,
          error: {
            kind:
              kind === 'desk-failed'
                ? 'desk-failed'
                : kind === 'root-untracked'
                  ? kind
                  : 'git-failed',
            message,
            ...(cause === undefined ? {} : { cause }),
          },
        };
      }
      return {
        ok: true,
        value: { points: read.value, rows: groupBaselinePoints(read.value.points) },
      };
    });
  });

  reg.handle('spaceRootDiff', async (event, arg) => {
    const call = begin(deps, event, schemas.diff, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const tracked = trackedRoot(root.value);
      if (!tracked.ok) return tracked;
      const { path, oldPath } = call.value.arg;
      // A pinned point is read here and never given to the tracker: the root's baseline stays.
      let baseline =
        call.value.arg.baseline ?? held.value.tracker.baseline(root.value.id) ?? 'HEAD';
      if (baseline !== 'HEAD') {
        const commit = await resolveRootCommit(context.runner, tracked.value, baseline);
        if (commit === null) {
          return {
            ok: false,
            error: {
              kind: 'baseline-missing',
              message: 'The commit is not in the repository of this root.',
            },
          };
        }
        baseline = commit;
      }
      return readRootDiff(context.runner, tracked.value, {
        baseline,
        path,
        ...(oldPath === undefined ? {} : { oldPath }),
      });
    });
  });

  reg.handle('spaceRootFileAt', async (event, arg) => {
    const call = begin(deps, event, schemas.fileAt, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const tracked = trackedRoot(root.value);
      if (!tracked.ok) return tracked;
      return readRootFileAt(context.runner, tracked.value, call.value.arg);
    });
  });

  reg.handle('spaceRootBlob', async (event, arg) => {
    const call = begin(deps, event, schemas.blob, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const tracked = trackedRoot(root.value);
      if (!tracked.ok) return tracked;
      return readRootBlob(context.runner, tracked.value, call.value.arg.blob);
    });
  });

  reg.handle('spaceRootFileHistory', async (event, arg) => {
    const call = begin(deps, event, schemas.history, arg);
    if (!call.ok) return call;
    const { roots, context } = call.value;
    return guarded(context, async () => {
      const held = await roots.running();
      if (!held.ok) return held;
      const root = roots.root(held.value, call.value.arg.rootId);
      if (!root.ok) return root;
      const tracked = trackedRoot(root.value);
      if (!tracked.ok) return tracked;
      return readRootFileHistory(context.runner, tracked.value, {
        path: call.value.arg.path,
        limit: call.value.arg.limit ?? ROOT_HISTORY_DEFAULT_LIMIT,
      });
    });
  });
};
