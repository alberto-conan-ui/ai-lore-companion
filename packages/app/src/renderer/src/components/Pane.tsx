import type {
  AppEntry,
  ChangeEntry,
  ChangeScope,
  IgnoreRule,
  TreeNode,
} from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DriftLevel,
  driftLevel,
  findTreeNode,
  useCockpitStore,
} from '../store.js';
import { AppPickerModal } from './AppPickerModal.js';
import { DriftPill } from './DriftPill.js';
import { FileGrid, type FileGridHandle } from './FileGrid.js';
import { FileTree, type FileTreeHandle } from './FileTree.js';
import { ChangesPanel, type ChangesPanelHandle, type DriftRow } from './ChangesPanel.js';

/** Which of the three regions inside a Pane currently owns the keyboard.
 *  Drives Tab cycling between them and the visible focus accent. */
type ActiveRegion = 'tree' | 'grid' | 'queue';

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
  /** Maps an absolute path to its tab-relative display path (for the queue grid). */
  displayPath: (absPath: string) => string;
  /** Set by a global-search pick: reveal this file. A new token re-triggers. */
  revealRequest?: { path: string; token: number };
};

/**
 * One pane of the cockpit: a folder tree, a file grid for the selected folder,
 * and the queue of unread drift for this side. The pane is rooted at a
 * `SubRoot` — a slice of its `scope`'s tree — and its drift is filtered to
 * that slice. Drift is per-`scope` throughout; the sub-root narrows it further.
 */
export function Pane({
  scope,
  label,
  testId,
  subRoot,
  projectRoot,
  displayPath,
  revealRequest,
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
      showIndexFiles ? rawChangesForScope : rawChangesForScope.filter((e) => !e.path.endsWith('.index.md')),
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

  // Context-menu actions shared across tree, grid, and (eventually) queue.
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
  const headerPath =
    subRoot.kind === 'path'
      ? subRoot.path
      : subRoot.childPaths.map((p) => p.slice(p.lastIndexOf('/') + 1)).join('  +  ');

  // Queue entry paths are relative to the project root; tree/grid paths are absolute.
  const toAbs = useCallback((relPath: string) => `${projectRoot}/${relPath}`, [projectRoot]);

  // The queue grid shows tab-relative paths — absolutise, then map to display.
  const queueDisplayPath = useCallback(
    (relPath: string) => displayPath(toAbs(relPath)),
    [displayPath, toAbs],
  );

  // Scope entries narrowed to the ones that fall within this pane's sub-root.
  const paneEntries = useMemo(
    () => entriesInSubRoot(changesForScope, subRoot, projectRoot),
    [changesForScope, subRoot, projectRoot],
  );

  const [selectedFolder, setSelectedFolder] = useState<string>(rootId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Seed the root expanded so its child folders show under the new root row.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([rootId]));
  const [queueHeight, setQueueHeight] = useState(220);
  const [treeWidth, setTreeWidth] = useState(240);
  // Per-pane Changes-panel view mode — List (default, grouped by location) or
  // Tree (file-explorer hierarchy). User asked for this on the Payload pane
  // specifically; making it per-pane keeps each panel's preference independent.
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  // The tree's right-click ignore menu: the node and where to draw it.
  const [treeMenu, setTreeMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  // Keyboard-focus tracking inside the Pane. `activeRegion` drives the visible
  // accent border and tells the Tab handler where to cycle to next. `null`
  // when no region inside this Pane owns the keyboard.
  const [activeRegion, setActiveRegion] = useState<ActiveRegion | null>(null);
  const treeColumnRef = useRef<HTMLDivElement>(null);
  const gridColumnRef = useRef<HTMLDivElement>(null);
  const queueRowRef = useRef<HTMLDivElement>(null);
  const treeHandle = useRef<FileTreeHandle>(null);
  const gridHandle = useRef<FileGridHandle>(null);
  const queueHandle = useRef<ChangesPanelHandle>(null);
  const paneRef = useRef<HTMLElement>(null);

  // Resolve which of the three regions the given node lives in, if any.
  const regionOf = useCallback((node: Node | null): ActiveRegion | null => {
    if (!node) return null;
    if (treeColumnRef.current?.contains(node)) return 'tree';
    if (gridColumnRef.current?.contains(node)) return 'grid';
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
    else if (region === 'grid') gridHandle.current?.focusMe();
    else queueHandle.current?.focusMe();
  }, []);

  // Tab / Shift+Tab inside the Pane cycles tree → grid → queue → tree.
  const onPaneKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Tab') return;
      const here = regionOf(document.activeElement);
      if (!here) return;
      e.preventDefault();
      const order: ActiveRegion[] = ['tree', 'grid', 'queue'];
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

  const gridRows = useMemo(
    () => findTreeNode(renderedRoot, selectedFolder)?.children ?? [],
    [renderedRoot, selectedFolder],
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
      setSelectedFolder(path);
      const node = findTreeNode(renderedRoot, path);
      if (node?.isDir && node.children === undefined) {
        void window.cockpit.treeExpand({ scope, path }).then((children) => {
          expandTree(scope, path, children);
        });
      }
    },
    [renderedRoot, scope, expandTree],
  );

  /** Navigate the pane into a folder — select it, and reveal it in the tree. */
  const handleOpenFolder = useCallback(
    (folderAbs: string) => {
      handleSelectFolder(folderAbs);
      const parent = folderAbs.slice(0, folderAbs.lastIndexOf('/'));
      setExpandedPaths((prev) => new Set(prev).add(parent).add(folderAbs));
    },
    [handleSelectFolder],
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
      const onMove = (ev: MouseEvent): void => {
        setQueueHeight(Math.max(120, startH + (startY - ev.clientY)));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [queueHeight],
  );

  /** Drag the divider between the tree and the grid to resize the tree column. */
  const onTreeResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = treeWidth;
      const onMove = (ev: MouseEvent): void => {
        setTreeWidth(Math.max(140, Math.min(520, startW + (ev.clientX - startX))));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [treeWidth],
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
      setSelectedFolder(folderAbs);
      setSelectedFile(fileAbs);
    },
    [scope, bases, expandTree],
  );

  const handleQueueClick = useCallback(
    (entry: DriftRow) => {
      void revealFile(entry.absPath);
    },
    [revealFile],
  );

  // A global-search pick (App sets `revealRequest`) reveals the file in the
  // pane that owns it — the token changes per pick so a repeat still fires.
  useEffect(() => {
    if (revealRequest) void revealFile(revealRequest.path);
  }, [revealRequest, revealFile]);

  // Queue double-click opens the row in the in-app editor's **diff** mode
  // (Read-only IDE P3) — content vs the selected save-point/ack, side by side.
  // Renamed/copied rows carry their source path so the baseline reads from the
  // old path. A new file (`add`) has an empty baseline → the diff shows it whole
  // as added. The Code | Diff toggle in the editor flips to plain content.
  const handleQueueDouble = useCallback(
    (entry: DriftRow) => {
      void openInEditor(entry.absPath, 'diff', entry.oldPath);
    },
    [openInEditor],
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
            width: treeWidth,
            ...(activeRegion === 'tree' ? activeRegionStyle : null),
          }}
        >
          {renderedRoot ? (
            <FileTree
              ref={treeHandle}
              root={renderedRoot}
              selectedPath={selectedFolder}
              onSelectFolder={handleSelectFolder}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              driftLevelFor={driftLevelFor}
              onContextMenu={(node, x, y) => setTreeMenu({ node, x, y })}
            />
          ) : (
            <div style={treeLoadingStyle}>Reading tree…</div>
          )}
        </div>
        <div
          style={treeResizeHandleStyle}
          onMouseDown={onTreeResize}
          title="Drag to resize the tree"
          data-testid={`tree-resize-${testId}`}
        />
        <div
          ref={gridColumnRef}
          style={{
            ...gridColumnStyle,
            ...(activeRegion === 'grid' ? activeRegionStyle : null),
          }}
        >
          <FileGrid
            ref={gridHandle}
            scope={scope}
            rows={gridRows}
            selectedPath={selectedFile}
            onSelectPath={setSelectedFile}
            onOpenFolder={handleOpenFolder}
            onOpenFile={(node) => void openInEditor(node.path, 'code')}
            driftByPath={driftByPath}
            onIgnore={(node) => void ignorePath(node)}
            onDiff={(node) => void handleDiff(node)}
            hasSavePoint={hasSavePoint}
            apps={apps}
            onOpenWith={(app, node) => void handleOpenWith(app, node)}
            onRevealInFinder={handleRevealInFinder}
          />
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
          entries={paneEntries}
          displayPath={queueDisplayPath}
          onRowClick={handleQueueClick}
          onRowDoubleClick={handleQueueDouble}
          apps={apps}
          hasSavePoint={hasSavePoint}
          onOpenWith={(app, node) => void handleOpenWith(app, node)}
          onRevealInFinder={handleRevealInFinder}
          onDiff={(node) => void handleDiff(node)}
          onIgnore={(node) => void ignorePath(node)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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
        <>
          <div style={menuBackdropStyle} onMouseDown={() => setTreeMenu(null)} />
          <div style={{ ...treeMenuStyle, left: treeMenu.x, top: treeMenu.y }}>
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
          </div>
        </>
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
  borderRight: '1px solid #1f2933',
};

/** A 1-px accent outline on the Pane's currently-focused region (tree / grid /
 *  queue). Outline rather than border so layout doesn't shift on focus change. */
const activeRegionStyle: React.CSSProperties = {
  outline: '1px solid #5a9bd4',
  outlineOffset: '-1px',
};

const paneHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.5rem 0.8rem',
  background: '#0f1620',
  borderBottom: '1px solid #1f2933',
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
  background: '#2d3a44',
  color: '#9fb1bd',
  border: '1px solid transparent',
  cursor: 'pointer',
};

