import type { TreeNode } from '@ai-lore-companion/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RootTreeEntry } from '../../../../shared/ipc/space/root-tree.types.js';
import type { RootFileEventsPayload } from '../../../../shared/ipc/space/roots.types.js';
import type { RootSummary } from './filesTypes.js';

/**
 * The tree of one root. The tree works in absolute paths, as the v0.8
 * `FileTree` does (a row's path is its key and what Reveal in Finder opens);
 * the channel works in paths relative to the root.
 */
export type RootTreeState = {
  /** The root's folder as a node; a folder whose `children` is undefined is not loaded yet. */
  node: TreeNode;
  /** Absolute paths of the expanded folders. The root's folder is expanded from the start. */
  expanded: Set<string>;
  /** The absolute path of the selected row, or `null`. */
  selected: string | null;
  /** Why the last listing failed, or `null`. */
  error: string | null;
  /** The loaded folders that hold more entries than main sends, by absolute path: how many they hold, and how many are shown. */
  truncated: Record<string, { total: number; limit: number }>;
};

/** The absolute path of `rel` inside the root folder `rootPath`. */
export function absOf(rootPath: string, rel: string): string {
  return rel === '' ? rootPath : `${rootPath}/${rel}`;
}

/** The path of `abs` relative to the root folder `rootPath`, or `null` when it is outside. */
export function relOf(rootPath: string, abs: string): string | null {
  if (abs === rootPath) return '';
  return abs.startsWith(`${rootPath}/`) ? abs.slice(rootPath.length + 1) : null;
}

/** The folder that holds `rel`: `''` for a child of the root's folder. */
function parentOf(rel: string): string {
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? '' : rel.slice(0, cut);
}

/** The node at `abs`, or `null`. */
function findNode(node: TreeNode, abs: string): TreeNode | null {
  if (node.path === abs) return node;
  if (!abs.startsWith(`${node.path}/`)) return null;
  for (const child of node.children ?? []) {
    const found = findNode(child, abs);
    if (found) return found;
  }
  return null;
}

/**
 * The tree with the folder at `abs` given `entries` as its children. A child
 * folder that was loaded before keeps its own children, so that reading a
 * folder again does not close the folders open under it.
 */
function withChildren(
  node: TreeNode,
  abs: string,
  rootPath: string,
  entries: RootTreeEntry[],
): TreeNode {
  if (node.path === abs) {
    const before = new Map((node.children ?? []).map((child) => [child.path, child]));
    const children = entries.map((entry): TreeNode => {
      const path = absOf(rootPath, entry.path);
      const old = before.get(path);
      if (old && old.isDir === entry.isDir) return old;
      return { name: entry.name, path, isDir: entry.isDir };
    });
    return { ...node, children };
  }
  if (!abs.startsWith(`${node.path}/`) || !node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => withChildren(child, abs, rootPath, entries)),
  };
}

/** The absolute paths of every loaded folder under `node`, itself included. */
function loadedFolders(node: TreeNode, out: string[] = []): string[] {
  if (node.isDir && node.children) {
    out.push(node.path);
    for (const child of node.children) loadedFolders(child, out);
  }
  return out;
}

function freshState(summary: RootSummary): RootTreeState {
  return {
    node: { name: summary.root.name, path: summary.root.path, isDir: true },
    expanded: new Set([summary.root.path]),
    selected: null,
    error: null,
    truncated: {},
  };
}

/**
 * The trees of the roots, one per root, loaded a level at a time through
 * `spaceRootTreeExpand` and kept while the window is open, so that going back
 * to a root's tab shows its tree as it was left. File events from main read
 * again the folders they touch that are loaded.
 */
