import type { JSX } from 'react';
import type {
  DashboardPmComponentValue,
  DashboardPmPanel,
  DashboardReportState,
} from '../../../../../shared/ipc.js';
import { OverflowFooter, capItems } from './overflow.js';

export function pmValue(
  id: string,
  state: DashboardReportState | null,
): DashboardPmComponentValue | null {
  if (state?.report === null || state?.report === undefined) return null;
  if (state.definition === null || state.report.definitionHash !== state.definition.hash)
    return null;
  return state.report.components.find((value) => value.id === id) ?? null;
}

export function PmLine({
  id,
  state,
}: {
  id: string;
  state: DashboardReportState | null;
}): string | null {
  const value = pmValue(id, state);
  return value !== null && 'type' in value && value.type === 'text' ? value.text : null;
}

export function PMPanel({
  panel,
  reportState,
}: {
  panel: DashboardPmPanel;
  reportState: DashboardReportState | null;
}): JSX.Element | null {
  const value = pmValue(panel.id, reportState);
  if (value === null) return null;
  if ('unavailable' in value) {
    return (
      <article className="dashboard-v2-card dashboard-v2-pm-panel">
        <h3>{panel.title}</h3>
        <p>{value.reason}</p>
      </article>
    );
  }
  return (
    <article className="dashboard-v2-card dashboard-v2-pm-panel">
      <h3>{panel.title}</h3>
      {value.type === 'text' ? <p>{value.text}</p> : null}
      {value.type === 'metric' ? (
        <p className="dashboard-v2-pm-metric">
          {value.value} {value.unit ?? ''}
        </p>
      ) : null}
      {value.type === 'list' ? (
        <>
          <ul>
            {capItems(value.items, Math.min(panel.limit ?? value.items.length, 8)).visible.map(
              (item) => (
                <li key={item.id}>
                  {item.label}
                  {item.value === undefined ? '' : `: ${item.value}`}
                </li>
              ),
            )}
          </ul>
          <OverflowFooter
            hiddenCount={
              capItems(value.items, Math.min(panel.limit ?? value.items.length, 8)).hiddenCount
            }
            noun="items"
          />
        </>
      ) : null}
    </article>
  );
}
