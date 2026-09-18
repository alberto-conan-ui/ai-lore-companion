import type { DashboardModel, FocusCard } from '@ai-lore-companion/core';
import { type CSSProperties, type JSX, useEffect, useState } from 'react';
import { errorAreaStyle, secondaryButtonStyle } from '../styles.js';
import { AgentsBoard } from './AgentsBoard.js';
import { FocusSheet } from './FocusSheet.js';
import { FocusesByStage } from './FocusesByStage.js';
import { NeedsYou } from './NeedsYou.js';
import { StartSession } from './StartSession.js';
import { stateSentence } from './dashboardText.js';
import { useProjectState } from './useProjectState.js';

/** How often the ages in the state line are written again. */
const AGE_TICK_MS = 30 * 1000;

/**
 * The Dashboard of a Space (phase M7.3): the state line with Refresh, Start a
 * session, then Needs you, Focuses by Stage and the Agents board, read from
 * the Space's GitHub Project through the companion's cache. It renders only
 * what the push `onSpaceProjectState` gives, and holds no data of its own.
 * Needs you, the Agents board and Start a session are phase M7.4's parts,
 * mounted here; each carries its own heading. The Space window mounts the
 * Dashboard inside the Dashboard entry of its rail, so it fills its parent.
 */
export function Dashboard(): JSX.Element {
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
    <main style={rootStyle} aria-label="Dashboard" data-testid="dashboard">
      <div style={stateRowStyle}>
        <p
          style={stateLineStyle}
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
      <StartSession />
      {project !== null && model === null ? (
        <p style={emptyStyle} data-testid="dashboard-no-model">
          No Project has been read from GitHub for this Space yet, so there is nothing to show.
          {refreshing ? ' A refresh is running.' : ' Refresh reads it now.'}
        </p>
      ) : null}
      {project !== null && model !== null ? (
        <>
          <NeedsYou entries={model.needsYou} onOpenFocus={(focus) => setOpenUrl(focus.url)} />
          <section style={sectionStyle} aria-labelledby="dashboard-focuses-heading">
            <h2 id="dashboard-focuses-heading" style={headingStyle}>
              Focuses by Stage
            </h2>
            <FocusesByStage model={model} onOpen={(focus) => setOpenUrl(focus.issue.url)} />
          </section>
          <AgentsBoard board={model.board} />
        </>
      ) : null}
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

const rootStyle: CSSProperties = {
  height: '100%',
  overflow: 'auto',
  padding: '0.75rem 1rem',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  color: 'var(--color-text)',
};
const stateRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem' };
const stateLineStyle: CSSProperties = {
  flex: 1,
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };
const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  color: 'var(--color-text-bright)',
};
const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text-muted)',
};
