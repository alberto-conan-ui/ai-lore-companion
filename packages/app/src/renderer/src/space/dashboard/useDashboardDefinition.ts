import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardReportState } from '../../../../shared/ipc.js';

export type DashboardDefinitionState = {
  state: DashboardReportState | null;
  problem: string | null;
  refreshing: boolean;
  refresh: () => void;
};

/** Admit only monotonic snapshots; late reads cannot undo live refresh state. */
export function useDashboardDefinition(): DashboardDefinitionState {
  const [state, setState] = useState<DashboardReportState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const live = useRef(false);
  const version = useRef(-1);
  const request = useRef(0);

  const take = useCallback((next: DashboardReportState): void => {
    if (!live.current || next.version < version.current) return;
    version.current = next.version;
    setState(next);
    if (next.refresh.status === 'updated') setProblem(null);
  }, []);

  useEffect(() => {
    live.current = true;
    const off = window.cockpit.onSpaceDashboardReport(take);
    void window.cockpit
      .spaceDashboardReport({})
      .then((result) => {
        if (!live.current) return;
        if (result.ok) take(result.value);
        else if (version.current < 0) setProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (live.current && version.current < 0) setProblem(String(caught));
      });
    return () => {
      live.current = false;
      off();
    };
  }, [take]);

  const refresh = useCallback((): void => {
    const current = ++request.current;
    setRequesting(true);
    setProblem(null);
    void window.cockpit
      .spaceDashboardRefresh({ reason: 'human' })
      .then((result) => {
        if (!live.current || current !== request.current) return;
        setRequesting(false);
        if (result.ok) take(result.value);
        else setProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (!live.current || current !== request.current) return;
        setRequesting(false);
        setProblem(caught instanceof Error ? caught.message : String(caught));
      });
  }, [take]);

  return {
    state,
    problem,
    refreshing:
      requesting || state?.refresh.status === 'requested' || state?.refresh.status === 'updating',
    refresh,
  };
}
