import type { ChangeScope } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentProject, TerminalForegroundStatus } from '../../shared/ipc.js';
import { isChainErrorPayload } from '../../shared/ipc.js';
import { AlteredScreen } from './components/AlteredScreen.js';
import { BrowserTab } from './components/BrowserTab.js';
import { DockPanel } from './components/DockPanel.js';
import { GlobalSearch } from './components/GlobalSearch.js';
import { Pane, type SubRoot, baseDirsOf, entriesInSubRoot } from './components/Pane.js';
import { type PanelId, TabbedPanel, type WorkspaceTab } from './components/TabbedPanel.js';
import { TerminalTab } from './components/TerminalTab.js';
import { TrackerStrip } from './components/TrackerStrip.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { accentColor, accentTint, hueFor, projectName } from './projectAccent.js';
import { useCockpitStore } from './store.js';

type Panel = { tabs: WorkspaceTab[]; activeId: string };

/** One of the four pinned cockpit panes — its tab, plus how to root and scope it. */
type PaneSpec = { id: string; title: string; scope: ChangeScope; subRoot: SubRoot };

/** The three pinned cockpit tabs. Always open in the left panel, in this order. */
const PANE_TABS: WorkspaceTab[] = [
  { id: 'status', kind: 'pane', title: 'Status' },
  { id: 'payload', kind: 'pane', title: 'Payload' },
  { id: 'memory', kind: 'pane', title: 'Memory' },
];
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
  const entries = useCockpitStore((s) => s.entries);

  const [mode, setMode] = useState<WindowMode>('loading');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [alteredFolder, setAlteredFolder] = useState<string>('');
  const [panels, setPanels] = useState<Record<PanelId, Panel>>({
    left: { tabs: PANE_TABS, activeId: 'status' },
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
  // A global-search pick: which pane should reveal which file. The token makes
  // picking the same file twice re-trigger the reveal.
  const [revealTarget, setRevealTarget] = useState<{
    paneId: string;
    path: string;
    token: number;
  } | null>(null);

  // The three pinned panes, rooted against the resolved chain. Status and
  // Memory each group sibling memory folders via a synthetic sub-root.
  const paneSpecs = useMemo<PaneSpec[]>(() => {
    if (!chain || isChainErrorPayload(chain)) return [];
    const mem = `${chain.lorePath}/memory`;
    return [
      {
        id: 'status',
        title: 'Status',
        scope: 'lore',
        subRoot: {
          kind: 'synthetic',
          id: 'synthetic:status',
          name: 'Status',
          childPaths: [`${mem}/status`, `${mem}/journal`, `${mem}/action-tree`],
        },
      },
      {
        id: 'payload',
        title: 'Payload',
        scope: 'payload',
        subRoot: { kind: 'path', path: chain.root },
      },
      {
        id: 'memory',
        title: 'Memory',
        scope: 'lore',
        subRoot: {
          kind: 'synthetic',
          id: 'synthetic:memory',
          name: 'Memory',
          childPaths: [`${mem}/blueprint`, `${mem}/knowledge-tree`],
        },
      },
    ];
  }, [chain]);

  const paneSpecById = useMemo(() => new Map(paneSpecs.map((p) => [p.id, p])), [paneSpecs]);

  // Every directory the global search walks — the union of all panes' roots.
  const searchDirs = useMemo(() => paneSpecs.flatMap((p) => baseDirsOf(p.subRoot)), [paneSpecs]);

  // Unacked-drift counts per pinned tab — shown as a badge on the tab strip.
  const tabDrift = useMemo(() => {
    const out: Record<string, number> = {};
    if (chain && !isChainErrorPayload(chain)) {
      for (const p of paneSpecs) {
        out[p.id] = entriesInSubRoot(entries, p.scope, p.subRoot, chain.root).length;
      }
    }
    return out;
  }, [paneSpecs, entries, chain]);

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
      const tab: WorkspaceTab =
        kind === 'terminal'
          ? { id, kind, title, baseTitle: title, status: 'idle' }
          : { id, kind, title, baseTitle: title };
      return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
    });
    setDockOpen(panelId, true);
  };

  /** Rename a tab by hand. A non-empty name wins and freezes terminal
   *  auto-rename; an empty name reverts to the auto-managed default. */
  const renameTab = (panelId: PanelId, tabId: string, raw: string): void => {
    const name = raw.trim();
    setPanels((p) => {
      const tabs = p[panelId].tabs.map((t) => {
        if (t.id !== tabId) return t;
        return name === ''
          ? { ...t, manualTitle: false, title: t.baseTitle ?? t.title }
          : { ...t, manualTitle: true, title: name };
      });
      return { ...p, [panelId]: { ...p[panelId], tabs } };
    });
  };

  /** Apply a terminal's foreground status: light the dot, and auto-rename the
   *  tab to the running command unless its title was set by hand. */
  const handleTerminalStatus = useCallback(
    (tabId: string, status: TerminalForegroundStatus, command: string): void => {
      setPanels((prev) => {
        for (const panelId of PANEL_IDS) {
          const tabs = prev[panelId].tabs;
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx === -1) continue;
          const tab = tabs[idx];
          const title = tab.manualTitle
            ? tab.title
            : status === 'running' && command
              ? command
              : (tab.baseTitle ?? tab.title);
          if (tab.status === status && tab.title === title) return prev;
          const next = [...tabs];
          next[idx] = { ...tab, status, title };
          return { ...prev, [panelId]: { ...prev[panelId], tabs: next } };
        }
        return prev;
      });
    },
    [],
  );

  const selectTab = (panelId: PanelId, tabId: string): void => {
    setPanels((p) => ({ ...p, [panelId]: { ...p[panelId], activeId: tabId } }));
  };

  /** A global-search pick: switch the left panel to the cockpit tab that owns
   *  the file, then ask that pane to reveal and scroll to it. */
  const handleSearchPick = useCallback(
    (path: string): void => {
      const spec = paneSpecs.find((p) =>
        baseDirsOf(p.subRoot).some((b) => path === b || path.startsWith(`${b}/`)),
      );
      if (!spec) return;
      setPanels((p) => ({ ...p, left: { ...p.left, activeId: spec.id } }));
      setRevealTarget((prev) => ({ paneId: spec.id, path, token: (prev?.token ?? 0) + 1 }));
    },
    [paneSpecs],
  );

  /** A short, tab-relative display path for a search hit — `payload/…` for the
   *  project, or the memory subfolder (`status/…`, `journal/…`) for the Lore. */
  const displayPath = useCallback(
    (abs: string): string => {
      if (!chain || isChainErrorPayload(chain)) return abs;
      const memRoot = `${chain.lorePath}/memory/`;
      if (abs.startsWith(memRoot)) return abs.slice(memRoot.length);
      if (abs.startsWith(`${chain.root}/`)) return `payload/${abs.slice(chain.root.length + 1)}`;
      return abs;
    },
    [chain],
  );

  const closeTab = (panelId: PanelId, tabId: string): void => {
    const panel = panels[panelId];
    const tab = panel.tabs.find((t) => t.id === tabId);
    // A terminal tab running a task confirms before closing — the whole-window
    // close has the same guard, but closing a single tab bypassed it.
    if (tab?.kind === 'terminal' && tab.status === 'running') {
      const proceed = window.confirm(
        'This terminal is running a task. Closing the tab will end it.\n\nClose anyway?',
      );
      if (!proceed) return;
    }
    if (tab?.kind === 'browser') window.cockpit.browserDestroy(tabId);
    setPanels((p) => {
      const tabs = p[panelId].tabs.filter((t) => t.id !== tabId);
      const activeId =
        p[panelId].activeId === tabId ? (tabs[tabs.length - 1]?.id ?? '') : p[panelId].activeId;
      return { ...p, [panelId]: { tabs, activeId } };
    });
    if (panelId !== 'left' && panel.tabs.length === 1) setDockOpen(panelId, false);
  };

  /** Move a tab between panels (or reorder within one). Pinned panes stay put. */
  const moveTab = (fromPanel: PanelId, tabId: string, toPanel: PanelId, index: number): void => {
    if (panels[fromPanel].tabs.find((t) => t.id === tabId)?.kind === 'pane') return;
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

  // The project's hue — the dock toggle handles wear it, as the header does.
  const projectHue = hueFor(projectName(chain.root));

  const panel = (panelId: PanelId): JSX.Element => (
    <TabbedPanel
      panelId={panelId}
      tabs={panels[panelId].tabs}
      activeTabId={panels[panelId].activeId}
      onSelectTab={(id) => selectTab(panelId, id)}
      onCloseTab={(id) => closeTab(panelId, id)}
      onNewTerminal={() => addTab(panelId, 'terminal')}
      onNewBrowser={() => addTab(panelId, 'browser')}
      onRenameTab={(id, name) => renameTab(panelId, id, name)}
      onMoveTab={moveTab}
      slotRef={slotRefs[panelId]}
      tabDrift={panelId === 'left' ? tabDrift : undefined}
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
      let body: JSX.Element | null = null;
      if (tab.kind === 'pane') {
        const spec = paneSpecById.get(tab.id);
        if (spec) {
          body = (
            <Pane
              testId={spec.id}
              scope={spec.scope}
              label={spec.title}
              subRoot={spec.subRoot}
              projectRoot={chain.root}
              displayPath={displayPath}
              revealRequest={revealTarget?.paneId === spec.id ? revealTarget : undefined}
            />
          );
        }
      } else if (tab.kind === 'terminal') {
        body = <TerminalTab active={visible} tabId={tab.id} onStatus={handleTerminalStatus} />;
      } else {
        body = <BrowserTab tabId={tab.id} visible={visible} />;
      }
      return createPortal(
        <div style={{ display: active ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0 }}>
          {body}
        </div>,
        slot,
        tab.id,
      );
    });
  });

  return (
    <div style={cockpitShell}>
      <TrackerStrip
        search={
          <GlobalSearch dirs={searchDirs} onPick={handleSearchPick} displayPath={displayPath} />
        }
      />
      <div style={panelsRow}>
        <div style={appColumn}>{panel('left')}</div>
        <DockPanel
          side="right"
          open={rightOpen}
          onToggle={setRightOpen}
          accent={accentColor(projectHue)}
          tint={accentTint(projectHue)}
        >
          {panel('right')}
        </DockPanel>
      </div>
      <DockPanel
        side="bottom"
        open={bottomOpen}
        onToggle={setBottomOpen}
        accent={accentColor(projectHue)}
        tint={accentTint(projectHue)}
      >
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
