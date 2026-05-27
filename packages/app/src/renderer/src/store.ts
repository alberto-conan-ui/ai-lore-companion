import type {
  AppEntry,
  ChangeEntry,
  ChangeScope,
  TreeNode,
} from '@ai-lore-companion/core';
import { create } from 'zustand';
import type {
  ChainPayload,
  ChangesPayload,
  CommitListEntry,
  CommitListPayload,
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
 * The high-level kind of change a porcelain / name-status code represents.
 * Used by the file grid + changes list to pick a glyph and colour without
 * exposing every git edge case (renames, copies, conflicts).
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

/** The changes snapshot, kept per repo. */
export type ChangesState = {
  payload: ChangeEntry[];
  lore: ChangeEntry[];
};

/** Return one side of the changes snapshot. */
export function entriesByScope(changes: ChangesState, scope: ChangeScope): ChangeEntry[] {
  return changes[scope];
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

type Trees = {
  payload: TreeNode | null;
  lore: TreeNode | null;
  /**
   * Publishing-shape projects (v0.8) get a third tree for `<project>/publish/`.
   * `null` when the project is default-shape — the Publish pane only exists
   * in publishing shape, so this stays `null` everywhere else.
   */
  publish: TreeNode | null;
};
/** The pane subjects v0.8 introduces — extends `ChangeScope` (`payload` /
 *  `lore`) with `publish` for the view-only Publish pane. The Pane reads its
 *  tree from `trees[scope]` using this union; the changes tracker never
 *  emits a `publish` scope. */
export type PaneScope = ChangeScope | 'publish';

type State = {
  chain: ChainPayload | null;
  /**
   * Live changes snapshots for both repos, against each scope's current
   * baseline. Pushed by main via [`IPC.Changes`](../../shared/ipc.ts) —
   * v0.6 Phase B's git-as-truth model.
   */
  changes: ChangesState;
  /**
   * The current baseline per scope — `HEAD` by default, or a commit SHA the
   * user picked from the Changes-panel dropdown. Drives what the Changes
   * snapshot is compared against.
   */
  baselineByScope: { payload: string; lore: string };
  /**
   * Recent commits per repo with save-point badges, for the baseline
   * dropdown. Pushed by main via [`IPC.CommitList`](../../shared/ipc.ts)
   * on launch and on every changes-tracker tick.
   */
  commitListByScope: { payload: CommitListEntry[]; lore: CommitListEntry[] };
  trees: Trees;
  /**
   * The Apps catalog — what *Open with…* menus offer. Mirrors the snapshot's
   * `global.apps`. Populated via `settingsGet` on launch and refreshed by the
   * `onSettingsChanged` subscription.
   */
  apps: AppEntry[];
  /**
   * Whether AI-Lore index files (`<name>.index.md`) are shown in the Changes
   * panel. Off by default — they churn every time Memory is reshaped and
   * dominate the panel when on. Toggle from any Changes-panel header. Global
   * across panes so a single click reveals or hides them everywhere.
   */
  showIndexFiles: boolean;
  setChain: (chain: ChainPayload) => void;
  applyChanges: (payload: ChangesPayload) => void;
  setBaseline: (scope: ChangeScope, baseline: string) => void;
  applyCommitList: (payload: CommitListPayload) => void;
  setTrees: (init: TreeInitPayload) => void;
  applyTreeUpdate: (update: TreeUpdatePayload) => void;
  expandTree: (scope: ChangeScope, path: string, children: TreeNode[]) => void;
  setApps: (apps: AppEntry[]) => void;
  setShowIndexFiles: (value: boolean) => void;
};

export const useCockpitStore = create<State>((set) => ({
  chain: null,
  changes: { payload: [], lore: [] },
  baselineByScope: { payload: 'HEAD', lore: 'HEAD' },
  commitListByScope: { payload: [], lore: [] },
  trees: { payload: null, lore: null, publish: null },
  apps: [],
  showIndexFiles: false,
  setApps: (apps) => set({ apps }),
  setShowIndexFiles: (value) => set({ showIndexFiles: value }),
  setChain: (chain) => set({ chain }),
  applyChanges: (payload) =>
    set((state) => ({
      changes: { ...state.changes, [payload.scope]: payload.entries },
      // Mirror the main-side baseline so the dropdown reflects the seeded
      // default (latest save-point) on first paint, and stays in sync after
      // any tracker-driven re-read.
      baselineByScope: { ...state.baselineByScope, [payload.scope]: payload.baseline },
    })),
  setBaseline: (scope, baseline) =>
    set((state) => ({
      baselineByScope: { ...state.baselineByScope, [scope]: baseline },
    })),
  applyCommitList: (payload) =>
    set((state) => ({
      commitListByScope: { ...state.commitListByScope, [payload.scope]: payload.commits },
    })),
  setTrees: (init) =>
    set({
      trees: {
        payload: init.payload,
        lore: init.lore,
        // Publishing-shape projects carry a third tree; default-shape inits
        // omit the field and the publish slot stays null.
        publish: init.publish ?? null,
      },
    }),
  applyTreeUpdate: (update) =>
    set((state) => patchTree(state.trees, update.scope, update.path, update.children)),
  expandTree: (scope, path, children) =>
    set((state) => patchTree(state.trees, scope, path, children)),
}));

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
