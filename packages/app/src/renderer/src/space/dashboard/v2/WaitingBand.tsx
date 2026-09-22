import type {
  OpenPullRequest,
  PullRequestChecks,
  PullRequestReview,
} from '@ai-lore-companion/core';
import type { CSSProperties, JSX, ReactNode } from 'react';
import type {
  DashboardCompanionPanel,
  DashboardPanel,
  DashboardReportState,
  SpaceProjectState,
} from '../../../../../shared/ipc.js';
import { openLink, relativeTime } from '../format.js';
import { PMPanel } from './PMPanel.js';
import { OverflowFooter, capItems } from './overflow.js';
import { StatusDot } from './statusVocabulary.js';

type PullRequestRow = OpenPullRequest;

type LiveSessionRow = {
  id: string;
  startedAt: string;
  label: string;
  mode: 'read-only' | 'writing';
  purpose: string | null;
};

type AgentRow = {
  issueNumber: number;
  issueUrl: string;
  title: string;
  column: 'Read only' | 'Writing' | 'Blocked' | 'Done';
  updatedAt: string | null;
  stale: boolean;
  idleMs: number | null;
};

export type WaitingBandProps = {
  /** The waiting definitions, already in the order written by the Human Lead. */
  panels: readonly DashboardPanel[];
  project: SpaceProjectState | null;
  reportState: DashboardReportState | null;
  now: number;
  /** Kept optional because the current shell has no board route of its own. */
  onOpenBoard?: () => void;
};

/** The four waiting panels. Handovers have their own column and are skipped here. */
export function WaitingBand({
  panels,
  project,
  reportState,
  now,
  onOpenBoard,
}: WaitingBandProps): JSX.Element {
  const pullRequests = project?.pullRequests.map(toPullRequest) ?? [];
  const sessions = reportState?.context?.activity.map(toSession) ?? [];
  const agents = project?.model?.board.map(toAgent) ?? [];

  const renderPanel = (panel: DashboardPanel): JSX.Element | null => {
    if (panel.source === 'pm')
      return <PMPanel key={panel.id} panel={panel} reportState={reportState} />;
    if (panel.kind === 'handovers') return null;
    switch (panel.kind) {
      case 'pull-requests':
        return (
          <PullRequestsPanel
            key={panel.id}
            title={panel.title}
            limit={Math.min(panel.limit ?? 3, 3)}
            order={panel.order}
            rows={pullRequests}
            project={project}
            now={now}
          />
        );
      case 'live-sessions':
        return (
          <LiveSessionsPanel
            key={panel.id}
            title={panel.title}
            limit={Math.min(panel.limit ?? 2, 2)}
            order={panel.order}
            rows={sessions}
          />
        );
      case 'agents-board':
        return (
          <AgentsPanel
            key={panel.id}
            title={panel.title}
            limit={Math.min(panel.limit ?? 3, 3)}
            order={panel.order}
            rows={agents}
            onOpenBoard={onOpenBoard}
          />
        );
      case 'space-stats':
        return <SpaceStatsPanel key={panel.id} title={panel.title} project={project} />;
      default:
        return null;
    }
  };
  return (
    <section
      className="dashboard-v2-waiting-band"
      aria-label="What is waiting"
      style={waitingBandStyle}
    >
      <div className="dashboard-v2-waiting-heading">
        <h2>WHAT IS WAITING</h2>
      </div>
      {panels.map(renderPanel)}
    </section>
  );
}

function panelStyle(): CSSProperties {
  return {
    padding: '6px 10px',
    lineHeight: 1.3,
    border: '1px solid var(--d-border-strong)',
    borderRadius: 'var(--d-radius)',
    background: 'var(--d-panel)',
  };
}

function PanelHeading({ title, suffix }: { title: string; suffix?: ReactNode }): JSX.Element {
  return (
    <div
      style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 'var(--d-size-title)',
          lineHeight: 1.2,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </h2>
      {suffix}
    </div>
  );
}

