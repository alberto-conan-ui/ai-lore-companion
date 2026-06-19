import type { AppEntry, ChangeEntry, ChangeScope, TreeNode } from '@ai-lore-companion/core';
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

/** Basename of a `/`-separated path (the segment after the last slash). */
function baseName(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/** Sort a built tree's children dirs-first then alphabetically, in place —
 *  matching the navigator's `readDirectory` order so the two trees read
 *  identically. */
function sortTreeChildren(node: TreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTreeChildren(child);
}

/**
 * Build a pruned `TreeNode` tree from a set of changed files, for the Changes
 * panel (Read-only IDE P2 — the changes view shares the navigator's tree
 * *engine*: same `FileTree`, same rows, drift dots, context menu). Only the
 * changed files and their ancestor folders appear; every folder carries its
 * real on-disk path, so the shared drift/menu machinery (`driftLevelFor`,
 * Reveal, Ignore) behaves exactly as in the navigator.
 *
 * `bases` are the real directories the pane covers — one for a `path` sub-root,
 * several for a synthetic group; each file's absolute path descends from one of
 * them. The tree roots at `rootId`/`rootName` (the rendered root — a real path,
 * or a synthetic id) with the base folders nested beneath it (or, when the pane
 * is rooted at a single real path, files hang directly off the root).
 */
export function buildChangeTree(
  rootId: string,
  rootName: string,
  bases: readonly string[],
  files: readonly { absPath: string }[],
): TreeNode {
  const root: TreeNode = { name: rootName, path: rootId, isDir: true, children: [] };
  const folders = new Map<string, TreeNode>([[rootId, root]]);

  /** Get or create the folder node at `path`, attaching it under `parent`. */
  const folderAt = (path: string, name: string, parent: TreeNode): TreeNode => {
    let node = folders.get(path);
    if (!node) {
      node = { name, path, isDir: true, children: [] };
      folders.set(path, node);
      (parent.children as TreeNode[]).push(node);
    }
    return node;
  };

  for (const { absPath } of files) {
    const base = bases.find((b) => absPath === b || absPath.startsWith(`${b}/`));
    if (!base) continue;
    // The base folder sits directly under the root, or *is* the root when the
    // pane is rooted at a single real path.
    let parent = base === rootId ? root : folderAt(base, baseName(base), root);
    const segs = absPath.slice(base.length + 1).split('/');
    let cur = base;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = `${cur}/${segs[i]}`;
      parent = folderAt(cur, segs[i] as string, parent);
    }
    (parent.children as TreeNode[]).push({
      name: segs[segs.length - 1] as string,
      path: absPath,
      isDir: false,
    });
  }

  sortTreeChildren(root);
  return root;
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

/** How an open editor doc is being viewed — its file content, a diff against the
 *  selected save-point/ack (Read-only IDE P1/P3), or a rendered markdown preview
 *  (markdown files only). */
export type EditorMode = 'code' | 'diff' | 'preview';

/**
 * One file open in the in-app editor (Read-only IDE). The app is read-only — a
 * doc is *viewed*, never edited to disk. Keyed by its absolute `path`; `scope`
 * resolves its baseline for the diff view.
 */
export type EditorDoc = {
  /** Absolute path — also the doc's stable id. */
  path: string;
  scope: ChangeScope;
  /** Basename, shown on the editor tab. */
  name: string;
  mode: EditorMode;
  /** Rename/copy source (project-relative or absolute) for the diff baseline. */
  oldPath?: string;
  /**
   * A per-file diff baseline override (a commit SHA), set by clicking an entry
   * in the diff's history column. When set, this file's diff compares against
   * this commit instead of the global baseline picker — only for this file.
   * `undefined` follows the global baseline.
   */
  diffBaseline?: string;
};

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
  /**
   * Files open in the in-app editor (Read-only IDE). The left panel splits into
   * nav | editor whenever this is non-empty, and collapses back when it empties.
   */
  editorDocs: EditorDoc[];
  /** The active editor doc's path, or `null` when none are open. */
  activeDocPath: string | null;
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
  /** Open a file in the editor (or refocus + re-mode it if already open). */
  openDoc: (doc: EditorDoc) => void;
  /** Close an open doc; focus shifts to a neighbour, or clears when none remain. */
  closeDoc: (path: string) => void;
  /** Focus an already-open doc. */
  setActiveDoc: (path: string) => void;
  /** Replace the open docs wholesale — used to restore the editor on launch from
   *  the persisted layout ("start always opened"). */
  restoreDocs: (docs: EditorDoc[], activePath: string | null) => void;
  /** Flip an open doc between content and diff. */
  setDocMode: (path: string, mode: EditorMode) => void;
  /** Pin an open doc's diff to a specific commit (from its history column), or
   *  `null` to follow the global baseline picker again. */
  setDocDiffBaseline: (path: string, baseline: string | null) => void;
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
  editorDocs: [],
  activeDocPath: null,
  setApps: (apps) => set({ apps }),
  setShowIndexFiles: (value) => set({ showIndexFiles: value }),
  openDoc: (doc) =>
    set((state) => {
      const idx = state.editorDocs.findIndex((d) => d.path === doc.path);
      if (idx === -1) {
        return { editorDocs: [...state.editorDocs, doc], activeDocPath: doc.path };
      }
      // Re-opening: the entry point (nav → code, changes → diff) sets the mode,
      // and the rename source refreshes; everything else stays.
      const next = [...state.editorDocs];
      next[idx] = { ...next[idx], mode: doc.mode, oldPath: doc.oldPath ?? next[idx].oldPath };
      return { editorDocs: next, activeDocPath: doc.path };
    }),
  closeDoc: (path) =>
    set((state) => {
      const idx = state.editorDocs.findIndex((d) => d.path === path);
      if (idx === -1) return {};
      const next = state.editorDocs.filter((d) => d.path !== path);
      let activeDocPath = state.activeDocPath;
      if (activeDocPath === path) {
        // Focus the previous tab, else the one that slid into this slot, else none.
        activeDocPath = (next[idx - 1] ?? next[idx])?.path ?? null;
      }
      return { editorDocs: next, activeDocPath };
    }),
  setActiveDoc: (path) => set({ activeDocPath: path }),
  restoreDocs: (docs, activePath) =>
    set({
      editorDocs: docs,
      // Keep the active pointer only if it names a restored doc; else fall back
      // to the first, or null when nothing was restored.
      activeDocPath: docs.some((d) => d.path === activePath) ? activePath : (docs[0]?.path ?? null),
    }),
  setDocMode: (path, mode) =>
    set((state) => ({
      editorDocs: state.editorDocs.map((d) => (d.path === path ? { ...d, mode } : d)),
    })),
  setDocDiffBaseline: (path, baseline) =>
    set((state) => ({
      editorDocs: state.editorDocs.map((d) =>
        d.path === path ? { ...d, diffBaseline: baseline ?? undefined } : d,
      ),
    })),
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
  if (node.path === path) return { ...node, children: mergeChildren(node.children, children) };
  if (!node.children) return node;
  let changed = false;
  const next = node.children.map((child) => {
    const updated = replaceChildren(child, path, children);
    if (updated !== child) changed = true;
    return updated;
  });
  return changed ? { ...node, children: next } : node;
}

/**
 * Merge a watcher's fresh one-level read with the previously-loaded children,
 * carrying over the loaded subtree of any folder that still exists.
 *
 * A re-read only knows a directory's *immediate* entries — sub-folders come
 * back `children: undefined`. Replacing wholesale would collapse every open
 * sub-folder back to unloaded, so the grid renders them empty until the pane is
 * re-opened. That is wrong: a change inside a sub-folder fires its *own* watcher
 * event, so the parent re-read has no business discarding deeper loaded state.
 * New entries appear unloaded; removed entries drop; surviving folders keep the
 * subtree they had, with their own metadata refreshed from the fresh read.
 */
function mergeChildren(prev: TreeNode[] | undefined, fresh: TreeNode[]): TreeNode[] {
  if (!prev || prev.length === 0) return fresh;
  const prevByPath = new Map(prev.map((c) => [c.path, c]));
  return fresh.map((f) => {
    if (!f.isDir || f.children !== undefined) return f;
    const old = prevByPath.get(f.path);
    return old?.isDir && old.children !== undefined ? { ...f, children: old.children } : f;
  });
}
