import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, useState } from 'react';
import type { TerminalForegroundStatus } from '../../../shared/ipc.js';
import { type DriftLevel, driftLevel } from '../store.js';

/** A tab's kind selects which surface it renders. `pane` tabs are the
 *  cockpit's pinned sub-rooted file views (Status / Payload / Memory) — they
 *  live alongside the user-created tabs in the strip but cannot be closed or
 *  reordered. `shell` and `ai` both back onto the integrated terminal pane;
 *  `shell` is a plain PTY, `ai` is the host for a structured AI session. */
export type TabKind = 'pane' | 'shell' | 'ai' | 'browser';

/** A tab in a panel — `id` is stable for the tab's lifetime. */
export type WorkspaceTab = {
  id: string;
  kind: TabKind;
  /** The displayed title — auto-managed for shell/ai/browser unless renamed by hand. */
  title: string;
  /** The default name a shell/ai/browser tab reverts to (`Shell N`, `AI N`, ...). */
  baseTitle?: string;
  /** True once the title was set by hand — freezes auto-rename. */
  manualTitle?: boolean;
  /** A shell tab's foreground status — drives the idle/running dot. */
  status?: TerminalForegroundStatus;
  /** For `kind === 'ai'`: the engine chosen when the tab was opened. */
  engine?: string;
};

/** Pick the engine id the strip's `+ AI` button creates a tab with. The
 *  project's last pick if it still exists; otherwise the first available; an
 *  empty string when no engines exist (the button is disabled in that case). */
function defaultEngineId(
  engines: readonly EngineEntry[],
  lastEngineId: string | null,
): string {
  if (lastEngineId && engines.some((e) => e.id === lastEngineId)) return lastEngineId;
  return engines[0]?.id ?? '';
}

/**
 * The six panels of the v0.9 workspace. Three columns side-by-side, each
 * with its own column-width bottom dock:
 *
 *   ┌────────────┬─────────┬─────────┐
 *   │  leftRail  │  centre │  right  │
 *   │            │         │         │
 *   ├────────────┼─────────┼─────────┤
 *   │ leftRail   │ centre  │ right   │
 *   │  Bottom    │  Bottom │  Bottom │
 *   └────────────┴─────────┴─────────┘
 *
 * `leftRail` is the locked nav rail (Status / Payload / Memory / Publish);
 * its top strip has no creators and refuses drops in Phase C onward. The
 * five other panels are free workspaces.
 */
export type PanelId =
  | 'leftRail'
  | 'centre'
  | 'right'
  | 'leftRailBottom'
  | 'centreBottom'
  | 'rightBottom';

