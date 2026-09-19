import { useCallback, useEffect, useRef, useState } from 'react';
import type { MachineCheckReport } from '../../../../shared/ipc.js';

/** What `useMachineCheck` gives a screen. */
export type MachineCheckView = {
  /** True while main runs the check. */
  checking: boolean;
  /** The last report received. While a later check runs, the earlier report stays. */
  report: MachineCheckReport | null;
  /** Why the last request gave no report, or `null`. */
  error: string | null;
  /** Run the check now ("check again"). */
  checkAgain: () => void;
};

/** How often the window's own focus may trigger a fresh check. */
const FOCUS_RECHECK_MIN_INTERVAL_MS = 3_000;

/**
 * Asks main for the machine check when the screen mounts, and again on
 * `checkAgain`. On mount `freshOnMount` decides whether main may answer with
 * the last check of this run of the app. The channel returns a result and
 * does not reject; a rejection is still caught, so that the screen shows it.
 * An answer that arrives after a later request, or after the screen is gone,
 * is dropped.
 *
 * The screen also asks again, fresh, when the window regains focus (a fix was
 * likely run outside the app, or in another window's command panel), at most
 * once every `FOCUS_RECHECK_MIN_INTERVAL_MS`.
 */
export function useMachineCheck(options: { freshOnMount: boolean }): MachineCheckView {
  const [checking, setChecking] = useState(true);
  const [report, setReport] = useState<MachineCheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const mounted = useRef(true);
  const lastFocusCheck = useRef(0);

  const request = useCallback(async (fresh: boolean): Promise<void> => {
    latest.current += 1;
    const mine = latest.current;
    setChecking(true);
    setError(null);
    let next: MachineCheckReport | null = null;
    let message: string | null = null;
    try {
      const result = await window.cockpit.spaceMachineCheck({ fresh });
      if (result.ok) next = result.value;
      else message = result.error.message;
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    if (!mounted.current || mine !== latest.current) return;
    if (next !== null) setReport(next);
    setError(message);
    setChecking(false);
  }, []);

  const { freshOnMount } = options;
  useEffect(() => {
    mounted.current = true;
    void request(freshOnMount);
    return () => {
      mounted.current = false;
    };
  }, [request, freshOnMount]);

  useEffect(() => {
    const onFocus = (): void => {
      const now = Date.now();
      if (now - lastFocusCheck.current < FOCUS_RECHECK_MIN_INTERVAL_MS) return;
      lastFocusCheck.current = now;
      void request(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [request]);

  const checkAgain = useCallback((): void => {
    void request(true);
  }, [request]);

  return { checking, report, error, checkAgain };
}
