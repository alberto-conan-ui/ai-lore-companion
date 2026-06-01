import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import {
  PTY_FLOW_PAUSE,
  PTY_FLOW_RESUME,
  type TerminalForegroundStatus,
} from '../../../shared/ipc.js';

/** Backpressure thresholds (chars of un-parsed PTY output). Pause the child when
 *  xterm falls this far behind; resume once it has caught up. */
const FLOW_HIGH_WATER = 200_000;
const FLOW_LOW_WATER = 20_000;

/** Match-highlight colours for the find addon, tuned to `TERMINAL_THEME`. */
const SEARCH_DECORATIONS = {
  matchBackground: '#3a4658',
  matchOverviewRuler: '#3a4658',
  activeMatchBackground: '#5a9bd4',
  activeMatchColorOverviewRuler: '#5a9bd4',
} as const;

/** The find-bar API a terminal surface drives (see `FindBar`). */
export interface XtermSearchHandle {
  /** Highlight + jump to the next match of `query` (wraps). */
  findNext: (query: string) => void;
  /** Highlight + jump to the previous match of `query` (wraps). */
  findPrevious: (query: string) => void;
  /** Clear all match decorations. */
  clear: () => void;
  /** Subscribe to match-count changes; returns an unsubscribe. `resultIndex` is
   *  the 0-based active match (-1 when none); `resultCount` the total. */
  onResults: (cb: (r: { resultIndex: number; resultCount: number }) => void) => () => void;
}

/**
 * The single source of truth for the integrated terminal's xterm.js setup.
 *
 * Both the Shell tab (`TerminalTab`) and the AI tab's running view
 * (`AiTab`'s `RunningPty`) drive a real PTY through an `xterm.js` terminal
 * with byte-identical config — theme, font, the WebGL renderer, the
 * Shift+Enter handler, fit/resize wiring, and the data/exit/status
 * subscriptions. This hook owns all of it so each surface (and any future
 * terminal-backed tab kind) wires it once, not by copy-paste.
 */
export const TERMINAL_THEME = {
  background: '#15191f',
  foreground: '#dde3ea',
  cursor: '#5a9bd4',
  selectionBackground: '#1d2c3d',
} as const;

const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, "Symbols Nerd Font Mono", monospace';

export interface XtermSessionConfig {
  /** True when this tab is the visible one — drives re-fit + focus on show. */
  active: boolean;
  /**
   * The PTY this session binds to. Provide **exactly one**:
   *   - `ptyId` — an already-spawned PTY (the AI tab spawns its engine PTY
   *     before mounting the view, so it passes the id in).
   *   - `spawn` — a spawner the hook calls at mount to create the PTY (the
   *     Shell tab owns its PTY's whole lifetime, so it spawns here).
   */
  ptyId?: string;
  spawn?: () => Promise<string | null>;
  /**
   * Kill the PTY when the session unmounts. The Shell tab owns its PTY, so
   * `true`; the AI tab manages its engine PTY's lifetime itself (Restart
   * re-uses the tab), so `false`.
   */
  killOnUnmount?: boolean;
  /** Dim message written into the terminal when the PTY exits. */
  exitMessage?: string;
  /** A one-shot command written to the PTY shortly after it spawns (terminal
   *  shortcuts). Only meaningful with `spawn`. */
  initialCommand?: string;
  /** Bubble the PTY's foreground status up to the caller (drives the tab title).
   *  The caller binds its own tabId. */
  onStatus?: (status: TerminalForegroundStatus, command: string) => void;
  /**
   * Render the session **read-only** — display the PTY's output but don't
   * forward keystrokes to it (xterm `disableStdin`, no `onData` → input wiring).
   * The AI Helper's visible session (CR2) uses this: the user watches the
   * conversation, but only the app drives turns (it injects from `main`, not
   * through this terminal). Defaults to false — Shell / AI tabs stay writable.
   */
  readOnly?: boolean;
}

export interface XtermSessionHandle {
  /** Attach to the host `<div>` the terminal mounts into. */
  hostRef: RefObject<HTMLDivElement>;
  /** Focus the terminal — e.g. after a sidebar click hands control back. */
  focus: () => void;
  /** Write `command` + newline into the PTY and refocus (sidebar shortcuts). */
  runCommand: (command: string) => void;
  /** Drives the in-terminal find bar (⌘F). */
  search: XtermSearchHandle;
}

