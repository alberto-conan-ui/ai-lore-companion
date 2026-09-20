import type { DashboardModel, FocusCard } from '@ai-lore-companion/core';
import { type JSX, useEffect, useState } from 'react';
import './dashboard.css';
import { errorAreaStyle, secondaryButtonStyle } from '../styles.js';
import { AgentsBoard } from './AgentsBoard.js';
import { FocusSheet } from './FocusSheet.js';
import { FocusesByStage } from './FocusesByStage.js';
import { NeedsYou } from './NeedsYou.js';
import { PmReport } from './PmReport.js';
import { Repositories } from './Repositories.js';
import { StartSession } from './StartSession.js';
import { stateSentence } from './dashboardText.js';
import { useProjectState } from './useProjectState.js';

/** How often the ages in the state line are written again. */
const AGE_TICK_MS = 30 * 1000;

/** Project and repository facts beside the PM's separately sourced interpretation. */
type Props = {
  /** Whether the Space window opened with `init.justCreated` (M9.10). */
  justCreated?: boolean;
};

export function Dashboard({ justCreated }: Props = {}): JSX.Element {
  const { project, problem, requested, refresh } = useProjectState();
  const [, setTick] = useState(0);
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  // The ages are computed at each render; the tick renders again as time passes.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const now = Date.now();
  const model = project?.model ?? null;
  const openFocus = model === null || openUrl === null ? null : findFocus(model, openUrl);
  const refreshing = requested || project?.refreshing === true;

  return (
    <main className="dashboard" aria-label="Dashboard" data-testid="dashboard">
      <div className="dashboard-state-row">
        <p
          className="dashboard-state-line"
          aria-live="polite"
          data-testid="dashboard-state"
          data-state={project?.state ?? ''}
          data-refreshing={refreshing ? 'true' : 'false'}
        >
          {project === null ? (
            'Reading the state of the Project from the companion.'
          ) : (
            <>
              <strong data-testid="dashboard-state-name">{project.state}</strong>
              {refreshing ? ', refreshing' : ''}.{' '}
              <span data-testid="dashboard-state-sentence">{stateSentence(project, now)}</span>
            </>
          )}
        </p>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={refresh}
          disabled={refreshing}
          data-testid="dashboard-refresh"
        >
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      {problem !== null ? (
        <p style={errorAreaStyle} role="alert" data-testid="dashboard-problem">
          {problem}
        </p>
      ) : null}
      {model !== null ? (
        <NeedsYou entries={model.needsYou} onOpenFocus={(focus) => setOpenUrl(focus.url)} />
      ) : null}
      <div className="dashboard-body">
        <div className="dashboard-facts" data-testid="dashboard-facts">
          <section className="dashboard-section" aria-labelledby="dashboard-focuses-heading">
            <h2 id="dashboard-focuses-heading" className="dashboard-heading">
              Where everything stands
            </h2>
            {project !== null && model === null ? (
              <p className="dashboard-empty" data-testid="dashboard-no-model">
                No Project has been read from GitHub for this Space yet, so there is nothing to
                show.
                {refreshing ? ' A refresh is running.' : ' Refresh reads it now.'}
              </p>
            ) : null}
            {model !== null ? (
              <FocusesByStage model={model} onOpen={(focus) => setOpenUrl(focus.issue.url)} />
            ) : null}
          </section>
          {model !== null ? <AgentsBoard board={model.board} /> : null}
          <Repositories now={now} />
        </div>
        <aside className="dashboard-pm-rail" aria-label="PM interpretation and sessions">
          <PmReport />
          <div className="dashboard-start-foot">
            <StartSession justCreated={justCreated === true} />
          </div>
        </aside>
      </div>
      {openFocus !== null ? (
        <FocusSheet focus={openFocus} onClose={() => setOpenUrl(null)} />
      ) : null}
    </main>
  );
}

/** The focus of a card as the current model has it, so an open sheet follows the pushes. */
function findFocus(model: DashboardModel, url: string): FocusCard | null {
  for (const column of model.columns) {
    const found = column.focuses.find((focus) => focus.issue.url === url);
    if (found) return found;
  }
  return model.unstaged.find((focus) => focus.issue.url === url) ?? null;
}
