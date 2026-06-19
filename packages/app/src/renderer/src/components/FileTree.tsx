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
import type { DriftKind, DriftLevel } from '../store.js';
import { FONT_SIZE } from '../theme.js';
import { FileIcon } from './FileIcon.js';
import { RowKebab } from './RowKebab.js';

/** Imperative handle the Pane uses to move keyboard focus into the tree. */
export type FileTreeHandle = {
  /** Focus the currently-highlighted row (the one carrying `tabIndex=0`). */
  focusMe: () => void;
};

type Props = {
  root: TreeNode;
  selectedPath: string | null;
  /** Select (highlight) a **folder** row — and, for an unloaded folder, the
   *  signal to lazy-load its children. */
  onSelectFolder: (path: string) => void;
  /** Select (highlight) a **file** row without opening it. */
  onSelectFile?: (path: string) => void;
  /** Activate a **file** — double-click or Enter — opens it in the editor. */
  onActivateFile?: (node: TreeNode) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
  /** A file's own change kind (add/change/unlink) when it differs from the
   *  baseline, else `undefined` — drives the per-file drift glyph. */
  driftKindFor?: (filePath: string) => DriftKind | undefined;
  /** Right-click on a real folder or file — opens the pane's menu at the cursor. */
  onContextMenu?: (node: TreeNode, x: number, y: number) => void;
};

/** Folder drift dot — the four-level scale, tuned to read on the tree's dark background. */
const DOT_COLOR: Record<DriftLevel, string> = {
  idle: 'var(--color-dot-idle)',
  live: 'var(--color-success)',
  warn: 'var(--color-warn)',
  alert: 'var(--color-danger)',
};

/** Per-file drift dot — by change kind, matching the grid/changes-panel palette. */
const FILE_DOT_COLOR: Record<DriftKind, string> = {
  add: 'var(--color-success)',
  change: 'var(--color-warn)',
  unlink: 'var(--color-danger)',
};

/** Fixed row height (px) — the unit virtualization windows on. Every tree row is
 *  this tall, so a node's vertical offset is simply `index * ROW_HEIGHT`. */
const ROW_HEIGHT = 22;
/** Extra rows rendered above and below the viewport so a fast scroll or an
 *  arrow-key step never reveals a blank gap before the window catches up. */
const OVERSCAN = 6;

/** The unified navigator tree shows **files and folders** in one tree (Read-only
 *  IDE P2) — the old folder-only tree + separate file grid is retired. Children
 *  arrive dirs-first then alpha from `readDirectory`, so no re-sort is needed. */
function childrenOf(node: TreeNode): TreeNode[] {
  return node.children ?? [];
}

/** One flattened, visible tree row: the node, its indent depth, and the path of
 *  its parent folder (for `←`-to-parent without re-walking the tree). */
type Row = { node: TreeNode; depth: number; parentPath: string | null };

/** Walk the tree depth-first, respecting `expanded`, and return the visible rows
 *  in render order. Drives both the windowed render and keyboard up/down. Only
 *  folders recurse — a file is always a leaf. Because a node is only visible when
 *  every ancestor is expanded, a visible node's parent is always visible too —
 *  so `parentPath` here is enough for `←`. */
function flattenVisible(root: TreeNode, expanded: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (node: TreeNode, depth: number, parentPath: string | null): void => {
    out.push({ node, depth, parentPath });
    if (node.isDir && expanded.has(node.path))
      for (const child of childrenOf(node)) walk(child, depth + 1, node.path);
  };
  walk(root, 0, null);
  return out;
}

/** Find the parent of `targetPath` within the rendered tree, or null if the
 *  target is the root (or not in the tree). Used only for the focus-snap recovery
 *  when the focused node has scrolled out of the *visible* set entirely (so its
 *  row — and `parentPath` — is gone). */
