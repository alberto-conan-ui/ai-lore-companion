/**
 * The ephemeral PM report of one open Space. A report is app state, never a
 * Space file: publishing it cannot claim a target or change a session's mode.
 */

import type {
  DashboardReport,
  DashboardReportState,
} from '../../shared/ipc/space/dashboard-report.types.js';
import { type SpaceContext, defineSpaceService } from './context.js';

/** The report data after the MCP tool has validated its text fields. */
export type DashboardReportInput = { markdown: string; basis?: string };

/** Why a report call could not change the app state. */
export type DashboardReportFailure = {
  kind: 'session-ended';
  message: string;
};

/** The in-memory report store of one Space. */
export type DashboardReportService = {
  /** Admit reports from this live PM session. */
  openSession(sessionId: string): void;
  /** Refuse later reports and stale the report when this was its source. */
  closeSession(sessionId: string): void;
  /** Accept one report from a live PM session. */
  publish(
    sessionId: string,
    input: DashboardReportInput,
  ): { ok: true; value: DashboardReport } | { ok: false; error: DashboardReportFailure };
  /** The report now, or none before the PM first reports. */
  read(): DashboardReportState;
  /** Mark the current report stale because the companion's Project source changed. */
  markProjectChanged(): void;
  /** Observe every replacement or stale transition. */
  subscribe(listener: (state: DashboardReportState) => void): () => void;
};

/** Build the store separately so the report lifecycle is headlessly testable. */
export function createDashboardReportService(
  options: { now?: () => Date } = {},
): DashboardReportService {
  const now = options.now ?? (() => new Date());
  const liveSessions = new Set<string>();
  const listeners = new Set<(state: DashboardReportState) => void>();
  let report: DashboardReport | null = null;
  let version = 0;

  const state = (): DashboardReportState => ({ version, report });
  const emit = (): void => {
    const next = state();
    for (const listener of listeners) listener(next);
  };
  const changed = (): void => {
    version += 1;
    emit();
  };

  return {
    openSession(sessionId) {
      liveSessions.add(sessionId);
    },
    closeSession(sessionId) {
      liveSessions.delete(sessionId);
      if (report?.sessionId !== sessionId || report.stale) return;
      report = { ...report, stale: true, staleReason: 'session-ended' };
      changed();
    },
    publish(sessionId, input) {
      if (!liveSessions.has(sessionId)) {
        return {
          ok: false,
          error: {
            kind: 'session-ended',
            message: 'This PM session has ended, so its dashboard report was not accepted.',
          },
        };
      }
      report = {
        markdown: input.markdown,
        basis: input.basis?.trim() || null,
        sessionId,
        receivedAt: now().toISOString(),
        stale: false,
        staleReason: null,
      };
      changed();
      return { ok: true, value: report };
    },
    read: state,
    markProjectChanged() {
      if (report === null || report.stale) return;
      report = { ...report, stale: true, staleReason: 'project-changed' };
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The dashboard report service of an open Space. It is disposed with its context. */
export const spaceDashboardReport = defineSpaceService<DashboardReportService>({
  id: 'dashboard-report',
  create: (_context: SpaceContext) => createDashboardReportService(),
});
