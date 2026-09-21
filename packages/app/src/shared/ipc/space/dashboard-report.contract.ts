import type { DashboardRefreshReason, DashboardReportState } from './dashboard-report.types.js';
import { invoke, push } from './describe.js';

export type DashboardReportResult =
  | { ok: true; value: DashboardReportState }
  | { ok: false; error: { kind: 'invalid-argument' | 'not-a-space-window'; message: string } };

export type DashboardRefreshArg = { reason: DashboardRefreshReason };

export type DashboardRefreshResult =
  | { ok: true; value: DashboardReportState }
  | {
      ok: false;
      error: {
        kind: 'invalid-argument' | 'not-a-space-window' | 'refresh-failed';
        message: string;
      };
    };

export const SPACE_DASHBOARD_REPORT_CONTRACT = {
  spaceDashboardReport: invoke<[arg: Record<string, never>], DashboardReportResult>(
    'space:dashboard-report',
  ),
  spaceDashboardRefresh: invoke<[arg: DashboardRefreshArg], DashboardRefreshResult>(
    'space:dashboard-refresh',
  ),
  onSpaceDashboardReport: push<DashboardReportState>('space:on-dashboard-report'),
} as const;
