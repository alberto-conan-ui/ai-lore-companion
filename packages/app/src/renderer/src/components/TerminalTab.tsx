import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useCallback, useEffect, useRef } from 'react';
import type { TerminalForegroundStatus } from '../../../shared/ipc.js';

const TERMINAL_THEME = {
  background: '#0a0f17',
  foreground: '#dde3ea',
  cursor: '#5a9bd4',
  selectionBackground: '#1d2c3d',
};

/**
 * A terminal tab — an `xterm.js` terminal bound to a real PTY in main. The
 * component's lifetime is the tab's lifetime: it mounts when the tab is
 * created and unmounts (killing the PTY) only when the tab is closed. Tab
 * switching toggles visibility, so this never unmounts on a switch.
 *
 * `onStatus` bubbles the PTY's foreground status up to the shell, which owns
 * the tab's title and idle/running indicator.
 */
export function TerminalTab({
  active,
  tabId,
  onStatus,
}: {
  active: boolean;
  tabId: string;
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Symbols Nerd Font Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Shift+Enter must insert a newline, not submit. xterm sends a bare `\r`
    // for both Enter and Shift+Enter, and Claude Code reads `\r` as submit.
    // Sending `\n` (LF — the Ctrl+J code) instead is the sequence Claude Code
    // reliably treats as newline-insert. (The "correct" Shift+Enter sequence
    // `\x1b[13;2u` is currently mis-parsed by Claude Code, so LF is used.)
    // Returning false for the whole keystroke — keydown and keypress — keeps
    // xterm from emitting its own `\r`.
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

    window.cockpit.spawnTerminal().then((id) => {
      if (disposed) {
        window.cockpit.killTerminal(id);
        return;
      }
      idRef.current = id;
      window.cockpit.resizeTerminal({ id, cols: term.cols, rows: term.rows });
      offData = window.cockpit.onTerminalData((p) => {
        if (p.id === id) term.write(p.data);
      });
      offExit = window.cockpit.onTerminalExit((p) => {
        if (p.id === id) term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      });
      offStatus = window.cockpit.onTerminalStatus((p) => {
        if (p.id === id) onStatus(tabId, p.status, p.command);
      });
      term.onData((data) => window.cockpit.sendTerminalInput({ id, data }));
      term.focus();
    });

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
      if (idRef.current) window.cockpit.killTerminal(idRef.current);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // `doFit` / `onStatus` / `tabId` are all stable for the component's
    // lifetime, so the effect runs exactly once — at mount.
  }, [doFit, onStatus, tabId]);

  // Re-fit and focus when this tab becomes the visible one (it cannot lay out
  // while `display: none`).
  useEffect(() => {
    if (active) {
      doFit();
      termRef.current?.focus();
    }
  }, [active, doFit]);

  return (
    <div style={wrapStyle} data-testid="terminal">
      <div ref={hostRef} style={hostStyle} />
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: '#0a0f17',
  padding: '4px 6px',
};

const hostStyle: React.CSSProperties = {
  height: '100%',
  width: '100%',
};