function PullRequestsPanel({
  title,
  limit,
  order,
  rows,
  project,
  now,
}: {
  title?: string;
  limit: number;
  order?: DashboardCompanionPanel['order'];
  rows: readonly PullRequestRow[];
  project: SpaceProjectState | null;
  now: number;
}): JSX.Element {
  const sorted = [...rows].sort((a, b) => {
    if (order === 'state' || order === undefined) {
      const stateDelta = pullRequestStateRank(a) - pullRequestStateRank(b);
      if (stateDelta !== 0) return stateDelta;
    }
    const delta = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return order === 'oldest' ? delta : -delta;
  });
  const visible = capItems(sorted, limit);
  const pullFailure = project?.pullRequestsFailure ?? null;
  const summary = project?.pullRequestSummary;
  const aggregate =
    pullFailure !== null
      ? `PULL REQUESTS UNAVAILABLE · ${pullFailure.message}`
      : rows.length === 0
        ? 'NO OPEN PULL REQUESTS'
        : (summary?.aggregate ?? 'PULL REQUEST STATUS UNAVAILABLE');
  const broken = summary?.broken === true || pullFailure !== null;
  return (
    <article
      style={{
        ...panelStyle(),
        ...(broken ? { borderColor: 'var(--d-red-border)', background: 'var(--d-red-bg)' } : {}),
      }}
    >
      <PanelHeading title={title ?? 'PULL REQUESTS'} />
      <p
        style={{
          margin: '4px 0',
          color: broken ? 'var(--d-red)' : 'var(--d-muted-2)',
          fontSize: 'var(--d-size-micro)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {aggregate}
      </p>
      {visible.visible.map((row) => (
        <a
          key={`${row.repository}#${row.number}`}
          href={row.url}
          onClick={(event) => {
            event.preventDefault();
            openLink(row.url);
          }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto minmax(0,1fr) auto',
            alignItems: 'center',
            gap: 6,
            minHeight: 22,
            color: 'inherit',
            textDecoration: 'none',
            fontSize: 'var(--d-size-small)',
          }}
        >
          <StatusDot
            tone={row.checks === 'failing' ? 'red' : row.checks === 'pending' ? 'accent' : 'muted'}
            word={ciWord(row.checks)}
            mark={ciMark(row.checks)}
          />
          <span style={{ color: 'var(--d-muted)', fontFamily: 'var(--d-mono)' }}>
            #{row.number}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.title} · {reviewWord(row.review)}
          </span>
          <time
            dateTime={row.updatedAt}
            style={{ color: 'var(--d-muted-2)', whiteSpace: 'nowrap' }}
          >
            {relativeTime(row.updatedAt, now)}
          </time>
        </a>
      ))}
      <OverflowFooter hiddenCount={visible.hiddenCount} noun="pull requests" />
    </article>
  );
}

function LiveSessionsPanel({
  title,
  limit,
  order,
  rows,
}: {
  title?: string;
  limit: number;
  order?: DashboardCompanionPanel['order'];
  rows: readonly LiveSessionRow[];
}): JSX.Element {
  const sorted = [...rows].sort((a, b) => {
    const delta = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    return order === 'oldest' ? delta : -delta;
  });
  const visible = capItems(sorted, limit);
  return (
    <article style={panelStyle()}>
      <PanelHeading
        title={title ?? 'LIVE SESSIONS'}
        suffix={<span style={microStyle}>{rows.length}</span>}
      />
      {rows.length === 0 ? (
        <p style={emptyStyle}>No session is running on this desk.</p>
      ) : (
        visible.visible.map((row) => (
          <div key={row.id} style={rowStyle}>
            <StatusDot
              tone="accent"
              word={row.mode === 'writing' ? 'WRITING' : 'READ-ONLY'}
              mark="·"
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.label}
            </span>
            {row.purpose === null ? null : (
              <span
                style={{
                  color: 'var(--d-muted-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.purpose}
              </span>
            )}
          </div>
        ))
      )}
      <OverflowFooter hiddenCount={visible.hiddenCount} noun="sessions" />
    </article>
  );
}

function AgentsPanel({
  title,
  limit,
  order,
  rows,
  onOpenBoard,
}: {
  title?: string;
  limit: number;
  order?: DashboardCompanionPanel['order'];
  rows: readonly AgentRow[];
  onOpenBoard?: () => void;
}): JSX.Element {
  const ordered = [...rows].sort((a, b) => {
    if (order === 'newest' || order === 'oldest') {
      const aTime = a.updatedAt === null ? Number.NaN : Date.parse(a.updatedAt);
      const bTime = b.updatedAt === null ? Number.NaN : Date.parse(b.updatedAt);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return order === 'oldest' ? aTime - bTime : bTime - aTime;
      }
    }
    return Number(b.column === 'Blocked') - Number(a.column === 'Blocked');
  });
  const visible = capItems(ordered, limit);
  return (
    <article style={panelStyle()}>
      <PanelHeading
        title={title ?? 'AGENTS BOARD'}
        suffix={
          <span style={microStyle}>
            {rows.length} SESSIONS
            {onOpenBoard ? (
              <button
                type="button"
                onClick={onOpenBoard}
                style={{
                  marginLeft: 8,
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  color: 'var(--d-accent)',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Open board
              </button>
            ) : null}
          </span>
        }
      />
      {rows.length === 0 ? (
        <p style={emptyStyle}>No session issue is open.</p>
      ) : (
        visible.visible.map((row) => (
          <div key={row.issueUrl} style={rowStyle}>
            <StatusDot
              tone={
                row.column === 'Blocked' ? 'red' : row.column === 'Writing' ? 'accent' : 'muted'
              }
              word={row.column.toUpperCase()}
              mark={agentMark(row.column)}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              #{row.issueNumber} {row.title}
            </span>
            <span
              style={{
                color: row.stale ? 'var(--d-red)' : 'var(--d-muted-2)',
                whiteSpace: 'nowrap',
              }}
            >
              {row.idleMs === null ? '—' : idleText(row.idleMs)}
            </span>
          </div>
        ))
      )}
      <OverflowFooter
        hiddenCount={visible.hiddenCount}
        noun="sessions"
        actionLabel="Open the board"
        onAction={onOpenBoard}
      />
    </article>
  );
}

function SpaceStatsPanel({
  title,
  project,
}: { title?: string; project: SpaceProjectState | null }): JSX.Element {
  const stats = project?.stats;
  const values = [
    ['FOCUSES OPEN', stats?.focusesOpen ?? 0],
    ['ITEMS OPEN', stats?.itemsOpen ?? 0],
    ['OPEN PULL REQUESTS', stats?.openPullRequests ?? 0],
    ['LIVE SESSIONS', stats?.liveSessions ?? 0],
  ];
  return (
    <article style={panelStyle()}>
      <PanelHeading title={title ?? 'THE SPACE'} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
          marginTop: 6,
        }}
      >
        {values.map(([label, value]) => (
          <div key={String(label)}>
            <strong
              style={{ display: 'block', color: 'var(--d-text)', fontSize: 'var(--d-size-num)' }}
            >
              {value}
            </strong>
            <span style={microStyle}>{label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function toPullRequest(row: SpaceProjectState['pullRequests'][number]): PullRequestRow {
  return row;
}

function toSession(
  row: NonNullable<DashboardReportState['context']>['activity'][number],
): LiveSessionRow {
  return {
    id: row.id,
    startedAt: row.startedAt,
    label: row.item?.title ?? row.purpose ?? 'Untitled session',
    mode: row.mode,
    purpose: row.item === undefined ? null : (row.purpose ?? null),
  };
}

function toAgent(row: NonNullable<SpaceProjectState['model']>['board'][number]): AgentRow {
  return {
    issueNumber: row.issue.number,
    issueUrl: row.issue.url,
    title: row.title,
    column: row.column,
    updatedAt: row.updatedAt,
    stale: row.stale,
    idleMs: row.idleMs,
  };
}

function ciWord(ci: PullRequestChecks): string {
  return ci === 'passing'
    ? 'PASSED'
    : ci === 'failing'
      ? 'FAILED'
      : ci === 'pending'
        ? 'RUNNING'
        : 'NO CI';
}
function ciMark(ci: PullRequestChecks): string {
  return ci === 'passing' ? '✓' : ci === 'failing' ? '✗' : ci === 'pending' ? '…' : '·';
}
function reviewWord(review: PullRequestReview): string {
  return review === 'approved'
    ? 'REVIEW APPROVED'
    : review === 'changes-requested'
      ? 'CHANGES REQUESTED'
      : review === 'review-required'
        ? 'REVIEW REQUIRED'
        : 'NO REVIEW';
}
function pullRequestStateRank(row: PullRequestRow): number {
  const checkRank =
    row.checks === 'failing' ? 0 : row.checks === 'pending' ? 1 : row.checks === 'none' ? 2 : 3;
  const reviewRank =
    row.review === 'changes-requested'
      ? 0
      : row.review === 'review-required'
        ? 1
        : row.review === 'none'
          ? 2
          : 3;
  return checkRank * 10 + reviewRank;
}
function agentMark(column: AgentRow['column']): string {
  return column === 'Done' ? '✓' : column === 'Blocked' ? '✗' : column === 'Writing' ? '●' : '○';
}
function idleText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

const microStyle: CSSProperties = {
  color: 'var(--d-muted-2)',
  fontSize: 'var(--d-size-micro)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const emptyStyle: CSSProperties = {
  margin: '10px 0 0',
  color: 'var(--d-text-3)',
  fontSize: 'var(--d-size-body)',
};
const waitingBandStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minHeight: 0,
};
const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0,1fr) auto',
  alignItems: 'center',
  gap: 6,
  minHeight: 22,
  fontSize: 'var(--d-size-small)',
};
