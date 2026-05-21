import type { JSX } from 'react';

/** A tab's kind selects which surface it renders. */
export type TabKind = 'cockpit' | 'terminal' | 'browser';

/** A tab in a panel — `id` is stable for the tab's lifetime. */
export type WorkspaceTab = { id: string; kind: TabKind; title: string };

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
  /** Move a tab — from a panel into this strip at `index` (drag and drop). */
  onMoveTab: (fromPanel: PanelId, tabId: string, toPanel: PanelId, index: number) => void;
  /** The panel's content slot — the shell portals tab content into it. */
  slotRef: (el: HTMLDivElement | null) => void;
};

/**
 * A panel: a strip of typed, draggable tabs over a content slot. The strip is
 * a drop target — dropping a tab moves it here. The content slot stays empty;
 * the shell portals each tab's surface into it so a tab keeps its component
 * (terminal scrollback, browser page) when dragged between panels.
 */
export function TabbedPanel({
  panelId,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
  onNewBrowser,
  onMoveTab,
  slotRef,
}: Props): JSX.Element {
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
          return (
            <div
              key={tab.id}
              style={{ ...tabStyle, ...(active ? activeTabStyle : null) }}
              data-testid={`tab-${tab.kind}`}
              draggable={tab.kind !== 'cockpit'}
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
              <button
                type="button"
                style={{ ...tabLabelBtn, color: active ? '#e6edf3' : '#8a96a2' }}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.title}
              </button>
              {tab.kind !== 'cockpit' ? (
                <button
                  type="button"
                  style={closeBtn}
                  title="Close tab"
                  onClick={() => onCloseTab(tab.id)}
                >
                  ×
                </button>
              ) : null}
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
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'grab',
  whiteSpace: 'nowrap',
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
