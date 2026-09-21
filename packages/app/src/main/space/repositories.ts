/**
 * The refresh service of a Space's repositories on the Dashboard
 * (architecture document, section 5.2; stage D1, phase D1.3).
 *
 * One service per Space, kept as a service of its context. It starts the
 * roots service (`roots-service.ts`), reads every repository root
 * independently, keeps the result in memory, and pushes the state to that
 * Space's windows on a timer, on window focus, on a root's file events, and
 * on demand. Follows `project-refresh.ts` in shape.
 *
 * - First paint waits for nothing: `current()` answers at once with the state
 *   as it is, and `readOnce()` starts the first read without waiting for it.
 * - Every repository is read independently, in parallel; a result is written
 *   in as it arrives and the state is emitted after each one, so a slow or
 *   failing read never holds the others back and fails only its own row.
 * - Nothing here is written to the desk. The state lives in memory and is
 *   gone when the Space's last window closes (architecture document, 5.4).
 * - One working tree is read once even when several roots share it (the Lore
 *   and a publish area inside the Space, for instance).
 *
 * This file imports nothing from Electron, so a headless test drives it.
 */

import {
  type CommandRunner,
  type MirrorCard,
  type MirrorDrift,
  ROOT_REPOSITORY_TIMEOUT_MS,
  type RepositoriesModel,
  type RepositoriesModelInput,
  type RepositoryRead,
  errorMessage,
  generateRepositorySkeleton,
  mirrorDrift,
  readLore,
  readRepositoryStateIn,
  repositoriesModel,
} from '@ai-lore-companion/core';
import type {
  RootSummary,
  SpaceRepositoriesState,
  SpaceRootsList,
  SpaceRootsResult,
} from '../../shared/ipc.js';
import { type SpaceContext, defineSpaceService } from './context.js';
import type { SpaceLog } from './log.js';
import type { RunningRoots } from './roots-service.js';
import { spaceRoots } from './roots-service.js';

/** The refresh interval: 60 seconds (the CTO's ruling on the stage; a constant, not a setting). */
export const DEFAULT_REPOSITORY_REFRESH_MS = 60_000;

/** How long a root's file events are collected before the state is re-emitted, with no new git read. */
export const REPOSITORY_FILE_EVENT_DEBOUNCE_MS = 500;

/** What a repositories service is built from. */
export type SpaceRepositoriesOptions = {
  runner: CommandRunner;
  /** The roots service's `running()`: resolves the roots and starts the tracker when none runs yet. */
  roots: () => Promise<SpaceRootsResult<RunningRoots>>;
  /** The roots service's `list()`, given the running roots it returned. */
  list: (held: RunningRoots) => SpaceRootsList;
  now?: () => Date;
  /** Default `DEFAULT_REPOSITORY_REFRESH_MS`. `0` starts no timer. */
  intervalMs?: number;
  log?: SpaceLog;
  /** Named in the log lines. */
  space?: string;
};

/** The repositories service of one Space. */
export type SpaceRepositories = {
  /** The state now, with the model computed from the roots and the reads held so far. */
  current(): SpaceRepositoriesState;
  /** Read every repository now; resolves with the state after the run that serves this request. */
  refresh(): Promise<SpaceRepositoriesState>;
  /** A window of the Space gained focus. */
  windowFocused(): void;
  /** Start a first read when none has run yet for this Space in this run of the app. */
  readOnce(): void;
  /** A root's file events settled: tell the subscribers with no new repository read. */
  changed(): void;
  subscribe(listener: (state: SpaceRepositoriesState) => void): () => void;
  /** Stop the timer; later requests do nothing. */
  dispose(): void;
};

function readOf(result: SpaceRootsResult<RunningRoots>): RunningRoots | null {
  return result.ok ? result.value : null;
}

/** Every distinct working tree of the tracked roots, each with the ids of the roots that share it. */
function workTreesOf(roots: readonly RootSummary[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const summary of roots) {
    const { root } = summary;
    if (!root.tracking.tracked) continue;
    const { workTree } = root.tracking;
    const ids = groups.get(workTree);
    if (ids === undefined) groups.set(workTree, [root.id]);
    else ids.push(root.id);
  }
  return groups;
}

