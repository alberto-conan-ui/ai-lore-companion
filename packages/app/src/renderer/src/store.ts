import type {
  AppEntry,
  GitStatusScope,
  PorcelainEntry,
  TreeNode,
} from '@ai-lore-companion/core';
import { create } from 'zustand';
import type {
  ChainPayload,
  GitStatusPayload,
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

/**
 * The high-level kind of change a `git status --porcelain` code represents.
 * Used by the file grid + drift list to pick a glyph and colour without
 * exposing every porcelain edge case (renames, copies, conflicts).
 */
export type DriftKind = 'add' | 'change' | 'unlink';

export function categoriseDriftCode(code: string): DriftKind {
  // Untracked + index-add → added.
  if (code[0] === '?' || code[0] === 'A') return 'add';
  // Either column reporting delete → unlink.
  if (code[0] === 'D' || code[1] === 'D') return 'unlink';
  // Everything else (modified, renamed, copied, conflicted) → change.
  return 'change';
}

/** The git-drift snapshot, kept per repo. */
export type GitStatusState = {
  payload: PorcelainEntry[];
  lore: PorcelainEntry[];
};

/** Return one side of the git-drift snapshot. */
export function entriesByScope(gitStatus: GitStatusState, scope: GitStatusScope): PorcelainEntry[] {
  return gitStatus[scope];
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
  /**
   * Live `git status --porcelain` snapshots for both repos. Pushed by main
   * via [`IPC.GitStatus`](../../shared/ipc.ts) — v0.6 Phase B's git-as-truth
   * model. Replaces the v0.5 SQLite-queue `entries` + event-reducer model.
   */
  gitStatus: GitStatusState;
  trees: Trees;
  /**
   * The Apps catalog — what *Open with…* menus offer. Mirrors the snapshot's
   * `global.apps`. Populated via `settingsGet` on launch and refreshed by the
   * `onSettingsChanged` subscription.
   */
  apps: AppEntry[];
  setChain: (chain: ChainPayload) => void;
  applyGitStatus: (payload: GitStatusPayload) => void;
  setTrees: (init: TreeInitPayload) => void;
  applyTreeUpdate: (update: TreeUpdatePayload) => void;
  expandTree: (scope: GitStatusScope, path: string, children: TreeNode[]) => void;
  setApps: (apps: AppEntry[]) => void;
};

export const useCockpitStore = create<State>((set) => ({
  chain: null,
  gitStatus: { payload: [], lore: [] },
  trees: { payload: null, lore: null },
  apps: [],
  setApps: (apps) => set({ apps }),
  setChain: (chain) => set({ chain }),
  applyGitStatus: (payload) =>
    set((state) => ({
      gitStatus: { ...state.gitStatus, [payload.scope]: payload.entries },
    })),
  setTrees: (init) => set({ trees: { payload: init.payload, lore: init.lore } }),
  applyTreeUpdate: (update) =>
    set((state) => patchTree(state.trees, update.scope, update.path, update.children)),
  expandTree: (scope, path, children) =>
    set((state) => patchTree(state.trees, scope, path, children)),
}));

/** Return a new `trees` with the node at `path` on `scope` given fresh `children`. */
function patchTree(
  trees: Trees,
  scope: GitStatusScope,
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
