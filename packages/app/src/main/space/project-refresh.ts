/**
 * The refresh of a Space's GitHub Project (architecture document, section
 * 5.11). Phase M7.1.
 *
 * One refresh service per Space, kept as a service of its context. It reads
 * the Project on a timer, when a window of the Space gains focus, and on
 * demand, and keeps what it read in the desk's `project-cache.json`.
 *
 * - One refresh at a time. A request made while one runs is served by one
 *   more run after it; every request made during the same run shares it.
 * - A refresh that fails (unreachable, rate-limited, a Project not found)
 *   keeps the cached snapshot and records the failure with its time. The
 *   state says `offline` for unreachable and `stale` for the other failures.
 * - A Project that was deleted or renamed on GitHub is not found by the
 *   Space's name and number; the failure says so in words.
 * - Every change of state goes to the subscribers, which the IPC module
 *   forwards to the windows of this Space only.
 *
 * This file imports nothing from Electron, so a headless test drives it.
 */

import {
  DEFAULT_STALE_AFTER_MS,
  type DashboardGate,
  type Desk,
  type DeskFailure,
  type GitHubError,
  type GitHubPort,
  type ProjectCache,
  type ProjectCacheFailure,
  type ProjectInfo,
  type ProjectSnapshot,
  type Result,
  type SessionRecord,
  type SpaceManifest,
  dashboardModel,
  describeGitHubFailure,
  findSpaceProject,
  listSessions,
  readProjectCache,
  recordProjectFailure,
  recordProjectSnapshot,
} from '@ai-lore-companion/core';
import type { SpaceProjectState } from '../../shared/ipc.js';
import { type SpaceContext, defineSpaceService } from './context.js';
import { spaceDashboardReport } from './dashboard-report.js';
import { spaceDesk } from './desk-service.js';
import { spaceGitHub } from './github-service.js';
import type { SpaceLog } from './log.js';
import { sessionServer } from './session-server/index.js';

/** The refresh interval: five minutes (a proposal of the architecture document; a setting). */
export const DEFAULT_PROJECT_REFRESH_MS = 5 * 60 * 1000;

/** What a refresh service is built from. */
export type ProjectRefreshOptions = {
  github: () => Promise<GitHubPort>;
  manifest: () => SpaceManifest;
  desk: () => Result<Desk, DeskFailure>;
  /** The gates that wait now. */
  gates: () => DashboardGate[];
  now?: () => Date;
  /** Default `DEFAULT_PROJECT_REFRESH_MS`. `0` starts no timer. */
  intervalMs?: number;
  /** Default `DEFAULT_STALE_AFTER_MS`. */
  staleAfterMs?: number;
  log?: SpaceLog;
  /** Named in the log lines. */
  space?: string;
};

/** The refresh service of one Space. */
export type ProjectRefresh = {
  /** The state now, with the model computed from the cache, the desk and the gates. */
  current(): SpaceProjectState;
  /** Refresh; resolves with the state after the run that serves this request. */
  refresh(): Promise<SpaceProjectState>;
  /** A window of the Space gained focus. */
  windowFocused(): void;
  /** Start a first refresh when none has run yet for this Space in this run of the app. */
  readOnce(): void;
  /** Something the model reads besides the snapshot changed (a gate): tell the subscribers. */
  changed(): void;
  subscribe(listener: (state: SpaceProjectState) => void): () => void;
  /** Stop the timer; later requests do nothing. */
  dispose(): void;
};

