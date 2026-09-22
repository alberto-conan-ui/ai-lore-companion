import type { FocusCard, NextAction } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import type {
  DashboardCompanionPanel,
  DashboardPanel,
  DashboardReportState,
  DashboardWorkbenchDocument,
  SpaceProjectState,
  SpaceRepositoriesState,
} from '../../../../../shared/ipc.js';
import { openDialogTicket } from '../../dialogs/useDialogQueue.js';
import { useSpaceNavStore } from '../../window/spaceNavStore.js';
import { relativeTime } from '../format.js';
import { PMPanel, PmLine, pmValue } from './PMPanel.js';
import { OverflowFooter, capItems } from './overflow.js';

export type BandNeedsYouProps = {
  panels: readonly DashboardPanel[];
  project: SpaceProjectState | null;
  reportState: DashboardReportState | null;
  repositories: SpaceRepositoriesState | null;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
};

export function BandNeedsYou({
  panels,
  project,
  reportState,
  repositories,
  now,
  onOpenFocus,
}: BandNeedsYouProps): JSX.Element {
  const nextAction = project?.nextActions[0] ?? null;
  const documents = reportState?.context?.documents ?? [];
  const gatesOpen =
    project?.model === null || project?.model === undefined
      ? (project?.nextActions.filter((entry) => entry.kind === 'gate').length ?? 0)
      : project.model.needsYou.filter((entry) => entry.kind === 'gate').length;
  const reviewsPending =
    project?.nextActions.filter((entry) => entry.kind === 'review').length ?? 0;
  const cards = panels.map((panel) => {
    if (panel.source === 'pm')
      return <PMPanel key={panel.id} panel={panel} reportState={reportState} />;
    return renderCompanionPanel({
      panel,
      documents,
      nextAction,
      project,
      repositories,
      reportState,
      now,
      onOpenFocus,
    });
  });
  const hasCard = cards.some((card) => card !== null);
  const cardCount = cards.filter((card) => card !== null).length;
  return (
    <section className="dashboard-v2-band-needs-you" data-testid="dashboard-v2-needs-you">
      <div className="dashboard-v2-band-heading">
        <h2>NEEDS YOU</h2>
        <span className="dashboard-v2-clear">
          {nextAction === null && documents.length === 0 ? '✓ NOTHING NEEDS YOU · ' : ''}
          {reviewsPending} REVIEWS PENDING · {gatesOpen} GATES OPEN
        </span>
      </div>
      {hasCard ? (
        <div className={`dashboard-v2-band1-cards count-${Math.min(cardCount, 3)}`}>{cards}</div>
      ) : null}
    </section>
  );
}

/** The Space's Project on GitHub, which is where a problem with it is fixed. */
function openProject(project: SpaceProjectState | null): void {
  const url = project?.snapshot?.project.url;
  if (url !== undefined) void window.cockpit.urlOpenExternal(url);
}

function renderCompanionPanel(input: {
  panel: DashboardCompanionPanel;
  documents: readonly DashboardWorkbenchDocument[];
  nextAction: NextAction | null;
  project: SpaceProjectState | null;
  repositories: SpaceRepositoriesState | null;
  reportState: DashboardReportState | null;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
}): JSX.Element | null {
  const { panel, documents, nextAction, project, repositories, reportState, now, onOpenFocus } =
    input;
  if (panel.kind === 'next-action') {
    return nextAction === null ? null : (
      <NextActionCard
        key={panel.id}
        action={nextAction}
        pmLine={
          panel.pmLine === undefined ? null : PmLine({ id: panel.pmLine.id, state: reportState })
        }
        project={project}
        onOpenFocus={onOpenFocus}
      />
    );
  }
  if (panel.kind === 'review-documents') {
    const recentDays = panel.recentDays;
    const recent =
      recentDays === undefined
        ? documents
        : documents.filter(
            (document) => now - Date.parse(document.timestamp) <= recentDays * 24 * 60 * 60 * 1000,
          );
    if (recent.length === 0) return null;
    const ordered = orderDocuments(recent, panel.order);
    const rows = capItems(ordered, Math.min(panel.limit ?? 3, 3));
    return (
      <DraftsCard key={panel.id} drafts={rows.visible} hiddenCount={rows.hiddenCount} now={now} />
    );
  }
  const row = repositories?.model?.rows.find((candidate) => candidate.kind === 'publish-area');
  return row === undefined ? null : <PublishCard key={panel.id} row={row} />;
}

function orderDocuments(
  documents: readonly DashboardWorkbenchDocument[],
  order: DashboardCompanionPanel['order'],
): DashboardWorkbenchDocument[] {
  return [...documents].sort((a, b) => {
    const left = Date.parse(a.timestamp);
    const right = Date.parse(b.timestamp);
    return order === 'oldest' ? left - right : right - left;
  });
}

function findFocus(
  project: SpaceProjectState | null,
  repository: string,
  number: number,
): FocusCard | null {
  const focuses =
    project === null
      ? []
      : [
          ...project.moving.inProgress,
          ...project.moving.queued,
          ...project.moving.dormant,
          ...project.moving.done,
        ];
  return (
    focuses.find(
      (focus) => focus.issue.repository === repository && focus.issue.number === number,
    ) ?? null
  );
}

