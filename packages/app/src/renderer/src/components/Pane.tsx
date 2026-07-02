import type {
  AppEntry,
  ChangeEntry,
  ChangeScope,
  IgnoreRule,
  TreeNode,
} from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DriftKind,
  type DriftLevel,
  categoriseDriftCode,
  driftLevel,
  findTreeNode,
  useCockpitStore,
} from '../store.js';
import { AppPickerModal } from './AppPickerModal.js';
import { ChangesPanel, type ChangesPanelHandle, type DriftRow } from './ChangesPanel.js';
import { DriftPill } from './DriftPill.js';
import { FileTree, type FileTreeHandle } from './FileTree.js';
import { ContextMenuShell } from './overlay/ContextMenuShell.js';

/** Which of the two regions inside a Pane currently owns the keyboard.
 *  Drives Tab cycling between them and the visible focus accent. The unified
 *  navigator tree (Read-only IDE P2) retired the separate file grid. */
type ActiveRegion = 'tree' | 'queue';

/**
 * What a pane is rooted at, within its scope's tree.
 *  - `path` — a real directory in the scope tree; its node is found by path.
 *  - `synthetic` — a virtual parent grouping several real directories, for a
 *    tab that must show two sibling folders at once (e.g. status + action-tree).
 *    `id` is a stable identifier for the virtual node; `childPaths` are the
 *    real directories it groups.
 */
export type SubRoot =
  | { kind: 'path'; path: string }
  | { kind: 'synthetic'; id: string; name: string; childPaths: string[] };

/** Resolve the `TreeNode` a pane renders, given its scope's path index and
 *  sub-root. Lookups are O(1) against the index (Focus 5). A synthetic sub-root
 *  composes a fresh parent node over the real child nodes it names. */
function resolveSubRoot(index: Map<string, TreeNode>, subRoot: SubRoot): TreeNode | null {
  if (subRoot.kind === 'path') return index.get(subRoot.path) ?? null;
  const children = subRoot.childPaths
    .map((p) => index.get(p))
    .filter((n): n is TreeNode => n !== undefined);
  if (children.length === 0) return null;
  return { name: subRoot.name, path: subRoot.id, isDir: true, children };
}

/** The real directories a sub-root covers — what drift is filtered against. */
export function baseDirsOf(subRoot: SubRoot): string[] {
  return subRoot.kind === 'path' ? [subRoot.path] : subRoot.childPaths;
}

function isUnderBases(absPath: string, bases: string[]): boolean {
  return bases.some((b) => absPath === b || absPath.startsWith(`${b}/`));
}

/**
 * Filter a changes-entry list to the sub-root's directories, producing
 * [`DriftRow`](./ChangesPanel.tsx#DriftRow) objects with the absolute and
 * project-relative paths the renderer needs.
 */
export function entriesInSubRoot(
  entries: readonly ChangeEntry[],
  subRoot: SubRoot,
  projectRoot: string,
): DriftRow[] {
  const bases = baseDirsOf(subRoot);
  const out: DriftRow[] = [];
  for (const e of entries) {
    const absPath = `${projectRoot}/${e.path}`;
    if (!isUnderBases(absPath, bases)) continue;
    out.push({ ...e, projectRelPath: e.path, absPath });
  }
  return out;
}

type Props = {
  scope: ChangeScope;
  label: string;
  /** Stable identifier for this pane — drives its `data-testid`. */
  testId: string;
  /** What this pane is rooted at within `scope`'s tree. */
  subRoot: SubRoot;
  /** Project root — queue entry paths are relative to it; needed to absolutise them. */
  projectRoot: string;
  /** Maps an absolute path to its tab-relative display path. Part of the shared
   *  tab context; the Pane no longer consumes it (the Changes tree uses real
   *  paths now), but it stays on the contract other tab kinds rely on. */
  displayPath: (absPath: string) => string;
  /** Set by a global-search pick: reveal this file. A new token re-triggers. */
  revealRequest?: { path: string; token: number };
  /** Persisted Changes-panel height for this pane (from the layout snapshot);
   *  the pane seeds its split from this and falls back to its default. */
  initialQueueHeight?: number;
  /** Reports a new Changes-panel height (on drag-end) so it can be persisted. */
  onQueueHeightChange?: (height: number) => void;
};

/**
 * One pane of the cockpit: the unified navigator tree (files + folders, Read-only
 * IDE P2) and the queue of unread drift for this side. The pane is rooted at a
 * `SubRoot` — a slice of its `scope`'s tree — and its drift is filtered to
 * that slice. Drift is per-`scope` throughout; the sub-root narrows it further.
 */
