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
  SavePointInfo,
  SavePointsPayload,
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

/** Depth-first search for the node at `path` within `root`. Kept for searches
 *  scoped to a *subtree* (e.g. a synthetic sub-root whose own `path` is a
 *  non-filesystem id) where the scope-wide path index does not apply. For
 *  whole-scope lookups by absolute path, prefer the O(1) `treeIndex` (Focus 5). */
export function findTreeNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const found = findTreeNode(child, path);
    if (found) return found;
  }
  return null;
}

/** Build a `path → node` index for O(1) whole-scope lookups, replacing the
 *  O(n) `findTreeNode` DFS on the hot path (Focus 5 — Reactive Store At Scale).
 *  Rebuilt when a scope's tree changes; one O(n) build amortises across the many
 *  per-render lookups between updates. */
export function indexTree(root: TreeNode | null): Map<string, TreeNode> {
  const index = new Map<string, TreeNode>();
  const walk = (node: TreeNode): void => {
    index.set(node.path, node);
    for (const child of node.children ?? []) walk(child);
  };
  if (root) walk(root);
  return index;
}

/** A path → node index per scope, mirroring `trees`. */
export type TreeIndex = {
  payload: Map<string, TreeNode>;
  lore: Map<string, TreeNode>;
  publish: Map<string, TreeNode>;
};

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
  /**
   * The save-point ledger — both repos paired per entry. The global baseline
   * picker (beside the pinned tabs) builds its milestone list from this plus
   * `commitListByScope`. Pushed by main via `onSavePoints`. Newest first.
   */
  savePoints: SavePointInfo[];
  trees: Trees;
  /** O(1) path → node lookup per scope, kept in sync with `trees` (Focus 5). */
  treeIndex: TreeIndex;
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
  applySavePoints: (payload: SavePointsPayload) => void;
  setTrees: (init: TreeInitPayload) => void;
  applyTreeUpdate: (update: TreeUpdatePayload) => void;
  expandTree: (scope: PaneScope, path: string, children: TreeNode[]) => void;
  setApps: (apps: AppEntry[]) => void;
  setShowIndexFiles: (value: boolean) => void;
};

export const useCockpitStore = create<State>((set) => ({
  chain: null,
  changes: { payload: [], lore: [] },
  baselineByScope: { payload: 'HEAD', lore: 'HEAD' },
  commitListByScope: { payload: [], lore: [] },
  savePoints: [],
  trees: { payload: null, lore: null, publish: null },
  treeIndex: { payload: new Map(), lore: new Map(), publish: new Map() },
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
  applySavePoints: (payload) => set({ savePoints: payload.savePoints }),
  setTrees: (init) => {
    // Publishing-shape projects carry a third tree; default-shape inits omit
    // the field and the publish slot stays null.
    const publish = init.publish ?? null;
    return set({
      trees: { payload: init.payload, lore: init.lore, publish },
      treeIndex: {
        payload: indexTree(init.payload),
        lore: indexTree(init.lore),
        publish: indexTree(publish),
      },
    });
  },
  applyTreeUpdate: (update) =>
    set((state) => patchTree(state, update.scope, update.path, update.children)),
  expandTree: (scope, path, children) => set((state) => patchTree(state, scope, path, children)),
}));

/** Replace the node at `path` on `scope` with fresh `children`, and rebuild that
 *  scope's path index to match. Returns the partial state to `set`. */
function patchTree(
  state: State,
  scope: PaneScope,
  path: string,
  children: TreeNode[],
): Partial<State> {
  const side = state.trees[scope];
  if (!side) return {};
  const nextSide = replaceChildren(side, path, children);
  return {
    trees: { ...state.trees, [scope]: nextSide },
    treeIndex: { ...state.treeIndex, [scope]: indexTree(nextSide) },
  };
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
