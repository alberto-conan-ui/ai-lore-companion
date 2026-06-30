/**
 * The companion's Dockview workspace (v2 P2). It hosts the **centre + right**
 * columns of the cockpit (the Assistant host pane plus the user's shell / AI /
 * browser tabs) through the shell's [DockHost](../shell/DockHost.tsx); the
 * leftmost pane (Status / Payload / Memory) and the editor stay rail-driven v1.0
 * chrome in App. Each tab's body dispatches through `companionContributions.tabKinds`
 * via the shared content seam, so a live PTY / web view survives a tab switch or
 * a drag between groups.
 *
 * It wires the three shell building blocks — `DockHost` (themed Dockview,
 * `renderer:'always'`), `DockSlotRegistry` + `makeDockSlotPanel` (each Dockview
 * panel is a *slot*), and `useHostSeam` (stable per-tab hosts portaled in).
 *
 * State model. App owns tab **existence + metadata** (the `panels` model, keyed
 * by id); Dockview owns **layout** (which group, what order — drag is native).
 * The two are kept in sync by a reconcile effect: tabs present in the model but
 * not in Dockview are added; panels in Dockview but gone from the model are
 * removed. Closing a tab routes App-first (the tab's close button overrides
 * Dockview's, calling App's `closeTab`), so existence has a single owner and the
 * sync never loops.
 */
import {
  type DockviewApi,
  DockviewDefaultTab,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type SerializedDockview,
} from 'dockview';
import { type FC, type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DockHost } from '../shell/DockHost.js';
import { type DockSlotParams, DockSlotRegistry, makeDockSlotPanel } from '../shell/dockSlots.js';
import { type HostSeamItem, useHostSeam } from '../shell/hostSeam.js';
import type { PanelId, WorkspaceTab } from './TabbedPanel.js';
import {
  NEW_TAB_BUTTONS,
  type NewTabContext,
  TAB_KINDS,
  type TabRenderContext,
} from './tabKinds.js';

/** The panel model slice DockWorkspace reads — structurally App's `Panel`. */
type WorkspacePanel = { tabs: WorkspaceTab[]; activeId: string };

type Props = {
  panels: Record<PanelId, WorkspacePanel>;
  /** Everything a tab body needs to render — threaded to `renderBody`. */
  renderCtx: TabRenderContext;
  /** Creator handlers (+ AI / + shell / + web) — already targeted at the dock. */
  newTabCtx: NewTabContext;
  /** Close a dock tab by id (runs App's close guard + removes it from the model). */
  onCloseTab: (tabId: string) => void;
  /** Rename a dock tab by id (double-click a tab → inline edit). An empty name
   *  reverts to the auto-managed default, mirroring v1.0's `renameTab`. */
  onRenameTab: (tabId: string, name: string) => void;
  /**
   * A previously-captured Dockview serialization (`api.toJSON()`, persisted via
   * `WorkspaceLayout.dock.serialized`). When present it is applied once in
   * `onReady` (S-D restore) so the saved group placement comes back instead of
   * every tab piling into one group. Opaque (`unknown`) so the component is the
   * only place that knows Dockview's serialization shape. The host must already
   * have seeded the model with the matching dormant tabs before mount — App
   * gates the mount on the restore read for exactly that reason.
   */
  initialDockLayout?: unknown;
  /** Hands the Dockview API up so the host can `toJSON()` at capture time. */
  onApi?: (api: DockviewApi) => void;
  /**
   * Fired whenever Dockview's own layout changes (a drag between groups, a group
   * resize, an active-panel change). These never touch App's tab model, so
   * without this the host has no signal to re-capture — and a pure rearrange
   * would never persist. App debounces a snapshot in response.
   */
  onLayoutChange?: () => void;
};

/**
 * Dockview hosts only the **centre + right** columns (and their bottom docks);
 * the leftmost pane + editor stay v1.0 chrome in App. New tabs land in the
 * centre bucket and the user drags to split into groups.
 */
const DOCK_PANELS: PanelId[] = ['centre', 'centreBottom', 'right', 'rightBottom'];

/**
 * Pinned-pane tab (Assistant host): not closable **and** not draggable. Dockview
 * 4.13.1 gates drag on a global `disableDnd` option, not per-panel, and `locked`
 * groups only block *drops* — neither pins a single tab in a shared group. So we
 * pin from the DOM: clear the host `.dv-tab`'s `draggable` flag on mount (the
 * browser then fires no `dragstart`, and Dockview's drag handler never engages).
 * The wrapper is `display:contents` so it adds no layout box.
 */