function parentOf(root: TreeNode, targetPath: string): TreeNode | null {
  if (root.path === targetPath) return null;
  for (const child of childrenOf(root)) {
    if (child.path === targetPath) return root;
    const deeper = parentOf(child, targetPath);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * The unified navigator tree (Read-only IDE P2): files **and** folders in one
 * lazy tree — the old folder-only tree + separate file grid is retired. A
 * selectable root sits at the top; folders nest under it and expand inline,
 * files are leaf rows. Double-click / Enter on a file opens it in the editor;
 * folders select + toggle. Expansion is controlled by the parent
 * (`expandedPaths`) so a queue click can reveal a file by expanding its whole
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
 * `→` expands or descends (folders only); `←` collapses or ascends; `Enter`
 * selects a folder or opens a file; `Space` toggles a folder's expansion.
 */
export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree(
  {
    root,
    selectedPath,
    onSelectFolder,
    onSelectFile,
    onActivateFile,
    expandedPaths,
    onToggleExpand,
    driftLevelFor,
    driftKindFor,
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

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setRowRef = useCallback((path: string, el: HTMLDivElement | null) => {
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

  // Reveal: when the selected row changes (a queue click or search pick selects
  // a file and expands its ancestors), scroll it into the window so it's visible
  // — the keyboard path scrolls on focus, but a reveal doesn't move DOM focus.
  // Guarded to the selected path being in the visible set.
  useEffect(() => {
    if (selectedPath == null || !indexByPath.has(selectedPath)) return;
    scrollPathIntoView(selectedPath);
  }, [selectedPath, indexByPath, scrollPathIntoView]);

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
          // Files are leaves — `→` does nothing on them.
          if (!node.isDir) break;
          if (!expandedPaths.has(node.path)) {
            // Collapsed: expand. Children will appear under it; focus stays.
            if (childrenOf(node).length > 0) onToggleExpand(node.path);
          } else {
            // Expanded: move to the first child (file or folder), if any.
            const first = childrenOf(node)[0];
            if (first) focusPath(first.path);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (node.isDir && expandedPaths.has(node.path) && childrenOf(node).length > 0) {
            onToggleExpand(node.path);
          } else if (row.parentPath) {
            focusPath(row.parentPath);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          // A folder selects (parity with click); a file opens in the editor.
          if (node.isDir) onSelectFolder(node.path);
          else onActivateFile?.(node);
          break;
        }
        case ' ': {
          // Space toggles a folder; on a file it does nothing (no expand).
          if (!node.isDir) break;
          e.preventDefault();
          onToggleExpand(node.path);
          break;
        }
      }
    },
    [
      visible,
      indexByPath,
      focusedPath,
      expandedPaths,
      focusPath,
      onSelectFolder,
      onActivateFile,
      onToggleExpand,
    ],
  );

  return (
    <div
      ref={viewportRef}
      style={viewportStyle}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <ul
        role="tree"
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
              onSelectFile={(p) => {
                setFocusedPath(p);
                onSelectFile?.(p);
              }}
              onActivateFile={onActivateFile}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              driftLevelFor={driftLevelFor}
              driftKindFor={driftKindFor}
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
  onSelectFile: (path: string) => void;
  onActivateFile?: (node: TreeNode) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
  driftKindFor?: (filePath: string) => DriftKind | undefined;
  onContextMenu?: (node: TreeNode, x: number, y: number) => void;
  setRowRef: (path: string, el: HTMLDivElement | null) => void;
};

function Row({
  node,
  depth,
  top,
  isRoot,
  selectedPath,
  focusedPath,
  onSelectFolder,
  onSelectFile,
  onActivateFile,
  expandedPaths,
  onToggleExpand,
  driftLevelFor,
  driftKindFor,
  onContextMenu,
  setRowRef,
}: RowProps): JSX.Element {
  const isDir = node.isDir;
  const open = isDir && expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isFocused = focusedPath === node.path;
  // A synthetic root (e.g. the Status tab grouping several memory folders) has
  // no real path on disk — skip the path tooltip, Reveal-in-Finder, and ignore.
  const synthetic = node.path.startsWith('synthetic:');
  // A file's own change kind colours its dot; folders show the subtree level.
  const fileKind = isDir ? undefined : driftKindFor?.(node.path);

  // Background + colour live in CSS (`.file-tree-row`, `.is-selected`, hover,
  // focus-visible) — see index.html. Only the depth indent stays inline.
  const rowStyle: React.CSSProperties = {
    ...nodeRow,
    paddingLeft: `${0.4 + depth * 0.9}rem`,
  };

  return (
    <li style={{ ...rowItem, top: `${top}px` }} role="presentation">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is the tree's roving-tabindex model — handleKeyDown on the parent <ul>. */}
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={isDir ? open : undefined}
        ref={(el) => setRowRef(node.path, el)}
        tabIndex={isFocused ? 0 : -1}
        className={`row-kebab-host file-tree-row${isSelected ? ' is-selected' : ''}`}
        style={rowStyle}
        onClick={() => {
          // A folder: select (highlight + lazy-load) and toggle its expansion.
          // A file: select (highlight) only — double-click opens it.
          if (isDir) {
            onSelectFolder(node.path);
            onToggleExpand(node.path);
          } else {
            onSelectFile(node.path);
          }
        }}
        onDoubleClick={() => {
          if (!isDir) onActivateFile?.(node);
        }}
        onContextMenu={(e) => {
          if (synthetic || !onContextMenu) return;
          e.preventDefault();
          onContextMenu(node, e.clientX, e.clientY);
        }}
        title={synthetic ? node.name : node.path}
        data-testid={isRoot ? 'tree-root' : undefined}
      >
        <span style={{ ...twistyStyle, color: 'var(--color-text-secondary)' }}>
          {isDir ? (open ? '▾' : '▸') : ''}
        </span>
        <span style={glyphStyle}>
          <FileIcon name={node.name} isDir={isDir} />
        </span>
        <span style={{ ...nameStyle, fontWeight: open ? 600 : 400 }}>{node.name}</span>
        <span
          style={{
            ...driftDotStyle,
            background: isDir
              ? DOT_COLOR[driftLevelFor(node.path)]
              : fileKind
                ? FILE_DOT_COLOR[fileKind]
                : 'transparent',
          }}
        />
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
      </div>
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
  border: 'none',
  textAlign: 'left',
  font: 'inherit',
  fontSize: FONT_SIZE,
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
  width: '14px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
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
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text-dim)',
  fontSize: '0.72rem',
  cursor: 'pointer',
  padding: 0,
};
