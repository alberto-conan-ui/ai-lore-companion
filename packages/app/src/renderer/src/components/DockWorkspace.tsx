/**
 * The companion's Dockview workspace (v2 P2, stage S-A). It hosts the cockpit's
 * panels — the pinned panes (Status / Payload / Memory / Publish / Assistant) and
 * the user's shell / AI / browser tabs — through the shell's [DockHost](../shell/DockHost.tsx),
 * dispatching each tab's body through the `companionContributions.tabKinds`
 * registry via the shared content seam.
 *
 * It wires the three shell building blocks:
 *   - `DockHost` renders Dockview with our theme + `renderer:'always'`;
 *   - `DockSlotRegistry` + `makeDockSlotPanel` make each Dockview panel a *slot*;
 *   - `useHostSeam` owns the stable per-tab host `<div>`s and portals each tab's
 *     `renderBody(...)` in, parking the host into its slot — so a live PTY / web
 *     view survives a tab switch or a move between groups.
 *
 * Behind App's `USE_DOCKVIEW` switch (OFF by default) — this is the staged,
 * supervised replacement for the v1.0 CSS-grid `panelsRow`. Stage S-A seeds the
 * layout from the panel model and renders content live; later stages add the
 * creators/rename/badges (S-B), Dockview-owned DnD + state inversion (S-C), and
 * `toJSON`/`fromJSON` persistence (S-D).
 */
import {
  type DockviewApi,
  DockviewDefaultTab,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
} from 'dockview';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { DockHost } from '../shell/DockHost.js';
import { type DockSlotParams, DockSlotRegistry, makeDockSlotPanel } from '../shell/dockSlots.js';
import { type HostSeamItem, useHostSeam } from '../shell/hostSeam.js';
import type { PanelId, WorkspaceTab } from './TabbedPanel.js';
import { TAB_KINDS, type TabRenderContext } from './tabKinds.js';

/** The panel model slice DockWorkspace reads — structurally App's `Panel`. */
type WorkspacePanel = { tabs: WorkspaceTab[]; activeId: string };

type Props = {
  panels: Record<PanelId, WorkspacePanel>;
  rightOpen: boolean;
  centreBottomOpen: boolean;
  rightBottomOpen: boolean;
  /** Everything a tab body needs to render — threaded to `renderBody`. */
  renderCtx: TabRenderContext;
};

/**
 * Dockview hosts only the **centre + right** columns (and their bottom docks).
 * The leftmost pane (Status / Payload / Memory) stays rail-driven v1.0 chrome in
 * App — the activity rail swaps *only* it against the Assistant feed — and the
 * editor column stays fixed chrome too. So the dock owns these four panels:
 */
const DOCK_PANELS: PanelId[] = ['centre', 'centreBottom', 'right', 'rightBottom'];

/** The seed order: each column's top group, then its bottom group below it; the
 *  two columns laid left→right. Bottoms only seed when open with content. */
const COLUMN_TOPS: PanelId[] = ['centre', 'right'];
const BOTTOM_OF: Partial<Record<PanelId, PanelId>> = {
  centre: 'centreBottom',
  right: 'rightBottom',
};

/** Pinned-pane tab: the cockpit's panes (Status / Payload / Memory / Publish /
 *  Assistant) are not closable. Re-uses Dockview's default tab with the close
 *  affordance hidden. */
function PaneTab(props: IDockviewPanelHeaderProps): JSX.Element {
  return <DockviewDefaultTab hideClose {...props} />;
}

