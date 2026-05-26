import type { ChangeScope, LayoutTab, WorkspaceLayout } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RecentProject, Shortcut, TerminalForegroundStatus } from '../../shared/ipc.js';
import { WORKSPACE_LAYOUT_SCHEMA_VERSION, isChainErrorPayload } from '../../shared/ipc.js';
import type { AlteredReason } from '../../shared/ipc.js';
import { AlteredScreen } from './components/AlteredScreen.js';
import { BrowserTab } from './components/BrowserTab.js';
import {
  DOCK_DEFAULT_BOTTOM,
  DOCK_DEFAULT_RIGHT,
  DOCK_MIN_SIZE,
  DockPanel,
} from './components/DockPanel.js';
import { GlobalSearch, type GlobalSearchHandle } from './components/GlobalSearch.js';
import { Pane, type SubRoot, baseDirsOf, entriesInSubRoot } from './components/Pane.js';
import {
  type PanelId,
  type TabKind,
  TabbedPanel,
  type WorkspaceTab,
} from './components/TabbedPanel.js';
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

const TAB_KINDS = new Set<TabKind>(['pane', 'terminal', 'browser']);

/** Convert a runtime `WorkspaceTab` into its persisted form — drops live state. */
function tabToLayout(tab: WorkspaceTab): LayoutTab {
  const out: LayoutTab = { id: tab.id, kind: tab.kind, title: tab.title };
  if (tab.baseTitle !== undefined) out.baseTitle = tab.baseTitle;
  if (tab.manualTitle !== undefined) out.manualTitle = tab.manualTitle;
  return out;
}

/** Lift a persisted `LayoutTab` into a runtime `WorkspaceTab`, or drop it if its kind is unknown. */
function tabFromLayout(t: LayoutTab): WorkspaceTab | null {
  if (!TAB_KINDS.has(t.kind as TabKind)) return null;
  const out: WorkspaceTab = { id: t.id, kind: t.kind as TabKind, title: t.title };
  if (t.baseTitle !== undefined) out.baseTitle = t.baseTitle;
  if (t.manualTitle !== undefined) out.manualTitle = t.manualTitle;
  // Terminal tabs always restore as idle — their PTY is fresh.
  if (out.kind === 'terminal') out.status = 'idle';
  return out;
}

/** What this window is — set once by main via `onWindowInit`. */
type WindowMode = 'loading' | 'welcome' | 'cockpit' | 'altered';

