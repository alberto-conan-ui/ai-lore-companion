/**
 * The PM's plain-text dashboard report. It is not the Project snapshot: the
 * companion keeps that source of truth separately and marks this report stale
 * when its source session ends or the Project changes.
 */

/** The largest report a PM may return in one MCP tool call. */
export const DASHBOARD_REPORT_MAX_CHARS = 24 * 1024;

/** The largest optional description of the material the PM says it used. */
export const DASHBOARD_REPORT_BASIS_MAX_CHARS = 1024;

/** A report as the companion received it. `basis` is an agent statement, not trusted freshness. */
export type DashboardReport = {
  markdown: string;
  basis: string | null;
  sessionId: string;
  receivedAt: string;
  stale: boolean;
  staleReason: 'session-ended' | 'project-changed' | null;
};

/** The one report the Dashboard shows for an open Space. */
export type DashboardReportState = {
  version: number;
  report: DashboardReport | null;
};
