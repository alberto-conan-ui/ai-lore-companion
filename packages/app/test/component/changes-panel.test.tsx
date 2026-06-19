import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChangesPanel, type DriftRow } from '../../src/renderer/src/components/ChangesPanel.js';

// jsdom lacks ResizeObserver and real layout; the shared FileTree's windowing
// needs both. Mirror the file-tree test's polyfills.
beforeAll(() => {
  // @ts-expect-error — minimal polyfill for the windowing effect.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 440,
  });
});

afterEach(cleanup);

const row = (relPath: string, code = 'M'): DriftRow => ({
  code,
  path: relPath,
  projectRelPath: relPath,
  absPath: `/proj/${relPath}`,
});

function renderPanel(
  entries: DriftRow[],
  overrides: Partial<Parameters<typeof ChangesPanel>[0]> = {},
) {
  const onSelectFile = vi.fn();
  const onActivateFile = vi.fn();
  const onContextMenu = vi.fn();
  const utils = render(
    <ChangesPanel
      label="Payload"
      rootId="/proj"
      rootName="proj"
      bases={['/proj']}
      entries={entries}
      driftLevelFor={() => 'idle'}
      driftKindFor={() => 'change'}
      onSelectFile={onSelectFile}
      onActivateFile={onActivateFile}
      onContextMenu={onContextMenu}
      {...overrides}
    />,
  );
  return { ...utils, onSelectFile, onActivateFile, onContextMenu };
}

describe('ChangesPanel (shared FileTree engine)', () => {
  it('renders changed files as a tree, default-expanded', () => {
    const { container } = renderPanel([row('src/a.ts'), row('src/b.ts')]);
    // The ancestor folder and both leaves are visible without expanding.
    expect(container.querySelector('[title="/proj/src"]')).not.toBeNull();
    expect(container.querySelector('[title="/proj/src/a.ts"]')).not.toBeNull();
    expect(container.querySelector('[title="/proj/src/b.ts"]')).not.toBeNull();
  });

  it('single-click reveals; double-click opens the diff', () => {
    const { container, onSelectFile, onActivateFile } = renderPanel([row('src/a.ts')]);
    const fileRow = container.querySelector<HTMLButtonElement>('[title="/proj/src/a.ts"]');
    expect(fileRow).not.toBeNull();
    fireEvent.click(fileRow as HTMLButtonElement);
    expect(onSelectFile).toHaveBeenCalledWith('/proj/src/a.ts');
    expect(onActivateFile).not.toHaveBeenCalled();
    fireEvent.doubleClick(fileRow as HTMLButtonElement);
    expect(onActivateFile).toHaveBeenCalledWith('/proj/src/a.ts');
  });

  it('shows the empty state when there are no changes', () => {
    const { getByText, queryByTestId } = renderPanel([]);
    expect(getByText('No changes.')).toBeTruthy();
    expect(queryByTestId('tree-root')).toBeNull();
  });

  it('search filters the tree to matching paths', () => {
    const { container, getByTestId } = renderPanel([row('src/keep.ts'), row('docs/drop.md')]);
    expect(container.querySelector('[title="/proj/src/keep.ts"]')).not.toBeNull();
    fireEvent.change(getByTestId('changes-search-payload'), { target: { value: 'keep' } });
    expect(container.querySelector('[title="/proj/src/keep.ts"]')).not.toBeNull();
    expect(container.querySelector('[title="/proj/docs/drop.md"]')).toBeNull();
  });
});