type Props = {
  panelId: PanelId;
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** Create a plain `kind: 'shell'` tab — today's PTY behaviour. */
  onNewShell: () => void;
  /** Create a new `kind: 'ai'` tab bound to the chosen engine id. The tab
   *  opens in empty state; the user clicks Start to spawn the engine. */
  onNewAi: (engineId: string) => void;
  /** Configured engines — used to resolve the default engine the strip's
   *  `+ AI` button creates a tab with. Empty list disables the button. */
  engines: readonly EngineEntry[];
  /** The id of the engine last picked in this project — preferred default for
   *  the strip's `+ AI` button so the user's most recent choice is the easiest
   *  target. The user picks a different engine in the AI tab's dropdown if
   *  they want one, before clicking Start. */
  lastEngineId: string | null;
  onNewBrowser: () => void;
  /** Rename a tab — an empty name reverts to the auto-managed default. */
  onRenameTab: (id: string, name: string) => void;
  /** Move a tab — from a panel into this strip at `index` (drag and drop). */
  onMoveTab: (fromPanel: PanelId, tabId: string, toPanel: PanelId, index: number) => void;
  /** The panel's content slot — the shell portals tab content into it. */
  slotRef: (el: HTMLDivElement | null) => void;
  /** Per-tab unacked-drift counts, keyed by tab id — shown as a badge on the tab. */
  tabDrift?: Record<string, number>;
  /** When true the strip is locked: no `+ AI / + shell / + web` creators,
   *  drops are refused. Used by the leftRail in v0.9 so the nav rail stays
   *  pinned-only. */
  locked?: boolean;
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

/** Idle/running dot on a shell tab — lit while a foreground task runs. */
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

/** Filled-glyph badge on an AI tab — the kind marker (Phase B will overlay an
 *  idle/running indicator on top of it). */
function AiBadge(): JSX.Element {
  return (
    <span style={aiBadgeStyle} aria-label="AI tab">
      ✦
    </span>
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
  onNewShell,
  onNewAi,
  engines,
  lastEngineId,
  onNewBrowser,
  onRenameTab,
  onMoveTab,
  slotRef,
  tabDrift,
  locked = false,
}: Props): JSX.Element {
  // The tab currently being renamed inline, plus its draft text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // The engine `+ AI` opens a new tab with — last-picked if still available,
  // first otherwise. The user can change it in the new tab's empty-state
  // dropdown before clicking Start.
  const newAiEngineId = defaultEngineId(engines, lastEngineId);

  const startEdit = (tab: WorkspaceTab): void => {
    setEditingId(tab.id);
    setDraft(tab.title);
  };
  const commitEdit = (): void => {
    if (editingId !== null) onRenameTab(editingId, draft);
    setEditingId(null);
  };

  const allowDrop = (e: React.DragEvent): void => {
    if (locked) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, index: number): void => {
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
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
          return (
            <div
              key={tab.id}
              style={{ ...tabStyle, ...(active ? activeTabStyle : null) }}
              data-testid={tab.kind === 'pane' ? `tab-${tab.id}` : `tab-${tab.kind}`}
              data-tab-kind={tab.kind}
              draggable={tab.kind !== 'pane'}
              onDragStart={(e) => {
                if (tab.kind === 'pane') {
                  e.preventDefault();
                  return;
                }
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
                  style={{
                    ...tabLabelBtn,
                    color: active ? '#e6edf3' : '#8a96a2',
                    // Pinned panes don't carry the drag-cursor hint other tabs do.
                    cursor: tab.kind === 'pane' ? 'pointer' : 'grab',
                  }}
                  title={tab.kind === 'ai' && tab.engine ? `${tab.title} · ${tab.engine}` : tab.title}
                  onClick={() => onSelectTab(tab.id)}
                  onDoubleClick={() => {
                    if (tab.kind !== 'pane') startEdit(tab);
                  }}
                >
                  {tab.kind === 'shell' ? <StatusDot status={tab.status ?? 'idle'} /> : null}
                  {tab.kind === 'ai' ? <AiBadge /> : null}
                  <span style={tabTitleStyle}>{tab.title}</span>
                  {tabDrift && tab.id in tabDrift ? <DriftBadge count={tabDrift[tab.id]} /> : null}
                </button>
              )}
              {tab.kind === 'pane' ? null : (
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
        {locked ? null : (
          <>
            <span style={stripDividerStyle} aria-hidden="true" />
            <button
              type="button"
              style={newBtn}
              title={
                engines.length === 0
                  ? 'Add an engine in Settings → Engines to enable AI tabs'
                  : 'New AI session'
              }
              data-testid="new-ai"
              disabled={engines.length === 0}
              onClick={() => onNewAi(newAiEngineId)}
            >
              + AI
            </button>
            <button
              type="button"
              style={newBtn}
              title="New shell"
              data-testid="new-shell"
              onClick={onNewShell}
            >
              + shell
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
            {/* v0.9 Phase E: the per-shortcut `+ <name>` URL + terminal
             *  buttons that used to live here are gone. URL shortcuts now
             *  surface inside every Web tab's sidebar; terminal shortcuts
             *  inside every Shell tab's sidebar. The strip carries only the
             *  three kind-creators (+ AI / + shell / + web). */}
          </>
        )}
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
  background: '#0c121a',
  borderBottom: '1px solid #1f2933',
  padding: '0 0.3rem',
  minHeight: '30px',
  flexShrink: 0,
  // Don't clip the engine-picker popover when it drops below the strip.
  overflow: 'visible',
};

const tabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'transparent',
  borderRight: '1px solid #1a2230',
  position: 'relative',
};

const activeTabStyle: React.CSSProperties = {
  background: '#0a0f17',
  boxShadow: 'inset 0 2px 0 #5a9bd4',
};

const tabLabelBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.4rem 0.75rem',
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

const aiBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1,
  color: '#c7b3ff',
  textShadow: '0 0 6px rgba(199, 179, 255, 0.35)',
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

const stripDividerStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '1px',
  alignSelf: 'center',
  height: '18px',
  background: '#243044',
  margin: '0 0.5rem',
};

const newBtn: React.CSSProperties = {
  padding: '0.25rem 0.55rem',
  background: 'transparent',
  border: 'none',
  color: '#7f8c98',
  fontSize: '0.72rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  borderRadius: '3px',
};

