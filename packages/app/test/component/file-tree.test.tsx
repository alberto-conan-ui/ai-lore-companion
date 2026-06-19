import type { TreeNode } from '@ai-lore-companion/core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileTree } from '../../src/renderer/src/components/FileTree.js';

// jsdom has neither ResizeObserver nor real layout. Give the tree a no-op
// observer and a fixed viewport height so its windowing math has something to
// window against — without these the component throws on mount and every row
// would have nowhere to clamp to.
beforeAll(() => {
  // @ts-expect-error — minimal polyfill for the windowing effect.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 440, // ~20 rows at ROW_HEIGHT=22
  });
});

afterEach(cleanup);

/** A root folder with `count` collapsed child folders — all visible at once
 *  because the root is expanded, so the flattened list is `1 + count` rows. */
function wideTree(count: number): TreeNode {
  const children: TreeNode[] = [];
  for (let i = 0; i < count; i++) {
    children.push({ name: `d${i}`, path: `/r/d${i}`, isDir: true, children: [] });
  }
  return { name: 'r', path: '/r', isDir: true, children };
}

describe('FileTree virtualization', () => {
  const noop = (): void => {};

  it('mounts the selectable root row', () => {
    const root = wideTree(10);
    const { getByTestId } = render(
      <FileTree
        root={root}
        selectedPath={null}
        onSelectFolder={noop}
        expandedPaths={new Set([root.path])}
        onToggleExpand={noop}
        driftLevelFor={() => 'idle'}
      />,
    );
    expect(getByTestId('tree-root')).toBeTruthy();
  });

  it('renders a bounded number of rows for a huge expanded tree', () => {
    const root = wideTree(2000);
    const { container } = render(
      <FileTree
        root={root}
        selectedPath={null}
        onSelectFolder={noop}
        expandedPaths={new Set([root.path])}
        onToggleExpand={noop}
        driftLevelFor={() => 'idle'}
        onContextMenu={noop}
      />,
    );
    // Row buttons carry `.row-kebab-host`; the nested ↗ / kebab buttons do not.
    const rows = container.querySelectorAll('button.row-kebab-host');
    // 2000+ visible nodes, but only the windowed slice (~viewport + overscan)
    // is in the DOM — the whole point of the virtualization.
    expect(rows.length).toBeLessThan(60);
    // The spacer still reserves full scroll height, so the scrollbar is honest.
    const spacer = container.querySelector('ul');
    expect(spacer?.style.height).toBe(`${(2000 + 1) * 22}px`);
  });

  it('renders files as leaf rows and opens one on double-click (unified tree)', () => {
    // A root with one folder and one file — the unified navigator tree (P2)
    // shows both; the old folder-only tree dropped the file.
    const root: TreeNode = {
      name: 'r',
      path: '/r',
      isDir: true,
      children: [
        { name: 'sub', path: '/r/sub', isDir: true, children: [] },
        { name: 'a.ts', path: '/r/a.ts', isDir: false },
      ],
    };
    const onActivateFile = vi.fn();
    const { container } = render(
      <FileTree
        root={root}
        selectedPath={null}
        onSelectFolder={noop}
        onSelectFile={noop}
        onActivateFile={onActivateFile}
        expandedPaths={new Set([root.path])}
        onToggleExpand={noop}
        driftLevelFor={() => 'idle'}
        driftKindFor={() => undefined}
      />,
    );
    const fileRow = container.querySelector<HTMLButtonElement>('[title="/r/a.ts"]');
    expect(fileRow).not.toBeNull();
    // Single click selects (no open); double-click opens in the editor.
    fireEvent.click(fileRow as HTMLButtonElement);
    expect(onActivateFile).not.toHaveBeenCalled();
    fireEvent.doubleClick(fileRow as HTMLButtonElement);
    expect(onActivateFile).toHaveBeenCalledTimes(1);
    expect(onActivateFile.mock.calls[0]?.[0]?.path).toBe('/r/a.ts');
  });

  it('does not mount rows far below the viewport', () => {
    const root = wideTree(2000);
    const { container } = render(
      <FileTree
        root={root}
        selectedPath={null}
        onSelectFolder={noop}
        expandedPaths={new Set([root.path])}
        onToggleExpand={noop}
        driftLevelFor={() => 'idle'}
      />,
    );
    // A node 1900 rows down is well outside the window at scrollTop 0.
    expect(container.querySelector('[title="/r/d1900"]')).toBeNull();
    // A node near the top is mounted.
    expect(container.querySelector('[title="/r/d0"]')).not.toBeNull();
  });
});