function NextActionCard({
  action,
  pmLine,
  project,
  onOpenFocus,
}: {
  action: NextAction;
  pmLine: string | null;
  project: SpaceProjectState | null;
  onOpenFocus: (focus: FocusCard) => void;
}): JSX.Element {
  const showScreen = useSpaceNavStore((state) => state.showScreen);
  const broken = action.kind === 'failing-pull-request';
  const openPrimary = (): void => {
    if (action.kind === 'gate') openDialogTicket(action.ticket);
    // The Done call is made on the focus, so it opens the focus, as a review does.
    else if (action.kind === 'review' || action.kind === 'ready-for-done') {
      const focus = findFocus(project, action.focus.repository, action.focus.number);
      if (focus === null) void window.cockpit.urlOpenExternal(action.focus.url);
      else onOpenFocus(focus);
    } else if (action.kind === 'draft')
      void window.cockpit.spaceNavigate({
        to: 'space-files',
        open: { rootId: 'workbench', relPath: action.path },
      });
    else if (action.kind === 'failing-pull-request')
      void window.cockpit.urlOpenExternal(action.pull.url);
    // A problem with the Project is fixed on the Project, and a view's
    // grouping cannot be set anywhere else: the GitHub API refuses it.
    else if (action.kind === 'project-problem') openProject(project);
    else void window.cockpit.urlOpenExternal(action.issue.url);
  };
  const openSecondary = (): void => {
    if (action.kind === 'gate') {
      if (action.item === null) showScreen('sessions');
      else
        void window.cockpit.urlOpenExternal(
          `https://github.com/${action.item.repository}/issues/${action.item.number}`,
        );
    } else if (action.kind === 'review' || action.kind === 'ready-for-done')
      void window.cockpit.urlOpenExternal(action.focus.url);
    else if (action.kind === 'failing-pull-request')
      void window.cockpit.urlOpenExternal(action.pull.url);
    else if (action.kind === 'stale-session') void window.cockpit.urlOpenExternal(action.issue.url);
    else if (action.kind === 'project-problem') openProject(project);
    else
      void window.cockpit.spaceNavigate({
        to: 'space-files',
        open: { rootId: 'workbench', relPath: action.path },
      });
  };
  const primary =
    action.kind === 'gate'
      ? 'Open gate'
      : action.kind === 'review' || action.kind === 'ready-for-done'
        ? 'Open focus'
        : action.kind === 'draft'
          ? 'Open draft'
          : action.kind === 'project-problem'
            ? 'Open the Project'
            : 'Open';
  const source =
    action.kind === 'gate'
      ? `${action.process} gate`
      : action.kind === 'review' || action.kind === 'ready-for-done'
        ? `${action.focus.repository}#${action.focus.number}`
        : action.kind === 'draft'
          ? 'LOCAL WORKBENCH'
          : action.kind === 'failing-pull-request'
            ? `PULL REQUEST #${action.pull.number}`
            : action.kind === 'project-problem'
              ? 'THE PROJECT'
              : `SESSION ISSUE #${action.issue.number}`;
  const secondary =
    action.kind === 'gate' && action.item === null ? 'View sessions' : 'Open source';
  return (
    <article className={`dashboard-v2-card dashboard-v2-next-action${broken ? ' is-broken' : ''}`}>
      <p className="dashboard-v2-action-source">
        {broken ? '✗ ' : ''}
        {source}
      </p>
      <h3>{action.headline}</h3>
      {pmLine === null ? null : (
        <p className="dashboard-v2-pm-line" title={pmLine}>
          {pmLine}
        </p>
      )}
      <div className="dashboard-v2-action-buttons">
        <button type="button" className="dashboard-v2-primary" onClick={openPrimary}>
          {primary}
        </button>
        <button type="button" className="dashboard-v2-secondary" onClick={openSecondary}>
          {secondary}
        </button>
      </div>
    </article>
  );
}

function DraftsCard({
  drafts,
  hiddenCount,
  now,
}: {
  drafts: readonly DashboardWorkbenchDocument[];
  hiddenCount: number;
  now: number;
}): JSX.Element {
  return (
    <article className="dashboard-v2-card dashboard-v2-drafts">
      <div className="dashboard-v2-draft-heading">
        <div className="dashboard-v2-draft-count">{drafts.length + hiddenCount}</div>
        <h3>drafts awaiting your review</h3>
      </div>
      <p className="dashboard-v2-micro">LOCAL WORKBENCH</p>
      {drafts.map((draft) => (
        <button
          type="button"
          className="dashboard-v2-draft-row"
          key={draft.path}
          onClick={() =>
            void window.cockpit.spaceNavigate({
              to: 'space-files',
              open: { rootId: 'workbench', relPath: draft.path },
            })
          }
        >
          <span aria-hidden="true">▪</span>
          <span className="dashboard-v2-draft-title" title={draft.title}>
            {draft.title}
          </span>
          <time dateTime={draft.timestamp}>{relativeTime(draft.timestamp, now)}</time>
        </button>
      ))}
      <OverflowFooter hiddenCount={hiddenCount} noun="drafts" />
    </article>
  );
}

function PublishCard({
  row,
}: { row: NonNullable<SpaceRepositoriesState['model']>['rows'][number] }): JSX.Element {
  const mirror = row.mirror;
  const state = mirror?.state ?? 'not-checked';
  const sentence =
    mirror === null || mirror === undefined
      ? 'The mirror has not been checked.'
      : state === 'matches'
        ? 'The payload matches its mirror.'
        : state === 'differs'
          ? `${mirror.added} files added and ${mirror.removed} removed since the mirror was recorded.`
          : 'The mirror check is not available.';
  return (
    <article className="dashboard-v2-card dashboard-v2-publish">
      <p className="dashboard-v2-micro">PUBLISH AREA</p>
      <h3>{state === 'matches' ? 'IN SYNC' : state === 'differs' ? 'MIRROR DRIFT' : 'UNKNOWN'}</h3>
      <p>{sentence}</p>
      <button
        type="button"
        className="dashboard-v2-secondary"
        onClick={() =>
          void window.cockpit.spaceNavigate({ to: 'space-files', open: { rootId: row.rootId } })
        }
      >
        Open in Files
      </button>
    </article>
  );
}
