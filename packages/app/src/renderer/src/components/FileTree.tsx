import type { TreeNode } from '@ai-lore-companion/core';
import {
  type JSX,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DriftLevel } from '../store.js';
import { RowKebab } from './RowKebab.js';

/** Imperative handle the Pane uses to move keyboard focus into the tree. */
export type FileTreeHandle = {
  /** Focus the currently-highlighted row (the one carrying `tabIndex=0`). */
  focusMe: () => void;
};

type Props = {
  root: TreeNode;
  selectedPath: string | null;
  onSelectFolder: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
  /** Right-click on a real folder — opens the pane's ignore menu at the cursor. */
  onContextMenu?: (node: TreeNode, x: number, y: number) => void;
};

/** Folder drift dot — the four-level scale, tuned to read on the tree's dark background. */
const DOT_COLOR: Record<DriftLevel, string> = {
  idle: '#3a4654',
  live: '#5fb87f',
  warn: '#e0a23a',
  alert: '#e0564e',
};

/** Fixed row height (px) — the unit virtualization windows on. Every tree row is
 *  this tall, so a node's vertical offset is simply `index * ROW_HEIGHT`. */
const ROW_HEIGHT = 22;
/** Extra rows rendered above and below the viewport so a fast scroll or an
 *  arrow-key step never reveals a blank gap before the window catches up. */
const OVERSCAN = 6;

/** The tree is a pure folder navigator — files live in the grid, never the tree. */
function folderChildren(node: TreeNode): TreeNode[] {
  return (node.children ?? []).filter((c) => c.isDir);
}

/** One flattened, visible tree row: the node, its indent depth, and the path of
 *  its parent folder (for `←`-to-parent without re-walking the tree). */
type Row = { node: TreeNode; depth: number; parentPath: string | null };

/** Walk the tree depth-first, respecting `expanded`, and return the visible rows
 *  in render order. Drives both the windowed render and keyboard up/down. Because
 *  a node is only visible when every ancestor is expanded, a visible node's
 *  parent is always visible too — so `parentPath` here is enough for `←`. */
function flattenVisible(root: TreeNode, expanded: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (node: TreeNode, depth: number, parentPath: string | null): void => {
    out.push({ node, depth, parentPath });
    if (expanded.has(node.path))
      for (const child of folderChildren(node)) walk(child, depth + 1, node.path);
  };
  walk(root, 0, null);
  return out;
}

/** Find the parent folder of `targetPath` within the rendered tree, or null
 *  if the target is the root (or not in the tree). Used only for the focus-snap
 *  recovery when the focused node has scrolled out of the *visible* set entirely
 *  (so its row — and `parentPath` — is gone). */
