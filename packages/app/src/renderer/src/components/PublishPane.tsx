import type { AppEntry, TreeNode } from '@ai-lore-companion/core';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { useCockpitStore } from '../store.js';
import { FileTree } from './FileTree.js';

/**
 * The Publish pane (v0.8 Phase B) — view-only browser of `<project>/publish/`.
 *
 * By methodology contract `publish/` is **derived state**, write-restricted
 * to the `publish` verb itself. The companion enforces this by omission:
 *
 *   - **No watcher** — the tree refreshes on user navigation / re-open
 *     only. Acceptable for a view-only surface.
 *   - **No ChangesPanel** — no drift, no commit baseline, no diff.
 *   - **Reduced context menu** — Open in Finder + Open with… only. No
 *     Diff, no Ignore, no other write-shaped actions.
 *
 * The publish tree itself is loaded by main on chain attach when the
 * project declares the Publishing shape, and lives in `store.trees.publish`.
 */
export function PublishPane(): JSX.Element {
  const tree = useCockpitStore((s) => s.trees.publish);
  const expandTree = useCockpitStore((s) => s.expandTree);
  const apps = useCockpitStore((s) => s.apps);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  // Auto-seed selected + expanded once the tree lands so the right pane
  // shows something useful on first open.
  if (tree && selectedFolder === null) {
    setSelectedFolder(tree.path);
    setExpandedPaths(new Set([tree.path]));
  }

  // The publish tree is sent one level deep (like every pane tree). A folder
  // whose `children` is still `undefined` has never been read — fetch it once
  // on first navigation/expand so its contents appear. Without this, sub-folders
  // render in the tree but their contents stay empty (notably a `publish/`
  // symlink whose top level is all folders). Mirrors `Pane.tsx`'s lazy load.
  const inFlight = useRef<Set<string>>(new Set());
  const ensureLoaded = useCallback(
    (path: string) => {
      const node = tree ? findNode(tree, path) : null;
      if (!node?.isDir || node.children !== undefined) return;
      if (inFlight.current.has(path)) return;
      inFlight.current.add(path);
      void window.cockpit.treeExpand({ scope: 'lore', path }).then((children) => {
        inFlight.current.delete(path);
        expandTree('publish', path, children);
      });
    },
    [tree, expandTree],
  );

  const handleSelectFolder = useCallback(
    (path: string) => {
      setSelectedFolder(path);
      ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const handleToggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      ensureLoaded(path);
    },
    [ensureLoaded],
  );

  // Drift in a view-only pane is always idle — the pane shows no drift glyph.
  const driftLevelFor = useCallback(() => 'idle' as const, []);

  const handleRevealInFinder = useCallback((node: TreeNode) => {
    window.cockpit.revealInFinder(node.path);
  }, []);

  const handleOpenWith = useCallback(async (app: AppEntry, node: TreeNode) => {
    const result = await window.cockpit.appsInvoke({ appId: app.id, path: node.path });
    if (result.kind === 'failed') {
      window.alert(`Could not open with ${app.label}: ${result.message}`);
    }
  }, []);

  // The selected folder's files — sorted (folders first, then files), no
  // drift glyph, no Ignore/Diff actions in the row context menu.
  const visibleFiles = useMemo(() => {
    if (!tree || !selectedFolder) return [];
    const node = findNode(tree, selectedFolder);
    if (!node || !node.children) return [];
    return [...node.children].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [tree, selectedFolder]);

  if (!tree) {
    return (
      <div style={emptyWrapStyle} data-testid="pane-publish">
        <div style={emptyMessageStyle}>
          Publish folder is not loaded yet — make sure the project declares a <code>publish:</code>{' '}
          block in <code>workspace.yaml</code>.
        </div>
      </div>
    );
  }

  return (
    <div style={paneStyle} data-testid="pane-publish" data-pane="publish">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>Publish</span>
        <span style={headerHintStyle}>view-only · written by the publish verb</span>
      </div>
      <div style={bodyStyle}>
        <div style={treeColumnStyle}>
          <FileTree
            root={tree}
            selectedPath={selectedFolder}
            onSelectFolder={handleSelectFolder}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            driftLevelFor={driftLevelFor}
          />
        </div>
        <div style={gridColumnStyle}>
          {visibleFiles.length === 0 ? (
            <div style={emptyGridStyle}>This folder is empty.</div>
          ) : (
            <ul style={fileListStyle} data-testid="publish-file-list">
              {visibleFiles.map((node) => (
                <PublishRow
                  key={node.path}
                  node={node}
                  apps={apps}
                  onRevealInFinder={handleRevealInFinder}
                  onOpenWith={handleOpenWith}
                  onOpenFolder={(p) => {
                    handleSelectFolder(p);
                    setExpandedPaths((prev) => new Set([...prev, p]));
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** One file/folder row — clicking a folder navigates into it; right-click
 *  opens the reduced view-only menu (Open in Finder + Open with…). */
function PublishRow({
  node,
  apps,
  onRevealInFinder,
  onOpenWith,
  onOpenFolder,
}: {
  node: TreeNode;
  apps: readonly AppEntry[];
  onRevealInFinder: (node: TreeNode) => void;
  onOpenWith: (app: AppEntry, node: TreeNode) => void;
  onOpenFolder: (path: string) => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const onCtx = (e: React.MouseEvent): void => {
    e.preventDefault();
    setMenuOpen(true);
  };
  const onDouble = (): void => {
    if (node.isDir) onOpenFolder(node.path);
    else onRevealInFinder(node);
  };
  // Apps that apply to this node kind — same filter the regular grid uses,
  // minus the diff app (excluded by `appsForNode` already in the catalog).
  const applicableApps = apps.filter((a) => {
    if (a.role === 'diff') return false;
    if (a.target === 'both') return true;
    return node.isDir ? a.target === 'folder' : a.target === 'file';
  });
  return (
    <li style={rowStyle} onContextMenu={onCtx} onDoubleClick={onDouble}>
      <span style={rowGlyphStyle}>{node.isDir ? '▸' : '·'}</span>
      <span style={rowNameStyle} data-testid="publish-row-name">
        {node.name}
      </span>
      {menuOpen ? (
        <div style={menuStyle} onMouseLeave={() => setMenuOpen(false)}>
          <button
            type="button"
            style={menuItemStyle}
            onClick={() => {
              onRevealInFinder(node);
              setMenuOpen(false);
            }}
            data-testid="publish-menu-reveal"
          >
            Open in Finder
          </button>
          {applicableApps.length > 0 ? (
            <>
              <div style={menuDividerStyle} />
              {applicableApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  style={menuItemStyle}
                  onClick={() => {
                    onOpenWith(app, node);
                    setMenuOpen(false);
                  }}
                  data-testid={`publish-menu-app-${app.id}`}
                >
                  Open with {app.label}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function findNode(tree: TreeNode, path: string): TreeNode | null {
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  background: 'var(--color-panel)',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 700,
  color: 'var(--color-text-bright)',
};

const headerHintStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const treeColumnStyle: React.CSSProperties = {
  width: '240px',
  flexShrink: 0,
  borderRight: '1px solid var(--color-border)',
  overflow: 'auto',
};

const gridColumnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
};

const fileListStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.4rem 0',
  listStyle: 'none',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.25rem 0.7rem',
  fontSize: '0.78rem',
  cursor: 'default',
  position: 'relative',
};

const rowGlyphStyle: React.CSSProperties = {
  color: 'var(--color-text-soft)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};

const rowNameStyle: React.CSSProperties = {
  color: 'var(--color-text)',
};

const emptyWrapStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

const emptyMessageStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--color-text-soft)',
  textAlign: 'center',
  maxWidth: '24rem',
  lineHeight: 1.5,
};

const emptyGridStyle: React.CSSProperties = {
  padding: '1rem 0.7rem',
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
};

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: '0.5rem',
  zIndex: 10,
  background: 'var(--color-inset)',
  border: '1px solid var(--color-border-2)',
  borderRadius: '4px',
  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.55)',
  display: 'flex',
  flexDirection: 'column',
  padding: '0.25rem',
  minWidth: '12rem',
};

const menuItemStyle: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text)',
  fontSize: '0.78rem',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: '3px',
};

const menuDividerStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--color-border-2)',
  margin: '0.2rem 0.4rem',
};
