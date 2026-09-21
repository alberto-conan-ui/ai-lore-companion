/**
 * The typed, ephemeral dashboard state of one open Space.
 *
 * Lore and Workbench are read-only inputs. A successful PM submission changes
 * app memory only; it cannot claim a target, alter a session mode or write a
 * payload. The request lifecycle is deliberately exposed as a small port so
 * the guarded transient PM runner can own process startup and cleanup.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SessionRecord } from '@ai-lore-companion/core';
import { listSessions } from '@ai-lore-companion/core';
import type {
  DashboardCompanionComponentDefinition,
  DashboardDefinitionDiagnostic,
  DashboardRefreshReason,
  DashboardRefreshState,
  DashboardReport,
  DashboardReportInput,
  DashboardReportState,
  DashboardWorkbenchSnapshot,
  ResolvedDashboardDefinition,
} from '../../shared/ipc/space/dashboard-report.types.js';
import type { SpaceContext } from './context.js';
import { defineSpaceService } from './context.js';
import {
  type DashboardDefinitionReadOptions,
  readDashboardDefinition,
  validateDashboardReport,
} from './dashboard-definition.js';
import { readDashboardWorkbench } from './dashboard-workbench.js';
import { spaceDesk } from './desk-service.js';

export type DashboardReportFailure = {
  kind:
    | 'session-ended'
    | 'definition-unavailable'
    | 'invalid-report'
    | 'request-mismatch'
    | 'request-not-found';
  message: string;
};

export type DashboardRefreshRequest = {
  requestId: string;
  reason: DashboardRefreshReason;
  requestedAt: string;
  definitionHash: string | null;
};

export type DashboardRequestResult = {
  request: DashboardRefreshRequest;
  coalesced: boolean;
};

export type DashboardContextSnapshot = DashboardWorkbenchSnapshot;

export type DashboardReportService = {
  /** The effective definition accepted for this open Space, or null while loading/invalid. */
  definition(): ResolvedDashboardDefinition | null;
  /** Current state; this is synchronous and never performs filesystem I/O. */
  read(): DashboardReportState;
  /** Current factual context; use refreshContext to re-read the Workbench. */
  readContext(): DashboardContextSnapshot | null;
  /** Read context for a conversational PM and bind that session to this source generation. */
  readContextForSession(sessionId: string): DashboardContextSnapshot | null;
  /** Complete initial definition loading and refresh the Workbench snapshot. */
  ready(): Promise<DashboardReportState>;
  refreshContext(): Promise<DashboardReportState>;
  /** Admit/refuse a report source session. */
  openSession(sessionId: string, requestId?: string): void;
  closeSession(sessionId: string, options?: { preserveReport?: boolean }): void;
  publish(
    sessionId: string,
    input: unknown,
  ): { ok: true; value: DashboardReport } | { ok: false; error: DashboardReportFailure };
  /** Ask the refresh runner to create a transient PM run. */
  request(reason: DashboardRefreshReason): DashboardRequestResult;
  attachRequest(requestId: string, sessionId: string): boolean;
  beginRequest(requestId: string): boolean;
  failRequest(requestId: string, error: { kind: string; message: string }): boolean;
  markSourcesChanged(reason: 'project' | 'workbench' | 'definition'): void;
  /** Backwards-compatible name used by the Project refresh service. */
  markProjectChanged(): void;
  subscribe(listener: (state: DashboardReportState) => void): () => void;
  /** Stop source polling and release listeners when the Space closes. */
  dispose(): void;
};

export type DashboardReportServiceOptions = {
  definition?: DashboardDefinitionReadOptions;
  workbenchRoot?: string;
  sessions?: () => readonly SessionRecord[];
  now?: () => Date;
  onRequest?: (request: DashboardRefreshRequest) => void;
  /** Source poll cadence. Zero disables polling; production supplies a bounded cadence. */
  pollIntervalMs?: number;
};

function failure(
  kind: DashboardReportFailure['kind'],
  message: string,
): { ok: false; error: DashboardReportFailure } {
  return { ok: false, error: { kind, message } };
}

