import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpacePlansState } from '../../../../shared/ipc.js';

/** How often the band asks for the plans again while it can be seen. The tool's own cache is 30 seconds too. */
export const PLANS_REFRESH_MS = 30_000;

/** What the Plans band knows of the Space's plans, and its actions. */
export type PlansStateView = {
  /** The last state main sent, or `null` before the first answer (or after main could not be asked). */
  plans: SpacePlansState | null;
  /** Why main could not be asked, or `null`. When it is set there is no list: nothing is shown from before. */
  problem: string | null;
  /** Whether a Refresh asked from this window has not answered yet. */
  requested: boolean;
  /** Whether the band is being read on its timer now: it is in view and the window is in front. */
  active: boolean;
  /** The row whose dashboard is being opened, or `null`. */
  opening: number | null;
  /** Why the last row did not open, or `null`. */
  openProblem: string | null;
  refresh: () => void;
  open: (number: number) => void;
  /** Attach to the band's element, so it is read only while it is in view. */
  bandRef: (element: Element | null) => void;
};

const windowInFront = (): boolean => document.visibilityState !== 'hidden' && document.hasFocus();

/**
 * The Space's plans as main pushes them. Modelled on `useRepositoriesState.ts`, with one difference: main starts no
 * read of its own, so this hook asks, every `PLANS_REFRESH_MS`, and only while the band is in view and the window is
 * in front (an interval that finds it is not does nothing), when the window comes to the front after 30 seconds or
 * more, and when Refresh is pressed. A state replaces the shown one only when its `version` is not lower. An answer
 * main could not give is shown as that, with no list: a list from before is never put back in its place.
 */
export function usePlansState(): PlansStateView {
  const [plans, setPlans] = useState<SpacePlansState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [inView, setInView] = useState(true);
  const [front, setFront] = useState(windowInFront);
  const [opening, setOpening] = useState<number | null>(null);
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const lastStart = useRef<number | null>(null);
  // the state last taken, kept here as well so the timer never reads a render's stale copy
  const latest = useRef<SpacePlansState | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const inViewRef = useRef(inView);
  inViewRef.current = inView;
  const active = inView && front;

  const isUnavailable = useCallback((): boolean => latest.current?.outcome === 'unavailable', []);

  const take = useCallback((next: SpacePlansState): void => {
    if (latest.current === null || next.version >= latest.current.version) {
      latest.current = next;
      setPlans(next);
    }
    setProblem(null);
  }, []);

  const read = useCallback((): Promise<void> => {
    lastStart.current = Date.now();
    return window.cockpit
      .spacePlansRefresh({})
      .then((answer) => {
        if (answer.ok) take(answer.value);
        else {
          latest.current = null;
          setPlans(null);
          setProblem(answer.error.message);
        }
      })
      .catch((caught: unknown) => {
        latest.current = null;
        setPlans(null);
        setProblem(
          `Plans could not be asked for: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
  }, [take]);

  useEffect(() => {
    let live = true;
    const off = window.cockpit.onSpacePlansState((next) => {
      if (live) take(next);
    });
    void window.cockpit.spacePlansState({}).then((answer) => {
      if (live && answer.ok && answer.value.outcome !== null) take(answer.value);
    });
    return () => {
      live = false;
      off();
    };
  }, [take]);

  useEffect(() => {
    const due = (): boolean =>
      lastStart.current === null || Date.now() - lastStart.current >= PLANS_REFRESH_MS;
    const wake = (): void => {
      const now = windowInFront();
      setFront(now);
      if (now && inViewRef.current && !isUnavailable() && due()) void read();
    };
    const timer = window.setInterval(() => {
      const now = windowInFront();
      setFront(now);
      if (now && inViewRef.current && !isUnavailable()) void read();
    }, PLANS_REFRESH_MS);
    window.addEventListener('focus', wake);
    window.addEventListener('blur', wake);
    document.addEventListener('visibilitychange', wake);
    wake();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('blur', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [read, isUnavailable]);

  // the band came into view: read at once if the last read is 30 seconds old or more
  useEffect(() => {
    const old = lastStart.current === null || Date.now() - lastStart.current >= PLANS_REFRESH_MS;
    if (inView && windowInFront() && !isUnavailable() && old) void read();
  }, [inView, read, isUnavailable]);

  const refresh = useCallback((): void => {
    setRequested(true);
    void read().then(() => setRequested(false));
  }, [read]);

  const open = useCallback((number: number): void => {
    setOpening(number);
    setOpenProblem(null);
    void window.cockpit
      .spacePlansOpen({ number })
      .then((answer) => {
        if (!answer.ok) setOpenProblem(answer.error.message);
      })
      .catch((caught: unknown) =>
        setOpenProblem(
          `The dashboard was not opened: ${caught instanceof Error ? caught.message : String(caught)}`,
        ),
      )
      .then(() => setOpening(null));
  }, []);

  const bandRef = useCallback((element: Element | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (element === null || typeof IntersectionObserver === 'undefined') {
      if (element === null) return;
      setInView(true);
      return;
    }
    const next = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) setInView(last.isIntersecting);
    });
    next.observe(element);
    observer.current = next;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { plans, problem, requested, active, opening, openProblem, refresh, open, bandRef };
}
