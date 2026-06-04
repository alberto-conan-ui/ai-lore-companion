import type { TreeNode } from '@ai-lore-companion/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { findTreeNode, useCockpitStore } from '../../src/renderer/src/store.js';

/**
 * Regression — "panel contents disappear under heavy file changes, reappear on
 * close/open".
 *
 * The tree is held one level deep; deeper folders load lazily via `expandTree`.
 * The file watcher reacts to a change by re-reading the *parent directory* one
 * level deep and pushing it through `applyTreeUpdate` → `patchTree` →
 * `replaceChildren`. That re-read must MERGE — a surviving sub-folder keeps its
 * already-loaded contents — rather than replacing wholesale, which used to drop
 * every open sub-folder back to unloaded (rendered empty until re-open).
 */

const dir = (path: string, children?: TreeNode[]): TreeNode => ({
  name: path.split('/').pop() ?? path,
  path,
  isDir: true,
  ...(children ? { children } : {}),
});
const file = (path: string): TreeNode => ({
  name: path.split('/').pop() ?? path,
  path,
  isDir: false,
});

beforeEach(() => {
  useCockpitStore.getState().setTrees({
    payload: dir('/p', [dir('/p/a')]),
    lore: dir('/l', []),
  });
});

describe('a watcher re-read preserves lazily-loaded descendants', () => {
  it('a change at root keeps the loaded contents of an open sub-folder', () => {
    const store = useCockpitStore.getState();

    // User drilled into /p/a, then into /p/a/b — both now loaded in the store.
    store.expandTree('payload', '/p/a', [dir('/p/a/b'), file('/p/a/x.txt')]);
    store.expandTree('payload', '/p/a/b', [file('/p/a/b/y.txt')]);

    // A file is added at the ROOT. The watcher re-reads root one level deep —
    // /p/a comes back UNLOADED in that fresh read.
    store.applyTreeUpdate({
      scope: 'payload',
      path: '/p',
      children: [dir('/p/a'), file('/p/new.txt')],
    });

    const root = useCockpitStore.getState().trees.payload;
    // The new root entry shows...
    expect(root?.children?.map((c) => c.name)).toEqual(['a', 'new.txt']);
    // ...and /p/a kept its loaded contents (and so did /p/a/b, two levels deep).
    expect(findTreeNode(root, '/p/a')?.children?.map((c) => c.name)).toEqual(['b', 'x.txt']);
    expect(findTreeNode(root, '/p/a/b')?.children?.map((c) => c.name)).toEqual(['y.txt']);
  });

  it('a change inside a folder keeps the loaded contents of its open sub-folders', () => {
    const store = useCockpitStore.getState();

    store.expandTree('payload', '/p/a', [dir('/p/a/b'), file('/p/a/x.txt')]);
    store.expandTree('payload', '/p/a/b', [file('/p/a/b/y.txt')]);

    // A file changes inside /p/a. Watcher re-reads /p/a one level.
    store.applyTreeUpdate({
      scope: 'payload',
      path: '/p/a',
      children: [dir('/p/a/b'), file('/p/a/x.txt')],
    });

    const root = useCockpitStore.getState().trees.payload;
    expect(findTreeNode(root, '/p/a/b')?.children?.map((c) => c.name)).toEqual(['y.txt']);
  });

  it('a folder removed on disk drops out of the tree', () => {
    const store = useCockpitStore.getState();
    store.expandTree('payload', '/p/a', [dir('/p/a/b'), file('/p/a/x.txt')]);

    // /p/a is gone from disk — the fresh root read no longer lists it.
    store.applyTreeUpdate({ scope: 'payload', path: '/p', children: [file('/p/new.txt')] });

    const root = useCockpitStore.getState().trees.payload;
    expect(root?.children?.map((c) => c.name)).toEqual(['new.txt']);
    expect(findTreeNode(root, '/p/a')).toBeNull();
  });
});