function PaneTab(props: IDockviewPanelHeaderProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tabEl = ref.current?.closest('.dv-tab');
    if (tabEl instanceof HTMLElement) tabEl.draggable = false;
  }, []);
  return (
    <span ref={ref} style={paneTabWrap}>
      <DockviewDefaultTab hideClose {...props} />
    </span>
  );
}

/**
 * A user tab (shell / AI / web): closable and **inline-renamable**. Dockview's
 * default tab has no rename, so double-click swaps the title for an input
 * (restoring v1.0's gesture); Enter / blur commits, Escape cancels. While editing
 * the host `.dv-tab` is freed from drag so mouse text-selection in the input
 * isn't hijacked into a tab drag. Close + rename read the latest handlers through
 * refs so the component identity stays stable for Dockview.
 */
function makeRenamableTab(
  closeRef: { current: (tabId: string) => void },
  renameRef: { current: (tabId: string, name: string) => void },
): FC<IDockviewPanelHeaderProps> {
  return function RenamableTab(props: IDockviewPanelHeaderProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const ref = useRef<HTMLElement | null>(null);
    const title = props.api.title ?? '';
    useEffect(() => {
      const tabEl = ref.current?.closest('.dv-tab');
      if (tabEl instanceof HTMLElement) tabEl.draggable = !editing;
      if (editing && ref.current instanceof HTMLInputElement) ref.current.select();
    }, [editing]);
    const commit = (): void => {
      renameRef.current(props.api.id, draft);
      setEditing(false);
    };
    if (editing) {
      return (
        <input
          ref={ref}
          style={renameInput}
          value={draft}
          spellCheck={false}
          aria-label="Rename tab"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      );
    }
    return (
      <span
        ref={ref}
        style={paneTabWrap}
        onDoubleClick={() => {
          setDraft(title);
          setEditing(true);
        }}
      >
        <DockviewDefaultTab {...props} closeActionOverride={() => closeRef.current(props.api.id)} />
      </span>
    );
  };
}

/** Header creators (+ AI / + shell / + web) for a group, reading the latest ctx
 *  through a ref so the component identity stays stable for Dockview. */
function makeCreators(ctxRef: { current: NewTabContext }): FC<IDockviewHeaderActionsProps> {
  return function Creators(): JSX.Element {
    const ctx = ctxRef.current;
    return (
      <div style={creatorRow}>
        {NEW_TAB_BUTTONS.map((btn) => (
          <button
            key={btn.testId}
            type="button"
            data-testid={btn.testId}
            className="dock-creator"
            style={creatorBtn}
            title={btn.title(ctx)}
            disabled={btn.disabled?.(ctx) ?? false}
            onClick={() => btn.onClick(ctx)}
          >
            {btn.label}
          </button>
        ))}
      </div>
    );
  };
}

