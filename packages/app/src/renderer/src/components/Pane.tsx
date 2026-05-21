import type { ChangeScope, QueueEntry, TreeNode } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { type DriftLevel, driftLevel, findTreeNode, useCockpitStore } from '../store.js';
import { DriftPill } from './DriftPill.js';
import { FileGrid } from './FileGrid.js';
import { FileTree } from './FileTree.js';
import { PaneQueue } from './PaneQueue.js';

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
};

/**
 * One pane of the cockpit: a folder tree, a file grid for the selected folder,
 * and the queue of unread drift for this side. The pane is rooted at a
 * `SubRoot` — a slice of its `scope`'s tree — and its drift is filtered to
 * that slice. Drift is per-`scope` throughout; the sub-root narrows it further.
 */
export function Pane({ scope, label, testId, subRoot, projectRoot }: Props): JSX.Element {
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

  // Scope entries narrowed to the ones that fall within this pane's sub-root.
  const paneEntries = useMemo(
    () => entriesInSubRoot(entries, scope, subRoot, projectRoot),
    [entries, scope, subRoot, projectRoot],
  );

  const [selectedFolder, setSelectedFolder] = useState<string>(rootId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

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

  /**
   * Reveal a file: load every ancestor folder, expand the chain in the tree,
   * select the containing folder, and select the file so the grid scrolls to
   * it. The walk starts at whichever of the sub-root's base directories
   * contains the file.
   */
  const revealFile = useCallback(
    async (fileAbs: string) => {
      const base = bases.find((b) => fileAbs === b || fileAbs.startsWith(`${b}/`));
      if (!base) return;
      const folderAbs = fileAbs.slice(0, fileAbs.lastIndexOf('/'));
      const toLoad: string[] = [];
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
      if (toLoad.length > 0) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          // The base folder itself is a tree row when the sub-root groups
          // several folders — expand it so the revealed chain is visible.
          next.add(base);
          for (const p of toLoad) next.add(p);
          return next;
        });
      }
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

  const handleQueueDouble = useCallback(
    (entry: QueueEntry) => {
      void window.cockpit.openPath(toAbs(entry.path));
    },
    [toAbs],
  );

  return (
    <section style={paneStyle} data-testid={`pane-${testId}`}>
      <header style={paneHeaderStyle}>
        <span style={paneLabelStyle}>{label}</span>
        <span style={pathStyle} title={headerPath}>
          {headerPath}
        </span>
        <DriftPill level={driftLevel(paneEntries.length)} count={paneEntries.length} />
      </header>

      <div style={paneBodyStyle}>
        <div style={treeColumnStyle}>
          {renderedRoot ? (
            <FileTree
              root={renderedRoot}
              selectedPath={selectedFolder}
              onSelectFolder={handleSelectFolder}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              driftLevelFor={driftLevelFor}
            />
          ) : (
            <div style={treeLoadingStyle}>Reading tree…</div>
          )}
        </div>
        <div style={gridColumnStyle}>
          <FileGrid
            scope={scope}
            rows={gridRows}
            selectedPath={selectedFile}
            onSelectPath={setSelectedFile}
            onOpenFolder={handleOpenFolder}
            driftByPath={driftByPath}
          />
        </div>
      </div>

      <div style={queueRowStyle}>
        <PaneQueue
          label={label}
          entries={paneEntries}
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
  width: '240px',
  flexShrink: 0,
  overflowY: 'auto',
  background: '#0c121a',
  borderRight: '1px solid #1f2933',
  padding: '0.3rem 0',
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
  height: '32%',
  minHeight: '160px',
  display: 'flex',
  flexDirection: 'column',
};
