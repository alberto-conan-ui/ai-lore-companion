import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingDialog, SettledDialog } from '../../../../shared/ipc.js';

/**
 * How long the keyboard must be quiet before a new request opens its dialog on
 * its own. A modal dialog takes the focus when it opens; waiting for a pause in
 * typing keeps a keystroke meant for a terminal from landing in the dialog.
 */
export const TYPING_PAUSE_MS = 1500;

/** Keep the element that has the focus, unless one is kept already: the first of a run of dialogs. */
function rememberFocus(kept: { current: HTMLElement | null }): void {
  const active = document.activeElement;
  if (kept.current === null && active instanceof HTMLElement && active !== document.body) {
    kept.current = active;
  }
}

/** The `show` of every mounted queue: a Space window mounts one. */
const showListeners = new Set<(ticket: string) => void>();

/**
 * Open the dialog of a pending request from outside the list of requests, for
 * example from the Dashboard's Needs you (phase M7.4). As the list's Open
 * action does: a request that is not pending opens nothing. Answers `false`
 * when no queue is mounted in this window.
 */
export function openDialogTicket(ticket: string): boolean {
  for (const show of showListeners) show(ticket);
  return showListeners.size > 0;
}

/** What `useDialogQueue` gives `SpaceDialogs`. */
export type DialogQueue = {
  /** The requests that wait, oldest first, as main last sent them. */
  requests: PendingDialog[];
  /** The request whose dialog is open, or `null`. */
  open: PendingDialog | null;
  /** The position of the open request in the list, from 1. */
  position: number;
  /** The last request that ended, with what happened to it. */
  settled: SettledDialog | null;
  /** Why the list could not be read, or `null`. */
  error: string | null;
  /** Open the dialog of a request from the list. */
  show(ticket: string): void;
  /** Close the open dialog without answering. The request stays in the list. */
  close(): void;
};

/**
 * The queue of requests of this Space window.
 *
 * - The list comes from main: one `spaceDialogsPending` call when the window
 *   mounts, then the push `onSpaceDialogsPending` at every change.
 * - One dialog is open at a time. When none is open, the oldest request that
 *   the Human Lead has not closed opens on its own, once no key was pressed for
 *   `TYPING_PAUSE_MS`. Until then the list above the screen shows it.
 * - Closing a dialog answers nothing: the request stays pending and in the
 *   list, and it opens again only from the list.
 * - A request that ends while its dialog is open (answered in another way,
 *   cancelled by its session, or ended with the session) closes the dialog.
 */
export function useDialogQueue(): DialogQueue {
  const [requests, setRequests] = useState<PendingDialog[]>([]);
  const [settled, setSettled] = useState<SettledDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const lastKeyAt = useRef(0);
  /** Where the focus was before the first of a run of dialogs opened. */
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    const off = window.cockpit.onSpaceDialogsPending((payload) => {
      setRequests(payload.requests);
      if (payload.settled !== null) setSettled(payload.settled);
    });
    void window.cockpit.spaceDialogsPending({}).then((result) => {
      if (!live) return;
      if (result.ok) {
        setRequests(result.value.requests);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // Keys are seen in the capture phase, before a terminal or an editor handles them.
  useEffect(() => {
    const onKey = (): void => {
      lastKeyAt.current = Date.now();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A request that ended closes its dialog, and is forgotten by the closed set.
  useEffect(() => {
    if (openTicket !== null && !requests.some((request) => request.ticket === openTicket)) {
      setOpenTicket(null);
    }
    setClosed((before) => {
      const kept = [...before].filter((ticket) => requests.some((r) => r.ticket === ticket));
      return kept.length === before.size ? before : new Set(kept);
    });
  }, [requests, openTicket]);

  // Open the next request on its own, after a pause in typing. A key pressed during the wait
  // starts the wait again.
  useEffect(() => {
    if (openTicket !== null) return;
    const next = requests.find((request) => !closed.has(request.ticket));
    if (next === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (): void => {
      const wait = TYPING_PAUSE_MS - (Date.now() - lastKeyAt.current);
      if (wait <= 0) {
        rememberFocus(returnFocus);
        setOpenTicket(next.ticket);
      } else timer = setTimeout(attempt, wait);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [requests, closed, openTicket]);

  // When no dialog is open any more, the focus goes back where it was before the first one
  // opened (a terminal, usually). The dialog itself does not do it: it has no trigger to
  // return to. A dialog that opens next cancels the return.
  useEffect(() => {
    if (openTicket !== null || returnFocus.current === null) return;
    const timer = setTimeout(() => {
      const element = returnFocus.current;
      returnFocus.current = null;
      if (element?.isConnected) element.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [openTicket]);

  const show = useCallback((ticket: string): void => {
    rememberFocus(returnFocus);
    setOpenTicket(ticket);
  }, []);
  useEffect(() => {
    showListeners.add(show);
    return () => {
      showListeners.delete(show);
    };
  }, [show]);
  const close = useCallback((): void => {
    if (openTicket !== null) setClosed((before) => new Set(before).add(openTicket));
    setOpenTicket(null);
  }, [openTicket]);

  const index = requests.findIndex((request) => request.ticket === openTicket);
  return {
    requests,
    open: index === -1 ? null : (requests[index] ?? null),
    position: index + 1,
    settled,
    error,
    show,
    close,
  };
}