export function DockWorkspace({
  panels,
  rightOpen,
  centreBottomOpen,
  rightBottomOpen,
  renderCtx,
}: Props): JSX.Element {
  // The slot registry is created once and lives for the component's life. A
  // version counter bumps whenever a slot panel mounts/unmounts so the seam
  // re-parks hosts as Dockview (re)builds panels.
  const registryRef = useRef<DockSlotRegistry>();
  if (!registryRef.current) registryRef.current = new DockSlotRegistry();
  const registry = registryRef.current;
  const [slotsVersion, setSlotsVersion] = useState(0);

  // Which seeded panels Dockview currently shows (the active tab of each group).
  // Drives the seam's per-host visibility.
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  // The `slot` panel renderer + the pinned-pane tab renderer, stable for the
  // component's life. Subscribe the version bump here so a mounted slot triggers
  // a re-park.
  const components = useMemo(() => {
    registry.subscribe(() => setSlotsVersion((v) => v + 1));
    return { slot: makeDockSlotPanel(registry) };
  }, [registry]);
  const tabComponents = useMemo(() => ({ pane: PaneTab }), []);

  // A flat id→tab map across the dock-owned panels, for content dispatch.
  const tabsById = useMemo(() => {
    const m = new Map<string, WorkspaceTab>();
    for (const id of DOCK_PANELS) {
      for (const tab of panels[id].tabs) m.set(tab.id, tab);
    }
    return m;
  }, [panels]);

  // The seam items: every tab, visible if Dockview is showing its panel.
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

  // Seed the layout once Dockview is ready. Reads the panel model at mount;
  // Dockview owns layout thereafter (live re-seed on model change is S-B/S-C).
  const apiRef = useRef<DockviewApi | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: onReady seeds from the panel model at mount only; Dockview owns layout thereafter, so a model change must NOT re-run seeding (live re-seed is a later stage).
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    const firstOf: Partial<Record<PanelId, string>> = {};
    const addPanelFor = (
      panelId: PanelId,
      tab: WorkspaceTab,
      isFirst: boolean,
      groupSeed: { reference: string; direction: 'right' | 'below' } | null,
    ): void => {
      const position = isFirst
        ? groupSeed
          ? { referencePanel: groupSeed.reference, direction: groupSeed.direction }
          : undefined
        : { referencePanel: firstOf[panelId] as string, direction: 'within' as const };
      api.addPanel<DockSlotParams>({
        id: tab.id,
        component: 'slot',
        tabComponent: tab.kind === 'pane' ? 'pane' : undefined,
        params: { slotId: tab.id },
        title: tab.title,
        inactive: tab.id !== panels[panelId].activeId,
        ...(position ? { position } : {}),
      });
      if (isFirst) firstOf[panelId] = tab.id;
    };

    const seedGroup = (
      panelId: PanelId,
      groupSeed: { reference: string; direction: 'right' | 'below' } | null,
    ): void => {
      const tabs = panels[panelId].tabs;
      if (tabs.length === 0) return;
      tabs.forEach((tab, i) => addPanelFor(panelId, tab, i === 0, groupSeed));
    };

    const openOf: Partial<Record<PanelId, boolean>> = {
      centre: true,
      right: rightOpen,
      centreBottom: centreBottomOpen,
      rightBottom: rightBottomOpen,
    };

    let prevTop: PanelId | null = null;
    for (const top of COLUMN_TOPS) {
      if (!openOf[top] || panels[top].tabs.length === 0) continue;
      const seed =
        prevTop === null
          ? null
          : { reference: firstOf[prevTop] as string, direction: 'right' as const };
      seedGroup(top, seed);
      prevTop = top;
      const bottom = BOTTOM_OF[top];
      if (bottom && openOf[bottom] && panels[bottom].tabs.length > 0) {
        seedGroup(bottom, { reference: firstOf[top] as string, direction: 'below' });
      }
    }

    const recomputeVisible = (): void => {
      const vis = new Set<string>();
      for (const p of api.panels) if (p.api.isVisible) vis.add(p.id);
      setVisibleIds(vis);
    };
    recomputeVisible();
    api.onDidLayoutChange(recomputeVisible);
    api.onDidActivePanelChange(recomputeVisible);
  }, []);

  return (
    <div style={hostWrap} data-testid="dock-workspace">
      <DockHost components={components} tabComponents={tabComponents} onReady={onReady} />
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
