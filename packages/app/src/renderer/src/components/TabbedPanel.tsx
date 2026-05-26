import { type JSX, useState } from 'react';
import type { Shortcut, TerminalForegroundStatus } from '../../../shared/ipc.js';
import { type DriftLevel, driftLevel } from '../store.js';

/** A tab's kind selects which surface it renders. `pane` tabs are the pinned
 *  cockpit panes — not closable, not movable. */
export type TabKind = 'pane' | 'terminal' | 'browser';

/** A tab in a panel — `id` is stable for the tab's lifetime. */
export type WorkspaceTab = {
  id: string;
  kind: TabKind;
  /** The displayed title — auto-managed for terminals unless renamed by hand. */
  title: string;
  /** The default name a terminal/browser tab reverts to (`Terminal N`). */
  baseTitle?: string;
  /** True once the title was set by hand — freezes terminal auto-rename. */
  manualTitle?: boolean;
  /** A terminal tab's foreground status — drives the idle/running dot. */
  status?: TerminalForegroundStatus;
};

/** The three docks of the workspace. */
export type PanelId = 'left' | 'right' | 'bottom';

type Props = {
  panelId: PanelId;
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTerminal: () => void;
  onNewBrowser: () => void;
  /** Rename a tab — an empty name reverts to the auto-managed default. */
  onRenameTab: (id: string, name: string) => void;
  /** Move a tab — from a panel into this strip at `index` (drag and drop). */
  onMoveTab: (fromPanel: PanelId, tabId: string, toPanel: PanelId, index: number) => void;
  /** The panel's content slot — the shell portals tab content into it. */
  slotRef: (el: HTMLDivElement | null) => void;
  /** Per-tab unacked-drift counts, keyed by tab id — shown as a badge on the tab. */
  tabDrift?: Record<string, number>;
  /** Configured URL + terminal shortcuts — surfaced as `+ <name>` creators in
   *  the strip after the bare `+term`/`+web` defaults. */
  tabShortcuts: Shortcut[];
  /** Open a new browser tab in this panel, pre-navigated to `url`, titled `label`. */
  onCreateBrowserTab: (url: string, label: string) => void;
  /** Open a new terminal tab in this panel, running `command`, titled `label`. */
  onCreateTerminalTab: (command: string, label: string) => void;
  /** Launch a URL shortcut externally (Chrome) — used by the `↗` arrow. */
  onLaunchUrlExternal: (id: string) => void;
};

/** Drift badge on a pinned tab — count plus the four-level colour scale. */
const TAB_DRIFT_COLOR: Record<DriftLevel, { bg: string; fg: string }> = {
  idle: { bg: '#1f2933', fg: '#7c8893' },
  live: { bg: '#2c5b3f', fg: '#bcefcd' },
  warn: { bg: '#7a5a14', fg: '#ffdf91' },
  alert: { bg: '#7a1f1f', fg: '#ffc2c2' },
};

function DriftBadge({ count }: { count: number }): JSX.Element {
  const c = TAB_DRIFT_COLOR[driftLevel(count)];
  return (
    <span
      style={{ ...tabBadgeStyle, background: c.bg, color: c.fg }}
      aria-label={`${count} changed`}
    >
      {count}
    </span>
  );
}

/** Idle/running dot on a terminal tab — lit while a foreground task runs. */
function StatusDot({ status }: { status: TerminalForegroundStatus }): JSX.Element {
  const running = status === 'running';
  return (
    <span
      style={{
        ...statusDotStyle,
        background: running ? '#4cd07d' : '#3a4654',
        boxShadow: running ? '0 0 4px #4cd07d' : 'none',
      }}
      aria-label={running ? 'running' : 'idle'}
    />
  );
}

/**
 * A panel: a strip of typed, draggable tabs over a content slot. The strip is
 * a drop target — dropping a tab moves it here. The content slot stays empty;
 * the shell portals each tab's surface into it so a tab keeps its component
 * (terminal scrollback, browser page) when dragged between panels. Pinned
 * `pane` tabs cannot be moved or closed.
 */
