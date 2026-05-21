import { type JSX, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentProject } from '../../shared/ipc.js';
import { isChainErrorPayload } from '../../shared/ipc.js';
import { AlteredScreen } from './components/AlteredScreen.js';
import { BrowserTab } from './components/BrowserTab.js';
import { CockpitTab } from './components/CockpitTab.js';
import { DockPanel } from './components/DockPanel.js';
import { type PanelId, TabbedPanel, type WorkspaceTab } from './components/TabbedPanel.js';
import { TerminalTab } from './components/TerminalTab.js';
import { TrackerStrip } from './components/TrackerStrip.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { useCockpitStore } from './store.js';

type Panel = { tabs: WorkspaceTab[]; activeId: string };

const COCKPIT_TAB: WorkspaceTab = { id: 'cockpit', kind: 'cockpit', title: 'Cockpit' };
const PANEL_IDS = ['left', 'right', 'bottom'] as const;

/** What this window is — set once by main via `onWindowInit`. */
type WindowMode = 'loading' | 'welcome' | 'cockpit' | 'altered';

export function App(): JSX.Element {
  const setChain = useCockpitStore((s) => s.setChain);
  const setEntries = useCockpitStore((s) => s.setEntries);
  const applyEvent = useCockpitStore((s) => s.applyEvent);
  const setTrees = useCockpitStore((s) => s.setTrees);
  const applyTreeUpdate = useCockpitStore((s) => s.applyTreeUpdate);
  const chain = useCockpitStore((s) => s.chain);

  const [mode, setMode] = useState<WindowMode>('loading');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [alteredFolder, setAlteredFolder] = useState<string>('');
  const [panels, setPanels] = useState<Record<PanelId, Panel>>({
    left: { tabs: [COCKPIT_TAB], activeId: 'cockpit' },
    right: { tabs: [], activeId: '' },
    bottom: { tabs: [], activeId: '' },
  });
  const [rightOpen, setRightOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [slots, setSlots] = useState<Record<PanelId, HTMLDivElement | null>>({
    left: null,
    right: null,
    bottom: null,
  });

  useEffect(() => {
    return window.cockpit.onWindowInit((payload) => {
      if (payload.mode === 'welcome') {
        setRecents(payload.recents);
        setMode('welcome');
      } else if (payload.mode === 'altered') {
        setAlteredFolder(payload.folder);
        setMode('altered');
      } else {
        setMode('cockpit');
      }
    });
  }, []);

  useEffect(() => {
    const offChain = window.cockpit.onChain(setChain);
    const offRestore = window.cockpit.onRestore(setEntries);
    const offChange = window.cockpit.onChange(applyEvent);
    const offTreeInit = window.cockpit.onTreeInit(setTrees);
    const offTreeUpdate = window.cockpit.onTreeUpdate(applyTreeUpdate);
    return () => {
      offChain();
      offRestore();
      offChange();
      offTreeInit();
      offTreeUpdate();
    };
  }, [setChain, setEntries, applyEvent, setTrees, applyTreeUpdate]);

  const dockOpen = (id: PanelId): boolean =>
    id === 'left' || (id === 'right' ? rightOpen : bottomOpen);

  const setDockOpen = (id: PanelId, open: boolean): void => {
    if (id === 'right') setRightOpen(open);
    else if (id === 'bottom') setBottomOpen(open);
  };

  // Stable ref callbacks — a fresh callback each render would make React
  // detach/reattach the slot every render and loop on setState.
  const setLeftSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.left === el ? s : { ...s, left: el }));
  }, []);
  const setRightSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.right === el ? s : { ...s, right: el }));
  }, []);
  const setBottomSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.bottom === el ? s : { ...s, bottom: el }));
  }, []);
  const slotRefs: Record<PanelId, (el: HTMLDivElement | null) => void> = {
    left: setLeftSlot,
    right: setRightSlot,
    bottom: setBottomSlot,
  };

  const addTab = (panelId: PanelId, kind: 'terminal' | 'browser'): void => {
    const id = crypto.randomUUID();
    setPanels((p) => {
      const n = p[panelId].tabs.filter((t) => t.kind === kind).length + 1;
      const title = `${kind === 'terminal' ? 'Terminal' : 'Browser'} ${n}`;
      return { ...p, [panelId]: { tabs: [...p[panelId].tabs, { id, kind, title }], activeId: id } };
    });
    setDockOpen(panelId, true);
  };

  const selectTab = (panelId: PanelId, tabId: string): void => {
    setPanels((p) => ({ ...p, [panelId]: { ...p[panelId], activeId: tabId } }));
  };

  const closeTab = (panelId: PanelId, tabId: string): void => {
    const panel = panels[panelId];
    const tab = panel.tabs.find((t) => t.id === tabId);
    if (tab?.kind === 'browser') window.cockpit.browserDestroy(tabId);
    setPanels((p) => {
      const tabs = p[panelId].tabs.filter((t) => t.id !== tabId);
      const activeId =
        p[panelId].activeId === tabId ? (tabs[tabs.length - 1]?.id ?? '') : p[panelId].activeId;
      return { ...p, [panelId]: { tabs, activeId } };
    });
    if (panelId !== 'left' && panel.tabs.length === 1) setDockOpen(panelId, false);
  };

  /** Move a tab between panels (or reorder within one). The cockpit stays put. */
  const moveTab = (fromPanel: PanelId, tabId: string, toPanel: PanelId, index: number): void => {
    if (tabId === 'cockpit') return;
    const fromTabsBefore = panels[fromPanel].tabs;
    setPanels((p) => {
      const tab = p[fromPanel].tabs.find((t) => t.id === tabId);
      if (!tab) return p;
      const fromTabs = p[fromPanel].tabs.filter((t) => t.id !== tabId);
      const base = fromPanel === toPanel ? fromTabs : p[toPanel].tabs.filter((t) => t.id !== tabId);
      const at = Math.max(0, Math.min(index, base.length));
      const toTabs = [...base.slice(0, at), tab, ...base.slice(at)];
      const next = { ...p };
      if (fromPanel === toPanel) {
        next[toPanel] = { tabs: toTabs, activeId: tabId };
      } else {
        const fromActive = fromTabs.some((t) => t.id === p[fromPanel].activeId)
          ? p[fromPanel].activeId
          : (fromTabs[fromTabs.length - 1]?.id ?? '');
        next[fromPanel] = { tabs: fromTabs, activeId: fromActive };
        next[toPanel] = { tabs: toTabs, activeId: tabId };
      }
      return next;
    });
    if (fromPanel !== toPanel) {
      setDockOpen(toPanel, true);
      if (fromPanel !== 'left' && fromTabsBefore.length === 1) setDockOpen(fromPanel, false);
    }
  };

  if (mode === 'loading') {
    return (
      <main style={fullCenter} data-testid="loading">
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.1rem', color: '#dde3ea', fontWeight: 600 }}>
            AI-Lore
          </h1>
          <p style={{ margin: '0.4rem 0 0', color: '#6c7783', fontSize: '0.85rem' }}>Starting…</p>
        </div>
      </main>
    );
  }

  if (mode === 'welcome') {
    return <WelcomeScreen recents={recents} />;
  }

  if (mode === 'altered') {
    return <AlteredScreen folder={alteredFolder} />;
  }

  if (!chain) {
    return (
      <main style={fullCenter} data-testid="loading">
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.1rem', color: '#dde3ea', fontWeight: 600 }}>
            AI-Lore
          </h1>
          <p style={{ margin: '0.4rem 0 0', color: '#6c7783', fontSize: '0.85rem' }}>
            Reading tracker chain…
          </p>
        </div>
      </main>
    );
  }

  if (isChainErrorPayload(chain)) {
    return (
      <main style={fullCenter} data-testid="chain-error">
        <div style={errorCard}>
          <h2 style={{ margin: '0 0 0.5rem', color: '#ff8a8a' }}>Cannot read tracker chain</h2>
          <p style={{ margin: 0, color: '#dde3ea' }}>{chain.error}</p>
          <p style={{ margin: '0.8rem 0 0', color: '#6c7783', fontSize: '0.85rem' }}>
            Run with <code>--root &lt;path&gt;</code> or launch from a project that contains a{' '}
            <code>.ai-lore-&lt;name&gt;/</code> folder.
          </p>
        </div>
      </main>
    );
  }

  const panel = (panelId: PanelId): JSX.Element => (
    <TabbedPanel
      panelId={panelId}
      tabs={panels[panelId].tabs}
      activeTabId={panels[panelId].activeId}
      onSelectTab={(id) => selectTab(panelId, id)}
      onCloseTab={(id) => closeTab(panelId, id)}
      onNewTerminal={() => addTab(panelId, 'terminal')}
      onNewBrowser={() => addTab(panelId, 'browser')}
      onMoveTab={moveTab}
      slotRef={slotRefs[panelId]}
    />
  );

  // Every tab's content is rendered once, keyed by tab id, and portaled into
  // its panel's slot — so dragging a tab between panels keeps its component
  // (terminal scrollback, browser page) rather than remounting it.
  const contentPortals = PANEL_IDS.flatMap((panelId) => {
    const slot = slots[panelId];
    if (!slot) return [];
    return panels[panelId].tabs.map((tab) => {
      const active = panels[panelId].activeId === tab.id;
      const visible = active && dockOpen(panelId);
      return createPortal(
        <div style={{ display: active ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }}>
          {tab.kind === 'cockpit' ? (
            <CockpitTab chain={chain} />
          ) : tab.kind === 'terminal' ? (
            <TerminalTab active={visible} />
          ) : (
            <BrowserTab tabId={tab.id} visible={visible} />
          )}
        </div>,
        slot,
        tab.id,
      );
    });
  });

  return (
    <div style={cockpitShell}>
      <TrackerStrip />
      <div style={panelsRow}>
        <div style={appColumn}>{panel('left')}</div>
        <DockPanel side="right" open={rightOpen} onToggle={setRightOpen}>
          {panel('right')}
        </DockPanel>
      </div>
      <DockPanel side="bottom" open={bottomOpen} onToggle={setBottomOpen}>
        {panel('bottom')}
      </DockPanel>
      {contentPortals}
    </div>
  );
}

const appLayout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: '#0a0f17',
  color: '#dde3ea',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  margin: 0,
};

/** Cockpit shell: a full-width header, the panel row, then the bottom dock. */
const cockpitShell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  margin: 0,
  background: '#0a0f17',
  color: '#dde3ea',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** The panel row beneath the header: the left panel plus the right dock. */
const panelsRow: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const appColumn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const fullCenter: React.CSSProperties = {
  ...appLayout,
  alignItems: 'center',
  justifyContent: 'center',
};

const errorCard: React.CSSProperties = {
  maxWidth: '560px',
  padding: '1.2rem 1.5rem',
  background: '#1a1212',
  border: '1px solid #5b2222',
  borderRadius: '6px',
};
