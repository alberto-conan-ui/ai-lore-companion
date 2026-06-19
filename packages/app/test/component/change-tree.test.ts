import type { TreeNode } from '@ai-lore-companion/core';
import { expect, test } from 'vitest';
import { buildChangeTree } from '../../src/renderer/src/store.js';

/** buildChangeTree (Read-only IDE P2) prunes a flat changed-file list into the
 *  tree the Changes panel renders through the shared FileTree engine. Folders
 *  carry real on-disk paths so the navigator's drift/menu machinery applies. */

const file = (absPath: string): { absPath: string } => ({ absPath });

/** Find a node by path anywhere in a built tree. */
function find(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, path);
    if (hit) return hit;
  }
  return null;
}

test('roots at a real path and hangs files off their real ancestor folders', () => {
  const root = buildChangeTree(
    '/proj/memory',
    'memory',
    ['/proj/memory'],
    [file('/proj/memory/blueprint/contracts/a.md'), file('/proj/memory/blueprint/b.md')],
  );
  expect(root.path).toBe('/proj/memory');
  // The shared ancestor folder is synthesized once, with its real path.
  const blueprint = find(root, '/proj/memory/blueprint');
  expect(blueprint?.isDir).toBe(true);
  const contracts = find(root, '/proj/memory/blueprint/contracts');
  expect(contracts?.isDir).toBe(true);
  // Both leaves present, as non-dir leaves keyed by absolute path.
  expect(find(root, '/proj/memory/blueprint/contracts/a.md')?.isDir).toBe(false);
  expect(find(root, '/proj/memory/blueprint/b.md')?.isDir).toBe(false);
});

test('children sort dirs-first then alphabetically (matches readDirectory)', () => {
  const root = buildChangeTree(
    '/r',
    'r',
    ['/r'],
    [file('/r/z.md'), file('/r/a.md'), file('/r/sub/x.md')],
  );
  expect((root.children ?? []).map((c) => c.name)).toEqual(['sub', 'a.md', 'z.md']);
});

test('a synthetic group root nests each base folder beneath it', () => {
  const root = buildChangeTree(
    'synthetic:status',
    'Status',
    ['/proj/memory/status', '/proj/memory/action-tree'],
    [file('/proj/memory/status/s.md'), file('/proj/memory/action-tree/at.md')],
  );
  expect(root.path).toBe('synthetic:status');
  expect(find(root, '/proj/memory/status')?.isDir).toBe(true);
  expect(find(root, '/proj/memory/action-tree')?.isDir).toBe(true);
  expect(find(root, '/proj/memory/status/s.md')?.isDir).toBe(false);
});

test('drops files that fall under no base (out of this pane’s scope)', () => {
  const root = buildChangeTree('/r', 'r', ['/r'], [file('/r/keep.md'), file('/elsewhere/drop.md')]);
  expect(find(root, '/elsewhere/drop.md')).toBeNull();
  expect(find(root, '/r/keep.md')).not.toBeNull();
});
