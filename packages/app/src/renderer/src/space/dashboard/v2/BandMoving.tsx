import type { FocusCard } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import { useState } from 'react';
import type {
  DashboardPanel,
  DashboardReportState,
  SpaceProjectState,
} from '../../../../../shared/ipc.js';
import { ModalSheet } from '../../../components/overlay/ModalSheet.js';
import { durationText, relativeTime } from '../format.js';
import { PMPanel, PmLine } from './PMPanel.js';
import { OverflowFooter, capItems } from './overflow.js';
import { StageMark } from './statusVocabulary.js';

export type BandMovingProps = {
  panels: readonly DashboardPanel[];
  project: SpaceProjectState | null;
  reportState: DashboardReportState | null;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
};

export function BandMoving({
  panels,
  project,
  reportState,
  now,
  onOpenFocus,
}: BandMovingProps): JSX.Element {
  const [backlogOpen, setBacklogOpen] = useState(false);
  const moving = project?.moving ?? {
    inProgress: [],
    queued: [],
    untriaged: [],
    dormant: [],
    done: [],
  };
  // A payload from an older cache has no `untriaged`. Read it defensively: a
  // band that throws takes the whole Dashboard with it, and a missing bucket
  // should degrade to "nothing to show" rather than a blank page.
  const untriaged = moving.untriaged ?? [];
  const dormant = project?.dormant ?? {
    count: moving.dormant.length,
    paused: moving.dormant.filter((focus) => focus.labels.includes('paused')).length,
    oldestAgeMs: null,
    medianAgeMs: null,
  };
  return (
    <section className="dashboard-v2-band-moving" data-testid="dashboard-v2-moving">
      <div className="dashboard-v2-band-heading">
        <h2>WHAT IS MOVING</h2>
        <span className="dashboard-v2-clear">
          {moving.inProgress.length} IN PROGRESS · {moving.queued.length} QUEUED
          {untriaged.length > 0 ? ` · ${untriaged.length} UNTRIAGED` : ''}
        </span>
      </div>
      <div className="dashboard-v2-moving-content">
        {panels.map((panel) => {
          if (panel.source === 'pm')
            return <PMPanel key={panel.id} panel={panel} reportState={reportState} />;
          if (panel.kind === 'in-progress')
            return (
              <MovingRows
                key={panel.id}
                items={moving.inProgress}
                limit={Math.min(panel.limit ?? 4, 3)}
                order={panel.order}
                now={now}
                onOpenFocus={onOpenFocus}
                inProgress
              />
            );
          if (panel.kind === 'queued')
            return (
              <MovingRows
                key={panel.id}
                items={moving.queued}
                limit={Math.min(panel.limit ?? 4, 3)}
                order={panel.order}
                now={now}
                onOpenFocus={onOpenFocus}
                inProgress={false}
              />
            );
          if (panel.kind === 'dormant')
            return (
              <DormantRow
                key={panel.id}
                items={moving.dormant}
                aggregate={dormant}
                onOpenBacklog={() => setBacklogOpen(true)}
                pmLine={
                  panel.pmLine === undefined
                    ? null
                    : PmLine({ id: panel.pmLine.id, state: reportState })
                }
              />
            );
          return (
            <DoneLine key={panel.id} focus={moving.done[0] ?? null} onOpenFocus={onOpenFocus} />
          );
        })}
      </div>
      {backlogOpen ? (
        <ModalSheet
          label="Dormant focuses"
          onClose={() => setBacklogOpen(false)}
          testId="dashboard-dormant-sheet"
          backdropTestId="dashboard-dormant-sheet-backdrop"
          panelStyle={{
            left: '50%',
            top: '50%',
            width: 'min(620px, calc(100vw - 32px))',
            maxHeight: '80vh',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="dashboard-v2-theme dashboard-v2-backlog">
            <div className="dashboard-v2-backlog-heading">
              <h3>UNTRIAGED AND PARKED</h3>
              <button
                type="button"
                className="dashboard-v2-secondary"
                onClick={() => setBacklogOpen(false)}
              >
                Close
              </button>
            </div>
            {untriaged.length > 0 ? (
              <p className="dashboard-v2-clear" data-testid="dashboard-untriaged-note">
                {untriaged.length} with no stage — nobody has said where these are yet.
                Parked work is listed below them.
              </p>
            ) : null}
            {untriaged.map((focus) => (
              <button
                type="button"
                className="dashboard-v2-draft-row"
                key={focus.issue.url}
                data-testid="dashboard-untriaged-row"
                onClick={() => {
                  setBacklogOpen(false);
                  onOpenFocus(focus);
                }}
              >
                #{focus.issue.number} {focus.title}
              </button>
            ))}
            {moving.dormant.map((focus) => (
              <button
                type="button"
                className="dashboard-v2-draft-row"
                key={focus.issue.url}
                onClick={() => {
                  setBacklogOpen(false);
                  onOpenFocus(focus);
                }}
              >
                #{focus.issue.number} {focus.title}
              </button>
            ))}
          </div>
        </ModalSheet>
      ) : null}
    </section>
  );
}

function MovingRows({
  items,
  limit,
  order,
  now,
  onOpenFocus,
  inProgress,
}: {
  items: readonly FocusCard[];
  limit?: number;
  order?: 'newest' | 'oldest' | 'age' | 'stage' | 'state';
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
  inProgress: boolean;
}): JSX.Element {
  const ordered = [...items].sort((a, b) => {
    if (order === 'stage') return (a.stage ?? '').localeCompare(b.stage ?? '');
    if (order === 'state') return a.state.localeCompare(b.state);
    const left = Date.parse(a.stageChangedAt ?? '');
    const right = Date.parse(b.stageChangedAt ?? '');
    return order === 'newest' ? right - left : left - right;
  });
  const rows = capItems(ordered, limit ?? 4);
  return (
    <div className="dashboard-v2-moving-group">
      {rows.visible.length === 0 ? (
        <p className="dashboard-v2-empty">
          {inProgress ? 'Nothing is in progress.' : 'Nothing is queued.'}
        </p>
      ) : null}
      {rows.visible.map((focus) => (
        <FocusRow
          key={focus.issue.url}
          focus={focus}
          now={now}
          onOpenFocus={onOpenFocus}
          inProgress={inProgress}
        />
      ))}
      <OverflowFooter
        hiddenCount={rows.hiddenCount}
        noun={inProgress ? 'in progress items' : 'queued items'}
      />
    </div>
  );
}

function DormantRow({
  items,
  aggregate,
  onOpenBacklog,
  pmLine,
}: {
  items: readonly FocusCard[];
  aggregate: SpaceProjectState['dormant'];
  onOpenBacklog: () => void;
  pmLine: string | null;
}): JSX.Element | null {
  if (aggregate.count === 0) return null;
  const oldest =
    aggregate.oldestAgeMs === null
      ? 'STAGE AGE UNKNOWN'
      : `MOST IDLE: ${durationText(aggregate.oldestAgeMs)}`;
  return (
    <article className="dashboard-v2-dormant-row">
      <div>
        <strong>
          {aggregate.count} dormant {aggregate.count === 1 ? 'focus' : 'focuses'}
        </strong>
        <p className="dashboard-v2-micro dashboard-v2-dormant-facts">
          {pmLine === null ? null : (
            <span className="dashboard-v2-pm-line" title={pmLine}>
              {pmLine}
            </span>
          )}
          <span>
            {pmLine === null ? '' : ' · '}
            {oldest}
            {aggregate.paused === 0 ? '' : ` · ${aggregate.paused} PAUSED`}
          </span>
        </p>
      </div>
      {items.length === 0 ? null : (
        <button type="button" className="dashboard-v2-secondary" onClick={onOpenBacklog}>
          Review backlog ›
        </button>
      )}
    </article>
  );
}

function DoneLine({
  focus,
  onOpenFocus,
}: { focus: FocusCard | null; onOpenFocus: (focus: FocusCard) => void }): JSX.Element | null {
  return focus === null ? null : (
    <button type="button" className="dashboard-v2-done" onClick={() => onOpenFocus(focus)}>
      ✓ DONE #{focus.issue.number} {focus.title}
    </button>
  );
}

function FocusRow({
  focus,
  now,
  onOpenFocus,
  inProgress,
}: {
  focus: FocusCard;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
  inProgress: boolean;
}): JSX.Element {
  const shape = focus.stage === 'Build' ? 'build' : focus.stage === 'Spec' ? 'spec' : 'queued';
  const age =
    focus.stageChangedAt === null ? 'age unknown' : relativeTime(focus.stageChangedAt, now);
  return (
    <button
      type="button"
      className={`dashboard-v2-moving-row${inProgress ? ' is-in-progress' : ''}`}
      onClick={() => onOpenFocus(focus)}
    >
      <span className="dashboard-v2-moving-row-top">
        <span className="dashboard-v2-micro">{inProgress ? '● IN PROGRESS' : '○ QUEUED'}</span>
        <StageMark shape={shape} word={focus.stage ?? 'QUEUED'} />
        <time dateTime={focus.stageChangedAt ?? undefined}>{age}</time>
      </span>
      <span>
        <span className="dashboard-v2-issue">#{focus.issue.number}</span> {focus.title}
      </span>
    </button>
  );
}
