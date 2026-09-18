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

/**
 * Whether create, adopt and open by address may be started, and the sentence
 * that says why not. `reason` is `null` only when `ready` is true.
 */
export type SetupReadiness = { ready: boolean; reason: string | null };

/** The readiness the screens derive from the state of the machine check. */
export function setupReadiness(view: MachineCheckView): SetupReadiness {
  if (view.report === null) {
    if (view.error !== null) {
      return {
        ready: false,
        reason: `Not available: the machine check did not run. ${view.error}`,
      };
    }
    return { ready: false, reason: 'Not available: the machine check is running.' };
  }
  if (view.report.check.ready) return { ready: true, reason: null };
  const notFine = view.report.check.requirements
    .filter((requirement) => requirement.state.kind !== 'fine')
    .map((requirement) => `${requirement.id} is ${requirement.state.kind}`);
  return {
    ready: false,
    reason: `Not available: the machine check is not ready. ${notFine.join(', ')}.`,
  };
}

/**
 * Asks main for the machine check when the screen mounts, and again on
 * `checkAgain`. On mount `fresh` decides whether main may answer with the last
 * check of this run of the app. The channel returns a result and does not
 * reject; a rejection is still caught, so that the screen shows it. An answer
 * that arrives after a later request, or after the screen is gone, is dropped.
 */
export function useMachineCheck(options: { freshOnMount: boolean }): MachineCheckView {
  const [checking, setChecking] = useState(true);
  const [report, setReport] = useState<MachineCheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const mounted = useRef(true);

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

  const checkAgain = useCallback((): void => {
    void request(true);
  }, [request]);

  return { checking, report, error, checkAgain };
}