export function App(): JSX.Element {
  const setChain = useCockpitStore((s) => s.setChain);
  const applyChanges = useCockpitStore((s) => s.applyChanges);
  const applyCommitList = useCockpitStore((s) => s.applyCommitList);
  const setTrees = useCockpitStore((s) => s.setTrees);
  const applyTreeUpdate = useCockpitStore((s) => s.applyTreeUpdate);
  const setApps = useCockpitStore((s) => s.setApps);
  const chain = useCockpitStore((s) => s.chain);
  const changes = useCockpitStore((s) => s.changes);

  const [mode, setMode] = useState<WindowMode>('loading');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [alteredFolder, setAlteredFolder] = useState<string>('');
  const [alteredReason, setAlteredReason] = useState<AlteredReason>({ kind: 'not-ai-lore' });
  const [panels, setPanels] = useState<Record<PanelId, Panel>>({
    left: { tabs: PANE_TABS, activeId: 'status' },
    right: { tabs: [], activeId: '' },
    bottom: { tabs: [], activeId: '' },
  });
  const [rightOpen, setRightOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [rightSize, setRightSize] = useState(DOCK_DEFAULT_RIGHT);
  const [bottomSize, setBottomSize] = useState(DOCK_DEFAULT_BOTTOM);
  // Per-tab URLs the restored layout seeded. Consumed by `BrowserTab` on
  // mount to override the browser companion's default home page.
  const [browserInitialUrls, setBrowserInitialUrls] = useState<Record<string, string>>({});
  // Per-tab one-shot commands a terminal shortcut seeded. Consumed by
  // `TerminalTab` on mount; written to the PTY once the shell is up.
  const [terminalInitialCommands, setTerminalInitialCommands] = useState<Record<string, string>>(
    {},
  );
  // URL + terminal shortcuts surfaced in every panel's tab strip as `+ <name>`
  // creators. Project/lore shortcuts live in the header rows instead.
  const [tabShortcuts, setTabShortcuts] = useState<Shortcut[]>([]);
  useEffect(() => {
    const apply = (list: Shortcut[]): void => {
      setTabShortcuts(list.filter((s) => s.target === 'url' || s.target === 'terminal'));
    };
    void window.cockpit.shortcutsList().then(apply);
    return window.cockpit.onShortcutsChanged(apply);
  }, []);
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
          // v0.5 brings two more first-class areas into the Status grouping:
          // `memory/save-points/` (the milestone ledger) and `references/`
          // (the optional cross-project pointer registry — note: lives at
          // `<lore>/references/`, outside `memory/`). Drift on either is
          // covered by the existing watcher + queue + per-row ack.
          childPaths: [
            `${mem}/status`,
            `${mem}/journal`,
            `${mem}/action-tree`,
            `${mem}/save-points`,
            `${chain.lorePath}/references`,
          ],
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

  // Drift counts per pinned tab — shown as a badge on the tab strip. Sourced
  // from the per-scope changes snapshot (v0.6 Phase B); filtered to each
  // pane's sub-root.
  const tabDrift = useMemo(() => {
    const out: Record<string, number> = {};
    if (chain && !isChainErrorPayload(chain)) {
      for (const p of paneSpecs) {
        out[p.id] = entriesInSubRoot(changes[p.scope], p.subRoot, chain.root).length;
      }
    }
    return out;
  }, [paneSpecs, changes, chain]);

  useEffect(() => {
    return window.cockpit.onWindowInit((payload) => {
      if (payload.mode === 'welcome') {
        setRecents(payload.recents);
        setMode('welcome');
      } else if (payload.mode === 'altered') {
        setAlteredFolder(payload.folder);
        setAlteredReason(payload.reason);
        setMode('altered');
      } else {
        setMode('cockpit');
      }
    });
  }, []);

  useEffect(() => {
    const offChain = window.cockpit.onChain(setChain);
    const offChanges = window.cockpit.onChanges(applyChanges);
    const offCommitList = window.cockpit.onCommitList(applyCommitList);
    const offTreeInit = window.cockpit.onTreeInit(setTrees);
    const offTreeUpdate = window.cockpit.onTreeUpdate(applyTreeUpdate);
    // Hydrate the Apps catalog from the global settings tier — context menus
    // need it. Re-pull on every SettingsChanged push so adds/removes are live.
    void window.cockpit.settingsGet().then((snap) => setApps(snap.global.apps ?? []));
    const offSettings = window.cockpit.onSettingsChanged((snap) =>
      setApps(snap.global.apps ?? []),
    );
    return () => {
      offChain();
      offChanges();
      offCommitList();
      offTreeInit();
      offTreeUpdate();
      offSettings();
    };
  }, [setChain, applyChanges, applyCommitList, setTrees, applyTreeUpdate, setApps]);

  const globalSearchRef = useRef<GlobalSearchHandle>(null);

  // ⌘+[ / ⌘+] moves the keyboard between visible Panes. Adapted from the
  // V2 "Project ↔ Lore" model to the dockable workspace: each panel can
  // host a Pane tab, so cycling means moving across panels rather than
  // inside one tab. Scoped to "focus is inside a Pane already" — if the
  // user is inside a BrowserTab's WebContentsView the keydown does not
  // reach this listener at all, and clicks elsewhere are no-ops.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey || (e.key !== '[' && e.key !== ']')) return;
      const active = document.activeElement as HTMLElement | null;
      const here = active?.closest('[data-pane]') as HTMLElement | null;
      if (!here) return;
      const panes = Array.from(document.querySelectorAll<HTMLElement>('[data-pane]'));
      if (panes.length < 2) return;
      e.preventDefault();
      const idx = panes.indexOf(here);
      const step = e.key === '[' ? -1 : 1;
      const target = panes[(idx + step + panes.length) % panes.length];
      if (!target) return;
      // Restore focus to whichever row currently carries the roving
      // tabindex inside the target Pane's tree; fall back to the tree's
      // root row, then to the section itself.
      const focusable =
        target.querySelector<HTMLElement>('[tabindex="0"]') ??
        target.querySelector<HTMLElement>('[data-testid="tree-root"]') ??
        target;
      focusable.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ⌘+1..⌘+9 select the Nth tab in the left panel (the cockpit pillar). The
  // accelerator is fired from the app menu in main; main pushes the index
  // here. Out-of-range indexes (more tabs than the left panel has) are
  // silently ignored.
  useEffect(() => {
    const off = window.cockpit.onSelectCockpitTab((n) => {
      setPanels((prev) => {
        const left = prev.left;
        const target = left.tabs[n - 1];
        if (!target) return prev;
        return { ...prev, left: { ...left, activeId: target.id } };
      });
      // Defer focus until after the tab switch has rendered.
      requestAnimationFrame(() => {
        const pane = document.querySelector<HTMLElement>('[data-pane]');
        const focusable =
          pane?.querySelector<HTMLElement>('[tabindex="0"]') ??
          pane?.querySelector<HTMLElement>('[data-testid="tree-root"]') ??
          pane;
        focusable?.focus();
      });
    });
    return off;
  }, []);

  // ⌘+F focuses the global file search. Main pushes this on the App menu
  // accelerator. When focus is inside a BrowserTab's WebContentsView the
  // keydown stays there (browser find) and this handler never fires.
  useEffect(() => {
    const off = window.cockpit.onFocusGlobalSearch(() => {
      globalSearchRef.current?.focusMe();
    });
    return off;
  }, []);

  // Seed the workspace layout from the per-project snapshot, exactly once per
  // window — gated on `workspace.restoreLayout`. A missing snapshot, or the
  // toggle off, leaves the defaults in place.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain)) return;
    seededRef.current = true;
    void window.cockpit.settingsGet().then((snap) => {
      if (snap.resolved['workspace.restoreLayout'] === false) return;
      const layout = snap.project?.layout;
      if (!layout) return;
      const liftPanel = (p: { tabs: LayoutTab[]; activeId: string }): Panel => {
        const tabs = p.tabs.flatMap((t) => {
          const lifted = tabFromLayout(t);
          return lifted ? [lifted] : [];
        });
        // The persisted activeId might be a tab that got dropped on lift —
        // fall back to the last surviving tab so the panel stays usable.
        const stillThere = tabs.some((t) => t.id === p.activeId);
        return {
          tabs,
          activeId: stillThere ? p.activeId : (tabs[tabs.length - 1]?.id ?? ''),
        };
      };
      // The left panel always carries the pinned panes, even when a stale
      // snapshot lost them — drop the snapshot rather than ship a cockpit
      // with no Status/Payload/Memory.
      const left = liftPanel(layout.panels.left);
      const hasAllPanes = PANE_TABS.every((p) => left.tabs.some((t) => t.id === p.id));
      if (!hasAllPanes) return;
      setPanels({
        left,
        right: liftPanel(layout.panels.right),
        bottom: liftPanel(layout.panels.bottom),
      });
      setRightOpen(layout.rightOpen);
      setBottomOpen(layout.bottomOpen);
      setRightSize(Math.max(DOCK_MIN_SIZE, layout.rightWidth));
      setBottomSize(Math.max(DOCK_MIN_SIZE, layout.bottomHeight));
      setBrowserInitialUrls(layout.browserUrls);
    });
  }, [mode, chain]);

  // Whether this window currently has OS focus — only the focused window
  // writes layout. The blurred window keeps its in-memory state but stops
  // writing, so two windows on the same project do not race their writes.
  const [hasFocus, setHasFocus] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  );
  useEffect(() => {
    const onFocus = (): void => setHasFocus(true);
    const onBlur = (): void => setHasFocus(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /** Snapshot the current layout — asks main for each browser tab's URL. */
  const captureLayout = useCallback(async (): Promise<WorkspaceLayout> => {
    const browserUrls: Record<string, string> = {};
    for (const panelId of PANEL_IDS) {
      for (const tab of panels[panelId].tabs) {
        if (tab.kind !== 'browser') continue;
        const url = await window.cockpit.browserGetUrl(tab.id);
        if (typeof url === 'string' && url.length > 0) browserUrls[tab.id] = url;
      }
    }
    return {
      schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
      panels: {
        left: { tabs: panels.left.tabs.map(tabToLayout), activeId: panels.left.activeId },
        right: { tabs: panels.right.tabs.map(tabToLayout), activeId: panels.right.activeId },
        bottom: { tabs: panels.bottom.tabs.map(tabToLayout), activeId: panels.bottom.activeId },
      },
      rightOpen,
      bottomOpen,
      rightWidth: rightSize,
      bottomHeight: bottomSize,
      browserUrls,
    };
  }, [panels, rightOpen, bottomOpen, rightSize, bottomSize]);

  // Capture the layout on changes, debounced to 300ms, and only from the
  // focused window. A final flush goes out on `beforeunload`. Skipped until a
  // project context is in place — pre-cockpit state is not a real layout.
  useEffect(() => {
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain)) return;
    if (!seededRef.current) return; // wait until the seed pass has run
    if (!hasFocus) return;
    const handle = window.setTimeout(() => {
      void captureLayout().then((layout) => {
        void window.cockpit.settingsSetLayout({ layout });
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [mode, chain, hasFocus, captureLayout]);

  // Final flush on window close — fire-and-forget; main records what reaches it.
  useEffect(() => {
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain)) return;
    const onUnload = (): void => {
      void captureLayout().then((layout) => {
        void window.cockpit.settingsSetLayout({ layout });
      });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [mode, chain, captureLayout]);

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

  /** Create a terminal tab on `panelId` from a tab shortcut — titled after the
   *  shortcut, with the command queued for the PTY once it spawns. */
  const createTerminalShortcutTab = useCallback(
    (panelId: PanelId, command: string, label: string): void => {
      const id = crypto.randomUUID();
      setTerminalInitialCommands((prev) => ({ ...prev, [id]: command }));
      setPanels((p) => {
        const tab: WorkspaceTab = {
          id,
          kind: 'terminal',
          title: label,
          baseTitle: label,
          status: 'idle',
        };
        return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
      });
      // Mirror `setDockOpen` inline so the callback has no unstable deps.
      if (panelId === 'right') setRightOpen(true);
      else if (panelId === 'bottom') setBottomOpen(true);
    },
    [],
  );

  /** Create a browser tab on `panelId` from a URL tab shortcut — titled after
   *  the shortcut, pre-navigated to `url`. */
  const createBrowserShortcutTab = useCallback(
    (panelId: PanelId, url: string, label: string): void => {
      const id = crypto.randomUUID();
      setBrowserInitialUrls((prev) => ({ ...prev, [id]: url }));
      setPanels((p) => {
        const tab: WorkspaceTab = { id, kind: 'browser', title: label, baseTitle: label };
        return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
      });
      // Mirror `setDockOpen` inline so the callback has no unstable deps.
      if (panelId === 'right') setRightOpen(true);
      else if (panelId === 'bottom') setBottomOpen(true);
    },
    [],
  );

  // Legacy: terminal shortcuts fired from the header (Phase F's header trigger,
  // since removed) sent a payload via main. The tab-strip shortcuts (this
  // session) handle terminal targets directly in the renderer, so this
  // subscription is dormant — kept defensively for any future main-side trigger.
  useEffect(() => {
    return window.cockpit.onOpenTerminalShortcut((payload) => {
      createTerminalShortcutTab('bottom', payload.command, payload.label);
    });
  }, [createTerminalShortcutTab]);

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
   *  the file, then ask that pane to reveal and scroll to it. Routing picks the
   *  pane with the **longest** matching base directory, not the first that
   *  prefix-matches — the Lore folder lives under `chain.root`, so a naïve
   *  first-match always returns the Payload pane for Status and Memory files. */
  const handleSearchPick = useCallback(
    (path: string): void => {
      let best: { spec: PaneSpec; baseLen: number } | undefined;
      for (const spec of paneSpecs) {
        for (const base of baseDirsOf(spec.subRoot)) {
          if (path === base || path.startsWith(`${base}/`)) {
            if (!best || base.length > best.baseLen) best = { spec, baseLen: base.length };
          }
        }
      }
      if (!best) return;
      const picked = best.spec;
      setPanels((p) => ({ ...p, left: { ...p.left, activeId: picked.id } }));
      setRevealTarget((prev) => ({ paneId: picked.id, path, token: (prev?.token ?? 0) + 1 }));
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
    return <AlteredScreen folder={alteredFolder} reason={alteredReason} />;
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
      tabShortcuts={tabShortcuts}
      onCreateBrowserTab={(url, label) => createBrowserShortcutTab(panelId, url, label)}
      onCreateTerminalTab={(command, label) => createTerminalShortcutTab(panelId, command, label)}
      onLaunchUrlExternal={(id) => window.cockpit.shortcutsRun(id)}
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
        body = (
          <TerminalTab
            active={visible}
            tabId={tab.id}
            onStatus={handleTerminalStatus}
            initialCommand={terminalInitialCommands[tab.id]}
          />
        );
      } else {
        body = (
          <BrowserTab tabId={tab.id} visible={visible} initialUrl={browserInitialUrls[tab.id]} />
        );
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
          <GlobalSearch
            ref={globalSearchRef}
            dirs={searchDirs}
            onPick={handleSearchPick}
            displayPath={displayPath}
          />
        }
      />
      <div style={panelsRow}>
        <div style={appColumn}>{panel('left')}</div>
        <DockPanel
          side="right"
          open={rightOpen}
          onToggle={setRightOpen}
          size={rightSize}
          onResize={setRightSize}
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
        size={bottomSize}
        onResize={setBottomSize}
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
