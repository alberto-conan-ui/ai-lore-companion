import type { TreeNode } from '@ai-lore-companion/core';
import type { JSX } from 'react';
import type { DriftLevel } from '../store.js';

type Props = {
  root: TreeNode;
  selectedPath: string | null;
  onSelectFolder: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
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

/**
 * Lazy directory tree, folders only: a selectable root node sits at the top with
 * its child folders nested under it. Selecting the root shows the pane's
 * root-level files in the grid. Expansion is controlled by the parent
 * (`expandedPaths`) so a queue click can reveal a folder by expanding its whole
 * ancestor chain.
 */
export function FileTree({
  root,
  selectedPath,
  onSelectFolder,
  expandedPaths,
  onToggleExpand,
  driftLevelFor,
}: Props): JSX.Element {
  return (
    <ul style={listReset}>
      <Node
        node={root}
        depth={0}
        isRoot
        selectedPath={selectedPath}
        onSelectFolder={onSelectFolder}
        expandedPaths={expandedPaths}
        onToggleExpand={onToggleExpand}
        driftLevelFor={driftLevelFor}
      />
    </ul>
  );
}

type NodeProps = {
  node: TreeNode;
  depth: number;
  /** True for the single top node — the pane's selectable root row. */
  isRoot?: boolean;
  selectedPath: string | null;
  onSelectFolder: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  driftLevelFor: (folderPath: string) => DriftLevel;
};

function Node({
  node,
  depth,
  isRoot,
  selectedPath,
  onSelectFolder,
  expandedPaths,
  onToggleExpand,
  driftLevelFor,
}: NodeProps): JSX.Element {
  const open = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const childList = folderChildren(node);
  // A synthetic root (e.g. the Status tab grouping several memory folders) has
  // no real path on disk — skip the path tooltip and the Reveal-in-Finder shortcut.
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
        style={rowStyle}
        onClick={() => {
          onSelectFolder(node.path);
          onToggleExpand(node.path);
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
              onSelectFolder={onSelectFolder}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              driftLevelFor={driftLevelFor}
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
