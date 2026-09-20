import { type JSX, useEffect, useState } from 'react';
import type { DashboardReportState } from '../../../../shared/ipc.js';
import { secondaryButtonStyle } from '../styles.js';
import { useSpaceNavStore } from '../window/spaceNavStore.js';

/** Literal text only: a PM report can never introduce HTML, script or remote image loads. */
export function PmReport(): JSX.Element {
  const [state, setState] = useState<DashboardReportState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const showSessions = useSpaceNavStore((nav) => nav.showScreen);
  useEffect(() => {
    let live = true;
    const take = (next: DashboardReportState): void => {
      if (live)
        setState((previous) =>
          previous === null || next.version >= previous.version ? next : previous,
        );
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
    <section aria-labelledby="pm-report-heading" data-testid="pm-report">
      <h2 id="pm-report-heading" style={{ margin: 0, fontSize: '0.95rem' }}>
        PM report
      </h2>
      {problem ? <p role="alert">{problem}</p> : null}
      {report ? (
        <>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            Received{' '}
            <time dateTime={report.receivedAt}>{new Date(report.receivedAt).toLocaleString()}</time>
            {' · '}
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
          <div
            data-testid="pm-report-text"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.85rem' }}
          >
            {report.markdown}
          </div>
          {report.basis ? (
            <p
              data-testid="pm-report-basis"
              style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}
            >
              Sources reported by PM: {report.basis}
            </p>
          ) : null}
        </>
      ) : (
        <p data-testid="pm-report-empty">
          {state === null
            ? 'Reading the PM report…'
            : 'No PM report yet. In Sessions, ask the PM: “Please update the dashboard.”'}
        </p>
      )}
      <button type="button" style={secondaryButtonStyle} onClick={() => showSessions('sessions')}>
        Talk to PM in Sessions
      </button>
    </section>
  );
}
