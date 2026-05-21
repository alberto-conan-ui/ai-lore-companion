import type { ChangeScope, QueueEntry } from '@ai-lore-companion/core';
import { type JSX, useCallback, useMemo, useState } from 'react';
import {
  type DriftLevel,
  driftLevel,
  entriesByScope,
  findTreeNode,
  useCockpitStore,
} from '../store.js';
import { DriftPill } from './DriftPill.js';
import { FileGrid } from './FileGrid.js';
import { FileTree } from './FileTree.js';
import { PaneQueue } from './PaneQueue.js';

type Props = {
  scope: ChangeScope;
  label: string;
  /** Absolute path this pane's tree is rooted at (project root, or the Lore folder). */
  rootPath: string;
  /** Project root — queue entry paths are relative to it; needed to absolutise them. */
  projectRoot: string;
};

/**
 * One half of the cockpit: a folder tree, a file grid for the selected folder,
 * and the queue of unread drift for this side. Drift is per-`scope` throughout.
 */
export function Pane({ scope, label, rootPath, projectRoot }: Props): JSX.Element {
  const tree = useCockpitStore((s) => s.trees[scope]);
  const entries = useCockpitStore((s) => s.entries);
  const expandTree = useCockpitStore((s) => s.expandTree);

  const paneEntries = useMemo(() => entriesByScope(entries, scope), [entries, scope]);

  const [selectedFolder, setSelectedFolder] = useState<string>(rootPath);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  // Queue entry paths are relative to the project root; tree/grid paths are absolute.
  const toAbs = useCallback((relPath: string) => `${projectRoot}/${relPath}`, [projectRoot]);

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
    () => findTreeNode(tree, selectedFolder)?.children ?? [],
    [tree, selectedFolder],
  );

  const handleSelectFolder = useCallback(
    (path: string) => {
      setSelectedFolder(path);
      const node = findTreeNode(tree, path);
      if (node?.isDir && node.children === undefined) {
        void window.cockpit.treeExpand({ scope, path }).then((children) => {
          expandTree(scope, path, children);
        });
      }
    },
    [tree, scope, expandTree],
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
   * select the containing folder, and select the file so the grid scrolls to it.
   */
  const revealFile = useCallback(
    async (fileAbs: string) => {
      const folderAbs = fileAbs.slice(0, fileAbs.lastIndexOf('/'));
      const toLoad: string[] = [];
      if (folderAbs !== rootPath && folderAbs.startsWith(`${rootPath}/`)) {
        let cur = rootPath;
        for (const seg of folderAbs.slice(rootPath.length + 1).split('/')) {
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
          for (const p of toLoad) next.add(p);
          return next;
        });
      }
      setSelectedFolder(folderAbs);
      setSelectedFile(fileAbs);
    },
    [scope, rootPath, expandTree],
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
    <section style={paneStyle} data-testid={`pane-${scope}`}>
      <header style={paneHeaderStyle}>
        <span style={paneLabelStyle}>{label}</span>
        <span style={pathStyle} title={rootPath}>
          {rootPath}
        </span>
        <DriftPill level={driftLevel(paneEntries.length)} count={paneEntries.length} />
      </header>

      <div style={paneBodyStyle}>
        <div style={treeColumnStyle}>
          {tree ? (
            <FileTree
              root={tree}
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
