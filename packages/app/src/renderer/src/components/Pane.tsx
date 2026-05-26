import type { ChangeScope, IgnoreRule, QueueEntry, TreeNode } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DriftLevel, driftLevel, findTreeNode, useCockpitStore } from '../store.js';
import { DriftPill } from './DriftPill.js';
import { FileGrid, type FileGridHandle } from './FileGrid.js';
import { FileTree, type FileTreeHandle } from './FileTree.js';
import { PaneQueue, type PaneQueueHandle } from './PaneQueue.js';

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

/** Resolve the `TreeNode` a pane renders, given its scope's tree and sub-root. */
function resolveSubRoot(tree: TreeNode | null, subRoot: SubRoot): TreeNode | null {
  if (subRoot.kind === 'path') return findTreeNode(tree, subRoot.path);
  const children = subRoot.childPaths
    .map((p) => findTreeNode(tree, p))
    .filter((n): n is TreeNode => n !== null);
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

/** Queue entries on `scope` whose file falls within the sub-root's directories. */
export function entriesInSubRoot(
  entries: QueueEntry[],
  scope: ChangeScope,
  subRoot: SubRoot,
  projectRoot: string,
): QueueEntry[] {
  const bases = baseDirsOf(subRoot);
  return entries.filter(
    (e) => e.scope === scope && isUnderBases(`${projectRoot}/${e.path}`, bases),
  );
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
  const tree = useCockpitStore((s) => s.trees[scope]);
  const entries = useCockpitStore((s) => s.entries);
  const expandTree = useCockpitStore((s) => s.expandTree);

  const renderedRoot = useMemo(() => resolveSubRoot(tree, subRoot), [tree, subRoot]);
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
    () => entriesInSubRoot(entries, scope, subRoot, projectRoot),
    [entries, scope, subRoot, projectRoot],
  );

  const [selectedFolder, setSelectedFolder] = useState<string>(rootId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Seed the root expanded so its child folders show under the new root row.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([rootId]));
  const [queueHeight, setQueueHeight] = useState(220);
  const [treeWidth, setTreeWidth] = useState(240);
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
  const queueHandle = useRef<PaneQueueHandle>(null);
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

  const entryAbsPaths = useMemo(() => paneEntries.map((e) => toAbs(e.path)), [paneEntries, toAbs]);

  const driftByPath = useMemo(() => {
    const map = new Map<string, QueueEntry>();
    for (const entry of paneEntries) map.set(toAbs(entry.path), entry);
    return map;
  }, [paneEntries, toAbs]);

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
    const node = findTreeNode(tree, subRoot.path);
    if (node?.isDir && node.children === undefined) {
      void window.cockpit.treeExpand({ scope, path: subRoot.path }).then((children) => {
        expandTree(scope, subRoot.path, children);
      });
    }
  }, [tree, subRoot, scope, expandTree]);

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

  /** Drag the divider above the queue to resize it — dragging up grows it. */
  const onQueueResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = queueHeight;
      const onMove = (ev: MouseEvent): void => {
        setQueueHeight(Math.max(120, Math.min(680, startH + (startY - ev.clientY))));
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
    (entry: QueueEntry) => {
      void revealFile(toAbs(entry.path));
    },
    [revealFile, toAbs],
  );

  // A global-search pick (App sets `revealRequest`) reveals the file in the
  // pane that owns it — the token changes per pick so a repeat still fires.
  useEffect(() => {
    if (revealRequest) void revealFile(revealRequest.path);
  }, [revealRequest, revealFile]);

  const handleQueueDouble = useCallback(
    (entry: QueueEntry) => {
      void window.cockpit.openPath(toAbs(entry.path));
    },
    [toAbs],
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
            driftByPath={driftByPath}
            onIgnore={(node) => void ignorePath(node)}
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
        <PaneQueue
          ref={queueHandle}
          label={label}
          entries={paneEntries}
          displayPath={queueDisplayPath}
          onRowClick={handleQueueClick}
          onRowDoubleClick={handleQueueDouble}
          onAck={(id) => {
            void window.cockpit.ack(id);
          }}
          onAckAll={() => {
            void window.cockpit.ackAllScope(scope);
          }}
        />
      </div>

      {treeMenu ? (
        <>
          <div style={menuBackdropStyle} onMouseDown={() => setTreeMenu(null)} />
          <div style={{ ...treeMenuStyle, left: treeMenu.x, top: treeMenu.y }}>
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
  overflowY: 'auto',
  background: '#0c121a',
  padding: '0.3rem 0',
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