/** Build a repositories service. The timer starts now. */
export function createSpaceRepositories(options: SpaceRepositoriesOptions): SpaceRepositories {
  const now = options.now ?? (() => new Date());
  const fields = options.space === undefined ? {} : { space: options.space };
  const listeners = new Set<(state: SpaceRepositoriesState) => void>();
  const reads = new Map<string, RepositoryRead>();
  let heldRoots: RunningRoots | null = null;
  let problem: string | null = null;
  let readAt: string | null = null;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let disposed = false;
  let attempted = false;
  const cachedMirrors: Record<string, MirrorDrift> = {};
  let nextMirrorCheck = 0;
  /** The `version` of the last state given; each state gets the next number. */
  let version = 0;

  const buildInput = (list: SpaceRootsList): RepositoriesModelInput => {
    const snapshots: Record<string, RepositoriesModelInput['snapshots'][string]> = {};
    const baselines: Record<string, string> = {};
    const defaults: Record<string, RepositoriesModelInput['defaults'][string]> = {};
    const github: Record<string, string> = {};
    for (const summary of list.roots) {
      snapshots[summary.root.id] = summary.snapshot;
      baselines[summary.root.id] = summary.baseline;
      defaults[summary.root.id] = summary.defaultBaseline;
      if (summary.github !== null) github[summary.root.id] = summary.github;
    }
    return {
      roots: list.roots.map((summary) => summary.root),
      snapshots,
      baselines,
      defaults,
      reads: Object.fromEntries(reads),
      github,
      mirrors: cachedMirrors,
    };
  };

  const modelNow = (): RepositoriesModel | null => {
    if (heldRoots === null) return null;
    return repositoriesModel(buildInput(options.list(heldRoots)));
  };

  const current = (): SpaceRepositoriesState => {
    version += 1;
    return {
      version,
      reading: running !== null,
      model: modelNow(),
      readAt,
      problem,
    };
  };

  const emit = (): void => {
    if (disposed || listeners.size === 0) return;
    const state = current();
    for (const listener of listeners) listener(state);
  };

  const readWorkTree = async (workTree: string): Promise<RepositoryRead> => {
    try {
      const result = await readRepositoryStateIn(options.runner, workTree, {
        timeoutMs: ROOT_REPOSITORY_TIMEOUT_MS,
        now,
      });
      if (result.ok) return { status: 'ok', state: result.value };
      return { status: 'failed', message: result.error.message };
    } catch (caught) {
      return { status: 'failed', message: errorMessage(caught) };
    }
  };

  const run = (): Promise<void> => {
    attempted = true;
    const started = (async () => {
      try {
        const held = await options.roots();
        if (!held.ok) {
          problem = held.error.message;
          options.log?.warn('repositories-roots-unavailable', {
            ...fields,
            kind: held.error.kind,
          });
          return;
        }
        problem = null;
        heldRoots = readOf(held);
        const list = options.list(held.value);
        const groups = workTreesOf(list.roots);

        if (now().getTime() >= nextMirrorCheck) {
          nextMirrorCheck = now().getTime() + DEFAULT_REPOSITORY_REFRESH_MS * 2;
          const loreRoot = list.roots.find((summary) => summary.root.kind === 'lore')?.root;
          if (loreRoot?.tracking.tracked) {
            const spaceRoot = loreRoot.tracking.workTree;
            const loreResult = await readLore(spaceRoot);
            if (loreResult.ok) {
              const mirrors: MirrorCard[] = loreResult.value.parts.mirrors.map(
                (e: { card: MirrorCard }) => e.card,
              );
              await Promise.allSettled(
                list.roots.map(async (summary) => {
                  const root = summary.root;
                  if (root.kind !== 'repository' && root.kind !== 'publish-area') return;
                  const payloadPath =
                    root.name === 'ai-lore-companion' || root.name === 'publish'
                      ? root.name
                      : `repos/${root.name}`;
                  const card = mirrors.find((m: MirrorCard) => m.payload === payloadPath);
                  const mirrorPath = `lore/mirrors/${root.name}.md`;
                  if (!card) {
                    cachedMirrors[root.id] = {
                      path: mirrorPath,
                      state: 'no-mirror',
                      added: 0,
                      removed: 0,
                      checkedAt: now().toISOString(),
                    };
                    return;
                  }
                  try {
                    const scriptPath = spaceRoot + '/' + card.generator;
                    const args = [scriptPath, payloadPath];
                    let run = await options.runner.run('python3', args, {
                      cwd: spaceRoot,
                      timeoutMs: 120000,
                    });
                    let generated: string[] | null = null;
                    if (run.code === 0 && run.failure === undefined) {
                      let lines = run.stdout.split('\n').filter((line: string) => line !== '');
                      if (lines.length > 2000) {
                        const depthArgs = [scriptPath, payloadPath, '--depth', '2'];
                        const depthRun = await options.runner.run('python3', depthArgs, {
                          cwd: spaceRoot,
                          timeoutMs: 120000,
                        });
                        if (depthRun.code === 0 && depthRun.failure === undefined) {
                          lines = depthRun.stdout.split('\n').filter((line: string) => line !== '');
                        } else {
                          throw new Error('Depth run failed');
                        }
                      }
                      generated = lines;
                    } else {
                      throw new Error('Run failed');
                    }
                    cachedMirrors[root.id] = mirrorDrift({
                      path: mirrorPath,
                      stored: card.skeleton,
                      generated,
                      checkedAt: now().toISOString(),
                    });
                  } catch (e) {
                    cachedMirrors[root.id] = mirrorDrift({
                      path: mirrorPath,
                      stored: card.skeleton,
                      generated: null,
                      checkedAt: now().toISOString(),
                    });
                  }
                }),
              );
            }
          }
        }

        await Promise.allSettled(
          [...groups.entries()].map(async ([workTree, ids]) => {
            const read = await readWorkTree(workTree);
            for (const id of ids) reads.set(id, read);
            emit();
          }),
        );
      } catch (caught) {
        problem = `The Space's repositories could not be read: ${errorMessage(caught)}.`;
        options.log?.warn('repositories-run-failed', { ...fields, message: errorMessage(caught) });
      } finally {
        readAt = now().toISOString();
      }
    })();
    running = started.finally(() => {
      running = null;
      emit();
    });
    emit();
    return running;
  };

  const refresh = async (): Promise<SpaceRepositoriesState> => {
    if (disposed) return current();
    if (running === null) {
      await run();
      return current();
    }
    if (queued === null) {
      queued = running.then(() => {
        queued = null;
        return disposed ? undefined : run();
      });
    }
    await queued;
    return current();
  };

  const intervalMs = options.intervalMs ?? DEFAULT_REPOSITORY_REFRESH_MS;
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          void refresh();
        }, intervalMs)
      : null;
  timer?.unref?.();

  return {
    current,
    refresh,
    windowFocused() {
      void refresh();
    },
    readOnce() {
      if (!attempted) void refresh();
    },
    changed: emit,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearInterval(timer);
      listeners.clear();
    },
  };
}

