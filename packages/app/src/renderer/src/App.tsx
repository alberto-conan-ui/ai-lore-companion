import type { ChangeScope, EngineEntry, LayoutTab, WorkspaceLayout } from '@ai-lore-companion/core';
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { RecentProject, Shortcut, TerminalForegroundStatus } from '../../shared/ipc.js';
import { WORKSPACE_LAYOUT_SCHEMA_VERSION, isChainErrorPayload } from '../../shared/ipc.js';
import type { AlteredReason } from '../../shared/ipc.js';
import { AiTab } from './components/AiTab.js';
import { AlteredScreen } from './components/AlteredScreen.js';
import { BrowserTab } from './components/BrowserTab.js';
import { PublishPane } from './components/PublishPane.js';
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

/** v0.8 Phase B — the pinned cockpit tabs adapt to the project's shape.
 *  Default-shape projects get three (Status / Payload / Memory). Publishing-
 *  shape projects also get a `publish` pane sandwiched between Payload and
 *  Memory — workshop → deliverable → record. The tabs are otherwise
 *  identical: pinned, unclosable, unmovable.
 */
function panesForShape(shape: 'default' | 'publishing'): WorkspaceTab[] {
  if (shape === 'publishing') {
    return [
      { id: 'status', kind: 'pane', title: 'Status' },
      { id: 'payload', kind: 'pane', title: 'Payload' },
      { id: 'publish', kind: 'pane', title: 'Publish' },
      { id: 'memory', kind: 'pane', title: 'Memory' },
    ];
  }
  return [
    { id: 'status', kind: 'pane', title: 'Status' },
    { id: 'payload', kind: 'pane', title: 'Payload' },
    { id: 'memory', kind: 'pane', title: 'Memory' },
  ];
}

const PANEL_IDS = ['left', 'right', 'bottom'] as const;

const TAB_KINDS = new Set<TabKind>(['pane', 'shell', 'ai', 'browser']);

/** Convert a runtime `WorkspaceTab` into its persisted form — drops live state. */
function tabToLayout(tab: WorkspaceTab): LayoutTab {
  const out: LayoutTab = { id: tab.id, kind: tab.kind, title: tab.title };
  if (tab.baseTitle !== undefined) out.baseTitle = tab.baseTitle;
  if (tab.manualTitle !== undefined) out.manualTitle = tab.manualTitle;
  if (tab.engine !== undefined) out.engine = tab.engine;
  return out;
}

