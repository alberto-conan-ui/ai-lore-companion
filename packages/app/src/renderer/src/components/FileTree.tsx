import type { TreeNode } from '@ai-lore-companion/core';
import {
  type JSX,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DriftLevel } from '../store.js';

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

/** The tree is a pure folder navigator — files live in the grid, never the tree. */
function folderChildren(node: TreeNode): TreeNode[] {
  return (node.children ?? []).filter((c) => c.isDir);
}

/** Walk the tree depth-first, respecting `expanded`, and return the visible
 *  node list in render order. Drives keyboard up/down between rows. */
function flattenVisible(root: TreeNode, expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (node: TreeNode): void => {
    out.push(node);
    if (expanded.has(node.path)) for (const child of folderChildren(node)) walk(child);
  };
  walk(root);
  return out;
}

/** Find the parent folder of `targetPath` within the rendered tree, or null
 *  if the target is the root (or not in the tree). */
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
 * Keyboard model — roving tabindex. One row at a time carries `tabIndex=0`
 * (the focused row); the rest carry `-1`. Arrow keys move the focused row in
 * the visible (flattened) list; `→` expands or descends; `←` collapses or
 * ascends; `Enter` selects (parity with click); `Space` toggles expand
 * without selecting.
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
  const [focusedPath, setFocusedPath] = useState<string>(root.path);

  // If the focused row is no longer visible (an ancestor collapsed it away,
  // or the tree changed under us), snap focus to the closest visible
  // ancestor — or to the root as a last resort.
  useEffect(() => {
    if (visible.some((n) => n.path === focusedPath)) return;
    let cur: TreeNode | null = parentOf(root, focusedPath);
    while (cur && !visible.some((n) => n.path === cur?.path)) cur = parentOf(root, cur.path);
    setFocusedPath(cur ? cur.path : root.path);
  }, [visible, focusedPath, root]);

  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const setRowRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  // Move focus to a path: update state and DOM focus together. Skipping the
  // DOM focus call would leave the previously-focused element retaining
  // browser focus, which then conflicts with the next key event.
  const focusPath = useCallback((path: string) => {
    setFocusedPath(path);
    rowRefs.current.get(path)?.focus();
  }, []);

  // Imperative API the Pane uses when Tab routes into the tree.
  useImperativeHandle(
    forwardedRef,
    () => ({
      focusMe: () => {
        rowRefs.current.get(focusedPath)?.focus();
      },
    }),
    [focusedPath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const idx = visible.findIndex((n) => n.path === focusedPath);
      if (idx === -1) return;
      const node = visible[idx];
      if (!node) return;
      switch (e.key) {
        case 'ArrowDown': {
          if (idx + 1 < visible.length) {
            e.preventDefault();
            const next = visible[idx + 1];
            if (next) focusPath(next.path);
          }
          break;
        }
        case 'ArrowUp': {
          if (idx > 0) {
            e.preventDefault();
            const prev = visible[idx - 1];
            if (prev) focusPath(prev.path);
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
          } else {
            const parent = parentOf(root, node.path);
            if (parent) focusPath(parent.path);
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
    [visible, focusedPath, expandedPaths, focusPath, onSelectFolder, onToggleExpand, root],
  );

  return (
    <ul style={listReset} onKeyDown={handleKeyDown}>
      <Node
        node={root}
        depth={0}
        isRoot
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
    </ul>
  );
});

type NodeProps = {
  node: TreeNode;
  depth: number;
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

function Node({
  node,
  depth,
  isRoot,
  selectedPath,
  focusedPath,
  onSelectFolder,
  expandedPaths,
  onToggleExpand,
  driftLevelFor,
  onContextMenu,
  setRowRef,
}: NodeProps): JSX.Element {
  const open = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isFocused = focusedPath === node.path;
  const childList = folderChildren(node);
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
    <li style={listReset}>
      <button
        type="button"
        ref={(el) => setRowRef(node.path, el)}
        tabIndex={isFocused ? 0 : -1}
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
      </button>
      {open && childList.length > 0 ? (
        <ul style={listReset}>
          {childList.map((child) => (
            <Node
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              focusedPath={focusedPath}
              onSelectFolder={onSelectFolder}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              driftLevelFor={driftLevelFor}
              onContextMenu={onContextMenu}
              setRowRef={setRowRef}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const listReset: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const nodeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  width: '100%',
  padding: '0.18rem 0.5rem 0.18rem 0',
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