function isTypedReportInput(
  value: unknown,
): value is Extract<DashboardReportInput, { definitionHash: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { definitionHash?: unknown }).definitionHash === 'string' &&
    Array.isArray((value as { components?: unknown }).components)
  );
}

function sourceFingerprint(snapshot: DashboardWorkbenchSnapshot): string {
  return JSON.stringify({
    documents: snapshot.documents,
    handovers: snapshot.handovers,
    problems: snapshot.problems,
    // A transient refresh session is process plumbing and must not stale the result it produces.
    activity: snapshot.activity.filter(
      (session) => session.purpose !== 'dashboard-refresh' && session.purpose !== 'pm-refresh',
    ),
  });
}

export function createDashboardReportService(
  options: DashboardReportServiceOptions,
): DashboardReportService {
  const now = options.now ?? (() => new Date());
  const definitionOptions = options.definition ?? { spaceRoot: process.cwd() };
  const workbenchRoot = options.workbenchRoot ?? join(definitionOptions.spaceRoot, 'workbench');
  const listeners = new Set<(state: DashboardReportState) => void>();
  const liveSessions = new Map<string, { requestId?: string; generation: number }>();
  let currentDefinition: ResolvedDashboardDefinition | null = null;
  let definitionFailure: DashboardDefinitionDiagnostic | null = null;
  let context: DashboardWorkbenchSnapshot | null = null;
  let contextFingerprint = '';
  let report: DashboardReport | null = null;
  let refresh: DashboardRefreshState = {
    status: 'idle',
    requestId: null,
    reason: null,
    requestedAt: null,
    failure: null,
  };
  let pending: DashboardRefreshRequest | null = null;
  let version = 0;
  let contextRefreshPromise: Promise<DashboardReportState> | null = null;
  let initialReady: Promise<DashboardReportState> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let sourceGeneration = 0;

  const state = (): DashboardReportState => ({
    version,
    definition: currentDefinition,
    context,
    report,
    refresh,
  });
  const emit = (): void => {
    version += 1;
    const next = state();
    for (const listener of listeners) listener(next);
  };

  const sessions = (): readonly SessionRecord[] => {
    if (options.sessions) return options.sessions();
    return [];
  };

  const loadDefinition = async (): Promise<void> => {
    const loaded = await readDashboardDefinition(definitionOptions);
    if (loaded.ok) {
      // A malformed higher-priority override must not replace a definition
      // already accepted for this open Space. Keep the old hash for PM
      // correlation, while exposing the diagnostic on the state.
      if (loaded.value.diagnostic !== null && currentDefinition !== null) {
        currentDefinition = { ...currentDefinition, diagnostic: loaded.value.diagnostic };
        definitionFailure = loaded.value.diagnostic;
        return;
      }
      if (currentDefinition?.hash !== loaded.value.hash && report !== null) {
        report = { ...report, stale: true, staleReason: 'definition-changed' };
      }
      currentDefinition = loaded.value;
      definitionFailure = loaded.value.diagnostic;
    } else {
      definitionFailure = loaded.error;
      if (currentDefinition !== null)
        currentDefinition = { ...currentDefinition, diagnostic: loaded.error };
    }
  };

  const refreshContextImpl = async (): Promise<DashboardReportState> => {
    if (disposed) return state();
    const previousDefinitionIdentity =
      currentDefinition === null
        ? null
        : JSON.stringify({
            hash: currentDefinition.hash,
            source: currentDefinition.source,
            path: currentDefinition.path,
            diagnostic: currentDefinition.diagnostic,
          });
    await loadDefinition();
    const hadContext = context !== null;
    const definitionIdentity =
      currentDefinition === null
        ? null
        : JSON.stringify({
            hash: currentDefinition.hash,
            source: currentDefinition.source,
            path: currentDefinition.path,
            diagnostic: currentDefinition.diagnostic,
          });
    const definitionChanged = previousDefinitionIdentity !== definitionIdentity;
    const workbenchComponents = currentDefinition?.definition.components.filter(
      (component): component is DashboardCompanionComponentDefinition =>
        component.source === 'companion' && component.type === 'workbench-docs',
    );
    const handoverComponents = currentDefinition?.definition.components.filter(
      (component): component is DashboardCompanionComponentDefinition =>
        component.source === 'companion' && component.type === 'handovers',
    );
    const scanLimit = Math.max(
      ...(workbenchComponents ?? []).map((component) => component.limit ?? 10),
      ...(handoverComponents ?? []).map((component) => component.limit ?? 10),
      10,
    );
    const workbench = await readDashboardWorkbench({
      workbenchRoot,
      sessions: sessions(),
      recentDays:
        workbenchComponents === undefined || workbenchComponents.length === 0
          ? undefined
          : Math.max(...workbenchComponents.map((component) => component.recentDays ?? 14)),
      limit: scanLimit,
      windows: workbenchComponents?.map((component) => ({
        recentDays: component.recentDays ?? 14,
        limit: component.limit ?? 10,
      })),
      now,
    });
    const nextFingerprint = sourceFingerprint(workbench);
    const contextChanged = contextFingerprint !== nextFingerprint;
    if (hadContext && (contextChanged || definitionChanged)) sourceGeneration += 1;
    if (context !== null && contextChanged && report !== null && !report.stale) {
      report = { ...report, stale: true, staleReason: 'workbench-changed' };
    }
    context = workbench;
    contextFingerprint = nextFingerprint;
    // The first read returns the complete initial state directly. Avoid a
    // duplicate push to a renderer that subscribed before that read; later
    // refreshes are observable events.
    if (hadContext && (contextChanged || definitionChanged)) emit();
    return state();
  };

  const refreshContext = (): Promise<DashboardReportState> => {
    contextRefreshPromise ??= refreshContextImpl().finally(() => {
      contextRefreshPromise = null;
    });
    return contextRefreshPromise;
  };

  const pollIntervalMs = options.pollIntervalMs ?? 0;
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(
      () => {
        void refreshContext().catch(() => {
          // A transient filesystem read failure is represented by the next
          // successful snapshot; polling must never create an unhandled error.
        });
      },
      Math.max(250, Math.floor(pollIntervalMs)),
    );
    // A background source poll must not keep a headless process alive while
    // its Space is otherwise closed.
    pollTimer.unref?.();
  }

  const ready = async (): Promise<DashboardReportState> => {
    if (initialReady === null) {
      initialReady = refreshContext().catch(() => state());
      return initialReady;
    }
    return refreshContext();
  };

  const request = (reason: DashboardRefreshReason): DashboardRequestResult => {
    if (pending !== null) return { request: pending, coalesced: true };
    const requestValue: DashboardRefreshRequest = {
      requestId: randomUUID(),
      reason,
      requestedAt: now().toISOString(),
      definitionHash: currentDefinition?.hash ?? null,
    };
    pending = requestValue;
    refresh = {
      status: 'requested',
      requestId: requestValue.requestId,
      reason,
      requestedAt: requestValue.requestedAt,
      failure: null,
    };
    emit();
    options.onRequest?.(requestValue);
    return { request: requestValue, coalesced: false };
  };

  const attachRequest = (requestId: string, sessionId: string): boolean => {
    if (pending?.requestId !== requestId) return false;
    liveSessions.set(sessionId, { requestId, generation: sourceGeneration });
    refresh = { ...refresh, status: 'updating' };
    emit();
    return true;
  };

  const beginRequest = (requestId: string): boolean => {
    if (pending?.requestId !== requestId) return false;
    refresh = { ...refresh, status: 'updating' };
    emit();
    return true;
  };

  const failRequest = (requestId: string, error: { kind: string; message: string }): boolean => {
    if (pending?.requestId !== requestId) return false;
    pending = null;
    refresh = { ...refresh, status: 'failed', failure: error };
    emit();
    return true;
  };

  const service: DashboardReportService = {
    definition: () => currentDefinition,
    read: state,
    readContext: () => context,
    readContextForSession(sessionId) {
      const live = liveSessions.get(sessionId);
      if (live !== undefined && live.requestId === undefined) live.generation = sourceGeneration;
      return context;
    },
    ready,
    refreshContext,
    openSession(sessionId, requestId) {
      liveSessions.set(sessionId, {
        ...(requestId === undefined ? {} : { requestId }),
        generation: sourceGeneration,
      });
    },
    closeSession(sessionId, options) {
      liveSessions.delete(sessionId);
      if (
        options?.preserveReport !== true &&
        report !== null &&
        report.sessionId === sessionId &&
        !report.stale
      ) {
        report = { ...report, stale: true, staleReason: 'session-ended' };
        emit();
      }
    },
    publish(sessionId, input: unknown) {
      const live = liveSessions.get(sessionId);
      const requestId = live?.requestId;
      if (live === undefined)
        return failure(
          'session-ended',
          'This PM session has ended, so its dashboard data was not accepted.',
        );
      if (currentDefinition === null)
        return failure(
          'definition-unavailable',
          definitionFailure?.message ?? 'The effective dashboard definition is unavailable.',
        );
      if (requestId !== undefined && pending?.requestId !== requestId)
        return failure(
          'request-mismatch',
          'This dashboard refresh is no longer the current request.',
        );
      if (requestId !== undefined && pending?.definitionHash !== currentDefinition.hash)
        return failure('request-mismatch', 'The dashboard definition changed during this refresh.');
      if (!isTypedReportInput(input))
        return failure(
          'invalid-report',
          'The PM must submit typed dashboard components, not a Markdown report.',
        );
      if (requestId !== undefined && input.definitionHash !== pending?.definitionHash)
        return failure(
          'request-mismatch',
          'This PM response belongs to an older refresh generation.',
        );
      if (requestId === undefined && live.generation < sourceGeneration)
        return failure(
          'request-mismatch',
          'This PM response was prepared before the dashboard source changed.',
        );
      const checked = validateDashboardReport(currentDefinition, input);
      if (!checked.ok) return failure('invalid-report', checked.error.message);
      if (requestId !== undefined && checked.value.definitionHash !== pending?.definitionHash)
        return failure(
          'request-mismatch',
          'The PM response belongs to a different refresh definition.',
        );
      report = {
        components: checked.value.components,
        definitionHash: checked.value.definitionHash,
        basis: checked.value.basis?.trim() || null,
        sessionId,
        receivedAt: now().toISOString(),
        stale: false,
        staleReason: null,
      };
      if (requestId !== undefined && pending?.requestId === requestId) {
        pending = null;
        refresh = { ...refresh, status: 'updated', failure: null };
      }
      emit();
      return { ok: true, value: report };
    },
    request,
    attachRequest,
    beginRequest,
    failRequest,
    markSourcesChanged(reason) {
      sourceGeneration += 1;
      if (report === null || report.stale) return;
      report = {
        ...report,
        stale: true,
        staleReason:
          reason === 'project'
            ? 'project-changed'
            : reason === 'definition'
              ? 'definition-changed'
              : 'workbench-changed',
      };
      emit();
    },
    markProjectChanged() {
      service.markSourcesChanged('project');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
      listeners.clear();
    },
  };

  void ready();
  return service;
}

/** The dashboard report service of an open Space. It is disposed with its context. */
export const spaceDashboardReport = defineSpaceService<DashboardReportService>({
  id: 'dashboard-report',
  create: (context: SpaceContext) => {
    const desk = context.service(spaceDesk);
    return createDashboardReportService({
      definition: { spaceRoot: context.root },
      workbenchRoot: context.paths.workbench,
      pollIntervalMs: 2_000,
      sessions: () => {
        const opened = desk.open();
        if (!opened.ok) return [];
        const listed = listSessions(opened.value);
        return listed.ok ? listed.value : [];
      },
    });
  },
  dispose: (service) => service.dispose(),
});