/** Lift a persisted `LayoutTab` into a runtime `WorkspaceTab`, or drop it if its kind is unknown. */
function tabFromLayout(t: LayoutTab): WorkspaceTab | null {
  // Pre-v0.7 layouts persisted `kind: 'terminal'`; lift those into 'shell'.
  const kind = t.kind === 'terminal' ? 'shell' : (t.kind as TabKind);
  if (!TAB_KINDS.has(kind)) return null;
  const out: WorkspaceTab = { id: t.id, kind, title: t.title };
  if (t.baseTitle !== undefined) out.baseTitle = t.baseTitle;
  if (t.manualTitle !== undefined) out.manualTitle = t.manualTitle;
  if (t.engine !== undefined) out.engine = t.engine;
  // Shell tabs always restore as idle — their PTY is fresh.
  if (out.kind === 'shell') out.status = 'idle';
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
  const rawChanges = useCockpitStore((s) => s.changes);
  const showIndexFiles = useCockpitStore((s) => s.showIndexFiles);
  // Match the per-pane filter so tab badges count the same rows the panel
  // shows. Index files appear in counts only when the toggle is on.
  const changes = useMemo(
    () =>
      showIndexFiles
        ? rawChanges
        : {
            payload: rawChanges.payload.filter((e) => !e.path.endsWith('.index.md')),
            lore: rawChanges.lore.filter((e) => !e.path.endsWith('.index.md')),
          },
    [rawChanges, showIndexFiles],
  );

  const [mode, setMode] = useState<WindowMode>('loading');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [alteredFolder, setAlteredFolder] = useState<string>('');
  const [alteredReason, setAlteredReason] = useState<AlteredReason>({ kind: 'not-ai-lore' });
  const [panels, setPanels] = useState<Record<PanelId, Panel>>({
    // Seeded with the default-shape pinned tabs. When the first chain push
    // arrives and reports `shape: 'publishing'`, an effect below reconciles
    // the left strip to include the Publish pane between Payload and Memory.
    left: { tabs: panesForShape('default'), activeId: 'status' },
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
  // Configured AI engines — populates the `+ AI ▾` popover and the AI tab's
  // empty-state engine dropdown. Sourced from the global store; back-filled
  // with `claude` / `gemini` defaults when their binaries are on PATH.
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  useEffect(() => {
    void window.cockpit.enginesList().then(setEngines);
    return window.cockpit.onEnginesChanged(setEngines);
  }, []);
  // The engine id this project last picked — used to order the `+ AI ▾`
  // popover so the user's recent choice surfaces first. Stored per project
  // in `projectDataDir/engine-state.json`; reads at mount, refreshes
  // whenever the engine on any AI tab is changed.
  const [lastEngineId, setLastEngineId] = useState<string | null>(null);
  useEffect(() => {
    if (chain && !isChainErrorPayload(chain)) {
      void window.cockpit.engineLastGet().then(setLastEngineId);
    }
  }, [chain]);
  // Lookup helper: engine display name for the tab title. Falls back to the
  // id when the engine was removed by the user after this AI tab was created.
  const engineName = useCallback(
    (engineId: string): string =>
      engines.find((e) => e.id === engineId)?.name ?? engineId,
    [engines],
  );
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

  // The pinned panes, rooted against the resolved chain. Default-shape
  // projects get three; publishing-shape adds a fourth `publish` pane
  // sub-rooted to `<project>/publish/`. Status and Memory each group sibling
  // memory folders via a synthetic sub-root. The `publish` pane is rendered
  // by its own component (`PublishPane`) — its spec carries no scope, since
  // by methodology contract `publish/` is write-restricted to the publish
  // verb and the companion never tracks drift against it.
  const paneSpecs = useMemo<PaneSpec[]>(() => {
    if (!chain || isChainErrorPayload(chain)) return [];
    const mem = `${chain.lorePath}/memory`;
    const base: PaneSpec[] = [
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
        // v0.8 Phase C — in publishing shape the Payload pane sub-roots to
        // `<project>/payload/` (the workshop), not the project root. The
        // methodology pairs the workshop with the deliverable named by the
        // `publish:` block; the workshop folder is always `payload/`. The
        // underlying Payload git repo still lives at the project root, so
        // drift / changes / save-points keep working unchanged.
        subRoot: {
          kind: 'path',
          path: chain.shape === 'publishing' ? `${chain.root}/payload` : chain.root,
        },
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
    return base;
  }, [chain]);

  // v0.8 Phase B — when the chain reports a shape change, reconcile the
  // left strip's pinned pane tabs. Adds the Publish tab in publishing mode
  // between Payload and Memory; removes it in default mode. Preserves all
  // other tabs (shell / AI / browser) and the active tab when possible.
  const shape = chain && !isChainErrorPayload(chain) ? chain.shape : 'default';
  useEffect(() => {
    setPanels((prev) => {
      const expected = panesForShape(shape);
      const expectedIds = expected.map((t) => t.id);
      const leftTabs = prev.left.tabs;
      // Existing pane tabs that survive the shape transition.
      const surviving = leftTabs.filter(
        (t) => t.kind !== 'pane' || expectedIds.includes(t.id),
      );
      // Pane tabs in the new shape that aren't on the strip yet.
      const missing = expected.filter((t) => !leftTabs.some((x) => x.id === t.id));
      if (missing.length === 0 && surviving.length === leftTabs.length) return prev;
      // Splice the missing tabs into their methodology-defined order; keep
      // non-pane tabs (shell / AI / browser) at the end where they sit today.
      const paneSurvivors = surviving.filter((t) => t.kind === 'pane');
      const nonPane = surviving.filter((t) => t.kind !== 'pane');
      const orderedPane: WorkspaceTab[] = expected.map((t) => {
        const carry = paneSurvivors.find((p) => p.id === t.id);
        return carry ?? t;
      });
      const nextTabs = [...orderedPane, ...nonPane];
      const activeId = nextTabs.some((t) => t.id === prev.left.activeId)
        ? prev.left.activeId
        : nextTabs[0]?.id ?? '';
      return { ...prev, left: { tabs: nextTabs, activeId } };
    });
  }, [shape]);

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

  // Layout restore is disabled: every launch starts with the default layout
  // (pinned panes in the left, both docks closed at default size). The
  // `captureLayout` write path below still snapshots state to disk so the
  // restore can be re-enabled in one place when the UX is ready for it.

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

  const addTab = (panelId: PanelId, kind: 'shell' | 'browser'): void => {
    const id = crypto.randomUUID();
    setPanels((p) => {
      const n = p[panelId].tabs.filter((t) => t.kind === kind).length + 1;
      const title = `${kind === 'shell' ? 'Shell' : 'Browser'} ${n}`;
      const tab: WorkspaceTab =
        kind === 'shell'
          ? { id, kind, title, baseTitle: title, status: 'idle' }
          : { id, kind, title, baseTitle: title };
      return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
    });
    setDockOpen(panelId, true);
  };

  /** Create an `kind: 'ai'` tab bound to `engineId`. The tab opens in empty
   *  state with the engine preselected; the user clicks Start to spawn the
   *  engine. The pick is persisted as this project's last-picked engine so
   *  the next new AI tab defaults to the same engine. */
  const addAiTab = (panelId: PanelId, engineId: string): void => {
    const id = crypto.randomUUID();
    const title = `AI (${engineName(engineId)})`;
    setPanels((p) => {
      const tab: WorkspaceTab = { id, kind: 'ai', title, baseTitle: title, engine: engineId };
      return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
    });
    setDockOpen(panelId, true);
    void window.cockpit.engineLastSet(engineId);
    setLastEngineId(engineId);
  };

  /** Change the engine bound to an AI tab. Updates the tab's `engine` field
   *  and (when its title was not user-renamed) refreshes the auto-managed
   *  title to match. Persisted as the project's last-picked engine. */
  const setAiTabEngine = useCallback(
    (tabId: string, engineId: string): void => {
      setPanels((prev) => {
        for (const panelId of PANEL_IDS) {
          const tabs = prev[panelId].tabs;
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx === -1) continue;
          const tab = tabs[idx];
          if (tab.engine === engineId) return prev;
          const baseTitle = `AI (${engineName(engineId)})`;
          const next = [...tabs];
          next[idx] = {
            ...tab,
            engine: engineId,
            baseTitle,
            title: tab.manualTitle ? tab.title : baseTitle,
          };
          return { ...prev, [panelId]: { ...prev[panelId], tabs: next } };
        }
        return prev;
      });
      void window.cockpit.engineLastSet(engineId);
      setLastEngineId(engineId);
    },
    [engineName],
  );

  /** Flip an AI tab's running state — the engine just started or just exited.
   *  Drives the auto-managed title: `AI (engine)` while empty, `engine` while
   *  running. The `running` flag itself does not persist; the next session's
   *  AI tabs always restore in the empty state. */
  const setAiTabRunning = useCallback(
    (tabId: string, running: boolean): void => {
      setPanels((prev) => {
        for (const panelId of PANEL_IDS) {
          const tabs = prev[panelId].tabs;
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx === -1) continue;
          const tab = tabs[idx];
          if (tab.kind !== 'ai') continue;
          const name = tab.engine ? engineName(tab.engine) : '';
          const baseTitle = running ? name : `AI (${name})`;
          if (tab.baseTitle === baseTitle && (tab.manualTitle || tab.title === baseTitle)) {
            return prev;
          }
          const next = [...tabs];
          next[idx] = {
            ...tab,
            baseTitle,
            title: tab.manualTitle ? tab.title : baseTitle,
          };
          return { ...prev, [panelId]: { ...prev[panelId], tabs: next } };
        }
        return prev;
      });
    },
    [engineName],
  );


  /** Create a shell tab on `panelId` from a tab shortcut — titled after the
   *  shortcut, with the command queued for the PTY once it spawns. */
  const createTerminalShortcutTab = useCallback(
    (panelId: PanelId, command: string, label: string): void => {
      const id = crypto.randomUUID();
      setTerminalInitialCommands((prev) => ({ ...prev, [id]: command }));
      setPanels((p) => {
        const tab: WorkspaceTab = {
          id,
          kind: 'shell',
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
   *  tab. **Shell tabs** show the running command (today's behaviour).
   *  **AI tabs** show `engine · status` — e.g. `claude · running` — because
   *  the engine command surfaced by `ps` is typically a long node path and
   *  the running/idle suffix is what the user actually cares about. */
  const handleTerminalStatus = useCallback(
    (tabId: string, status: TerminalForegroundStatus, command: string): void => {
      setPanels((prev) => {
        for (const panelId of PANEL_IDS) {
          const tabs = prev[panelId].tabs;
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx === -1) continue;
          const tab = tabs[idx];
          const aiTitle = (): string => {
            const name = tab.engine ? engineName(tab.engine) : 'AI';
            return `${name} · ${status}`;
          };
          const title = tab.manualTitle
            ? tab.title
            : tab.kind === 'ai'
              ? aiTitle()
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
    [engineName],
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
    // A shell tab running a task confirms before closing — the whole-window
    // close has the same guard, but closing a single tab bypassed it.
    if (tab?.kind === 'shell' && tab.status === 'running') {
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

  // Each tab's content lives in a stable host `<div>` (one per tab.id) that
  // is created imperatively and lives outside React's tree. The host stays
  // the same for the tab's lifetime; only its DOM parent changes when the
  // tab moves between panels. The layout effect below reparents each host
  // into its active panel's slot via `appendChild` — a plain DOM move that
  // does not trigger React lifecycle.
  //
  // The stable host is load-bearing: `createPortal`'s `container` argument
  // changing forces React to unmount + remount the children, which would
  // kill a long-running PTY on every tab move. Portaling into the host (one
  // per tab, never re-targeted) instead of directly into the panel slot
  // (different per panel) is what keeps `claude` and friends alive.
  const tabPlacements = useMemo(() => {
    const out: { tab: WorkspaceTab; panelId: PanelId; visible: boolean }[] = [];
    for (const panelId of PANEL_IDS) {
      const p = panels[panelId];
      for (const tab of p.tabs) {
        const active = p.activeId === tab.id;
        const open = panelId === 'left' || (panelId === 'right' ? rightOpen : bottomOpen);
        out.push({ tab, panelId, visible: active && open });
      }
    }
    return out;
  }, [panels, rightOpen, bottomOpen]);

  const tabHostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const getOrCreateTabHost = (tabId: string): HTMLDivElement => {
    let host = tabHostsRef.current.get(tabId);
    if (!host) {
      host = document.createElement('div');
      host.dataset.tabHost = tabId;
      Object.assign(host.style, {
        flex: '1',
        minWidth: '0',
        minHeight: '0',
        display: 'none',
      });
      tabHostsRef.current.set(tabId, host);
    }
    return host;
  };

  // Park each tab host in its panel's slot and toggle visibility. Runs before
  // paint so panel moves don't flicker. Drops hosts for closed tabs.
  useLayoutEffect(() => {
    const alive = new Set(tabPlacements.map((p) => p.tab.id));
    for (const { tab, panelId, visible } of tabPlacements) {
      const slot = slots[panelId];
      const host = tabHostsRef.current.get(tab.id);
      if (!host) continue;
      if (slot && host.parentNode !== slot) slot.appendChild(host);
      host.style.display = visible ? 'flex' : 'none';
    }
    for (const [id, host] of tabHostsRef.current) {
      if (!alive.has(id)) {
        host.remove();
        tabHostsRef.current.delete(id);
      }
    }
  }, [tabPlacements, slots]);

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
      onNewShell={() => addTab(panelId, 'shell')}
      onNewAi={(engine) => addAiTab(panelId, engine)}
      onNewBrowser={() => addTab(panelId, 'browser')}
      engines={engines}
      lastEngineId={lastEngineId}
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

  const contentPortals = tabPlacements.map(({ tab, visible }) => {
    const host = getOrCreateTabHost(tab.id);
    let body: JSX.Element | null = null;
    if (tab.kind === 'pane') {
      if (tab.id === 'publish') {
        body = <PublishPane />;
      } else {
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
      }
    } else if (tab.kind === 'shell') {
      body = (
        <TerminalTab
          active={visible}
          tabId={tab.id}
          onStatus={handleTerminalStatus}
          initialCommand={terminalInitialCommands[tab.id]}
        />
      );
    } else if (tab.kind === 'ai') {
      body = (
        <AiTab
          active={visible}
          tabId={tab.id}
          engine={tab.engine ?? ''}
          engines={engines}
          onEngineChange={(engineId) => setAiTabEngine(tab.id, engineId)}
          onStatus={handleTerminalStatus}
          onRunningChange={setAiTabRunning}
        />
      );
    } else {
      body = (
        <BrowserTab tabId={tab.id} visible={visible} initialUrl={browserInitialUrls[tab.id]} />
      );
    }
    return createPortal(body, host, tab.id);
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
