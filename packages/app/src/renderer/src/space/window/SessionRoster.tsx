import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, useEffect, useState } from 'react';
import type {
  DashboardReportState,
  SpaceSessionHeader,
  SpaceSessionStarted,
} from '../../../../shared/ipc.js';
import type { WorkspaceTab } from '../../components/TabbedPanel.js';
import { targetLabel } from '../session-header/SessionHeader.js';
import { useSpaceNavStore } from './spaceNavStore.js';

type Props = {
  tabs: WorkspaceTab[];
  sessions: ReadonlyMap<string, string>;
  engines: EngineEntry[];
  activeTab: string;
  pmTabId: string;
  pmSession: SpaceSessionStarted | null;
  pmStarting: boolean;
  pmProblem: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onEnsurePm: () => void;
  onRestartPm: () => void;
  onRequest: () => void;
};

/** Local desk facts only. Subscribe before reading so a late read cannot replace a push. */
function useRosterHeader(sessionId: string | undefined): {
  header: SpaceSessionHeader | null;
  problem: string | null;
} {
  const [header, setHeader] = useState<SpaceSessionHeader | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setHeader(null);
    setProblem(null);
    if (!sessionId) return;
    let live = true;
    let pushed = false;
    const off = window.cockpit.onSpaceSessionHeader((next) => {
      if (!live || next.sessionId !== sessionId) return;
      pushed = true;
      setHeader(next);
      setProblem(null);
    });
    void window.cockpit
      .spaceSessionHeader({ sessionId })
      .then((result) => {
        if (!live || pushed) return;
        if (result.ok) setHeader(result.value);
        else setProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (live && !pushed) setProblem(String(caught));
      });
    return () => {
      live = false;
      off();
    };
  }, [sessionId]);
  return { header: header?.sessionId === sessionId ? header : null, problem };
}

