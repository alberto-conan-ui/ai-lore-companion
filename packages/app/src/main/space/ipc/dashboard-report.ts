import { z } from 'zod';
import {
  type DashboardReportResult,
  SPACE_DASHBOARD_REPORT_CONTRACT,
} from '../../../shared/ipc/space/dashboard-report.contract.js';
import type { RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import { spaceDashboardReport } from '../dashboard-report.js';
import { parseArg } from './validate.js';

const emptySchema = z.strictObject({});
const forwarded = new WeakSet<SpaceContext>();

/** A renderer can read reports only; only an authenticated live PM can publish one. */
export const registerSpaceDashboardReport: RegisterModule = (reg, deps) => {
  reg.handle('spaceDashboardReport', (event, arg): DashboardReportResult => {
    const parsed = parseArg(emptySchema, arg);
    if (!parsed.ok) return parsed;
    const context = deps.space.contextFor(event);
    if (!context || deps.space.windowFor(event)?.init.mode !== 'space')
      return {
        ok: false,
        error: { kind: 'not-a-space-window', message: 'PM reports belong to the Space window.' },
      };
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
    return { ok: true, value: reports.read() };
  });
};