/** Build a refresh service. The timer starts now. */
export function createProjectRefresh(options: ProjectRefreshOptions): ProjectRefresh {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const listeners = new Set<(state: SpaceProjectState) => void>();
  const fields = options.space === undefined ? {} : { space: options.space };
  let cache: ProjectCache | null = null;
  let succeeded = false;
  let project: ProjectInfo | null = null;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let disposed = false;
  let attempted = false;
  /** The `version` of the last state given; each state gets the next number. */
  let version = 0;

  const loaded = (): ProjectCache => {
    if (cache !== null) return cache;
    const desk = options.desk();
    const read = desk.ok ? readProjectCache(desk.value) : desk;
    if (!read.ok) {
      options.log?.warn('project-cache-not-read', { ...fields, kind: read.error.kind });
      cache = { snapshot: null, failure: null };
    } else {
      cache = read.value;
    }
    return cache;
  };

  const sessions = (): SessionRecord[] => {
    const desk = options.desk();
    if (!desk.ok) return [];
    const listed = listSessions(desk.value);
    return listed.ok ? listed.value : [];
  };

  const current = (): SpaceProjectState => {
    const { snapshot, failure } = loaded();
    const state: SpaceProjectState['state'] =
      failure === null
        ? succeeded
          ? 'fresh'
          : 'stale'
        : failure.kind === 'unreachable'
          ? 'offline'
          : 'stale';
    version += 1;
    return {
      version,
      snapshot,
      fetchedAt: snapshot?.fetchedAt ?? null,
      state,
      failure,
      refreshing: running !== null,
      model:
        snapshot === null
          ? null
          : dashboardModel({
              snapshot,
              sessions: sessions(),
              gates: options.gates(),
              now: now().toISOString(),
              staleAfterMs,
            }),
    };
  };

  const emit = (): void => {
    if (disposed || listeners.size === 0) return;
    const state = current();
    for (const listener of listeners) listener(state);
  };

  /**
   * Keep the cache in memory, and on the desk when it can be written. A run
   * that ends after the Space closed writes nothing: the desk may be released.
   */
  const keep = (
    write: (desk: Desk) => Result<ProjectCache, DeskFailure>,
    next: ProjectCache,
  ): void => {
    if (disposed) return;
    cache = next;
    const desk = options.desk();
    const written = desk.ok ? write(desk.value) : desk;
    if (!written.ok) {
      options.log?.warn('project-cache-not-written', { ...fields, kind: written.error.kind });
    }
  };

  const failed = (
    error: GitHubError | { kind: 'not-found'; message: string },
    text: string,
  ): void => {
    const failure: ProjectCacheFailure = {
      kind: error.kind,
      message: text,
      at: now().toISOString(),
    };
    succeeded = false;
    keep((desk) => recordProjectFailure(desk, failure), { snapshot: loaded().snapshot, failure });
    options.log?.info('project-refresh-failed', { ...fields, kind: error.kind });
  };

  const read = async (): Promise<void> => {
    const manifest = options.manifest();
    const repository = manifest.github.repository;
    if (repository === '') {
      failed(
        { kind: 'not-found', message: '' },
        'The Space has no GitHub repository in its manifest, so it has no Project to read.',
      );
      return;
    }
    const github = await options.github();
    if (project === null) {
      const found = await findSpaceProject(github, {
        repository,
        name: manifest.name,
        project: manifest.github.project,
      });
      if (!found.ok) {
        failed(
          found.error,
          found.error.kind === 'not-found'
            ? `The Project "${manifest.name}"${manifest.github.project > 0 ? ` with the number ${manifest.github.project}` : ''} of ${repository.split('/')[0] ?? ''} was not found on GitHub. It may have been deleted or renamed. The Dashboard shows the cache as it was.`
            : `${describeGitHubFailure(found.error)}.`,
        );
        return;
      }
      project = found.value;
    }
    const snapshot = await github.readProject({ project });
    if (!snapshot.ok) {
      if (snapshot.error.kind === 'not-found') {
        const gone = project;
        project = null;
        failed(
          snapshot.error,
          `The Project "${gone.title}" (number ${gone.number}) of ${gone.owner} was not found on GitHub. It may have been deleted. The Dashboard shows the cache as it was.`,
        );
      } else {
        failed(snapshot.error, `${describeGitHubFailure(snapshot.error)}.`);
      }
      return;
    }
    succeeded = true;
    const value: ProjectSnapshot = snapshot.value;
    keep((desk) => recordProjectSnapshot(desk, value), { snapshot: value, failure: null });
  };

  const run = (): Promise<void> => {
    attempted = true;
    const started = (async () => {
      try {
        await read();
      } catch (caught) {
        failed(
          { kind: 'failed', message: '' },
          `The Project could not be read: ${caught instanceof Error ? caught.message : String(caught)}.`,
        );
      }
    })();
    running = started.finally(() => {
      running = null;
      emit();
    });
    emit();
    return running;
  };

  const refresh = async (): Promise<SpaceProjectState> => {
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

  const intervalMs = options.intervalMs ?? DEFAULT_PROJECT_REFRESH_MS;
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

/** The settings of the refresh: the interval and the stale threshold. A test sets short ones. */
export type ProjectRefreshSettings = {
  intervalMs?: number;
  staleAfterMs?: number;
  now?: () => Date;
};

let settings: ProjectRefreshSettings = {};

/** Replace the settings of services built from now on. `null` restores the defaults. */
export function configureProjectRefresh(next: ProjectRefreshSettings | null): void {
  settings = next ?? {};
}

/** The pending gates of the Space's dialog broker, as the model takes them. */
function pendingGates(context: SpaceContext): DashboardGate[] {
  const gates: DashboardGate[] = [];
  for (const request of context.service(sessionServer).broker.pending()) {
    if (request.kind !== 'gate') continue;
    const { ticket, sessionId, askedAt, process, step, question } = request;
    gates.push({ ticket, sessionId, askedAt, process, step, question });
  }
  return gates;
}

/** The refresh service of an open Space. */
export const spaceProjectRefresh = defineSpaceService<ProjectRefresh>({
  id: 'project-refresh',
  create: (context) => {
    const desk = context.service(spaceDesk);
    const github = context.service(spaceGitHub);
    const broker = context.service(sessionServer).broker;
    const refresh = createProjectRefresh({
      github: () => github.port(),
      manifest: () => context.manifest,
      desk: () => desk.open(),
      gates: () => pendingGates(context),
      log: context.log,
      space: context.key,
      ...settings,
    });
    // Freshness belongs to the source lifecycle, not to whether a Dashboard has
    // subscribed to reports yet. Ordinary reads/version increments do not stale prose.
    const reports = context.service(spaceDashboardReport);
    const initial = refresh.current();
    let source = `${initial.fetchedAt}|${initial.state}|${initial.failure?.at ?? ''}`;
    refresh.subscribe((state) => {
      const next = `${state.fetchedAt}|${state.state}|${state.failure?.at ?? ''}`;
      if (source !== next) reports.markProjectChanged();
      source = next;
    });
    // A gate that begins or ends waiting changes Needs you and the gate notes.
    const unsubscribe = broker.subscribe((event) => {
      if ('request' in event && event.request.kind === 'gate') refresh.changed();
    });
    return {
      ...refresh,
      dispose() {
        unsubscribe();
        refresh.dispose();
      },
    };
  },
  dispose: (service) => service.dispose(),
});