export function TabbedPanel({
  panelId,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
  onNewBrowser,
  onRenameTab,
  onMoveTab,
  slotRef,
  tabDrift,
  tabShortcuts,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onLaunchUrlExternal,
}: Props): JSX.Element {
  // The tab currently being renamed inline, plus its draft text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (tab: WorkspaceTab): void => {
    setEditingId(tab.id);
    setDraft(tab.title);
  };
  const commitEdit = (): void => {
    if (editingId !== null) onRenameTab(editingId, draft);
    setEditingId(null);
  };

  const allowDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, index: number): void => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let parsed: { fromPanel: PanelId; tabId: string };
    try {
      parsed = JSON.parse(raw) as { fromPanel: PanelId; tabId: string };
    } catch {
      return;
    }
    onMoveTab(parsed.fromPanel, parsed.tabId, panelId, index);
  };

  return (
    <div style={panelStyle}>
      <div
        style={stripStyle}
        data-testid="tab-strip"
        onDragOver={allowDrop}
        onDrop={(e) => handleDrop(e, tabs.length)}
      >
        {tabs.map((tab, i) => {
          const active = tab.id === activeTabId;
          const pinned = tab.kind === 'pane';
          return (
            <div
              key={tab.id}
              style={{ ...tabStyle, ...(active ? activeTabStyle : null) }}
              data-testid={pinned ? `tab-${tab.id}` : `tab-${tab.kind}`}
              draggable={!pinned}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'text/plain',
                  JSON.stringify({ fromPanel: panelId, tabId: tab.id }),
                );
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={allowDrop}
              onDrop={(e) => handleDrop(e, i)}
            >
              {editingId === tab.id ? (
                <input
                  // Focus and select on mount so the rename is type-ready.
                  ref={(el) => el?.select()}
                  style={tabEditInput}
                  value={draft}
                  spellCheck={false}
                  aria-label="Rename tab"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  style={{ ...tabLabelBtn, color: active ? '#e6edf3' : '#8a96a2' }}
                  title={tab.title}
                  onClick={() => onSelectTab(tab.id)}
                  // Pinned panes keep fixed names; terminal/browser tabs rename.
                  onDoubleClick={pinned ? undefined : () => startEdit(tab)}
                >
                  {tab.kind === 'terminal' ? <StatusDot status={tab.status ?? 'idle'} /> : null}
                  <span style={tabTitleStyle}>{tab.title}</span>
                  {tabDrift && tab.id in tabDrift ? <DriftBadge count={tabDrift[tab.id]} /> : null}
                </button>
              )}
              {pinned ? null : (
                <button
                  type="button"
                  style={closeBtn}
                  title="Close tab"
                  onClick={() => onCloseTab(tab.id)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          style={newBtn}
          title="New terminal"
          data-testid="new-terminal"
          onClick={onNewTerminal}
        >
          + term
        </button>
        <button
          type="button"
          style={newBtn}
          title="New browser"
          data-testid="new-browser"
          onClick={onNewBrowser}
        >
          + web
        </button>
        {tabShortcuts.map((s) => {
          if (s.target === 'terminal' && s.command) {
            return (
              <button
                key={s.id}
                type="button"
                style={newBtn}
                title={`Run ${s.command} in a new terminal tab`}
                data-testid="tab-shortcut-terminal"
                onClick={() => onCreateTerminalTab(s.command ?? '', s.label)}
              >
                + {s.label}
              </button>
            );
          }
          if (s.target === 'url' && s.url) {
            // URL shortcuts are split: `+ <name>` opens an in-app browser tab;
            // `↗` opens the URL externally in Chrome via the existing launcher.
            return (
              <span key={s.id} style={splitBtnGroup}>
                <button
                  type="button"
                  style={newBtnSplitLeft}
                  title={`Open ${s.url} in a new browser tab`}
                  data-testid="tab-shortcut-url"
                  onClick={() => onCreateBrowserTab(s.url ?? '', s.label)}
                >
                  + {s.label}
                </button>
                <button
                  type="button"
                  style={newBtnSplitRight}
                  title={`Open ${s.url} externally in Chrome`}
                  data-testid="tab-shortcut-url-external"
                  onClick={() => onLaunchUrlExternal(s.id)}
                >
                  ↗
                </button>
              </span>
            );
          }
          return null;
        })}
      </div>
      <div ref={slotRef} style={contentSlot} />
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const contentSlot: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: '1px',
  background: '#0c121a',
  borderBottom: '1px solid #1f2933',
  padding: '0 0.3rem',
  minHeight: '32px',
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'transparent',
  borderRight: '1px solid #161c25',
};

const activeTabStyle: React.CSSProperties = {
  background: '#0a0f17',
  boxShadow: 'inset 0 -2px 0 #5a9bd4',
};

const tabLabelBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'grab',
  whiteSpace: 'nowrap',
};

const tabTitleStyle: React.CSSProperties = {
  display: 'inline-block',
  maxWidth: '14rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'middle',
};

const statusDotStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '7px',
  height: '7px',
  borderRadius: '50%',
};

const tabEditInput: React.CSSProperties = {
  margin: '0.2rem 0.45rem',
  width: '8rem',
  padding: '0.15rem 0.3rem',
  background: '#0a0f17',
  border: '1px solid #5a9bd4',
  borderRadius: '3px',
  color: '#e6edf3',
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const tabBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: '1.1rem',
  height: '1.05rem',
  padding: '0 0.3rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  fontSize: '0.62rem',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const closeBtn: React.CSSProperties = {
  padding: '0 0.4rem 0 0',
  background: 'transparent',
  border: 'none',
  color: '#6c7783',
  fontSize: '0.9rem',
  lineHeight: 1,
  cursor: 'pointer',
};

const newBtn: React.CSSProperties = {
  padding: '0 0.5rem',
  background: 'transparent',
  border: 'none',
  color: '#9fb1bd',
  fontSize: '0.72rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

/** URL tab shortcuts render as a split button — `+ <name>` on the left,
 *  `↗` (external) on the right — sharing visual styling so they read as one. */
const splitBtnGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
};

const newBtnSplitLeft: React.CSSProperties = {
  ...newBtn,
  paddingRight: '0.25rem',
};

const newBtnSplitRight: React.CSSProperties = {
  ...newBtn,
  paddingLeft: '0.15rem',
  paddingRight: '0.5rem',
  color: '#6c7783',
  fontSize: '0.78rem',
};
