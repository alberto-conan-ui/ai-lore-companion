import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DocView mounts a CodeMirror surface for the active doc; stub the CM factory so
// the tab tests stay fast and isolated (the strip is what's under test here).
vi.mock('../../src/renderer/src/components/editor/codemirror.js', () => {
  const view = { destroy: () => {} };
  return {
    makeCodeView: () => view,
    makeDiffView: () => view,
    makeNoticeView: () => view,
    makeTripleView: () => view,
    makeTripleDiffView: () => view,
  };
});

import { EditorPanel } from '../../src/renderer/src/components/EditorPanel.js';
import { type EditorDoc, useCockpitStore } from '../../src/renderer/src/store.js';

const doc = (path: string): EditorDoc => ({
  path,
  scope: 'payload',
  name: path.slice(path.lastIndexOf('/') + 1),
  mode: 'code',
});

beforeEach(() => {
  (window as unknown as { cockpit: Record<string, ReturnType<typeof vi.fn>> }).cockpit = {
    readFile: vi.fn().mockResolvedValue({ kind: 'text', text: 'hello' }),
    fileHistory: vi.fn().mockResolvedValue({ kind: 'ok', entries: [] }),
    openPath: vi.fn(),
  };
  // jsdom has no scrollIntoView — the active-tab reveal calls it.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });
  useCockpitStore.setState({
    editorDocs: [doc('/p/a.ts'), doc('/p/b.ts')],
    activeDocPath: '/p/a.ts',
    chain: null,
    changes: { payload: [], lore: [] },
    savePoints: [],
    baselineByScope: { payload: 'HEAD', lore: 'HEAD' },
  });
});

afterEach(cleanup);

describe('EditorPanel tabs', () => {
  it('renders a tab per open doc and marks the active one', () => {
    const { getByTestId } = render(<EditorPanel />);
    expect(getByTestId('editor-tab-a.ts').getAttribute('data-active')).toBe('true');
    expect(getByTestId('editor-tab-b.ts').getAttribute('data-active')).toBe('false');
  });

  it('clicking a tab activates it', () => {
    const { getByTestId, getByTitle } = render(<EditorPanel />);
    fireEvent.click(getByTitle('/p/b.ts'));
    expect(getByTestId('editor-tab-b.ts').getAttribute('data-active')).toBe('true');
    expect(useCockpitStore.getState().activeDocPath).toBe('/p/b.ts');
  });

  it('the × button closes a tab', () => {
    const { getByLabelText } = render(<EditorPanel />);
    fireEvent.click(getByLabelText('Close b.ts'));
    expect(useCockpitStore.getState().editorDocs.map((d) => d.path)).toEqual(['/p/a.ts']);
  });

  it('middle-click closes a tab (IDE convention)', () => {
    const { getByTestId } = render(<EditorPanel />);
    fireEvent(
      getByTestId('editor-tab-b.ts'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(useCockpitStore.getState().editorDocs.map((d) => d.path)).toEqual(['/p/a.ts']);
  });
});
