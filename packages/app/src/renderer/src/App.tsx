import type {
  EngineEntry,
  LayoutEditorDoc,
  LayoutPanel,
  LayoutTab,
  TabLastSession,
  WorkspaceLayout,
} from '@ai-lore-companion/core';
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
import { AlteredScreen } from './components/AlteredScreen.js';
import { AssistantDashboard } from './components/AssistantDashboard.js';
import { BaselinePicker } from './components/BaselinePicker.js';
import { DockPanel } from './components/DockPanel.js';
import { EditorPanel } from './components/EditorPanel.js';
import {
  LEFT_RAIL_WIDTH,
  LeftActivityRail,
  type LeftSection,
} from './components/LeftActivityRail.js';
import { baseDirsOf, entriesInSubRoot } from './components/Pane.js';
import { SearchDialog, type SearchScope } from './components/SearchDialog.js';
import {
  type PanelId,
  type TabKind,
  TabbedPanel,
  type WorkspaceTab,
} from './components/TabbedPanel.js';
import { TrackerStrip } from './components/TrackerStrip.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { type PaneSpec, TAB_KINDS, type TabRenderContext } from './components/tabKinds.js';
import { TERMINAL_FIND_EVENT } from './components/useXtermSession.js';
import { reflowEditorThirds, scaleForResize } from './layout.js';
import { accentColor, accentTint, accentTintLight, hueFor, projectName } from './projectAccent.js';
import { type EditorDoc, useCockpitStore } from './store.js';
import { onEffectiveTheme } from './theme.js';

type Panel = { tabs: WorkspaceTab[]; activeId: string };

/** v0.8 Phase B — the pinned cockpit tabs adapt to the project's shape.
 *  Default-shape projects get three (Status / Payload / Memory). Publishing-
 *  shape projects also get a `publish` pane sandwiched between Payload and
 *  Memory — workshop → deliverable → record. The tabs are otherwise
 *  identical: pinned, unclosable, unmovable.
 */