export function DockWorkspace({
  panels,
  renderCtx,
  newTabCtx,
  onCloseTab,
  onRenameTab,
  initialDockLayout,
  onApi,
  onLayoutChange,
}: Props): JSX.Element {
  // The slot registry lives for the component's life; a version counter bumps
  // when a slot panel mounts/unmounts so the seam re-parks as Dockview rebuilds.
  const registryRef = useRef<DockSlotRegistry>();
  if (!registryRef.current) registryRef.current = new DockSlotRegistry();
  const registry = registryRef.current;
  const [slotsVersion, setSlotsVersion] = useState(0);

  // Which dock panels Dockview currently shows (active tab of each group).
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  // Latest handlers, read by the stable-identity tab/header components via refs.
  const closeRef = useRef(onCloseTab);
  closeRef.current = onCloseTab;
  const renameRef = useRef(onRenameTab);
  renameRef.current = onRenameTab;
  const ctxRef = useRef(newTabCtx);
  ctxRef.current = newTabCtx;

  const components = useMemo(() => {
    registry.subscribe(() => setSlotsVersion((v) => v + 1));
    return { slot: makeDockSlotPanel(registry) };
  }, [registry]);
  // The pinned pane gets a no-close tab; everything else a default tab whose
  // close routes through App (existence is App-owned), then reconcile removes the
  // Dockview panel. A vetoed close (running task) leaves the tab in the model and
  // reconcile re-adds the panel — one owner, no sync loop.
  const tabComponents = useMemo(
    () => ({
      pane: PaneTab,
      closable: makeRenamableTab(closeRef, renameRef),
    }),
    [],
  );
  const headerActions = useMemo(() => makeCreators(ctxRef), []);

  // A flat id→tab map across the dock-owned panels, for content dispatch + sync.
  const tabsById = useMemo(() => {
    const m = new Map<string, WorkspaceTab>();
    for (const id of DOCK_PANELS) {
      for (const tab of panels[id].tabs) m.set(tab.id, tab);
    }
    return m;
  }, [panels]);

  const items = useMemo<HostSeamItem[]>(
    () => [...tabsById.keys()].map((id) => ({ id, visible: visibleIds.has(id) })),
    [tabsById, visibleIds],
  );
  const resolveSlot = useCallback((id: string) => registry.get(id), [registry]);
  const renderBody = useCallback(
    (id: string) => {
      const tab = tabsById.get(id);
      if (!tab) return null;
      return TAB_KINDS[tab.kind].renderBody(tab, visibleIds.has(id), renderCtx);
    },
    [tabsById, visibleIds, renderCtx],
  );
  const portals = useHostSeam(items, resolveSlot, renderBody, slotsVersion);

  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(0);
  // initialDockLayout / onApi are stable by the time the dock mounts — App gates
  // the mount on the restore read — so the first-render closure carries the
  // final values; onReady only fires once. Deps keep the lint honest.
  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      // S-D restore: rebuild the saved group placement before anything else, so
      // the reconcile effect below matches the restored panels by id (no
      // re-add / remove) and visibility is computed against the real layout. A
      // corrupt blob must not brick the workspace — fall back to the reconcile-
      // built default.
      if (initialDockLayout) {
        try {
          api.fromJSON(initialDockLayout as SerializedDockview);
        } catch (err) {
          console.error('[dock] fromJSON failed; opening with the default layout', err);
        }
      }
      const recomputeVisible = (): void => {
        const vis = new Set<string>();
        for (const p of api.panels) if (p.api.isVisible) vis.add(p.id);
        setVisibleIds(vis);
      };
      const onLayout = (): void => {
        recomputeVisible();
        onLayoutChange?.();
      };
      recomputeVisible();
      api.onDidLayoutChange(onLayout);
      api.onDidActivePanelChange(onLayout);
      onApi?.(api);
      setReady((r) => r + 1);
    },
    [initialDockLayout, onApi, onLayoutChange],
  );

  // Reconcile Dockview to the model: add new tabs (active, in the active group),
  // update titles, remove panels whose tab is gone. Dockview keeps ownership of
  // where each panel sits (the user's drags). The leftmost-pane chrome is not
  // here. New tabs use the `closable` tab; the Assistant pane uses `pane`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ready` is a deliberate re-run trigger — it isn't read in the body, but the reconcile must (re)run once `apiRef` is populated by onReady.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const [id, tab] of tabsById) {
      const existing = api.getPanel(id);
      if (!existing) {
        api.addPanel<DockSlotParams>({
          id,
          component: 'slot',
          tabComponent: tab.kind === 'pane' ? 'pane' : 'closable',
          params: { slotId: id },
          title: tab.title,
        });
      } else if (existing.title !== tab.title) {
        existing.api.setTitle(tab.title);
      }
    }
    for (const p of [...api.panels]) {
      if (!tabsById.has(p.id)) api.removePanel(p);
    }
  }, [tabsById, ready]);

  return (
    <div style={hostWrap} data-testid="dock-workspace">
      <DockHost
        components={components}
        tabComponents={tabComponents}
        rightHeaderActionsComponent={headerActions}
        onReady={onReady}
      />
      {portals}
    </div>
  );
}

const hostWrap: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  position: 'relative',
};

const paneTabWrap: React.CSSProperties = { display: 'contents' };

const renameInput: React.CSSProperties = {
  margin: '0.2rem 0.45rem',
  width: '8rem',
  padding: '0.15rem 0.3rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-accent)',
  borderRadius: '3px',
  color: 'var(--color-text-bright)',
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const creatorRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.15rem',
  padding: '0 0.3rem',
};

const creatorBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-dim)',
  font: 'inherit',
  fontSize: '0.72rem',
  fontWeight: 600,
  padding: '0.1rem 0.35rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
