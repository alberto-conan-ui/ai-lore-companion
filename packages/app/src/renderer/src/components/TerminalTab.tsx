import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useCallback, useEffect, useRef } from 'react';
import type { Shortcut, TerminalForegroundStatus } from '../../../shared/ipc.js';
import { SidebarTab } from './SidebarTab.js';

const TERMINAL_THEME = {
  background: '#15191f',
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
  initialCommand,
  tabShortcuts = [],
}: {
  active: boolean;
  tabId?: string;
  onStatus?: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
  /** A one-shot command written to the PTY once it spawns — used by terminal
   *  shortcuts to run a command in the freshly opened tab. */
  initialCommand?: string;
  /** Configured shortcuts surfaced in the shell-tab sidebar. Terminal-target
   *  entries become clickable commands; non-terminal entries are ignored.
   *  Optional so `AlteredScreen`'s embedded terminal can mount without a
   *  shortcuts store. */
  tabShortcuts?: Shortcut[];
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
        if (p.id === id && onStatus && tabId) onStatus(tabId, p.status, p.command);
      });
      term.onData((data) => window.cockpit.sendTerminalInput({ id, data }));
      term.focus();
      // Terminal shortcut: write the one-shot command into the PTY. A small
      // delay lets the login shell finish writing its banner before our input
      // lands; without it the command interleaves with the prompt.
      if (initialCommand) {
        setTimeout(() => {
          if (!disposed) {
            window.cockpit.sendTerminalInput({ id, data: `${initialCommand}\n` });
          }
        }, 250);
      }
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
    // `doFit` / `onStatus` / `tabId` / `initialCommand` are all stable for the
    // component's lifetime, so the effect runs exactly once — at mount.
  }, [doFit, onStatus, tabId, initialCommand]);

  // Re-fit and focus when this tab becomes the visible one (it cannot lay out
  // while `display: none`).
  useEffect(() => {
    if (active) {
      doFit();
      termRef.current?.focus();
    }
  }, [active, doFit]);

  /** Send a command to the PTY and refocus the xterm. Wired from the sidebar
   *  shortcuts — if the shell is at a prompt, the command runs immediately;
   *  if a foreground task is running, the bytes are appended to its stdin
   *  (and effectively ignored if the task isn't reading), per the v0.9 spec. */
  const runCommand = useCallback((command: string): void => {
    if (idRef.current) {
      window.cockpit.sendTerminalInput({ id: idRef.current, data: `${command}\n` });
    }
    termRef.current?.focus();
  }, []);

  return (
    <SidebarTab
      testIdPrefix="shell-shortcuts"
      defaultWidth={220}
      expandTitle="Show shortcuts"
      collapseTitle="Hide shortcuts"
      hideTitle="Hide shortcuts"
      sidebar={<ShellShortcutsColumn shortcuts={tabShortcuts} onRun={runCommand} />}
      content={
        <div style={wrapStyle} data-testid="terminal">
          <div ref={hostRef} style={hostStyle} />
        </div>
      }
    />
  );
}

/** The shell-tab sidebar: each terminal-targeted shortcut renders as a row
 *  that runs the command in the PTY when clicked. URL shortcuts (browser) are
 *  filtered out — they belong inside Web tabs, not Shell tabs. */
function ShellShortcutsColumn({
  shortcuts,
  onRun,
}: {
  shortcuts: Shortcut[];
  onRun: (command: string) => void;
}): JSX.Element {
  const rows = shortcuts.filter((s) => s.target === 'terminal' && s.command);
  if (rows.length === 0) {
    return (
      <div style={emptyStyle}>
        No terminal shortcuts. Add some in <strong>Settings → Shortcuts</strong>.
      </div>
    );
  }
  return (
    <div style={listStyle} data-testid="shell-shortcuts-list">
      {rows.map((s) => (
        <button
          key={s.id}
          type="button"
          style={rowStyle}
          title={s.command}
          data-testid={`shell-shortcut-${s.id}`}
          onClick={() => onRun(s.command ?? '')}
        >
          <span style={labelStyle}>{s.label}</span>
          <span style={commandStyle}>{s.command}</span>
        </button>
      ))}
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

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0.5rem 0',
  gap: '0.3rem',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  padding: '0.35rem 0.85rem',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  font: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#dde3ea',
};

const commandStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.72rem',
  color: '#7a8590',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.85rem',
  fontSize: '0.78rem',
  color: '#6c7783',
  lineHeight: 1.5,
};
