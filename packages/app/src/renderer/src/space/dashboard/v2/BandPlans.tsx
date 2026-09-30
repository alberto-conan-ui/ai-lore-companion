import type { JSX } from 'react';
import { useState } from 'react';
import type { SpacePlansState, SpacePlansUnit } from '../../../../../shared/ipc.js';
import { footerText, headingState, kindLabel, lastReadText, updatedText } from '../plansText.js';
import type { PlansStateView } from '../usePlansState.js';
import { OverflowFooter, capItems } from './overflow.js';

/** The rows shown before "show all": the band sits among others on one page. */
export const PLANS_ROWS_SHOWN = 12;

export type BandPlansProps = {
  view: PlansStateView;
  now: number;
};

/**
 * The Plans band of the Space dashboard (alberto-conan-ui/ai-lore#398): the Space's epics, sub-epics and focuses, each
 * with its Stage and when it was last changed, each opening its own dashboard. Built from the bands already here
 * (`BandMoving`): its heading, rows, marks and overflow footer. A read that is incomplete, refused or not reachable is
 * said as that; the list of a read that did not answer is never drawn, and nothing saved is shown as current.
 */
export function BandPlans({ view, now }: BandPlansProps): JSX.Element | null {
  const [all, setAll] = useState(false);
  const state = view.plans;
  if (state?.outcome === 'unavailable') return null;
  const rows = state?.units ?? null;
  const shown = rows === null ? null : capItems(rows, all ? rows.length : PLANS_ROWS_SHOWN);
  return (
    <section
      className="dashboard-v2-band-moving dashboard-v2-band-plans"
      data-testid="dashboard-v2-plans"
      data-outcome={state?.outcome ?? (view.problem === null ? 'reading' : 'problem')}
      aria-label="Plans"
      ref={view.bandRef}
    >
      <div className="dashboard-v2-band-heading">
        <h2>PLANS</h2>
        <span className="dashboard-v2-clear" data-testid="plans-state">
          {state?.demo ? 'DEMO DATA, FAKE GITHUB · ' : ''}
          {view.problem === null ? headingState(state, now, view.active) : 'NOT READ'}
          {view.active ? '' : ' · PAUSED'}
        </span>
      </div>
      <div className="dashboard-v2-moving-content">
        <PlansNotice view={view} state={state} now={now} />
        {shown === null ? null : (
          <div className="dashboard-v2-moving-group">
            {shown.visible.length === 0 && state?.outcome === 'complete' ? (
              <p className="dashboard-v2-empty" data-testid="plans-empty">
                No epics or focuses are on the Project yet.
              </p>
            ) : null}
            {shown.visible.map((unit) => (
              <PlanRow
                key={unit.number}
                unit={unit}
                now={now}
                busy={view.opening !== null}
                opening={view.opening === unit.number}
                onOpen={() => view.open(unit.number)}
              />
            ))}
            <OverflowFooter
              hiddenCount={shown.hiddenCount}
              noun="plans"
              actionLabel="show all"
              onAction={() => setAll(true)}
            />
          </div>
        )}
        {view.openProblem === null ? null : (
          <p role="alert" data-testid="plans-open-problem">
            {view.openProblem}
          </p>
        )}
        {(state?.leftOut ?? []).map((line) => (
          <p className="dashboard-v2-muted" key={line} data-testid="plans-left-out">
            {line}
          </p>
        ))}
        <p className="dashboard-v2-muted" data-testid="plans-footer">
          {footerText(state)}
          {view.active ? '' : ' Not refreshing while this window is hidden.'}
        </p>
      </div>
    </section>
  );
}

/** What is said above the rows: that nothing is read yet, or that the read is not whole, or why there is no list. */
function PlansNotice({
  view,
  state,
  now,
}: { view: PlansStateView; state: SpacePlansState | null; now: number }): JSX.Element | null {
  if (view.problem !== null) {
    return (
      <p role="alert" data-testid="plans-problem">
        {view.problem} No list is shown.
      </p>
    );
  }
  if (state === null || state.outcome === null) {
    return (
      <p className="dashboard-v2-empty" data-testid="plans-reading" aria-busy={view.active}>
        {view.active
          ? 'Reading the plans…'
          : 'The plans have not been read yet, because this window is hidden or this band is out of view. They are read as soon as it is shown.'}
      </p>
    );
  }
  if (state.outcome === 'complete') return null;
  const lost = state.outcome !== 'incomplete';
  return (
    <div role="alert" data-testid="plans-problem" data-outcome={state.outcome}>
      <strong>{state.head === '' ? 'Plans could not be read' : state.head}</strong>
      <p className="dashboard-v2-muted">
        {state.text}
        {lost ? ' No list is shown, and nothing saved stands in for it.' : ''}
      </p>
      {state.missing.map((line) => (
        <p className="dashboard-v2-micro" key={line}>
          {line}
        </p>
      ))}
      {lost ? (
        <p className="dashboard-v2-micro" data-testid="plans-last-read">
          {lastReadText(state, now)}
        </p>
      ) : null}
      <button
        type="button"
        className="dashboard-v2-secondary"
        data-testid="plans-read-again"
        onClick={view.refresh}
        disabled={view.requested || state.reading}
      >
        {view.requested || state.reading ? 'Reading' : 'Read again'}
      </button>
    </div>
  );
}

function PlanRow({
  unit,
  now,
  busy,
  opening,
  onOpen,
}: {
  unit: SpacePlansUnit;
  now: number;
  busy: boolean;
  opening: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="dashboard-v2-moving-row dashboard-v2-plan-row"
      data-testid="plans-row"
      data-number={String(unit.number)}
      disabled={busy}
      aria-busy={opening}
      title={unit.onGitHub ? 'Opens its dashboard from GitHub' : 'Opens its JSON dashboard'}
      onClick={onOpen}
    >
      <span
        className="dashboard-v2-plan-title"
        style={{ paddingLeft: `${String(unit.depth * 22)}px` }}
        data-depth={String(unit.depth)}
      >
        <span className="dashboard-v2-plan-level" data-kind={unit.kind}>
          {kindLabel(unit.kind)}
        </span>
        <span className="dashboard-v2-plan-name">
          <span className="dashboard-v2-issue">#{unit.number}</span> {unit.title}
        </span>
      </span>
      <span className="dashboard-v2-plan-stage" data-stage={unit.stage ?? ''}>
        {unit.stage ?? 'No Stage'}
      </span>
      <time className="dashboard-v2-plan-updated">
        {opening ? 'opening…' : updatedText(unit, now)}
      </time>
    </button>
  );
}
