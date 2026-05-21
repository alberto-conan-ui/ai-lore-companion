import type { ChangeScope, QueueEntry, TreeNode } from '@ai-lore-companion/core';
import { create } from 'zustand';
import type {
  ChainPayload,
  ChangePayload,
  TreeInitPayload,
  TreeUpdatePayload,
} from '../../shared/ipc.js';

export type DriftLevel = 'idle' | 'live' | 'warn' | 'alert';

export function driftLevel(count: number): DriftLevel {
  if (count === 0) return 'idle';
  if (count < 5) return 'live';
  if (count < 10) return 'warn';
  return 'alert';
}

/** The flat entries list narrowed to one side. */
export function entriesByScope(entries: QueueEntry[], scope: ChangeScope): QueueEntry[] {
  return entries.filter((e) => e.scope === scope);
}

/** Depth-first search for the node at `path` within `root`. */
export function findTreeNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const found = findTreeNode(child, path);
    if (found) return found;
  }
  return null;
}

type Trees = { payload: TreeNode | null; lore: TreeNode | null };

type State = {
  chain: ChainPayload | null;
  entries: QueueEntry[];
  trees: Trees;
  setChain: (chain: ChainPayload) => void;
  setEntries: (entries: QueueEntry[]) => void;
  applyEvent: (event: ChangePayload) => void;
  setTrees: (init: TreeInitPayload) => void;
  applyTreeUpdate: (update: TreeUpdatePayload) => void;
  expandTree: (scope: ChangeScope, path: string, children: TreeNode[]) => void;
};

export const useCockpitStore = create<State>((set) => ({
  chain: null,
  entries: [],
  trees: { payload: null, lore: null },
  setChain: (chain) => set({ chain }),
  setEntries: (entries) => set({ entries: sortNewestFirst(entries) }),
  applyEvent: (event) =>
    set((state) => {
      switch (event.kind) {
        case 'add':
          return { entries: [event.entry, ...state.entries] };
        case 'replace':
          return {
            entries: [event.entry, ...state.entries.filter((e) => e.id !== event.replaces)],
          };
        case 'ack':
          return { entries: state.entries.filter((e) => e.id !== event.id) };
        case 'clear':
          return {
            entries: event.scope ? state.entries.filter((e) => e.scope !== event.scope) : [],
          };
        default:
          return state;
      }
    }),
  setTrees: (init) => set({ trees: { payload: init.payload, lore: init.lore } }),
  applyTreeUpdate: (update) =>
    set((state) => patchTree(state.trees, update.scope, update.path, update.children)),
  expandTree: (scope, path, children) =>
    set((state) => patchTree(state.trees, scope, path, children)),
}));

function sortNewestFirst(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => b.ts - a.ts);
}

/** Return a new `trees` with the node at `path` on `scope` given fresh `children`. */
function patchTree(
  trees: Trees,
  scope: ChangeScope,
  path: string,
  children: TreeNode[],
): { trees: Trees } {
  const side = trees[scope];
  if (!side) return { trees };
  return { trees: { ...trees, [scope]: replaceChildren(side, path, children) } };
}

function replaceChildren(node: TreeNode, path: string, children: TreeNode[]): TreeNode {
  if (node.path === path) return { ...node, children };
  if (!node.children) return node;
  let changed = false;
  const next = node.children.map((child) => {
    const updated = replaceChildren(child, path, children);
    if (updated !== child) changed = true;
    return updated;
  });
  return changed ? { ...node, children: next } : node;
}
