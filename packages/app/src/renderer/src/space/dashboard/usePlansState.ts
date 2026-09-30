import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpacePlansState } from '../../../../shared/ipc.js';

/** How old the newest read may be before the band asks again. The tool's own cache is strict at 30 seconds too. */
export const PLANS_REFRESH_MS = 30_000;
/** No ask is made sooner than this after the last one (a clock that is early, a read that came back from the cache). */
export const PLANS_MIN_GAP_MS = 5_000;

/** What the Plans band knows of the Space's plans, and its actions. */
export type PlansStateView = {
  /** The last state main sent, or `null` before the first answer (or after main could not be asked). */
  plans: SpacePlansState | null;
  /** Why main could not be asked, or `null`. When it is set there is no list: nothing is shown from before. */
  problem: string | null;
  /** Whether a Refresh asked from this window has not answered yet. */
  requested: boolean;
  /** Whether the band is being read on its timer now: it is in view and the window is visible. */
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

/** Visible means visible: a window beside another, with no focus, still shows its band and is kept current. */
const windowVisible = (): boolean => document.visibilityState !== 'hidden';

/**
 * When to ask next: the scheme of the live dashboards (ai-lore#397). The band promises a minute from the START of the
 * read it shows, so it asks when the newest read it knows of is 30 s old, not 30 s after its last ask: a timer of its own
 * would drift against the tool's cache, which is strict at 30 s from the start of a read, and a tick that came a little
 * early would be answered from that cache and show the same read for 30 s more. Without a read to go by (a read that
 * failed, or none yet) it asks 30 s after the last ask. `now` and the times are milliseconds.
 */
export function nextPlansDelay(
  now: number,
  lastStart: number | null,
  newestReadStart: number | null,
): number {
  if (lastStart === null) return 0;
  const byAsk = lastStart + PLANS_REFRESH_MS - now;
  if (newestReadStart === null) return byAsk;
  return Math.max(newestReadStart + PLANS_REFRESH_MS - now, lastStart + PLANS_MIN_GAP_MS - now);
}

/**
 * The Space's plans as main pushes them. Modelled on `useRepositoriesState.ts`, with one difference: main starts no
 * read of its own, so this hook asks, on the schedule of `nextPlansDelay`, only while the band is in view and the window
 * is visible; when the window becomes visible and the newest read is 30 seconds old or more; and when Refresh is pressed.
 * A state replaces the shown one only when its `version` is not lower. An answer main could not give is shown as that,
 * with no list: a list from before is never put back in its place.
 */
export function usePlansState(): PlansStateView {
  const [plans, setPlans] = useState<SpacePlansState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(windowVisible);
  const [opening, setOpening] = useState<number | null>(null);
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const lastStart = useRef<number | null>(null);
  // the state last taken, kept here as well so the timer never reads a render's stale copy
  const latest = useRef<SpacePlansState | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const inViewRef = useRef(inView);
  inViewRef.current = inView;
  const timer = useRef<number | null>(null);
  const active = inView && visible;

  const isUnavailable = useCallback((): boolean => latest.current?.outcome === 'unavailable', []);

  const take = useCallback((next: SpacePlansState): void => {
    if (latest.current === null || next.version >= latest.current.version) {
      latest.current = next;
      setPlans(next);
    }
    setProblem(null);
  }, []);

  const canRead = useCallback(
    (): boolean => inViewRef.current && windowVisible() && !isUnavailable(),
    [isUnavailable],
  );

  // `read` and `schedule` call each other: `schedule` sets a timer that calls `read`, `read` ends by scheduling.
  const readRef = useRef<() => Promise<void>>(async () => undefined);

  const schedule = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!canRead()) return;
    const current = latest.current;
    // the newest read the state stands on: a list says when its read started; a failed read has none
    const readStart =
      current?.units !== null && current?.units !== undefined ? current.readAt : null;
    const delay = nextPlansDelay(Date.now(), lastStart.current, readStart);
    timer.current = window.setTimeout(
      () => {
        timer.current = null;
        if (canRead()) void readRef.current();
      },
      Math.max(0, delay),
    );
  }, [canRead]);

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
      })
      .then(schedule);
  }, [take, schedule]);
  readRef.current = read;

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

  // The window's visibility changes: read at once if the newest read is 30 seconds old or more, else wait for its time.
  useEffect(() => {
    const wake = (): void => {
      setVisible(windowVisible());
      if (!canRead()) {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        return;
      }
      const current = latest.current;
      const readStart =
        current?.units !== null && current?.units !== undefined ? current.readAt : null;
      if (nextPlansDelay(Date.now(), lastStart.current, readStart) <= 0) void read();
      else schedule();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [read, schedule, canRead]);

  // the band came into or went out of view
  useEffect(() => {
    if (!inView) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      return;
    }
    const current = latest.current;
    const readStart =
      current?.units !== null && current?.units !== undefined ? current.readAt : null;
    if (canRead() && nextPlansDelay(Date.now(), lastStart.current, readStart) <= 0) void read();
    else schedule();
  }, [inView, read, schedule, canRead]);

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
