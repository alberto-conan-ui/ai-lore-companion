import { z } from 'zod';
import {
  type DashboardRefreshResult,
  type DashboardReportResult,
  SPACE_DASHBOARD_REPORT_CONTRACT,
} from '../../../shared/ipc/space/dashboard-report.contract.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import { spaceDashboardReport } from '../dashboard-report.js';
import type { SpaceIpcEvent } from '../host.js';
import { spaceSessions } from '../sessions/service.js';
import { parseArg } from './validate.js';

const emptySchema = z.strictObject({});
const refreshSchema = z.strictObject({
  reason: z.enum(['human', 'agent', 'verb', 'startup']),
});
const forwarded = new WeakSet<SpaceContext>();

function reportsFor(deps: Deps, event: SpaceIpcEvent) {
  const context = deps.space.contextFor(event);
  if (!context || deps.space.windowFor(event)?.init.mode !== 'space') return null;
  const reports = context.service(spaceDashboardReport);
  if (!forwarded.has(context)) {
    forwarded.add(context);
    reports.subscribe((state) =>
      deps.space.sendToSpace(
        context.root,
        SPACE_DASHBOARD_REPORT_CONTRACT.onSpaceDashboardReport.channel,
        state,
      ),
    );
  }
  return { context, reports };
}

/** A renderer can read reports only; only an authenticated live PM can publish one. */
export const registerSpaceDashboardReport: RegisterModule = (reg, deps) => {
  reg.handle('spaceDashboardReport', async (event, arg): Promise<DashboardReportResult> => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const found = reportsFor(deps, event);
    if (found === null)
      return {
        ok: false,
        error: { kind: 'not-a-space-window', message: 'PM reports belong to the Space window.' },
      };
    await found.reports.ready();
    return { ok: true, value: found.reports.read() };
  });

  reg.handle('spaceDashboardRefresh', async (event, arg): Promise<DashboardRefreshResult> => {
    const parsed = parseArg(refreshSchema, arg);
    if (!parsed.ok) return parsed;
    const found = reportsFor(deps, event);
    if (found === null)
      return {
        ok: false,
        error: {
          kind: 'not-a-space-window',
          message: 'Dashboard refresh belongs to the Space window.',
        },
      };
    try {
      // The session service owns the one refresh operation for both this button
      // and request_dashboard_update. It starts the guarded transient PM run;
      // this IPC handler only returns the shared state to the renderer.
      const requested = await found.context
        .service(spaceSessions)
        .requestDashboardUpdate(undefined, parsed.value.reason);
      if (requested.status === 'failed') {
        return {
          ok: false,
          error: {
            kind: 'refresh-failed',
            message: requested.message ?? 'The dashboard refresh failed.',
          },
        };
      }
      return { ok: true, value: found.reports.read() };
    } catch (caught) {
      return {
        ok: false,
        error: {
          kind: 'refresh-failed',
          message: `The dashboard could not refresh: ${caught instanceof Error ? caught.message : String(caught)}.`,
        },
      };
    }
  });
};