function parentOf(root: TreeNode, targetPath: string): TreeNode | null {
  if (root.path === targetPath) return null;
  for (const child of folderChildren(root)) {
    if (child.path === targetPath) return root;
    const deeper = parentOf(child, targetPath);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * Lazy directory tree, folders only: a selectable root node sits at the top with
 * its child folders nested under it. Selecting the root shows the pane's
 * root-level files in the grid. Expansion is controlled by the parent
 * (`expandedPaths`) so a queue click can reveal a folder by expanding its whole
 * ancestor chain.
 *
 * Virtualized — the tree owns its own scroll viewport and mounts only the rows
 * in (or near) view, so a 10k-node expanded tree renders a bounded handful of
 * DOM rows instead of one per node (Focus 5 — Reactive Store At Scale). Light,
 * dependency-free windowing over the flattened row list — deliberately *not* AG
 * Grid (that would pin the heavy grid eager in the always-visible panes; see the
 * focus decision note).
 *
 * Keyboard model — roving tabindex. One row at a time carries `tabIndex=0`
 * (the focused row); the rest carry `-1`. Arrow keys move the focused row in
 * the visible (flattened) list and scroll it into view so it stays mounted;
 * `→` expands or descends; `←` collapses or ascends; `Enter` selects (parity
 * with click); `Space` toggles expand without selecting.
 */
export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree(
  {
    root,
    selectedPath,
    onSelectFolder,
    expandedPaths,
    onToggleExpand,
    driftLevelFor,
    onContextMenu,
  }: Props,
  forwardedRef,
): JSX.Element {
  const visible = useMemo(() => flattenVisible(root, expandedPaths), [root, expandedPaths]);
  // O(1) path → row-index, so keyboard nav never scans the visible list.
  const indexByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < visible.length; i++) m.set((visible[i] as Row).node.path, i);
    return m;
  }, [visible]);
  const [focusedPath, setFocusedPath] = useState<string>(root.path);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Track the viewport's height — the window size depends on it. ResizeObserver
  // keeps it current as the pane is resized or the window reflows.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = visible.length * ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    visible.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const windowRows = visible.slice(start, end);

  // If the focused row is no longer visible (an ancestor collapsed it away,
  // or the tree changed under us), snap focus to the closest visible
  // ancestor — or to the root as a last resort.
  useEffect(() => {
    if (indexByPath.has(focusedPath)) return;
    let cur: TreeNode | null = parentOf(root, focusedPath);
    while (cur && !indexByPath.has(cur.path)) cur = parentOf(root, cur.path);
    setFocusedPath(cur ? cur.path : root.path);
  }, [indexByPath, focusedPath, root]);

  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const setRowRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  // A row's DOM focus may have to wait until windowing mounts it. We record the
  // path that wants focus, scroll it into view (which re-renders the window),
  // and a layout effect focuses it once its element exists.
  const pendingFocusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const p = pendingFocusRef.current;
    if (p == null) return;
    const el = rowRefs.current.get(p);
    if (el) {
      el.focus();
      pendingFocusRef.current = null;
    }
  });

  // Adjust the viewport scroll so the row at `path` sits within view. Setting
  // `scrollTop` imperatively fires the scroll handler, which re-renders the
  // window to include the row.
  const scrollPathIntoView = useCallback(
    (path: string) => {
      const idx = indexByPath.get(path);
      const el = viewportRef.current;
      if (idx == null || !el) return;
      const top = idx * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    },
    [indexByPath],
  );

  // Move focus to a path: update state, ensure the row is windowed in, and
  // queue the DOM focus. Skipping the DOM focus call would leave the
  // previously-focused element retaining browser focus, which then conflicts
  // with the next key event.
  const focusPath = useCallback(
    (path: string) => {
      setFocusedPath(path);
      pendingFocusRef.current = path;
      scrollPathIntoView(path);
    },
    [scrollPathIntoView],
  );

  // Imperative API the Pane uses when Tab routes into the tree.
  useImperativeHandle(
    forwardedRef,
    () => ({
      focusMe: () => {
        const el = rowRefs.current.get(focusedPath);
        if (el) {
          el.focus();
          pendingFocusRef.current = null;
        } else {
          // Scrolled out of the window — queue focus, then bring it into view
          // so the row mounts and the layout effect can focus it.
          pendingFocusRef.current = focusedPath;
          scrollPathIntoView(focusedPath);
        }
      },
    }),
    [focusedPath, scrollPathIntoView],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const idx = indexByPath.get(focusedPath);
      if (idx == null) return;
      const row = visible[idx];
      if (!row) return;
      const node = row.node;
      switch (e.key) {
        case 'ArrowDown': {
          if (idx + 1 < visible.length) {
            e.preventDefault();
            const next = visible[idx + 1];
            if (next) focusPath(next.node.path);
          }
          break;
        }
        case 'ArrowUp': {
          if (idx > 0) {
            e.preventDefault();
            const prev = visible[idx - 1];
            if (prev) focusPath(prev.node.path);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (!expandedPaths.has(node.path)) {
            // Collapsed: expand. Children will appear under it; focus stays.
            if (folderChildren(node).length > 0) onToggleExpand(node.path);
          } else {
            // Expanded: move to the first child folder, if any.
            const first = folderChildren(node)[0];
            if (first) focusPath(first.path);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (expandedPaths.has(node.path) && folderChildren(node).length > 0) {
            onToggleExpand(node.path);
          } else if (row.parentPath) {
            focusPath(row.parentPath);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          onSelectFolder(node.path);
          break;
        }
        case ' ': {
          e.preventDefault();
          onToggleExpand(node.path);
          break;
        }
      }
    },
    [visible, indexByPath, focusedPath, expandedPaths, focusPath, onSelectFolder, onToggleExpand],
  );

  return (
    <div
      ref={viewportRef}
      style={viewportStyle}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <ul
        style={{ ...listReset, position: 'relative', height: `${total}px` }}
        onKeyDown={handleKeyDown}
      >
        {windowRows.map((row, i) => {
          const index = start + i;
          return (
            <Row
              key={row.node.path}
              node={row.node}
              depth={row.depth}
              top={index * ROW_HEIGHT}
              isRoot={row.node.path === root.path}
              selectedPath={selectedPath}
              focusedPath={focusedPath}
              onSelectFolder={(p) => {
                setFocusedPath(p);
                onSelectFolder(p);
              }}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              driftLevelFor={driftLevelFor}
              onContextMenu={onContextMenu}
              setRowRef={setRowRef}
            />
          );
        })}
      </ul>
    </div>
  );
});