export function useXtermSession(config: XtermSessionConfig): XtermSessionHandle {
  const {
    active,
    ptyId,
    spawn,
    killOnUnmount = false,
    exitMessage,
    initialCommand,
    onStatus,
    readOnly = false,
  } = config;

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const idRef = useRef<string | null>(null);
  // Hold the latest callbacks without re-running the mount effect when the
  // caller passes a fresh closure.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  // Match-result listeners (the find bar subscribes for its count display).
  const resultListenersRef = useRef(
    new Set<(r: { resultIndex: number; resultCount: number }) => void>(),
  );

  const search = useRef<XtermSearchHandle>({
    findNext: (query) => {
      searchRef.current?.findNext(query, { decorations: SEARCH_DECORATIONS });
    },
    findPrevious: (query) => {
      searchRef.current?.findPrevious(query, { decorations: SEARCH_DECORATIONS });
    },
    clear: () => searchRef.current?.clearDecorations(),
    onResults: (cb) => {
      resultListenersRef.current.add(cb);
      return () => resultListenersRef.current.delete(cb);
    },
  }).current;

  const doFit = useCallback(() => {
    const host = hostRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    // `offsetParent` is null while the tab is hidden — fitting then would
    // measure zero. The active-effect re-fits when the tab is shown again.
    if (!host || !term || !fit || host.offsetParent === null) return;
    fit.fit();
    if (idRef.current) {
      window.cockpit.resizeTerminal({ id: idRef.current, cols: term.cols, rows: term.rows });
    }
  }, []);

  const focus = useCallback((): void => {
    termRef.current?.focus();
  }, []);

  const runCommand = useCallback((command: string): void => {
    if (idRef.current) {
      window.cockpit.sendTerminalInput({ id: idRef.current, data: `${command}\n` });
    }
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      cursorBlink: !readOnly,
      // Read-only session (the helper's visible view): xterm swallows keyboard
      // input. Programmatic `term.write` (the PTY's streamed output) is
      // unaffected; the app drives turns from `main`, not through this terminal.
      disableStdin: readOnly,
      // Required by the Unicode11 + search-decoration addons, which use xterm's
      // proposed API surface.
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // WebGL renderer eliminates the visible flicker the default DOM renderer
    // shows under high-update-rate TUIs (gemini's thinking spinner is the
    // motivating case). Mount-time try/catch covers GPU-context-creation
    // failure (older / virtualised macs); onContextLoss disposes the addon
    // so xterm.js falls back to its DOM renderer if the GPU context is lost
    // mid-session (laptop sleep/wake, dGPU switching).
    //
    // Skip in Playwright-driven runs: WebGL renders into a <canvas>, so the
    // .xterm-rows DOM nodes our e2e tests assert against disappear. Production
    // users see WebGL; tests see the DOM renderer they're written against.
    if (!navigator.webdriver) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // WebGL unavailable — DOM renderer stays in place.
      }
    }

    // Wide-glyph width: activate Unicode v11 so emoji / CJK / combining marks
    // occupy the correct cell count (no cursor drift on emoji-heavy output).
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    // Clickable links — URLs in output open in the external browser, matching
    // iTerm's ⌘-click.
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void window.cockpit.openExternal(uri);
      }),
    );

    // In-terminal find (⌘F). The bar UI lives in the surface; this addon does
    // the matching + decorations and reports counts to subscribers.
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    const offResults = search.onDidChangeResults((r) => {
      for (const listener of resultListenersRef.current) listener(r);
    });

    // Shift+Enter must insert a newline, not submit. xterm sends a bare `\r`
    // for both Enter and Shift+Enter, and Claude Code / Gemini read `\r` as
    // submit. Sending `\n` (LF — the Ctrl+J code) instead is the sequence
    // they reliably treat as newline-insert. (The "correct" Shift+Enter
    // sequence `\x1b[13;2u` is currently mis-parsed, so LF is used.) Returning
    // false for the whole keystroke — keydown and keypress — keeps xterm from
    // emitting its own `\r`.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        if (e.type === 'keydown' && idRef.current) {
          window.cockpit.sendTerminalInput({ id: idRef.current, data: '\n' });
        }
        return false;
      }
      return true;
    });

    let disposed = false;
    let offData = (): void => {};
    let offExit = (): void => {};
    let offStatus = (): void => {};

    const bind = (id: string): void => {
      idRef.current = id;
      window.cockpit.resizeTerminal({ id, cols: term.cols, rows: term.rows });
      // Flow control: count un-parsed bytes via xterm's write callback. When the
      // terminal falls behind a flood, send XOFF to pause the child; resume with
      // XON once it has drained. Keeps a `yes`/`cat <big>` from locking the UI.
      let pending = 0;
      let paused = false;
      offData = window.cockpit.onTerminalData((p) => {
        if (p.id !== id) return;
        pending += p.data.length;
        term.write(p.data, () => {
          pending -= p.data.length;
          if (paused && pending <= FLOW_LOW_WATER) {
            paused = false;
            window.cockpit.sendTerminalInput({ id, data: PTY_FLOW_RESUME });
          }
        });
        if (!paused && pending >= FLOW_HIGH_WATER) {
          paused = true;
          window.cockpit.sendTerminalInput({ id, data: PTY_FLOW_PAUSE });
        }
      });
      offExit = window.cockpit.onTerminalExit((p) => {
        if (p.id === id && exitMessage) term.write(`\r\n\x1b[2m${exitMessage}\x1b[0m\r\n`);
      });
      offStatus = window.cockpit.onTerminalStatus((p) => {
        if (p.id === id) onStatusRef.current?.(p.status, p.command);
      });
      // Read-only sessions don't forward keystrokes — the app drives turns from
      // `main`. (`disableStdin` already blocks input; skipping the wire is belt
      // and braces, and avoids focusing a terminal the user can't type into.)
      if (!readOnly) {
        term.onData((data) => window.cockpit.sendTerminalInput({ id, data }));
        term.focus();
      }
      if (initialCommand) {
        // A small delay lets the login shell finish writing its banner before
        // our input lands; without it the command interleaves with the prompt.
        setTimeout(() => {
          if (!disposed) window.cockpit.sendTerminalInput({ id, data: `${initialCommand}\n` });
        }, 250);
      }
    };

    if (ptyId) {
      bind(ptyId);
    } else if (spawn) {
      void spawn().then((id) => {
        if (!id) return;
        if (disposed) {
          window.cockpit.killTerminal(id);
          return;
        }
        bind(id);
      });
    }

    const onResize = (): void => doFit();
    window.addEventListener('resize', onResize);
    // Refit when the host's own box changes — a dock resize or a tab moved to
    // a differently sized panel, neither of which fires a window resize.
    const resizeObserver = new ResizeObserver(() => doFit());
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      offData();
      offExit();
      offStatus();
      offResults.dispose();
      if (killOnUnmount && idRef.current) window.cockpit.killTerminal(idRef.current);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      idRef.current = null;
    };
    // NOT `active` — toggling tab visibility must not tear down + respawn the
    // PTY. Visibility re-fit/focus lives in the separate effect below. For the
    // Shell tab `ptyId`/`spawn` are stable so this runs once at mount; for the
    // AI tab `ptyId` changes when a new engine PTY is bound, re-running here.
  }, [ptyId, spawn, killOnUnmount, exitMessage, initialCommand, doFit, readOnly]);

  // Re-fit and focus when this tab becomes the visible one (it cannot lay out
  // while `display: none`).
  useEffect(() => {
    if (active) {
      doFit();
      termRef.current?.focus();
    }
  }, [active, doFit]);

  return { hostRef, focus, runCommand, search };
}

/** Custom DOM event App fires on ⌘F when a terminal holds focus (the ⌘F menu
 *  accelerator can't reach xterm directly, so it routes through here). */
export const TERMINAL_FIND_EVENT = 'cockpit:terminal-find';

/**
 * Open a terminal surface's find bar when ⌘F is pressed *and this surface's
 * terminal has focus*. App dispatches {@link TERMINAL_FIND_EVENT} on the ⌘F
 * accelerator; each terminal listens and only the focused one (whose `hostRef`
 * contains the active element) responds — giving the "terminal-focused only"
 * behaviour the global file search keeps elsewhere.
 */
export function useTerminalFindShortcut(
  hostRef: RefObject<HTMLDivElement>,
  open: () => void,
): void {
  useEffect(() => {
    const onFind = (): void => {
      const host = hostRef.current;
      if (host && document.activeElement && host.contains(document.activeElement)) open();
    };
    window.addEventListener(TERMINAL_FIND_EVENT, onFind);
    return () => window.removeEventListener(TERMINAL_FIND_EVENT, onFind);
  }, [hostRef, open]);
}