function WorkerCard({
  tab,
  sessionId,
  engine,
  active,
  onSelect,
  onClose,
}: {
  tab: WorkspaceTab;
  sessionId: string | undefined;
  engine: EngineEntry | undefined;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element {
  const { header, problem } = useRosterHeader(sessionId);
  return (
    <article
      className="session-roster-card"
      data-active={active}
      data-testid="session-roster-worker"
      data-tab-id={tab.id}
      data-session-id={sessionId}
    >
      <button
        type="button"
        className="session-roster-select"
        onClick={onSelect}
        aria-pressed={active}
        data-testid={`session-roster-select-${tab.id}`}
      >
        <strong>{tab.title}</strong>
        <span className="session-roster-meta">
          {engine?.name ?? tab.engine ?? 'No engine selected'}
        </span>
        {sessionId ? <code>{sessionId}</code> : null}
        <span className="session-roster-row">
          <span className="session-roster-pill">
            {header?.closed
              ? 'Ended'
              : header
                ? header.mode === 'writing'
                  ? 'Writing'
                  : 'Read only'
                : problem
                  ? 'Session details unavailable'
                  : sessionId
                    ? 'Reading session…'
                    : 'Not running'}
          </span>
          {header?.unguarded.length ? (
            <span className="session-roster-warning">Unguarded</span>
          ) : null}
        </span>
        {problem ? (
          <span role="alert" className="session-roster-warning">
            {problem}
          </span>
        ) : null}
        {header?.targets.map((target) => (
          <span className="session-roster-target" key={targetLabel(target)}>
            {targetLabel(target)}
          </span>
        ))}
        {header?.item ? (
          <span className="session-roster-meta">
            item {header.item.repository}#{header.item.number}
          </span>
        ) : null}
      </button>
      <div className="session-roster-actions">
        {!sessionId ? (
          <button type="button" onClick={onSelect}>
            Open to start
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label={`Close ${tab.title}`}>
          Close
        </button>
      </div>
    </article>
  );
}

export function SessionRoster(props: Props): JSX.Element {
  const { tabs, sessions, engines, activeTab, pmTabId, pmSession, pmStarting, pmProblem } = props;
  const [reportState, setReportState] = useState<DashboardReportState | null>(null);
  const [reportProblem, setReportProblem] = useState<string | null>(null);
  const showScreen = useSpaceNavStore((state) => state.showScreen);
  useEffect(() => {
    let live = true;
    let pushed = false;
    const take = (next: DashboardReportState): void => {
      if (!live) return;
      setReportProblem(null);
      setReportState((previous) =>
        previous === null || next.version >= previous.version ? next : previous,
      );
    };
    const off = window.cockpit.onSpaceDashboardReport((next) => {
      pushed = true;
      take(next);
    });
    void window.cockpit
      .spaceDashboardReport({})
      .then((result) => {
        if (!live) return;
        if (result.ok) take(result.value);
        else if (!pushed) setReportProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (live && !pushed) setReportProblem(String(caught));
      });
    return () => {
      live = false;
      off();
    };
  }, []);
  const report = reportState?.report;
  const pmTab = tabs.find((tab) => tab.id === pmTabId);
  const pmEngine = engines.find((engine) => engine.id === pmSession?.engineId);
  const workers = tabs.filter((tab) => tab.kind === 'ai' && tab.id !== pmTabId);
  return (
    <aside
      className="session-roster"
      aria-label="Session roster"
      data-testid="session-roster"
      id="session-roster"
    >
      <div className="session-roster-heading">
        <h2>Sessions</h2>
        <span>
          {workers.length} worker {workers.length === 1 ? 'tab' : 'tabs'}
        </span>
      </div>
      <div className="session-roster-content">
        <article
          className="session-roster-card session-roster-pm"
          data-testid="session-roster-pm"
          data-active={activeTab === pmTabId}
        >
          <button
            type="button"
            className="session-roster-select"
            data-testid="pm-select"
            disabled={!pmTab}
            aria-pressed={activeTab === pmTabId}
            onClick={() => props.onSelect(pmTabId)}
          >
            <span className="session-roster-row">
              <strong>✦ PM</strong>
              <span className="session-roster-pill">Read only</span>
            </span>
            {pmSession ? (
              <>
                <code>{pmSession.sessionId}</code>
                <span>{pmEngine?.name ?? pmSession.engineId}</span>
                {pmEngine?.model ? (
                  <span className="session-roster-meta">Configured model: {pmEngine.model}</span>
                ) : null}
              </>
            ) : null}
            <span className="session-roster-meta">Claims nothing · this Space window</span>
          </button>
          <div className="session-roster-report" data-testid="pm-status">
            {pmStarting ? (
              <span>Starting PM…</span>
            ) : pmProblem ? (
              <span role="alert">{pmProblem}</span>
            ) : (
              <span>{pmSession ? 'Running' : 'Not running'}</span>
            )}
            {reportProblem ? (
              <span role="alert">Report unavailable: {reportProblem}</span>
            ) : report ? (
              <>
                <span>
                  Last report accepted{' '}
                  <time dateTime={report.receivedAt}>
                    {new Date(report.receivedAt).toLocaleString()}
                  </time>
                </span>
                <code>Source: {report.sessionId}</code>
                {report.stale ? (
                  <span className="session-roster-warning">
                    May be out of date:{' '}
                    {report.staleReason === 'session-ended'
                      ? 'the PM session ended.'
                      : 'the Project source changed.'}
                  </span>
                ) : null}
                <button type="button" onClick={() => showScreen('dashboard')}>
                  Read report on Dashboard
                </button>
              </>
            ) : (
              <span>{reportState ? 'No PM report yet.' : 'Reading report…'}</span>
            )}
          </div>
          <div className="session-roster-actions">
            {pmSession ? (
              <>
                <button
                  type="button"
                  data-testid="pm-dashboard-request"
                  onClick={props.onRequest}
                  disabled={pmStarting}
                  title="Inserts a follow-up request in the PM terminal. Press Enter to send."
                >
                  Draft follow-up dashboard request
                </button>
                <button
                  type="button"
                  data-testid="pm-restart"
                  disabled={pmStarting}
                  onClick={props.onRestartPm}
                >
                  Restart
                </button>
                <button
                  type="button"
                  disabled={pmStarting}
                  onClick={() => props.onClose(pmTabId)}
                  aria-label="Close PM"
                >
                  Close
                </button>
              </>
            ) : !pmStarting ? (
              <button
                type="button"
                data-testid="pm-retry"
                onClick={pmTab ? props.onRestartPm : props.onEnsurePm}
              >
                {pmProblem ? 'Retry PM' : 'Start PM'}
              </button>
            ) : null}
          </div>
          <p className="session-roster-meta">
            Closing the tab or Space stops the PM. Reports stay in this window only.
          </p>
        </article>
        <h3>Worker sessions</h3>
        {workers.length === 0 ? (
          <p className="session-roster-meta">No worker AI tabs. Use + AI to start a session.</p>
        ) : (
          workers.map((tab) => (
            <WorkerCard
              key={tab.id}
              tab={tab}
              sessionId={sessions.get(tab.id)}
              engine={engines.find((engine) => engine.id === tab.engine)}
              active={activeTab === tab.id}
              onSelect={() => props.onSelect(tab.id)}
              onClose={() => props.onClose(tab.id)}
            />
          ))
        )}
        <footer className="session-roster-engines">
          <h3>Configured engines</h3>
          <div className="session-roster-row">
            {engines.map((engine) => (
              <span
                className="session-roster-pill"
                key={engine.id}
                title={engine.model ? `Configured model: ${engine.model}` : undefined}
              >
                {engine.name}
              </span>
            ))}
          </div>
          {engines.length === 0 ? <p>No engines configured.</p> : null}
        </footer>
      </div>
    </aside>
  );
}