function panesForShape(shape: 'default' | 'publishing'): WorkspaceTab[] {
  // The "Project" panes — the orientation views. They live behind the Project
  // button of the left activity rail (CR9 Phase 3). The Assistant's output is a
  // sibling rail section (rendered directly, not a pane); its session host is a
  // pinned centre tab (CENTRE_PINNED).
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

const PANEL_IDS = [
  'leftRail',
  'centre',
  'right',
  'leftRailBottom',
  'centreBottom',
  'rightBottom',
] as const;

/** The centre pane's pinned tab(s) (AI Helper, CR9). The Assistant **host** —
 *  where the read-only helper session lives — is a pinned, unclosable tab in the
 *  mid pane, the counterpart to the left-rail Assistant **output** tab. Like the
 *  left-rail panes it is seeded (never restored from a snapshot); user-created
 *  shell/AI/browser tabs sit after it. */
const CENTRE_PINNED: WorkspaceTab[] = [{ id: 'assistant-host', kind: 'pane', title: 'Assistant' }];

/** First-launch default widths/heights, in px. leftRail lands near ~33% on a
 *  1200-1400px window; centre flexes; right is closed by default and opens to
 *  this width. */
const DEFAULT_LEFT_RAIL_WIDTH = 400;
const DEFAULT_RIGHT_WIDTH = 480;
const DEFAULT_BOTTOM_HEIGHT = 240;
/** The editor column's first-open width (Read-only IDE P1). */
const DEFAULT_EDITOR_WIDTH = 560;

/** Kinds the layout snapshot can restore. `pane` tabs are seeded by
 *  `panesForShape`, never restored — and an unknown kind from an older
 *  snapshot is dropped. */
const RESTORABLE_KINDS = new Set<TabKind>(['shell', 'ai', 'browser']);

/** Persist a runtime tab as a layout tab — structure plus the captured
 *  `lastSession`, dropping all live state (PTY ids, status, etc.). */
function tabToLayout(tab: WorkspaceTab, lastSession: TabLastSession | undefined): LayoutTab {
  const out: LayoutTab = { id: tab.id, kind: tab.kind, title: tab.title };
  if (tab.baseTitle !== undefined) out.baseTitle = tab.baseTitle;
  if (tab.manualTitle !== undefined) out.manualTitle = tab.manualTitle;
  if (tab.engine !== undefined) out.engine = tab.engine;
  if (lastSession) out.lastSession = lastSession;
  return out;
}

/** Lift a persisted layout tab into a **dormant** runtime tab — empty, with
 *  `lastSession` set so the banner shows and the live surface stays unmounted.
 *  Returns null for a kind the workspace can't restore. */
function tabFromLayout(t: LayoutTab): WorkspaceTab | null {
  const kind = t.kind as TabKind;
  if (!RESTORABLE_KINDS.has(kind)) return null;
  const out: WorkspaceTab = { id: t.id, kind, title: t.title };
  if (t.baseTitle !== undefined) out.baseTitle = t.baseTitle;
  if (t.manualTitle !== undefined) out.manualTitle = t.manualTitle;
  if (t.engine !== undefined) out.engine = t.engine;
  if (kind === 'shell') out.status = 'idle';
  // Always dormant on restore — even with no captured detail, an empty
  // `lastSession` keeps the surface unmounted until the user resumes it.
  out.lastSession = t.lastSession ?? { kind, detail: '' };
  return out;
}

/** What this window is — set once by main via `onWindowInit`. */
type WindowMode = 'loading' | 'welcome' | 'cockpit' | 'altered';

export function App(): JSX.Element {
  const setChain = useCockpitStore((s) => s.setChain);
  const applyChanges = useCockpitStore((s) => s.applyChanges);
  const applyCommitList = useCockpitStore((s) => s.applyCommitList);
  const applySavePoints = useCockpitStore((s) => s.applySavePoints);
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
    // v0.9: leftRail is seeded with the pinned panes; the other five panels
    // are empty workspaces. When the first chain push reports
    // `shape: 'publishing'`, an effect below reconciles leftRail to include
    // the Publish pane.
    leftRail: { tabs: panesForShape('default'), activeId: 'status' },
    centre: { tabs: [...CENTRE_PINNED], activeId: CENTRE_PINNED[0]?.id ?? '' },
    right: { tabs: [], activeId: '' },
    leftRailBottom: { tabs: [], activeId: '' },
    centreBottom: { tabs: [], activeId: '' },
    rightBottom: { tabs: [], activeId: '' },
  });
  // leftRail and centre are unconditionally visible. The right column is
  // toggleable — closed by default; the chevron sits at the window's right
  // edge until the user opens it.
  const [rightOpen, setRightOpen] = useState(false);
  // Which section the left activity rail shows (CR9 Phase 3): the Project panes
  // or the Assistant feed. Both stay mounted; this just toggles which is shown.
  const [leftSection, setLeftSection] = useState<LeftSection>('project');
  // Per-column bottom-dock visibility, all closed by default.
  const [leftRailBottomOpen, setLeftRailBottomOpen] = useState(false);
  const [centreBottomOpen, setCentreBottomOpen] = useState(false);
  const [rightBottomOpen, setRightBottomOpen] = useState(false);
  // leftRail's fixed width; right's width when open. Centre flexes.
  const [leftRailWidth, setLeftRailWidth] = useState(DEFAULT_LEFT_RAIL_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  // The editor column's width (Read-only IDE P1). Only rendered when a file is
  // open; the nav | editor split appears beside the left region and the centre
  // flexes to fill the rest. Width + open files persist across restart (P2).
  const [editorWidth, setEditorWidth] = useState(DEFAULT_EDITOR_WIDTH);
  // The open editor docs drive both `editorOpen` and layout capture — subscribed
  // here so opening/closing a file re-snapshots the layout.
  const editorDocs = useCockpitStore((s) => s.editorDocs);
  const activeDocPath = useCockpitStore((s) => s.activeDocPath);
  const editorOpen = editorDocs.length > 0;
  // Per-column bottom-dock heights.
  const [leftRailBottomHeight, setLeftRailBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [centreBottomHeight, setCentreBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [rightBottomHeight, setRightBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  // Per-pane Changes-panel split heights, keyed by pane id — persisted in the
  // layout snapshot so a resized Changes panel restores on reopen.
  const [changesHeightByPane, setChangesHeightByPane] = useState<Record<string, number>>({});
  // Per-tab one-shot commands a terminal shortcut seeded. Consumed by
  // `TerminalTab` on mount; written to the PTY once the shell is up.
  const [terminalInitialCommands, setTerminalInitialCommands] = useState<Record<string, string>>(
    {},
  );
  // Per-tab seed URLs a web shortcut queued. Consumed by `BrowserTab` on mount;
  // the view opens here instead of the home page.
  const [browserInitialUrls, setBrowserInitialUrls] = useState<Record<string, string>>({});
  // The foreground command each shell tab is currently running (keyed by tab
  // id), tracked from the status push. Read at capture time to describe a
  // restored shell ("was running …"); a ref, so updating it never re-renders.
  const runningCommands = useRef<Record<string, string>>({});
  // Layout-restore guards. `restoreStarted` runs the restore effect once;
  // `captureReady` gates capture until restore has settled (whether or not a
  // snapshot was found), so the default empty layout never clobbers a stored
  // one before it is read back.
  const restoreStarted = useRef(false);
  const captureReady = useRef(false);
  // Tracks the focus state so the capture can flush on the focus→blur edge.
  const wasFocused = useRef(false);
  // Auto-fit guard: the editor column is fitted to the window once per open
  // (the false→true edge), and the guard clears when the last file closes so the
  // next open refits to the current window size. A restored layout sets it true
  // up front so a saved editor width is never overridden.
  const editorFitted = useRef(false);
  // URL + terminal shortcuts surfaced inside Shell / Web tab sidebars and the
  // `+ shell ▾` / `+ web ▾` start-with-shortcut dropdowns. Project/lore
  // shortcuts live in the header rows instead.
  const [tabShortcuts, setTabShortcuts] = useState<Shortcut[]>([]);
  useEffect(() => {
    const apply = (list: Shortcut[]): void => {
      setTabShortcuts(list.filter((s) => s.target === 'url' || s.target === 'terminal'));
    };
    void window.cockpit.shortcutsList().then(apply);
    return window.cockpit.onShortcutsChanged(apply);
  }, []);
  // This project's own shortcuts — joined with the global list to populate the
  // `+ shell ▾` / `+ web ▾` dropdowns. The per-tab sidebars manage these; here
  // they only feed the creator dropdowns.
  const [projectShortcuts, setProjectShortcuts] = useState<Shortcut[]>([]);
  useEffect(() => {
    void window.cockpit.projectShortcutsList().then(setProjectShortcuts);
    return window.cockpit.onProjectShortcutsChanged(setProjectShortcuts);
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
    (engineId: string): string => engines.find((e) => e.id === engineId)?.name ?? engineId,
    [engines],
  );
  const [slots, setSlots] = useState<Record<PanelId, HTMLDivElement | null>>({
    leftRail: null,
    centre: null,
    right: null,
    leftRailBottom: null,
    centreBottom: null,
    rightBottom: null,
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
      const railTabs = prev.leftRail.tabs;
      // Existing pane tabs that survive the shape transition.
      const surviving = railTabs.filter((t) => t.kind !== 'pane' || expectedIds.includes(t.id));
      // Pane tabs in the new shape that aren't on the strip yet.
      const missing = expected.filter((t) => !railTabs.some((x) => x.id === t.id));
      if (missing.length === 0 && surviving.length === railTabs.length) return prev;
      // Splice the missing tabs into their methodology-defined order; keep
      // non-pane tabs (shell / AI / browser) at the end where they sit today.
      const paneSurvivors = surviving.filter((t) => t.kind === 'pane');
      const nonPane = surviving.filter((t) => t.kind !== 'pane');
      const orderedPane: WorkspaceTab[] = expected.map((t) => {
        const carry = paneSurvivors.find((p) => p.id === t.id);
        return carry ?? t;
      });
      const nextTabs = [...orderedPane, ...nonPane];
      const activeId = nextTabs.some((t) => t.id === prev.leftRail.activeId)
        ? prev.leftRail.activeId
        : (nextTabs[0]?.id ?? '');
      return { ...prev, leftRail: { tabs: nextTabs, activeId } };
    });
  }, [shape]);

  const paneSpecById = useMemo(() => new Map(paneSpecs.map((p) => [p.id, p])), [paneSpecs]);

  // The scopes the global search can cover — one checkbox per pinned tab, plus
  // Publish when the project is in publishing shape. All checked by default.
  const searchScopes = useMemo<SearchScope[]>(() => {
    const base: SearchScope[] = paneSpecs.map((p) => ({
      id: p.id,
      label: p.title,
      dirs: baseDirsOf(p.subRoot),
    }));
    if (chain && !isChainErrorPayload(chain) && chain.shape === 'publishing' && chain.publish) {
      base.push({ id: 'publish', label: 'Publish', dirs: [`${chain.root}/${chain.publish.path}`] });
    }
    return base;
  }, [paneSpecs, chain]);

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

  // The light/dark theme is a global setting; apply it to the document root so
  // the whole window re-themes live. `[data-theme="light"]` overrides the dark
  // token defaults in theme.css; dark is the bare `:root` (no attribute).
  // Effective theme (resolves `system` against the OS) → the document attribute
  // that flips the token layer, plus local state for the project-hue tint.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(
    () =>
      onEffectiveTheme((t) => {
        setTheme(t);
        if (t === 'light') document.documentElement.dataset.theme = 'light';
        else delete document.documentElement.dataset.theme;
      }),
    [],
  );

  useEffect(() => {
    const offChain = window.cockpit.onChain(setChain);
    const offChanges = window.cockpit.onChanges(applyChanges);
    const offCommitList = window.cockpit.onCommitList(applyCommitList);
    const offSavePoints = window.cockpit.onSavePoints(applySavePoints);
    const offTreeInit = window.cockpit.onTreeInit(setTrees);
    const offTreeUpdate = window.cockpit.onTreeUpdate(applyTreeUpdate);
    // Hydrate the Apps catalog from the global settings tier — context menus
    // need it. Re-pull on every SettingsChanged push so adds/removes are live.
    void window.cockpit.settingsGet().then((snap) => setApps(snap.global.apps ?? []));
    const offSettings = window.cockpit.onSettingsChanged((snap) => setApps(snap.global.apps ?? []));
    return () => {
      offChain();
      offChanges();
      offCommitList();
      offSavePoints();
      offTreeInit();
      offTreeUpdate();
      offSettings();
    };
  }, [
    setChain,
    applyChanges,
    applyCommitList,
    applySavePoints,
    setTrees,
    applyTreeUpdate,
    setApps,
  ]);

  // The project search is a modal dialog (⌘F / Edit ▸ Find), not a header bar.
  const [searchOpen, setSearchOpen] = useState(false);

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
        const rail = prev.leftRail;
        const target = rail.tabs[n - 1];
        if (!target) return prev;
        return { ...prev, leftRail: { ...rail, activeId: target.id } };
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

  // ⌘+F focuses the global file search — unless a terminal holds focus, in
  // which case it opens that terminal's in-terminal find bar instead (Focus 4).
  const routeFind = useCallback(() => {
    if (document.activeElement?.closest('.xterm')) {
      window.dispatchEvent(new Event(TERMINAL_FIND_EVENT));
    } else {
      setSearchOpen(true);
    }
  }, []);

  // Two entry points to ⌘F, both routed through `routeFind`:
  //  1. A renderer keydown — the real path on macOS, where the menu's hidden
  //     `visible:false` Navigate items DON'T register their accelerators, so the
  //     ⌘F menu item never fires on a keystroke. Listening here works regardless
  //     of menu visibility. (Focus inside a BrowserTab's WebContentsView is a
  //     separate web-contents, so this never fires there — browser find stays.)
  //  2. The `onFocusGlobalSearch` push from the menu item's click handler — the
  //     path the e2e drives (it clicks the menu item, it can't press the key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        routeFind();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [routeFind]);
  useEffect(() => window.cockpit.onFocusGlobalSearch(routeFind), [routeFind]);

  /** Whether a panel is currently visible. leftRail and centre are always on;
   *  the right column and the three bottoms carry explicit open flags. */
  const dockOpen = (id: PanelId): boolean => {
    switch (id) {
      case 'leftRail':
      case 'centre':
        return true;
      case 'right':
        return rightOpen;
      case 'leftRailBottom':
        return leftRailBottomOpen;
      case 'centreBottom':
        return centreBottomOpen;
      case 'rightBottom':
        return rightBottomOpen;
    }
  };

  const setDockOpen = (id: PanelId, open: boolean): void => {
    switch (id) {
      case 'leftRail':
      case 'centre':
        return; // always open
      case 'right':
        setRightOpen(open);
        return;
      case 'leftRailBottom':
        setLeftRailBottomOpen(open);
        return;
      case 'centreBottom':
        setCentreBottomOpen(open);
        return;
      case 'rightBottom':
        setRightBottomOpen(open);
        return;
    }
  };

  // Stable ref callbacks — a fresh callback each render would make React
  // detach/reattach the slot every render and loop on setState.
  const setLeftRailSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.leftRail === el ? s : { ...s, leftRail: el }));
  }, []);
  const setCentreSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.centre === el ? s : { ...s, centre: el }));
  }, []);
  const setRightSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.right === el ? s : { ...s, right: el }));
  }, []);
  const setLeftRailBottomSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.leftRailBottom === el ? s : { ...s, leftRailBottom: el }));
  }, []);
  const setCentreBottomSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.centreBottom === el ? s : { ...s, centreBottom: el }));
  }, []);
  const setRightBottomSlot = useCallback((el: HTMLDivElement | null) => {
    setSlots((s) => (s.rightBottom === el ? s : { ...s, rightBottom: el }));
  }, []);
  const slotRefs: Record<PanelId, (el: HTMLDivElement | null) => void> = {
    leftRail: setLeftRailSlot,
    centre: setCentreSlot,
    right: setRightSlot,
    leftRailBottom: setLeftRailBottomSlot,
    centreBottom: setCentreBottomSlot,
    rightBottom: setRightBottomSlot,
  };

  const addTab = (panelId: PanelId, kind: 'shell' | 'browser'): void => {
    const id = crypto.randomUUID();
    const make = TAB_KINDS[kind].makeTab;
    if (!make) return;
    setPanels((p) => {
      const index = p[panelId].tabs.filter((t) => t.kind === kind).length + 1;
      const tab = make({ id, index, engineName });
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
    const make = TAB_KINDS.ai.makeTab;
    if (!make) return;
    setPanels((p) => {
      const tab = make({ id, index: 0, engineId, engineName });
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
      // Inline the open-on-create mirror of `setDockOpen` — useState setters
      // are stable, so the surrounding `useCallback([])` is still honest.
      // leftRail and centre are always open — no toggle needed.
      if (panelId === 'right') setRightOpen(true);
      else if (panelId === 'leftRailBottom') setLeftRailBottomOpen(true);
      else if (panelId === 'centreBottom') setCentreBottomOpen(true);
      else if (panelId === 'rightBottom') setRightBottomOpen(true);
    },
    [],
  );

  /** Create a browser tab on `panelId` from a web shortcut — titled after the
   *  shortcut, opening at its URL once the view spawns. Mirrors
   *  `createTerminalShortcutTab` for the `+ web ▾` start-with-shortcut path. */
  const createBrowserShortcutTab = useCallback(
    (panelId: PanelId, url: string, label: string): void => {
      const id = crypto.randomUUID();
      setBrowserInitialUrls((prev) => ({ ...prev, [id]: url }));
      setPanels((p) => {
        const tab: WorkspaceTab = { id, kind: 'browser', title: label, baseTitle: label };
        return { ...p, [panelId]: { tabs: [...p[panelId].tabs, tab], activeId: id } };
      });
      // Mirror `createTerminalShortcutTab`'s open-on-create — leftRail / centre
      // are always open, the rest toggle.
      if (panelId === 'right') setRightOpen(true);
      else if (panelId === 'leftRailBottom') setLeftRailBottomOpen(true);
      else if (panelId === 'centreBottom') setCentreBottomOpen(true);
      else if (panelId === 'rightBottom') setRightBottomOpen(true);
    },
    [],
  );

  // Legacy: terminal shortcuts fired from the header (Phase F's header trigger,
  // since removed) sent a payload via main. The tab-strip shortcuts (this
  // session) handle terminal targets directly in the renderer, so this
  // subscription is dormant — kept defensively for any future main-side trigger.
  // Default target is `rightBottom` (closest v0.9 analogue of the old full-
  // width bottom dock).
  useEffect(() => {
    return window.cockpit.onOpenTerminalShortcut((payload) => {
      createTerminalShortcutTab('rightBottom', payload.command, payload.label);
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
      // Remember the live foreground command for the layout snapshot; clear it
      // when the shell falls idle, so a captured "was running …" is never stale.
      if (status === 'running' && command) runningCommands.current[tabId] = command;
      else delete runningCommands.current[tabId];
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

  /** Resume / dismiss a restored (dormant) tab: drop its `lastSession` so the
   *  banner clears and the live surface mounts as a fresh tab of its kind. */
  const clearLastSession = useCallback((tabId: string): void => {
    setPanels((prev) => {
      for (const panelId of PANEL_IDS) {
        const tabs = prev[panelId].tabs;
        const idx = tabs.findIndex((t) => t.id === tabId);
        if (idx === -1 || !tabs[idx].lastSession) continue;
        const next = [...tabs];
        const { lastSession: _drop, ...rest } = tabs[idx];
        next[idx] = rest;
        return { ...prev, [panelId]: { ...prev[panelId], tabs: next } };
      }
      return prev;
    });
  }, []);

  // ── Layout persistence (E) ────────────────────────────────────────────────
  // Capture the layout structure (panels, tabs, sizes) and, per tab, what it
  // was running — then restore it **empty** on next open: every tab comes back
  // dormant (no PTY, no page, no engine), with a warn banner saying what it
  // held. Only the focused window writes, so two windows on one project don't
  // race their snapshots.
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

  /** What a tab was running, for the snapshot — live state where available,
   *  else a dormant tab's carried note, else an empty (kind-only) marker. */
  const lastSessionFor = useCallback(
    async (tab: WorkspaceTab): Promise<TabLastSession | undefined> => {
      if (tab.kind === 'browser') {
        const url = await window.cockpit.browserGetUrl(tab.id);
        if (url) return { kind: 'browser', detail: url };
        return tab.lastSession ?? { kind: 'browser', detail: '' };
      }
      if (tab.kind === 'ai') {
        if (tab.engine) return { kind: 'ai', detail: engineName(tab.engine) };
        return tab.lastSession ?? { kind: 'ai', detail: '' };
      }
      if (tab.kind === 'shell') {
        const cmd = runningCommands.current[tab.id];
        if (cmd) return { kind: 'shell', detail: cmd };
        return tab.lastSession ?? { kind: 'shell', detail: '' };
      }
      return undefined; // pane tabs carry no session
    },
    [engineName],
  );

  /** Assemble the layout snapshot from the current state and a per-tab
   *  `lastSession` map. Pure + synchronous — the only async input (a browser
   *  tab's live URL) is resolved by the caller and passed in. */
  const buildLayout = useCallback(
    (lastBy: Record<string, TabLastSession | undefined>): WorkspaceLayout => {
      const toLayout = (p: Panel): LayoutPanel => ({
        tabs: p.tabs.map((t) => tabToLayout(t, lastBy[t.id])),
        activeId: p.activeId,
      });
      return {
        schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
        panels: {
          leftRail: toLayout(panels.leftRail),
          centre: toLayout(panels.centre),
          right: toLayout(panels.right),
          leftRailBottom: toLayout(panels.leftRailBottom),
          centreBottom: toLayout(panels.centreBottom),
          rightBottom: toLayout(panels.rightBottom),
        },
        rightOpen,
        leftRailBottomOpen,
        centreBottomOpen,
        rightBottomOpen,
        leftRailWidth,
        rightWidth,
        leftRailBottomHeight,
        centreBottomHeight,
        rightBottomHeight,
        editorWidth,
        editor: {
          docs: editorDocs.map((d) => {
            const ld: LayoutEditorDoc = {
              path: d.path,
              scope: d.scope,
              name: d.name,
              mode: d.mode,
            };
            if (d.oldPath !== undefined) ld.oldPath = d.oldPath;
            if (d.diffBaseline !== undefined) ld.diffBaseline = d.diffBaseline;
            return ld;
          }),
          activePath: activeDocPath,
        },
        changesHeightByPane,
      };
    },
    [
      panels,
      rightOpen,
      leftRailBottomOpen,
      centreBottomOpen,
      rightBottomOpen,
      leftRailWidth,
      rightWidth,
      leftRailBottomHeight,
      centreBottomHeight,
      rightBottomHeight,
      editorWidth,
      editorDocs,
      activeDocPath,
      changesHeightByPane,
    ],
  );

  /** Snapshot the current layout — asks main for each browser tab's live URL.
   *  Used by the in-session debounced capture, where the window stays alive to
   *  await the enrichment. */
  const captureLayout = useCallback(async (): Promise<WorkspaceLayout> => {
    const lastBy: Record<string, TabLastSession | undefined> = {};
    for (const panelId of PANEL_IDS) {
      for (const tab of panels[panelId].tabs) {
        lastBy[tab.id] = await lastSessionFor(tab);
      }
    }
    return buildLayout(lastBy);
  }, [panels, lastSessionFor, buildLayout]);

  /** Synchronous snapshot for the close / focus-loss flush. Skips the async
   *  per-tab URL enrichment (falls back to each tab's stored `lastSession`) so
   *  the IPC write is *dispatched within the `beforeunload` frame*, before the
   *  renderer tears down. Open editor docs and pane sizes are synchronous state,
   *  so a just-opened file reliably persists even on an immediate quit — the
   *  async version lost that race. */
  const captureLayoutSync = useCallback((): WorkspaceLayout => {
    const lastBy: Record<string, TabLastSession | undefined> = {};
    for (const panelId of PANEL_IDS) {
      for (const tab of panels[panelId].tabs) lastBy[tab.id] = tab.lastSession;
    }
    return buildLayout(lastBy);
  }, [panels, buildLayout]);

  /** Rebuild the workspace from a stored snapshot — the five free panels as
   *  dormant tabs, the column/dock sizes, and leftRail's active pane (its
   *  pinned tabs stay owned by `panesForShape`). */
  const applyLayout = useCallback((layout: WorkspaceLayout): void => {
    const liftPanel = (p: LayoutPanel): Panel => {
      const tabs = p.tabs.map(tabFromLayout).filter((t): t is WorkspaceTab => t !== null);
      const activeId = tabs.some((t) => t.id === p.activeId) ? p.activeId : (tabs[0]?.id ?? '');
      return { tabs, activeId };
    };
    // The centre's pinned Assistant host (CR9) is seeded, never restored — like
    // the left-rail panes — so prepend it ahead of the restored user tabs and
    // keep the snapshot's active tab if it still exists.
    const liftCentre = (p: LayoutPanel): Panel => {
      const restored = p.tabs.map(tabFromLayout).filter((t): t is WorkspaceTab => t !== null);
      const tabs = [...CENTRE_PINNED, ...restored];
      const activeId = tabs.some((t) => t.id === p.activeId) ? p.activeId : (tabs[0]?.id ?? '');
      return { tabs, activeId };
    };
    setPanels((prev) => ({
      ...prev,
      centre: liftCentre(layout.panels.centre),
      right: liftPanel(layout.panels.right),
      leftRailBottom: liftPanel(layout.panels.leftRailBottom),
      centreBottom: liftPanel(layout.panels.centreBottom),
      rightBottom: liftPanel(layout.panels.rightBottom),
      // leftRail's pinned panes are deterministic from the project shape — only
      // restore which one was active, and only if it still exists.
      leftRail: prev.leftRail.tabs.some((t) => t.id === layout.panels.leftRail.activeId)
        ? { ...prev.leftRail, activeId: layout.panels.leftRail.activeId }
        : prev.leftRail,
    }));
    setRightOpen(layout.rightOpen);
    setLeftRailBottomOpen(layout.leftRailBottomOpen);
    setCentreBottomOpen(layout.centreBottomOpen);
    setRightBottomOpen(layout.rightBottomOpen);
    setLeftRailWidth(layout.leftRailWidth);
    setRightWidth(layout.rightWidth);
    setLeftRailBottomHeight(layout.leftRailBottomHeight);
    setCentreBottomHeight(layout.centreBottomHeight);
    setRightBottomHeight(layout.rightBottomHeight);
    // Editor column + open files (P2) — optional on older snapshots. A restored
    // width is the user's own; suppress the first-open auto-fit so it stands.
    if (typeof layout.editorWidth === 'number') {
      setEditorWidth(layout.editorWidth);
      editorFitted.current = true;
    }
    if (layout.editor) {
      const docs: EditorDoc[] = layout.editor.docs.map((d) => {
        const doc: EditorDoc = { path: d.path, scope: d.scope, name: d.name, mode: d.mode };
        if (d.oldPath !== undefined) doc.oldPath = d.oldPath;
        if (d.diffBaseline !== undefined) doc.diffBaseline = d.diffBaseline;
        return doc;
      });
      useCockpitStore.getState().restoreDocs(docs, layout.editor.activePath);
    }
    if (layout.changesHeightByPane) setChangesHeightByPane(layout.changesHeightByPane);
  }, []);

  // Restore once, when the window first enters cockpit mode. Reads the project
  // settings snapshot; applies the stored layout when `restoreLayout` is on.
  // Either way, opens the capture gate when it settles.
  useEffect(() => {
    if (mode !== 'cockpit' || restoreStarted.current) return;
    restoreStarted.current = true;
    let cancelled = false;
    void window.cockpit.settingsGet().then((snap) => {
      if (cancelled) return;
      const layout = snap.project?.layout;
      if (snap.resolved['workspace.restoreLayout'] === true && layout) applyLayout(layout);
      captureReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [mode, applyLayout]);

  // The width shared by the nav | editor | centre trio — the window minus the
  // fixed activity rail and the (optional) right dock. The sashes are a few px
  // each; folding them in would only shift the split imperceptibly, so the trio
  // math ignores them.
  const trioAvail = useCallback(
    () => window.innerWidth - LEFT_RAIL_WIDTH - (rightOpen ? rightWidth : 0),
    [rightOpen, rightWidth],
  );

  // Auto-fit when the editor opens (Read-only IDE P2): the editor takes an equal
  // third of the trio, and the nav & centre keep their pre-open ratio in the
  // remaining two-thirds (so 50/50 → 33/33/33, 75/25 → 50/33/17). The guard
  // holds across manual drags and a restored width within an open session, so
  // neither is overridden; it clears when the last file closes so the next open
  // refits to the current window size. Every divider stays hand-draggable.
  useEffect(() => {
    if (!editorOpen) {
      editorFitted.current = false;
      return;
    }
    if (editorFitted.current) return;
    editorFitted.current = true;
    const avail = trioAvail();
    const { nav, editor } = reflowEditorThirds(avail, leftRailWidth - LEFT_RAIL_WIDTH);
    // Clamp for safety on a narrow window; the ratio holds in the common case.
    const editorPx = Math.max(DEFAULT_EDITOR_WIDTH * 0.6, Math.min(editor, avail * 0.6));
    setEditorWidth(Math.round(editorPx));
    setLeftRailWidth(Math.round(LEFT_RAIL_WIDTH + Math.max(160, nav)));
  }, [editorOpen, leftRailWidth, trioAvail]);

  // Keep the trio's proportions across a window resize: scale the nav content
  // and (when open) the editor by the change in available width, so the centre
  // — the flexed remainder — keeps its fraction too. Re-seeds its baseline on
  // every structural change (editor open/close, right dock toggle) so a one-off
  // jump in available width is never mistaken for a resize.
  const prevAvailRef = useRef<number | null>(null);
  useEffect(() => {
    prevAvailRef.current = trioAvail();
    const onResize = (): void => {
      const next = trioAvail();
      const prev = prevAvailRef.current;
      prevAvailRef.current = next;
      if (prev == null || Math.abs(next - prev) < 1) return;
      setLeftRailWidth((w) =>
        Math.round(LEFT_RAIL_WIDTH + scaleForResize(w - LEFT_RAIL_WIDTH, prev, next)),
      );
      if (editorOpen) setEditorWidth((w) => Math.round(scaleForResize(w, prev, next)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [editorOpen, trioAvail]);

  // Capture on layout changes, debounced, from the focused window only — but
  // not until restore has settled (so the default layout never overwrites a
  // stored one first).
  useEffect(() => {
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain)) return;
    if (!hasFocus || !captureReady.current) return;
    const handle = window.setTimeout(() => {
      void captureLayout().then((layout) => window.cockpit.settingsSetLayout({ layout }));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [mode, chain, hasFocus, captureLayout]);

  // Flush the moment the window loses focus. The debounced capture above only
  // runs while focused and is cleared on blur, so a change made just before
  // switching away (clicking to the terminal, ⌘-Tab) would otherwise sit
  // unwritten — and an abrupt process kill (Ctrl-C in dev) never reaches the
  // `beforeunload` flush below. Firing once on the focus→blur edge persists the
  // latest state before either happens. (`beforeunload` still covers a graceful
  // window close, which fires no blur.)
  useEffect(() => {
    const lostFocus = wasFocused.current && !hasFocus;
    wasFocused.current = hasFocus;
    if (!lostFocus) return;
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain) || !captureReady.current) return;
    void window.cockpit.settingsSetLayout({ layout: captureLayoutSync() });
  }, [hasFocus, mode, chain, captureLayoutSync]);

  // Final flush on window close — fire-and-forget; main records what reaches it.
  useEffect(() => {
    if (mode !== 'cockpit' || !chain || isChainErrorPayload(chain)) return;
    const onUnload = (): void => {
      if (!captureReady.current) return;
      void window.cockpit.settingsSetLayout({ layout: captureLayoutSync() });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [mode, chain, captureLayoutSync]);

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
      setPanels((p) => ({ ...p, leftRail: { ...p.leftRail, activeId: picked.id } }));
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
    // Per-kind close hook: shell confirms when a task runs (the whole-window
    // close has the same guard; closing a single tab bypassed it), browser
    // tears down its WebContentsView. A `false` return cancels the close.
    if (tab && TAB_KINDS[tab.kind].onClose?.(tab) === false) return;
    setPanels((p) => {
      const tabs = p[panelId].tabs.filter((t) => t.id !== tabId);
      const activeId =
        p[panelId].activeId === tabId ? (tabs[tabs.length - 1]?.id ?? '') : p[panelId].activeId;
      return { ...p, [panelId]: { tabs, activeId } };
    });
    if (panelId !== 'leftRail' && panel.tabs.length === 1) setDockOpen(panelId, false);
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
      if (fromPanel !== 'leftRail' && fromTabsBefore.length === 1) setDockOpen(fromPanel, false);
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
    const openOf = (id: PanelId): boolean => {
      switch (id) {
        case 'leftRail':
        case 'centre':
          return true;
        case 'right':
          return rightOpen;
        case 'leftRailBottom':
          return leftRailBottomOpen;
        case 'centreBottom':
          return centreBottomOpen;
        case 'rightBottom':
          return rightBottomOpen;
      }
    };
    for (const panelId of PANEL_IDS) {
      const p = panels[panelId];
      for (const tab of p.tabs) {
        const active = p.activeId === tab.id;
        out.push({ tab, panelId, visible: active && openOf(panelId) });
      }
    }
    return out;
  }, [panels, rightOpen, leftRailBottomOpen, centreBottomOpen, rightBottomOpen]);

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
          <h1
            style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)', fontWeight: 600 }}
          >
            AI-Lore
          </h1>
          <p
            style={{ margin: '0.4rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}
          >
            Starting…
          </p>
        </div>
      </main>
    );
  }

  if (mode === 'welcome') {
    return (
      <WelcomeScreen
        recents={recents}
        onRemoveRecent={(path) => void window.cockpit.recentsRemove(path).then(setRecents)}
      />
    );
  }

  if (mode === 'altered') {
    return <AlteredScreen folder={alteredFolder} reason={alteredReason} />;
  }

  if (!chain) {
    return (
      <main style={fullCenter} data-testid="loading">
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text)', fontWeight: 600 }}
          >
            AI-Lore
          </h1>
          <p
            style={{ margin: '0.4rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}
          >
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
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--color-danger-fg)' }}>
            Cannot read tracker chain
          </h2>
          <p style={{ margin: 0, color: 'var(--color-text)' }}>{chain.error}</p>
          <p
            style={{ margin: '0.8rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}
          >
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
      shortcuts={[...projectShortcuts, ...tabShortcuts]}
      onNewShellWithCommand={(command, label) => createTerminalShortcutTab(panelId, command, label)}
      onNewBrowserWithUrl={(url, label) => createBrowserShortcutTab(panelId, url, label)}
      onLaunchUrlExternal={(url) => window.cockpit.urlOpenExternal(url)}
      onRenameTab={(id, name) => renameTab(panelId, id, name)}
      onMoveTab={moveTab}
      slotRef={slotRefs[panelId]}
      tabDrift={panelId === 'leftRail' ? tabDrift : undefined}
      locked={panelId === 'leftRail'}
      trailing={panelId === 'leftRail' ? <BaselinePicker /> : undefined}
    />
  );

  // Everything a tab body reaches into App for — passed to the registry's
  // `renderBody` so `tabKinds` stays a pure module with no App-state imports.
  const renderCtx: TabRenderContext = {
    projectRoot: chain.root,
    paneSpecById,
    displayPath,
    revealTarget,
    handleTerminalStatus,
    terminalInitialCommands,
    browserInitialUrls,
    tabShortcuts,
    engines,
    setAiTabEngine,
    setAiTabRunning,
    clearLastSession,
    changesHeightByPane,
    onPaneChangesHeight: (paneId, height) =>
      setChangesHeightByPane((m) => ({ ...m, [paneId]: height })),
  };
  const contentPortals = tabPlacements.map(({ tab, visible }) => {
    const host = getOrCreateTabHost(tab.id);
    const body = TAB_KINDS[tab.kind].renderBody(tab, visible, renderCtx);
    return createPortal(body, host, tab.id);
  });

  const accent = accentColor(projectHue);
  const tint = theme === 'light' ? accentTintLight(projectHue) : accentTint(projectHue);
  return (
    <div style={cockpitShell}>
      <TrackerStrip />
      {searchOpen ? (
        <SearchDialog
          scopes={searchScopes}
          onPick={handleSearchPick}
          displayPath={displayPath}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      <div style={panelsRow}>
        {/* The left region (CR9 Phase 3): an activity rail switching between the
         *  Project panes and the Assistant feed. Both stay mounted — the hidden
         *  one is display:none — so the feed keeps its history + Channel-C
         *  subscription across switches. The fixed leftRailWidth covers rail +
         *  panel; the RailSash resizes the whole region. */}
        <div style={{ ...leftRegionStyle, width: leftRailWidth }} data-column-id="left-region">
          <LeftActivityRail section={leftSection} onSelect={setLeftSection} />
          <div style={leftSection === 'project' ? leftSectionShownStyle : leftSectionHiddenStyle}>
            <Column
              name="leftRail"
              flex
              top={panel('leftRail')}
              bottom={panel('leftRailBottom')}
              bottomOpen={leftRailBottomOpen}
              onBottomToggle={setLeftRailBottomOpen}
              bottomHeight={leftRailBottomHeight}
              onBottomResize={setLeftRailBottomHeight}
              accent={accent}
              tint={tint}
            />
          </div>
          <div style={leftSection === 'assistant' ? leftSectionShownStyle : leftSectionHiddenStyle}>
            <AssistantDashboard />
          </div>
        </div>
        {/* Resizable accent-coloured divider between leftRail and centre.
         *  Drag horizontally to adjust leftRail's width; the value persists
         *  via the captureLayout effect. */}
        <RailSash size={leftRailWidth} onResize={setLeftRailWidth} accent={accent} />
        {/* The editor column (Read-only IDE P1): present only while a file is
         *  open, so the left panel reads as nav | editor; the centre flexes to
         *  fill what's left. A sash on its right edge resizes it. */}
        {editorOpen ? (
          <>
            <div style={{ ...editorColumnStyle, width: editorWidth }} data-column-id="editor">
              <EditorPanel />
            </div>
            <RailSash size={editorWidth} onResize={setEditorWidth} accent={accent} />
          </>
        ) : null}
        <Column
          name="centre"
          flex
          top={panel('centre')}
          bottom={panel('centreBottom')}
          bottomOpen={centreBottomOpen}
          onBottomToggle={setCentreBottomOpen}
          bottomHeight={centreBottomHeight}
          onBottomResize={setCentreBottomHeight}
          accent={accent}
          tint={tint}
        />
        {/*
          The toggleable third column (`right`) lives inside a DockPanel
          side="right" so its chevron handle behaves exactly like the existing
          right/bottom docks — click to toggle, drag to resize. Closed by
          default; the chevron sits at the window's right edge until opened.
         */}
        <DockPanel
          side="right"
          open={rightOpen}
          onToggle={setRightOpen}
          size={rightWidth}
          onResize={setRightWidth}
          accent={accent}
          tint={tint}
        >
          <Column
            name="right"
            flex
            top={panel('right')}
            bottom={panel('rightBottom')}
            bottomOpen={rightBottomOpen}
            onBottomToggle={setRightBottomOpen}
            bottomHeight={rightBottomHeight}
            onBottomResize={setRightBottomHeight}
            accent={accent}
            tint={tint}
          />
        </DockPanel>
      </div>
      {contentPortals}
    </div>
  );
}

/** A 4-px-wide draggable sash between leftRail and centre — the 1-px accent
 *  line sits over a hit area thick enough to grab. Drag adjusts the leftRail
 *  width; the value clamps so the rail can't crush the centre. */
function RailSash({
  size,
  onResize,
  accent,
}: {
  size: number;
  onResize: (size: number) => void;
  accent: string;
}): JSX.Element {
  const clamp = (next: number): number => Math.max(200, Math.min(window.innerWidth * 0.6, next));
  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startSize = size;
    const onMove = (ev: MouseEvent): void => {
      onResize(clamp(startSize + (ev.clientX - startX)));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // Arrow keys nudge the width when the splitter is focused (16px steps).
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') onResize(clamp(size - 16));
    else if (e.key === 'ArrowRight') onResize(clamp(size + 16));
  };
  return (
    <div
      style={{ ...railSashHit }}
      // biome-ignore lint/a11y/useSemanticElements: an interactive window splitter — no semantic element fits.
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize left rail"
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      data-testid="left-rail-sash"
    >
      <div style={{ ...railDivider, background: accent }} />
    </div>
  );
}

/** A workspace column — its top TabbedPanel, plus an optional column-width
 *  bottom dock under it. The bottom uses today's `DockPanel` (which knows how
 *  to be column-width thanks to its parent's flex constraints). When `flex`
 *  is true the column flexes to fill remaining space; otherwise it carries
 *  the supplied fixed `width`. */
function Column({
  width,
  flex,
  top,
  bottom,
  bottomOpen,
  onBottomToggle,
  bottomHeight,
  onBottomResize,
  accent,
  tint,
  name,
}: {
  width?: number;
  flex: boolean;
  top: JSX.Element;
  bottom: JSX.Element;
  bottomOpen: boolean;
  onBottomToggle: (open: boolean) => void;
  bottomHeight: number;
  onBottomResize: (h: number) => void;
  accent: string;
  tint: string;
  /** A short identifier for test scoping — surfaces as `data-column-id`. */
  name: string;
}): JSX.Element {
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    // Any wide child (e.g. ChangesPanel's baseline dropdown carrying a long
    // commit subject) must clip inside the column rather than bleeding into
    // neighbouring columns.
    overflow: 'hidden',
    ...(flex ? { flex: 1 } : { width, flexShrink: 0 }),
  };
  return (
    <div style={style} data-column-id={name}>
      <div style={columnTopWrap}>{top}</div>
      <DockPanel
        side="bottom"
        open={bottomOpen}
        onToggle={onBottomToggle}
        size={bottomHeight}
        onResize={onBottomResize}
        accent={accent}
        tint={tint}
      >
        {bottom}
      </DockPanel>
    </div>
  );
}

/** The left region: the activity rail plus the (mutually exclusive) Project /
 *  Assistant sections. Fixed width (rail + panel); the inner sections flex. */
const leftRegionStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const leftSectionShownStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const leftSectionHiddenStyle: React.CSSProperties = { display: 'none' };

/** The editor column wrapper — fixed width (resized by its sash), the
 *  EditorPanel fills it. */
const editorColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const appLayout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
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
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** The panel row beneath the header: the three workspace columns side by side. */
const panelsRow: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const railSashHit: React.CSSProperties = {
  flexShrink: 0,
  // The hit area is wider than the visible line so the user can grab it
  // without pixel-precise aim. Centred 1-px accent line is rendered inside.
  width: '5px',
  height: '100%',
  cursor: 'col-resize',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'stretch',
};

const railDivider: React.CSSProperties = {
  flexShrink: 0,
  width: '1px',
};

const columnTopWrap: React.CSSProperties = {
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
  background: 'var(--color-danger-box-bg)',
  border: '1px solid var(--color-danger-box-border)',
  borderRadius: '6px',
};