export function useRootTrees(roots: RootSummary[]) {
  const [trees, setTrees] = useState<Record<string, RootTreeState>>({});
  const treesRef = useRef(trees);
  treesRef.current = trees;
  const rootsRef = useRef(roots);
  rootsRef.current = roots;

  const summaryOf = useCallback(
    (rootId: string) => rootsRef.current.find((summary) => summary.root.id === rootId),
    [],
  );

  const update = useCallback(
    (rootId: string, change: (state: RootTreeState) => RootTreeState): void => {
      const summary = summaryOf(rootId);
      if (!summary) return;
      setTrees((previous) => {
        const current = previous[rootId];
        const base =
          current && current.node.path === summary.root.path ? current : freshState(summary);
        return { ...previous, [rootId]: change(base) };
      });
    },
    [summaryOf],
  );

  /** Read one folder of a root (`rel` relative to the root) and put its children in the tree. */
  const readFolder = useCallback(
    async (rootId: string, rel: string): Promise<void> => {
      const summary = summaryOf(rootId);
      if (!summary || summary.root.path === '') return;
      const rootPath = summary.root.path;
      const result = await window.cockpit
        .spaceRootTreeExpand({ rootId, path: rel })
        .catch((caught: unknown) => ({
          ok: false as const,
          error: { kind: 'roots-unavailable' as const, message: String(caught) },
        }));
      if (!result.ok) {
        update(rootId, (state) => ({ ...state, error: result.error.message }));
        return;
      }
      const abs = absOf(rootPath, rel);
      const { total, limit, truncated: cut } = result.value;
      update(rootId, (state) => {
        const truncated = { ...state.truncated };
        if (cut) truncated[abs] = { total, limit };
        else delete truncated[abs];
        return {
          ...state,
          error: null,
          truncated,
          node: withChildren(state.node, abs, rootPath, result.value.entries),
        };
      });
    },
    [summaryOf, update],
  );

  const inflight = useRef(new Map<string, Promise<void>>());

  /** `readFolder`, once at a time per folder: a click selects and opens a folder, and reads it once. */
  const load = useCallback(
    (rootId: string, rel: string): Promise<void> => {
      const key = `${rootId}\0${rel}`;
      const running = inflight.current.get(key);
      if (running) return running;
      const work = readFolder(rootId, rel).finally(() => inflight.current.delete(key));
      inflight.current.set(key, work);
      return work;
    },
    [readFolder],
  );

  /** The tree of a root, fresh when it was never shown. */
  const stateFor = useCallback(
    (summary: RootSummary): RootTreeState => {
      const current = trees[summary.root.id];
      return current && current.node.path === summary.root.path ? current : freshState(summary);
    },
    [trees],
  );

  /** Load the root's folder the first time the root is shown. */
  const ensure = useCallback(
    (rootId: string): void => {
      const current = treesRef.current[rootId];
      if (current?.node.children) return;
      void load(rootId, '');
    },
    [load],
  );

  const select = useCallback(
    (rootId: string, abs: string): void => {
      update(rootId, (state) => ({ ...state, selected: abs }));
    },
    [update],
  );

  /** Select a folder, and read it when it is not loaded (the v0.8 tree's signal to load). */
  const selectFolder = useCallback(
    (rootId: string, abs: string): void => {
      select(rootId, abs);
      const summary = summaryOf(rootId);
      const state = treesRef.current[rootId];
      if (!summary) return;
      const rel = relOf(summary.root.path, abs);
      const node = state ? findNode(state.node, abs) : null;
      if (rel !== null && !node?.children) void load(rootId, rel);
    },
    [select, summaryOf, load],
  );

  /** Open or close a folder; a folder opened for the first time is read. */
  const toggle = useCallback(
    (rootId: string, abs: string): void => {
      update(rootId, (state) => {
        const expanded = new Set(state.expanded);
        if (expanded.has(abs)) expanded.delete(abs);
        else expanded.add(abs);
        return { ...state, expanded };
      });
      const summary = summaryOf(rootId);
      const state = treesRef.current[rootId];
      if (!summary) return;
      const rel = relOf(summary.root.path, abs);
      const node = state ? findNode(state.node, abs) : null;
      if (rel !== null && !node?.children) void load(rootId, rel);
    },
    [update, summaryOf, load],
  );

  /** Open every folder above a file of a root, reading each one, and select the file. */
  const reveal = useCallback(
    async (rootId: string, rel: string): Promise<void> => {
      const summary = summaryOf(rootId);
      if (!summary) return;
      const rootPath = summary.root.path;
      const segments = rel.split('/').filter((segment) => segment !== '');
      const folders = [''];
      for (let i = 1; i < segments.length; i++) folders.push(segments.slice(0, i).join('/'));
      for (const folder of folders) {
        const node = treesRef.current[rootId]
          ? findNode(treesRef.current[rootId].node, absOf(rootPath, folder))
          : null;
        if (!node?.children) await load(rootId, folder);
      }
      update(rootId, (state) => {
        const expanded = new Set(state.expanded);
        for (const folder of folders) expanded.add(absOf(rootPath, folder));
        return { ...state, expanded, selected: absOf(rootPath, segments.join('/')) };
      });
    },
    [summaryOf, load, update],
  );

  // Files and folders that came or went: read again the loaded folders that hold them.
  useEffect(() => {
    return window.cockpit.onSpaceRootFileEvents((payload: RootFileEventsPayload) => {
      const summary = summaryOf(payload.rootId);
      const state = treesRef.current[payload.rootId];
      if (!summary || !state?.node.children) return;
      const rootPath = summary.root.path;
      const folders = new Set<string>();
      if (payload.overflow) {
        for (const abs of loadedFolders(state.node)) {
          const rel = relOf(rootPath, abs);
          if (rel !== null) folders.add(rel);
        }
      } else {
        for (const entry of payload.events) {
          if (entry.event === 'change') continue;
          const parent = parentOf(entry.path);
          const node = findNode(state.node, absOf(rootPath, parent));
          if (node?.children) folders.add(parent);
        }
      }
      for (const folder of folders) void load(payload.rootId, folder);
    });
  }, [summaryOf, load]);

  return { stateFor, ensure, select, selectFolder, toggle, reveal };
}