type RowProps = {
  node: TreeNode;
  depth: number;
  /** Absolute vertical offset (px) of this row within the windowed list. */
  top: number;
  /** True for the single top node — the pane's selectable root row. */
  isRoot?: boolean;
  selectedPath: string | null;
  focusedPath: string;
  onSelectFolder: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
  onContextMenu?: (node: TreeNode, x: number, y: number) => void;
  setRowRef: (path: string, el: HTMLButtonElement | null) => void;
};

function Row({
  node,
  depth,
  top,
  isRoot,
  selectedPath,
  focusedPath,
  onSelectFolder,
  expandedPaths,
  onToggleExpand,
  driftLevelFor,
  onContextMenu,
  setRowRef,
}: RowProps): JSX.Element {
  const open = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isFocused = focusedPath === node.path;
  // A synthetic root (e.g. the Status tab grouping several memory folders) has
  // no real path on disk — skip the path tooltip, Reveal-in-Finder, and ignore.
  const synthetic = node.path.startsWith('synthetic:');

  const rowStyle: React.CSSProperties = {
    ...nodeRow,
    paddingLeft: `${0.4 + depth * 0.9}rem`,
    background: isSelected ? '#1d2c3d' : 'transparent',
    color: '#e6edf3',
  };

  return (
    <li style={{ ...rowItem, top: `${top}px` }}>
      <button
        type="button"
        ref={(el) => setRowRef(node.path, el)}
        tabIndex={isFocused ? 0 : -1}
        className="row-kebab-host"
        style={rowStyle}
        onClick={() => {
          onSelectFolder(node.path);
          onToggleExpand(node.path);
        }}
        onContextMenu={(e) => {
          if (synthetic || !onContextMenu) return;
          e.preventDefault();
          onContextMenu(node, e.clientX, e.clientY);
        }}
        title={synthetic ? node.name : node.path}
        data-testid={isRoot ? 'tree-root' : undefined}
      >
        <span style={{ ...twistyStyle, color: '#9aa6b2' }}>{open ? '▾' : '▸'}</span>
        <span style={glyphStyle}>{open ? '📂' : '📁'}</span>
        <span style={{ ...nameStyle, fontWeight: open ? 600 : 400 }}>{node.name}</span>
        <span style={{ ...driftDotStyle, background: DOT_COLOR[driftLevelFor(node.path)] }} />
        {synthetic ? null : (
          <button
            type="button"
            tabIndex={-1}
            style={finderBtnStyle}
            title="Reveal in Finder"
            onClick={(e) => {
              e.stopPropagation();
              void window.cockpit.openPath(node.path);
            }}
          >
            ↗
          </button>
        )}
        {synthetic || !onContextMenu ? null : (
          <RowKebab
            testId={`row-kebab-tree-${node.path}`}
            onActivate={(e) => {
              const ev = e as React.MouseEvent<HTMLButtonElement>;
              onContextMenu(node, ev.clientX, ev.clientY);
            }}
          />
        )}
      </button>
    </li>
  );
}

const viewportStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100%',
  overflowY: 'auto',
};

const listReset: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

/** Each row is absolutely positioned at `index * ROW_HEIGHT` within the
 *  full-height spacer, so only the windowed slice is mounted. */
const rowItem: React.CSSProperties = {
  listStyle: 'none',
  position: 'absolute',
  left: 0,
  right: 0,
  height: `${ROW_HEIGHT}px`,
};

const nodeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  width: '100%',
  height: '100%',
  padding: '0 0.5rem 0 0',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  font: 'inherit',
  fontSize: '0.78rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const twistyStyle: React.CSSProperties = {
  width: '0.9rem',
  flexShrink: 0,
  textAlign: 'center',
  fontSize: '0.82rem',
};

const glyphStyle: React.CSSProperties = {
  width: '1rem',
  flexShrink: 0,
  textAlign: 'center',
  fontSize: '0.82rem',
  filter: 'grayscale(0.15)',
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const driftDotStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  flexShrink: 0,
};

const finderBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '1.1rem',
  height: '1.1rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#8a96a2',
  fontSize: '0.72rem',
  cursor: 'pointer',
  padding: 0,
};
