import type { ChangeEntry, TreeNode } from '@ai-lore-companion/core';
import {
  type JSX,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type DriftKind, type DriftLevel, buildChangeTree } from '../store.js';
import { FileTree, type FileTreeHandle } from './FileTree.js';

/** Imperative handle the Pane uses to move keyboard focus into the panel. */
export type ChangesPanelHandle = {
  focusMe: () => void;
};

/**
 * One row of the Changes list. Wraps a `ChangeEntry` with the absolute
 * working-tree path the menu actions and the change tree need.
 */
export type DriftRow = ChangeEntry & {
  /** Path relative to the project root. */
  projectRelPath: string;
  /** Absolute path — the change tree's leaf id and the menu callbacks' target. */
  absPath: string;
};

type Props = {
  label: string;
  /** The rendered root's id (a real path, or a synthetic group id) and name —
   *  the change tree roots here, mirroring the navigator above. */
  rootId: string;
  rootName: string;
  /** The real directories this pane covers — each changed file descends from one. */
  bases: string[];
  /** This pane's changed files (already scope- and index-filtered upstream). */
  entries: DriftRow[];
  /** Folder subtree drift level (shared with the navigator). */
  driftLevelFor: (folderPath: string) => DriftLevel;
  /** A file's own change kind — drives its per-row drift dot. */
  driftKindFor: (filePath: string) => DriftKind | undefined;
  /** Single-click a changed file → reveal it in the navigator tree above. */
  onSelectFile: (absPath: string) => void;
  /** Double-click / Enter a changed file → open its diff vs the baseline. */
  onActivateFile: (absPath: string) => void;
  /** Right-click a file or folder → the pane's shared context menu. */
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
};

/** Gather every folder path in a built tree — the default-expanded set. */
function collectFolders(node: TreeNode, into: Set<string>): void {
  if (!node.isDir) return;
  into.add(node.path);
  for (const child of node.children ?? []) collectFolders(child, into);
}

/**
 * The pane's *Changes* surface — the files that differ between the working tree
 * and the milestone the global baseline picker selected. As of Read-only IDE
 * P2 this shares the navigator's **tree engine**: the same `FileTree` renders a
 * tree pruned to the changed files (drift dots, reveal arrows, context menu all
 * carry over). A single click reveals the file in the navigator above; a
 * double-click opens its diff. The tree starts fully expanded — it is already
 * pruned to what changed — and the user can collapse branches; a search box
 * filters the set.
 */
export const ChangesPanel = forwardRef<ChangesPanelHandle, Props>(function ChangesPanel(
  {
    label,
    rootId,
    rootName,
    bases,
    entries,
    driftLevelFor,
    driftKindFor,
    onSelectFile,
    onActivateFile,
    onContextMenu,
  }: Props,
  forwardedRef,
): JSX.Element {
  const [quickFilter, setQuickFilter] = useState('');
  // Folders the user has collapsed. The tree defaults to fully expanded, so we
  // track the negative — new changes then appear without a fresh expand.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const treeRef = useRef<FileTreeHandle>(null);

  useImperativeHandle(forwardedRef, () => ({ focusMe: () => treeRef.current?.focusMe() }), []);

  const query = quickFilter.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? entries.filter((e) => e.projectRelPath.toLowerCase().includes(query)) : entries),
    [entries, query],
  );

  const root = useMemo(
    () => buildChangeTree(rootId, rootName, bases, filtered),
    [rootId, rootName, bases, filtered],
  );

  const expandedPaths = useMemo(() => {
    const all = new Set<string>();
    collectFolders(root, all);
    for (const path of collapsed) all.delete(path);
    return all;
  }, [root, collapsed]);

  const onToggleExpand = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onSelectFile(path);
    },
    [onSelectFile],
  );

  const handleActivateFile = useCallback(
    (node: TreeNode) => {
      setSelectedPath(node.path);
      onActivateFile(node.path);
    },
    [onActivateFile],
  );

  return (
    <section style={containerStyle} data-testid={`changes-${label.toLowerCase()}`}>
      <header style={headerStyle}>
        <span style={labelStyle}>{label} changes</span>
        <span style={countStyle}>{filtered.length}</span>
        <input
          type="search"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          placeholder="Search changes…"
          style={searchStyle}
          data-testid={`changes-search-${label.toLowerCase()}`}
        />
      </header>
      <div style={bodyStyle}>
        {filtered.length === 0 ? (
          <div style={emptyStyle}>No changes.</div>
        ) : (
          <FileTree
            ref={treeRef}
            root={root}
            selectedPath={selectedPath}
            onSelectFolder={setSelectedPath}
            onSelectFile={handleSelectFile}
            onActivateFile={handleActivateFile}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
            driftLevelFor={driftLevelFor}
            driftKindFor={driftKindFor}
            onContextMenu={onContextMenu}
          />
        )}
      </div>
    </section>
  );
});

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  background: 'var(--color-panel)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-header)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--color-text)',
  textTransform: 'uppercase',
};

const countStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-border)',
  padding: '0.05rem 0.35rem',
  borderRadius: '999px',
};

const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: '14rem',
  padding: '0.2rem 0.5rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.72rem',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.6rem 0.8rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.76rem',
};
