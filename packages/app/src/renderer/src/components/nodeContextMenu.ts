/**
 * The uniform context-menu builder for any file/folder node — tree, grid,
 * drift list. v0.6 Phase A: every surface that lists files or folders shares
 * one menu shape so the user has a single mental model of *"what can I do
 * with this thing?"*.
 *
 * Item order:
 *   1. **Open in Finder** — always present; uses macOS reveal-or-open semantics.
 *   2. **Open with [label]** — one per matching Apps catalog entry.
 *   3. **Diff against latest save-point** — files only; disabled-with-hint when
 *      no save-point exists in the project.
 *   4. **Ignore this file/folder in the project** — preserved from v0.5.
 *
 * The catalog's `role: 'diff'` entry is excluded from *Open with* slots
 * (`appsForNode` already filters it out) — diff has its own dedicated item.
 */

import type { AppEntry, TreeNode } from '@ai-lore-companion/core';
import type { MenuItemDef } from 'ag-grid-community';

/**
 * Mirror of `appsForNode` from core, inlined so the renderer doesn't import
 * a runtime export of `@ai-lore-companion/core` (which would pull node-only
 * modules like `chokidar` into the renderer bundle). The two should stay in
 * sync — core's [apps.ts](../../../../core/src/apps/apps.ts) is the canonical
 * version.
 */
function appsForNode(apps: readonly AppEntry[], nodeKind: 'file' | 'folder'): AppEntry[] {
  return apps.filter((a) => {
    if (a.role === 'diff') return false;
    return a.target === 'both' || a.target === nodeKind;
  });
}

export type NodeContextMenuInput = {
  node: TreeNode;
  apps: readonly AppEntry[];
  hasSavePoint: boolean;
  onRevealInFinder: (node: TreeNode) => void;
  onOpenWith: (app: AppEntry, node: TreeNode) => void;
  onDiff: (node: TreeNode) => void;
  onIgnore: (node: TreeNode) => void;
};

export function buildNodeContextMenu(input: NodeContextMenuInput): (MenuItemDef | string)[] {
  const { node, apps, hasSavePoint, onRevealInFinder, onOpenWith, onDiff, onIgnore } = input;
  const nodeKind: 'file' | 'folder' = node.isDir ? 'folder' : 'file';
  const items: (MenuItemDef | string)[] = [
    {
      name: 'Open in Finder',
      action: () => onRevealInFinder(node),
    },
  ];

  const matching = appsForNode(apps, nodeKind);
  for (const app of matching) {
    items.push({
      name: `Open with ${app.label}`,
      action: () => onOpenWith(app, node),
    });
  }

  if (!node.isDir) {
    items.push({
      name: hasSavePoint
        ? 'Diff against latest save-point'
        : 'Diff against latest save-point (no save-point recorded)',
      disabled: !hasSavePoint,
      action: () => onDiff(node),
    });
  }

  items.push('separator');
  items.push({
    name: node.isDir ? 'Ignore this folder in the project' : 'Ignore this file in the project',
    action: () => onIgnore(node),
  });

  return items;
}
