import { type JSX, useEffect, useState } from 'react';
import type { DashboardReportState } from '../../../../shared/ipc.js';
import './dashboard.css';
import { useSpaceNavStore } from '../window/spaceNavStore.js';

/** Literal text only: a PM report can never introduce HTML, script or remote image loads. */
export function PmReport(): JSX.Element {
  const [state, setState] = useState<DashboardReportState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const showSessions = useSpaceNavStore((nav) => nav.showScreen);
  const showSessionTab = useSpaceNavStore((nav) => nav.showSessionTab);
  const sessionsWithTab = useSpaceNavStore((nav) => nav.sessionsWithTab);
  useEffect(() => {
    let live = true;
    const take = (next: DashboardReportState): void => {
      if (live) {
        setProblem(null);
        setState((previous) =>
          previous === null || next.version >= previous.version ? next : previous,
        );
      }
    };
    const off = window.cockpit.onSpaceDashboardReport(take);
    void window.cockpit
      .spaceDashboardReport({})
      .then((result) => {
        if (!live) return;
        if (result.ok) take(result.value);
        else setProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (live) setProblem(String(caught));
      });
    return () => {
      live = false;
      off();
    };
  }, []);
  const report = state?.report;
  return (
    <section
      className="dashboard-pm-report"
      aria-labelledby="pm-report-heading"
      data-testid="pm-report"
    >
      <h2 id="pm-report-heading" className="dashboard-heading">
        PM report
      </h2>
      <p className="dashboard-pm-label">PM interpretation · read only</p>
      {problem ? <p role="alert">{problem}</p> : null}
      {report ? (
        <>
          <p className="dashboard-pm-meta">
            Received{' '}
            <time dateTime={report.receivedAt}>{new Date(report.receivedAt).toLocaleString()}</time>
            {' · Source session: '}
            {report.sessionId}
            {report.stale ? (
              <span data-testid="pm-report-stale">
                {' · '}May be out of date:{' '}
                {report.staleReason === 'session-ended'
                  ? 'the PM session ended.'
                  : 'the Project source changed.'}
              </span>
            ) : null}
          </p>
          <div data-testid="pm-report-text" className="dashboard-pm-text">
            {report.markdown}
          </div>
          {report.basis ? (
            <p data-testid="pm-report-basis" className="dashboard-pm-meta">
              Sources reported by PM: {report.basis}
            </p>
          ) : (
            <p className="dashboard-pm-meta" data-testid="pm-report-basis">
              No basis stated by PM.
            </p>
          )}
        </>
      ) : (
        <p data-testid="pm-report-empty">
          {problem !== null
            ? 'The PM report could not be read.'
            : state === null
              ? 'Reading the PM report…'
              : 'No PM report yet. In Sessions, ask the PM: “Please update the dashboard.”'}
        </p>
      )}
      <button
        type="button"
        className="dashboard-pill dashboard-pm-talk"
        onClick={() => {
          if (report && sessionsWithTab.includes(report.sessionId))
            showSessionTab(report.sessionId);
          else showSessions('sessions');
        }}
      >
        Talk to PM in Sessions
      </button>
    </section>
  );
}