/** The settings of the service: the interval. A test sets a short one. */
export type SpaceRepositoriesSettings = {
  intervalMs?: number;
  now?: () => Date;
};

let settings: SpaceRepositoriesSettings = {};

/** Replace the settings of services built from now on. `null` restores the defaults. */
export function configureSpaceRepositories(next: SpaceRepositoriesSettings | null): void {
  settings = next ?? {};
}

/** The repositories service of an open Space. */
export const spaceRepositories = defineSpaceService<SpaceRepositories>({
  id: 'repositories',
  create: (context: SpaceContext) => {
    const roots = context.service(spaceRoots);
    const service = createSpaceRepositories({
      runner: context.runner,
      roots: () => roots.running(),
      list: (held) => roots.list(held),
      log: context.log,
      space: context.key,
      ...settings,
    });
    // A root's file events change the changes line, not the branch or the remote: re-emit, don't re-read.
    let debounce: NodeJS.Timeout | null = null;
    const unsubscribe = roots.onFileEvent(() => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        service.changed();
      }, REPOSITORY_FILE_EVENT_DEBOUNCE_MS);
    });
    return {
      ...service,
      dispose() {
        if (debounce !== null) clearTimeout(debounce);
        unsubscribe();
        service.dispose();
      },
    };
  },
  dispose: (service) => service.dispose(),
});
