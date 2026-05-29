import type { TreeNode } from '@ai-lore-companion/core';
import { describe, expect, it } from 'vitest';
import { findTreeNode, indexTree } from '../../src/renderer/src/store.js';

/** A deterministic balanced tree of `~breadth^depth` directory nodes, each leaf
 *  level carrying a couple of files — enough to make the O(n) DFS visibly slow. */
function buildTree(breadth: number, depth: number, prefix = '/r'): TreeNode {
  const children: TreeNode[] = [];
  if (depth > 0) {
    for (let i = 0; i < breadth; i++) {
      children.push(buildTree(breadth, depth - 1, `${prefix}/d${i}`));
    }
  } else {
    for (let i = 0; i < 2; i++) {
      children.push({ name: `f${i}.ts`, path: `${prefix}/f${i}.ts`, isDir: false });
    }
  }
  return { name: prefix.split('/').pop() ?? 'r', path: prefix, isDir: true, children };
}

function countNodes(root: TreeNode): number {
  let n = 1;
  for (const c of root.children ?? []) n += countNodes(c);
  return n;
}

describe('indexTree', () => {
  it('indexes every node by its path', () => {
    const root = buildTree(3, 3);
    const index = indexTree(root);
    expect(index.size).toBe(countNodes(root));
    expect(index.get(root.path)).toBe(root);
    // A deep leaf is reachable directly.
    expect(index.get('/r/d0/d0/d0/f0.ts')?.name).toBe('f0.ts');
  });

  it('is empty for a null tree', () => {
    expect(indexTree(null).size).toBe(0);
  });

  it('returns the same node the DFS would, for every path', () => {
    const root = buildTree(3, 3);
    const index = indexTree(root);
    for (const path of index.keys()) {
      expect(index.get(path)).toBe(findTreeNode(root, path));
    }
    // A path that doesn't exist: both miss.
    expect(index.get('/nope')).toBeUndefined();
    expect(findTreeNode(root, '/nope')).toBeNull();
  });

  it('O(1) lookups beat the O(n) DFS on a large tree (measured)', () => {
    const root = buildTree(6, 5); // ~9.3k nodes
    const index = indexTree(root);
    const paths = [...index.keys()];
    const LOOKUPS = 2000;

    const t0 = performance.now();
    for (let i = 0; i < LOOKUPS; i++) findTreeNode(root, paths[i % paths.length] as string);
    const dfsMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < LOOKUPS; i++) index.get(paths[i % paths.length] as string);
    const indexMs = performance.now() - t1;

    // eslint-disable-next-line no-console
    console.log(
      `tree-index: ${index.size} nodes, ${LOOKUPS} lookups — DFS ${dfsMs.toFixed(1)}ms vs index ${indexMs.toFixed(2)}ms`,
    );
    // The index is dramatically faster; assert a wide margin to stay non-flaky.
    expect(indexMs).toBeLessThan(dfsMs / 10);
  });
});