const indexPillOnStyle: React.CSSProperties = {
  ...indexPillStyle,
  background: '#2c5b3f',
  color: '#bcefcd',
};

const paneLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '0.85rem',
  color: '#e6edf3',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const pathStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '0.72rem',
  color: '#6c7783',
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
  flexShrink: 0,
  // The FileTree owns its own scroll viewport (virtualized) — the column just
  // bounds it horizontally and lays it out as a full-height flex child.
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: '#0c121a',
};

/** The drag bar between the tree and the grid — resizes the tree horizontally. */
const treeResizeHandleStyle: React.CSSProperties = {
  width: '7px',
  flexShrink: 0,
  cursor: 'ew-resize',
  background: '#0c121a',
  borderLeft: '1px solid #1f2933',
};

const treeLoadingStyle: React.CSSProperties = {
  padding: '0.6rem 0.8rem',
  color: '#6c7783',
  fontSize: '0.76rem',
};

const gridColumnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  minWidth: 0,
  minHeight: 0,
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
  background: '#0c121a',
  borderTop: '1px solid #1f2933',
};

/** Full-window catcher that dismisses the tree's right-click ignore menu. */
const menuBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
};

const treeMenuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 51,
  background: '#121a24',
  border: '1px solid #2f3a45',
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
  color: '#dde3ea',
  fontSize: '0.78rem',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const treeMenuSeparatorStyle: React.CSSProperties = {
  height: '1px',
  background: '#2f3a45',
  margin: '0.25rem 0.3rem',
};
