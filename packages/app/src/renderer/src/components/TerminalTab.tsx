import { type JSX, useCallback } from 'react';
import type { Shortcut, TerminalForegroundStatus } from '../../../shared/ipc.js';
import { SidebarTab } from './SidebarTab.js';
import { useXtermSession } from './useXtermSession.js';

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
  // The Shell tab owns its PTY's whole lifetime: it spawns at mount and is
  // killed on unmount (tab close). Shift+Enter, WebGL, resize, and the
  // data/exit/status wiring all live in the shared hook. `runCommand` is wired
  // to the sidebar shortcuts — if the shell is at a prompt the command runs
  // immediately; if a foreground task is running the bytes append to its stdin.
  const spawn = useCallback(() => window.cockpit.spawnTerminal(), []);
  const { hostRef, runCommand } = useXtermSession({
    active,
    spawn,
    killOnUnmount: true,
    exitMessage: '[process exited]',
    initialCommand,
    onStatus: (status, command) => {
      if (onStatus && tabId) onStatus(tabId, status, command);
    },
  });

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
