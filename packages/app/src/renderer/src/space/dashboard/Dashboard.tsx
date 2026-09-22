import type { FocusCard } from '@ai-lore-companion/core';
import { type JSX, useEffect, useState } from 'react';
import { FocusSheet } from './FocusSheet.js';
import { StartSession } from './StartSession.js';
import { stateSentence } from './dashboardText.js';
import { relativeTime } from './format.js';
import { useDashboardDefinition } from './useDashboardDefinition.js';
import { useProjectState } from './useProjectState.js';
import { useRepositoriesState } from './useRepositoriesState.js';
import { DashboardContent } from './v2/DashboardContent.js';

/** The existing state hooks keep out-of-order pushes from replacing newer data. */
export function Dashboard({ justCreated = false }: { justCreated?: boolean } = {}): JSX.Element {
  const project = useProjectState();
  const repositories = useRepositoriesState();
  const dashboard = useDashboardDefinition();
  const [now, setNow] = useState(Date.now());
  const [focusUrl, setFocusUrl] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const state = dashboard.state;
  const model = project.project?.model;
  const focuses = [
    ...(model?.columns.flatMap((column) => column.focuses) ?? []),
    ...(model?.unstaged ?? []),
  ];
  const openFocus: FocusCard | null = focuses.find((focus) => focus.issue.url === focusUrl) ?? null;
  const refreshing =
    project.requested ||
    project.project?.refreshing === true ||
    repositories.requested ||
    dashboard.refreshing;
  const refresh = (): void => {
    project.refresh();
    repositories.refresh();
    dashboard.refresh();
  };
  const problem = project.problem ?? repositories.problem ?? dashboard.problem;
  const diagnostic = state?.definition?.diagnostic;
  const pm = state?.report;
  const showUpdate = Boolean(
    pm ||
      state?.definition?.source === 'packaged-default' ||
      ['requested', 'updating', 'failed'].includes(state?.refresh.status ?? 'idle'),
  );
  const boardUrl = project.project?.snapshot?.project.url;
  const header = (
    <>
      <div className="dashboard-v2-title-row">
        <div>
          <h1>Dashboard</h1>
          <p
            className="dashboard-v2-muted"
            data-testid="dashboard-state"
            data-state={project.project?.state ?? ''}
            data-refreshing={String(refreshing)}
          >
            <span data-testid="dashboard-state-name">{project.project?.state ?? 'Reading'}</span>
            {refreshing ? ' · refreshing' : ''}
            {project.project?.fetchedAt
              ? ` · read ${relativeTime(project.project.fetchedAt, now)}`
              : ''}
            {showUpdate ? ' · ' : ''}
            <span
              className="dashboard-v2-muted"
              aria-live="polite"
              data-testid="dashboard-refresh-status"
              data-refresh-status={state?.refresh.status ?? 'idle'}
            >
              {state?.refresh.status === 'requested' || state?.refresh.status === 'updating'
                ? 'Updating dashboard data.'
                : state?.refresh.status === 'failed'
                  ? 'Dashboard update failed.'
                  : pm
                    ? `Updated ${relativeTime(pm.receivedAt, now)}${pm.stale ? ' · interpretation may be out of date' : ''}`
                    : ''}
              {state?.definition?.source === 'packaged-default'
                ? ' Using the packaged default dashboard definition.'
                : ''}
            </span>
          </p>
        </div>
        <div className="dashboard-v2-header-actions">
          <button
            type="button"
            data-testid="dashboard-refresh"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((value) => !value)}
          >
            Details
          </button>
          <StartSession justCreated={justCreated} />
        </div>
      </div>

      {problem ? (
        <p role="alert" data-testid="dashboard-problem">
          {problem}
        </p>
      ) : null}
      {diagnostic ? (
        <p role="alert" data-testid="dashboard-definition-diagnostic">
          {diagnostic.message} Showing a valid fallback definition.
        </p>
      ) : null}
      {state !== null && state.definition === null ? (
        <p role="alert" data-testid="dashboard-definition-diagnostic">
          No valid dashboard definition is available.
        </p>
      ) : null}
      {state?.refresh.failure ? (
        <p role="alert" data-testid="dashboard-refresh-failure">
          {state.refresh.failure.message} Previous accepted dashboard data is retained.
        </p>
      ) : null}
      {details ? (
        <div className="dashboard-v2-details" data-testid="dashboard-details">
          {project.project ? (
            <p data-testid="dashboard-state-sentence">{stateSentence(project.project, now)}</p>
          ) : null}
          {pm ? (
            <>
              <p>
                Accepted {new Date(pm.receivedAt).toLocaleString()} from {pm.sessionId}.
              </p>
              <p>{pm.basis ? `Sources named by PM: ${pm.basis}` : 'No sources were named.'}</p>
            </>
          ) : (
            <p>No PM interpretation has been accepted.</p>
          )}
          {state?.context?.problems.map((entry, index) => (
            <p key={`${entry.kind}-${index}`}>{entry.message}</p>
          ))}
        </div>
      ) : null}
    </>
  );
  return (
    <div className="dashboard-v2-host" data-testid="dashboard">
      <DashboardContent
        project={project.project}
        repositories={repositories.repositories}
        reportState={state}
        now={now}
        header={header}
        onOpenFocus={(focus) => setFocusUrl(focus.issue.url)}
        onOpenBoard={
          boardUrl
            ? () => {
                void window.cockpit.urlOpenExternal(boardUrl);
              }
            : undefined
        }
      />
      {openFocus ? <FocusSheet focus={openFocus} onClose={() => setFocusUrl(null)} /> : null}
    </div>
  );
}