export function Pane({
  scope,
  label,
  testId,
  subRoot,
  projectRoot,
  revealRequest,
  initialQueueHeight,
  onQueueHeightChange,
}: Props): JSX.Element {
  const index = useCockpitStore((s) => s.treeIndex[scope]);
  const rawChangesForScope = useCockpitStore((s) => s.changes[scope]);
  // The baseline is global now (the picker beside the pinned tabs writes both
  // scopes); the pane only reads its own scope's value for diff/open actions.
  const baseline = useCockpitStore((s) => s.baselineByScope[scope]);
  const expandTree = useCockpitStore((s) => s.expandTree);
  const showIndexFiles = useCockpitStore((s) => s.showIndexFiles);
  const setShowIndexFiles = useCockpitStore((s) => s.setShowIndexFiles);
  // AI-Lore index files (`<name>.index.md`) churn on every Memory reshape;
  // hide them by default and let the user reveal them via the toggle in the
  // Changes panel header.
  const changesForScope = useMemo(
    () =>
      showIndexFiles
        ? rawChangesForScope
        : rawChangesForScope.filter((e) => !e.path.endsWith('.index.md')),
    [rawChangesForScope, showIndexFiles],
  );
  const hasSavePoint = useCockpitStore((s) =>
    s.chain && !('error' in s.chain) ? s.chain.hasSavePoint : false,
  );
  const apps = useCockpitStore((s) => s.apps);
  const openDoc = useCockpitStore((s) => s.openDoc);
  // The lore repo's working tree, for deciding a file's diff scope by where it
  // actually lives (below) — not which pane opened it.
  const loreMemoryPath = useCockpitStore((s) =>
    s.chain && !('error' in s.chain) ? `${s.chain.lorePath}/memory` : null,
  );

  // Open a file in the in-app editor (Read-only IDE). From the navigator we
  // probe text-vs-binary first and hand binaries to the OS; the changes panel
  // opens straight in diff mode (DocView reads both sides + shows an overlay if
  // a side is unreadable). `absPath` is the doc id. The diff **scope** is the
  // file's *real* repo — a file under the lore memory tree is `lore` even when
  // it's opened from the Payload pane (whose tree contains the lore folder);
  // otherwise the lore commits resolve against the payload repo (which gitignores
  // the lore) and every diff comes back empty.
  const openInEditor = useCallback(
    async (absPath: string, mode: 'code' | 'diff', oldPath?: string): Promise<void> => {
      const name = absPath.slice(absPath.lastIndexOf('/') + 1);
      if (mode === 'code') {
        const probe = await window.cockpit.readFile({ path: absPath });
        if (probe.kind !== 'text') {
          void window.cockpit.openPath(absPath);
          return;
        }
      }
      const docScope: ChangeScope =
        loreMemoryPath && absPath.startsWith(`${loreMemoryPath}/`) ? 'lore' : 'payload';
      openDoc({ path: absPath, scope: docScope, name, mode, oldPath });
    },
    [openDoc, loreMemoryPath],
  );

  // Context-menu actions shared across the navigator tree and the queue.
  const handleRevealInFinder = useCallback((node: TreeNode) => {
    window.cockpit.revealInFinder(node.path);
  }, []);
  const handleOpenWith = useCallback(async (app: AppEntry, node: TreeNode) => {
    const result = await window.cockpit.appsInvoke({ appId: app.id, path: node.path });
    if (result.kind === 'failed') {
      window.alert(`Could not open with ${app.label}: ${result.message}`);
    }
  }, []);

  const renderedRoot = useMemo(() => resolveSubRoot(index, subRoot), [index, subRoot]);
  const bases = useMemo(() => baseDirsOf(subRoot), [subRoot]);

  // `rootId` is the rendered root node's path — a real path, or the synthetic
  // node's id. `headerPath` is what the header shows: the path, or the grouped
  // folders' names for a synthetic root.
  const rootId = subRoot.kind === 'path' ? subRoot.path : subRoot.id;
  // The change tree roots here too, mirroring the navigator's root row. A path
  // sub-root shows its folder name (from the rendered node); a synthetic group
  // shows the group's name.
  const rootName =
    subRoot.kind === 'path'
      ? (renderedRoot?.name ?? subRoot.path.slice(subRoot.path.lastIndexOf('/') + 1))
      : subRoot.name;
  const headerPath =
    subRoot.kind === 'path'
      ? subRoot.path
      : subRoot.childPaths.map((p) => p.slice(p.lastIndexOf('/') + 1)).join('  +  ');

  // Scope entries narrowed to the ones that fall within this pane's sub-root.
  const paneEntries = useMemo(
    () => entriesInSubRoot(changesForScope, subRoot, projectRoot),
    [changesForScope, subRoot, projectRoot],
  );

  // The highlighted row in the unified tree — a folder or a file. Folder
  // selection also lazy-loads children; file selection just highlights (a
  // double-click opens it in the editor).
  const [selectedPath, setSelectedPath] = useState<string>(rootId);
  // Seed the root expanded so its children show under the new root row.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([rootId]));
  const [queueHeight, setQueueHeight] = useState(initialQueueHeight ?? 220);
  // The tree's right-click ignore menu: the node and where to draw it.
  const [treeMenu, setTreeMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  // Keyboard-focus tracking inside the Pane. `activeRegion` drives the visible
  // accent border and tells the Tab handler where to cycle to next. `null`
  // when no region inside this Pane owns the keyboard.
  const [activeRegion, setActiveRegion] = useState<ActiveRegion | null>(null);
  const treeColumnRef = useRef<HTMLDivElement>(null);
  const queueRowRef = useRef<HTMLDivElement>(null);
  const treeHandle = useRef<FileTreeHandle>(null);
  const queueHandle = useRef<ChangesPanelHandle>(null);
  const paneRef = useRef<HTMLElement>(null);

  // Resolve which of the two regions the given node lives in, if any.
  const regionOf = useCallback((node: Node | null): ActiveRegion | null => {
    if (!node) return null;
    if (treeColumnRef.current?.contains(node)) return 'tree';
    if (queueRowRef.current?.contains(node)) return 'queue';
    return null;
  }, []);

  // Focus events bubble through the Pane container; we use them to drive
  // both the visible region accent and the Tab cycle.
  const onPaneFocus = useCallback(
    (e: React.FocusEvent<HTMLElement>) => {
      const region = regionOf(e.target);
      if (region) setActiveRegion(region);
    },
    [regionOf],
  );
  const onPaneBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!paneRef.current?.contains(next)) setActiveRegion(null);
  }, []);

  // Route a region handle's `focusMe` call by name.
  const focusRegion = useCallback((region: ActiveRegion) => {
    if (region === 'tree') treeHandle.current?.focusMe();
    else queueHandle.current?.focusMe();
  }, []);

  // Tab / Shift+Tab inside the Pane cycles tree → queue → tree.
  const onPaneKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Tab') return;
      const here = regionOf(document.activeElement);
      if (!here) return;
      e.preventDefault();
      const order: ActiveRegion[] = ['tree', 'queue'];
      const idx = order.indexOf(here);
      const step = e.shiftKey ? -1 : 1;
      const next = order[(idx + step + order.length) % order.length];
      if (next) focusRegion(next);
    },
    [focusRegion, regionOf],
  );

  const entryAbsPaths = useMemo(() => paneEntries.map((e) => e.absPath), [paneEntries]);

  const driftByPath = useMemo(() => {
    const map = new Map<string, DriftRow>();
    for (const entry of paneEntries) map.set(entry.absPath, entry);
    return map;
  }, [paneEntries]);

  /** Drift level for a folder = unacked entries anywhere in its subtree. */
  const driftLevelFor = useCallback(
    (folderPath: string): DriftLevel => {
      const prefix = `${folderPath}/`;
      let count = 0;
      for (const p of entryAbsPaths) if (p.startsWith(prefix)) count += 1;
      return driftLevel(count);
    },
    [entryAbsPaths],
  );

  /** A file's own change kind for its tree-row drift dot, or `undefined` when
   *  the file is unchanged against the baseline. */
  const driftKindFor = useCallback(
    (filePath: string): DriftKind | undefined => {
      const row = driftByPath.get(filePath);
      return row ? categoriseDriftCode(row.code) : undefined;
    },
    [driftByPath],
  );

  // A `path` sub-root deeper than the scope tree's root arrives with its
  // children unloaded — the tree is sent one level deep. Load them once.
  useEffect(() => {
    if (subRoot.kind !== 'path') return;
    const node = index.get(subRoot.path);
    if (node?.isDir && node.children === undefined) {
      void window.cockpit.treeExpand({ scope, path: subRoot.path }).then((children) => {
        expandTree(scope, subRoot.path, children);
      });
    }
  }, [index, subRoot, scope, expandTree]);

  const handleSelectFolder = useCallback(
    (path: string) => {
      setSelectedPath(path);
      const node = findTreeNode(renderedRoot, path);
      if (node?.isDir && node.children === undefined) {
        void window.cockpit.treeExpand({ scope, path }).then((children) => {
          expandTree(scope, path, children);
        });
      }
    },
    [renderedRoot, scope, expandTree],
  );

  /** Select a file row (highlight only). Opening is a double-click / Enter. */
  const handleSelectFile = useCallback((path: string) => setSelectedPath(path), []);

  /** Activate a file — open it in the in-app editor (binaries hand off to OS). */
  const handleActivateFile = useCallback(
    (node: TreeNode) => {
      setSelectedPath(node.path);
      void openInEditor(node.path, 'code');
    },
    [openInEditor],
  );

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Right-click ▸ Ignore — add a `no-drift` project rule for the path. It can
   *  be re-levelled or removed in Settings ▸ Ignore rules. */
  const ignorePath = useCallback(async (node: TreeNode): Promise<void> => {
    const snap = await window.cockpit.settingsGet();
    const pattern = node.isDir ? `**/${node.name}/**` : `**/${node.name}`;
    const rules = snap.project?.ignores ?? [];
    if (rules.some((r) => r.pattern === pattern)) return;
    const next: IgnoreRule[] = [...rules, { pattern, level: 'no-drift' }];
    await window.cockpit.settingsSetIgnores({ tier: 'project', rules: next });
  }, []);

  /** Drag the divider above the queue to resize it — dragging up grows it.
   *  Only the floor is enforced (120 px) so the panel keeps a usable shape;
   *  the ceiling is whatever the pane's flex parent allows. */
  const onQueueResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = queueHeight;
      let lastH = startH;
      const onMove = (ev: MouseEvent): void => {
        lastH = Math.max(120, startH + (startY - ev.clientY));
        setQueueHeight(lastH);
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        // Persist on drag-end only — App writes the layout, so we avoid a
        // setState-per-pixel round-trip through the parent during the drag.
        onQueueHeightChange?.(lastH);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [queueHeight, onQueueHeightChange],
  );

  /**
   * Reveal a file: load every ancestor folder, expand the chain in the tree,
   * select the containing folder, and select the file so the grid scrolls to
   * it. The walk starts at the base directory that contains the file — base is
   * loaded first because a synthetic sub-root's bases (Status, Memory) have no
   * auto-load, so `patchTree` would silently fail to attach a deeper folder's
   * children if base were skipped.
   */
  const revealFile = useCallback(
    async (fileAbs: string) => {
      const base = bases.find((b) => fileAbs === b || fileAbs.startsWith(`${b}/`));
      if (!base) return;
      const folderAbs = fileAbs.slice(0, fileAbs.lastIndexOf('/'));
      const toLoad: string[] = [base];
      if (folderAbs !== base && folderAbs.startsWith(`${base}/`)) {
        let cur = base;
        for (const seg of folderAbs.slice(base.length + 1).split('/')) {
          cur = `${cur}/${seg}`;
          toLoad.push(cur);
        }
      }
      // Load top-down: each folder's parent must already hold it before it can be patched in.
      for (const path of toLoad) {
        const children = await window.cockpit.treeExpand({ scope, path });
        expandTree(scope, path, children);
      }
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        for (const p of toLoad) next.add(p);
        return next;
      });
      // Highlight the revealed file in the unified tree; the tree scrolls it
      // into view (its scroll-to-selected effect).
      setSelectedPath(fileAbs);
    },
    [scope, bases, expandTree],
  );

  // Single-click a changed file in the Changes tree → reveal it in the
  // navigator above (the two trees share an engine; this is the cross-tree
  // link the shared-engine step buys).
  const handleRevealChange = useCallback(
    (absPath: string) => {
      void revealFile(absPath);
    },
    [revealFile],
  );

  // A global-search pick (App sets `revealRequest`) reveals the file in the
  // pane that owns it — the token changes per pick so a repeat still fires.
  useEffect(() => {
    if (revealRequest) void revealFile(revealRequest.path);
  }, [revealRequest, revealFile]);

  // Double-click a changed file → open it in the in-app editor's **diff** mode
  // (Read-only IDE P3) — content vs the selected save-point/ack, side by side.
  // Renamed/copied rows carry their source path (looked up by abs path) so the
  // baseline reads from the old path. A new file (`add`) has an empty baseline
  // → the diff shows it whole as added. The Code | Diff toggle flips to content.
  const handleOpenChangeDiff = useCallback(
    (absPath: string) => {
      void openInEditor(absPath, 'diff', driftByPath.get(absPath)?.oldPath);
    },
    [openInEditor, driftByPath],
  );

  // Diff target awaiting a freshly-picked app. When the user clicks *Diff*
  // and no diff entry exists in the Apps catalog, we open the App picker;
  // after they save, we retry the diff against the node they originally
  // clicked — that's why we stash it.
  const [pickerForDiff, setPickerForDiff] = useState<TreeNode | null>(null);

  // File context menu "Diff against latest save-point" — invokes the same
  // IPC. The main handler accepts absolute paths and resolves them against
  // the project root before materialising the baseline.
  const handleDiff = useCallback(
    async (node: TreeNode) => {
      if (node.isDir) return;
      const result = await window.cockpit.openDiff({ scope, relPath: node.path, baseline });
      if (result.kind === 'no-cli') {
        // First-use prompt: surface the App picker preselected to *diff* so
        // the user can pick a CLI without visiting Settings.
        setPickerForDiff(node);
      } else if (result.kind === 'failed') {
        window.alert(`Diff failed to open: ${result.message}`);
      }
    },
    [scope, baseline],
  );

  const onPickerSave = useCallback(
    async (entry: AppEntry) => {
      const target = pickerForDiff;
      // Add the new entry to the catalog and persist.
      await window.cockpit.appsSave([...apps, entry]);
      setPickerForDiff(null);
      // Retry the diff with the node the user originally clicked.
      if (target) void handleDiff(target);
    },
    [apps, handleDiff, pickerForDiff],
  );

  return (
    <section
      ref={paneRef}
      style={paneStyle}
      data-testid={`pane-${testId}`}
      data-pane={testId}
      onFocus={onPaneFocus}
      onBlur={onPaneBlur}
      onKeyDown={onPaneKeyDown}
    >
      <header style={paneHeaderStyle}>
        <span style={paneLabelStyle}>{label}</span>
        <span style={pathStyle} title={headerPath}>
          {headerPath}
        </span>
        <DriftPill level={driftLevel(paneEntries.length)} count={paneEntries.length} />
        <button
          type="button"
          role="switch"
          aria-checked={showIndexFiles}
          aria-label={
            showIndexFiles ? 'Hide *.index.md from Changes' : 'Show *.index.md in Changes'
          }
          data-testid="header-show-index"
          onClick={() => setShowIndexFiles(!showIndexFiles)}
          style={showIndexFiles ? indexPillOnStyle : indexPillStyle}
          title={
            showIndexFiles
              ? 'Hide *.index.md files (default — they churn on every Memory reshape)'
              : 'Show *.index.md files in the panel and counts'
          }
        >
          .idx
        </button>
      </header>

      <div style={paneBodyStyle}>
        <div
          ref={treeColumnRef}
          style={{
            ...treeColumnStyle,
            ...(activeRegion === 'tree' ? activeRegionStyle : null),
          }}
        >
          {renderedRoot ? (
            <FileTree
              ref={treeHandle}
              root={renderedRoot}
              selectedPath={selectedPath}
              onSelectFolder={handleSelectFolder}
              onSelectFile={handleSelectFile}
              onActivateFile={handleActivateFile}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              driftLevelFor={driftLevelFor}
              driftKindFor={driftKindFor}
              onContextMenu={(node, x, y) => setTreeMenu({ node, x, y })}
            />
          ) : (
            <div style={treeLoadingStyle}>Reading tree…</div>
          )}
        </div>
      </div>

      <div
        style={queueResizeHandleStyle}
        onMouseDown={onQueueResize}
        title="Drag to resize the queue"
        data-testid={`queue-resize-${testId}`}
      />
      <div
        ref={queueRowRef}
        style={{
          ...queueRowStyle,
          height: queueHeight,
          ...(activeRegion === 'queue' ? activeRegionStyle : null),
        }}
      >
        <ChangesPanel
          ref={queueHandle}
          label={label}
          rootId={rootId}
          rootName={rootName}
          bases={bases}
          entries={paneEntries}
          driftLevelFor={driftLevelFor}
          driftKindFor={driftKindFor}
          onSelectFile={handleRevealChange}
          onActivateFile={handleOpenChangeDiff}
          onContextMenu={(node, x, y) => setTreeMenu({ node, x, y })}
        />
      </div>

      {pickerForDiff ? (
        <AppPickerModal
          initial="diff"
          onSave={(e) => void onPickerSave(e)}
          onClose={() => setPickerForDiff(null)}
        />
      ) : null}

      {treeMenu ? (
        <ContextMenuShell
          x={treeMenu.x}
          y={treeMenu.y}
          onClose={() => setTreeMenu(null)}
          label={`Actions for ${treeMenu.node.name}`}
          contentStyle={treeMenuStyle}
        >
          <button
            type="button"
            style={treeMenuItemStyle}
            onClick={() => {
              handleRevealInFinder(treeMenu.node);
              setTreeMenu(null);
            }}
          >
            Open in Finder
          </button>
          {(treeMenu.node.isDir
            ? apps.filter((a) => a.target === 'folder' || a.target === 'both')
            : apps.filter((a) => a.target === 'file' || a.target === 'both')
          )
            .filter((a) => a.role !== 'diff')
            .map((app) => (
              <button
                key={app.id}
                type="button"
                style={treeMenuItemStyle}
                onClick={() => {
                  void handleOpenWith(app, treeMenu.node);
                  setTreeMenu(null);
                }}
              >
                Open with {app.label}
              </button>
            ))}
          {!treeMenu.node.isDir ? (
            <button
              type="button"
              style={treeMenuItemStyle}
              disabled={!hasSavePoint}
              onClick={() => {
                if (hasSavePoint) {
                  void handleDiff(treeMenu.node);
                  setTreeMenu(null);
                }
              }}
              title={
                hasSavePoint ? undefined : 'No save-point recorded — diff baseline unavailable'
              }
            >
              {hasSavePoint ? 'Diff against latest save-point' : 'Diff (no save-point recorded)'}
            </button>
          ) : null}
          <div style={treeMenuSeparatorStyle} />
          <button
            type="button"
            style={treeMenuItemStyle}
            onClick={() => {
              void ignorePath(treeMenu.node);
              setTreeMenu(null);
            }}
          >
            {treeMenu.node.isDir ? 'Ignore this folder' : 'Ignore this file'}
          </button>
        </ContextMenuShell>
      ) : null}
    </section>
  );
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  borderRight: '1px solid var(--color-border)',
};

