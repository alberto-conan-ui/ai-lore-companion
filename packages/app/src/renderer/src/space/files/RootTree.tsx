import type { ChangeEntry, TreeNode } from '@ai-lore-companion/core';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { FileTree } from '../../components/FileTree.js';
import { ContextMenuShell } from '../../components/overlay/ContextMenuShell.js';
import { type DriftKind, type DriftLevel, categoriseDriftCode, driftLevel } from '../../store.js';
import type { RootSummary } from './filesTypes.js';
import { type RootTreeState, absOf, relOf } from './useRootTrees.js';

type Props = {
  summary: RootSummary;
  state: RootTreeState;
  onSelectFolder: (abs: string) => void;
  onSelectFile: (abs: string) => void;
  onToggleExpand: (abs: string) => void;
  /** Open a file of the root in the editor; `rel` is relative to the root. */
  onOpenFile: (rel: string) => void;
};

/** The changed files of a root, by absolute path, from its snapshot. Empty when the root has no changes read. */
export function changesByPath(summary: RootSummary): Map<string, ChangeEntry> {
  const map = new Map<string, ChangeEntry>();
  if (summary.snapshot.status !== 'ok') return map;
  for (const entry of summary.snapshot.changes.entries) {
    map.set(absOf(summary.root.path, entry.path), entry);
  }
  return map;
}

/**
 * The tree of one root: the v0.8 `FileTree` as it is, with files and folders
 * loaded a level at a time, the change markers read from the root's snapshot
 * (a folder's dot by the number of changed files under it, a file's dot by
 * whether it was added, changed or deleted), the keyboard model of that tree,
 * and a context menu on each row.
 */
export function RootTree({
  summary,
  state,
  onSelectFolder,
  onSelectFile,
  onToggleExpand,
  onOpenFile,
}: Props): JSX.Element {
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const changed = useMemo(() => changesByPath(summary), [summary]);
  const changedPaths = useMemo(() => [...changed.keys()], [changed]);

  const driftLevelFor = useCallback(
    (folderPath: string): DriftLevel => {
      const prefix = `${folderPath}/`;
      let count = 0;
      for (const path of changedPaths) if (path.startsWith(prefix)) count += 1;
      return driftLevel(count);
    },
    [changedPaths],
  );

  const driftKindFor = useCallback(
    (filePath: string): DriftKind | undefined => {
      const entry = changed.get(filePath);
      return entry ? categoriseDriftCode(entry.code) : undefined;
    },
    [changed],
  );

  const openNode = useCallback(
    (node: TreeNode): void => {
      const rel = relOf(summary.root.path, node.path);
      if (rel !== null && rel !== '') onOpenFile(rel);
    },
    [summary.root.path, onOpenFile],
  );

  const [revealError, setRevealError] = useState<string | null>(null);

  // Main resolves the root's id and the relative path; no absolute path leaves the renderer.
  const revealNode = useCallback(
    (node: TreeNode): void => {
      const rel = relOf(summary.root.path, node.path);
      if (rel === null) return;
      setRevealError(null);
      void window.cockpit.spaceRootReveal({ rootId: summary.root.id, path: rel }).then(
        (result) => setRevealError(result.ok ? null : result.error.message),
        (caught: unknown) => setRevealError(String(caught)),
      );
    },
    [summary.root.path, summary.root.id],
  );

  const cut = Object.entries(state.truncated);

  return (
    <section
      style={treeAreaStyle}
      aria-label={`Tree of ${summary.root.name}`}
      data-testid="files-tree"
    >
      {state.error ? (
        <p role="alert" style={errorStyle} data-testid="files-tree-error">
          {state.error}
        </p>
      ) : null}
      {revealError ? (
        <p role="alert" style={errorStyle} data-testid="files-tree-reveal-error">
          {revealError}
        </p>
      ) : null}
      {cut.map(([abs, { total, limit }]) => (
        <p key={abs} style={noticeStyle} data-testid="files-tree-truncated">
          {`${relOf(summary.root.path, abs) || summary.root.name} holds ${total} entries; the first ${limit} are shown.`}
        </p>
      ))}
      <FileTree
        root={state.node}
        selectedPath={state.selected}
        onSelectFolder={onSelectFolder}
        onSelectFile={onSelectFile}
        onActivateFile={openNode}
        expandedPaths={state.expanded}
        onToggleExpand={onToggleExpand}
        driftLevelFor={driftLevelFor}
        driftKindFor={driftKindFor}
        onContextMenu={(node, x, y) => setMenu({ node, x, y })}
        onRevealInFinder={revealNode}
      />
      {menu ? (
        <ContextMenuShell
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          label={`Actions for ${menu.node.name}`}
          testId="files-tree-menu"
        >
          <div role="menu" aria-label={`Actions for ${menu.node.name}`} style={menuStyle}>
            {menu.node.isDir ? null : (
              <button
                type="button"
                role="menuitem"
                style={menuItemStyle}
                onClick={() => {
                  openNode(menu.node);
                  setMenu(null);
                }}
              >
                Open
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              style={menuItemStyle}
              onClick={() => {
                revealNode(menu.node);
                setMenu(null);
              }}
            >
              Reveal in Finder
            </button>
          </div>
        </ContextMenuShell>
      ) : null}
    </section>
  );
}

const treeAreaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};

const errorStyle: React.CSSProperties = {
  margin: '0.4rem 0.6rem',
  fontSize: '0.8rem',
  color: 'var(--color-danger)',
};

const noticeStyle: React.CSSProperties = {
  margin: '0.4rem 0.6rem',
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const menuStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' };

const menuItemStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.82rem',
  textAlign: 'left',
  cursor: 'pointer',
};