/** A 1-px accent outline on the Pane's currently-focused region (tree / grid /
 *  queue). Outline rather than border so layout doesn't shift on focus change. */
const activeRegionStyle: React.CSSProperties = {
  outline: '1px solid var(--color-accent)',
  outlineOffset: '-1px',
};

const paneHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.5rem 0.8rem',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
};

// Same height/shape as the DriftPill it sits next to so they read as one
// control group. Off mirrors the DriftPill's `idle` palette; on uses `live`
// so the active hint is unmistakable.
const indexPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: '1.6rem',
  padding: '0 0.65rem',
  borderRadius: '999px',
  fontSize: '0.72rem',
  fontFamily: 'monospace',
  fontWeight: 700,
  letterSpacing: '0.04em',
  background: 'var(--color-neutral-pill)',
  color: 'var(--color-text-secondary)',
  border: '1px solid transparent',
  cursor: 'pointer',
};

const indexPillOnStyle: React.CSSProperties = {
  ...indexPillStyle,
  background: 'var(--color-success-bg)',
  color: 'var(--color-success-fg)',
};

const paneLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '0.85rem',
  color: 'var(--color-text-bright)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const pathStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const paneBodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const treeColumnStyle: React.CSSProperties = {
  // The unified navigator tree fills the pane body (the file grid was retired in
  // Read-only IDE P2). The FileTree owns its own virtualized scroll viewport;
  // the column lays it out as a full-height flex child.
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  background: 'var(--color-panel)',
};

const treeLoadingStyle: React.CSSProperties = {
  padding: '0.6rem 0.8rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.76rem',
};

const queueRowStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
};

/** The drag bar between the grid and the queue — resizes the queue vertically. */
const queueResizeHandleStyle: React.CSSProperties = {
  height: '7px',
  flexShrink: 0,
  cursor: 'ns-resize',
  background: 'var(--color-panel)',
  borderTop: '1px solid var(--color-border)',
};

/** The right-click menu's panel skin — positioning, dismissal, and portal are
 *  the ContextMenuShell's. */
const treeMenuStyle: React.CSSProperties = {
  background: 'var(--color-raised)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  padding: '0.2rem',
};

const treeMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.78rem',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const treeMenuSeparatorStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--color-border-strong)',
  margin: '0.25rem 0.3rem',
};
