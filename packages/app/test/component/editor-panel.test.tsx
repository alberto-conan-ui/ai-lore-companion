import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DocView / CodeEditor mount a CodeMirror surface for the active doc; stub the CM
// factory so the tab tests stay fast and isolated (the strip is what's under
// test here). `makeEditView` captures its opts so a test can drive a change /
// save without a real editor.
const lastEdit: {
  opts:
    | Parameters<
        typeof import('../../src/renderer/src/components/editor/codemirror.js').makeEditView
      >[0]
    | null;
  livePreviewCalls: boolean[];
} = {
  opts: null,
  livePreviewCalls: [],
};
vi.mock('../../src/renderer/src/components/editor/codemirror.js', () => {
  const view = { destroy: () => {} };
  return {
    makeDiffView: () => view,
    makeNoticeView: () => view,
    makeTripleView: () => view,
    makeTripleDiffView: () => view,
    makeEditView: (opts: { onChange: (t: string) => void; onSave: (t: string) => void }) => {
      lastEdit.opts = opts as typeof lastEdit.opts;
      lastEdit.livePreviewCalls = [];
      return {
        view,
        setTheme: () => {},
        setLivePreview: (on: boolean) => lastEdit.livePreviewCalls.push(on),
        destroy: () => {},
      };
    },
  };
});

import { EditorPanel } from '../../src/renderer/src/components/EditorPanel.js';
import { type EditorDoc, useCockpitStore } from '../../src/renderer/src/store.js';

const doc = (path: string, mode: EditorDoc['mode'] = 'code'): EditorDoc => ({
  path,
  scope: 'payload',
  name: path.slice(path.lastIndexOf('/') + 1),
  mode,
});

beforeEach(() => {
  lastEdit.opts = null;
  (window as unknown as { cockpit: Record<string, ReturnType<typeof vi.fn>> }).cockpit = {
    readFile: vi.fn().mockResolvedValue({ kind: 'text', text: 'hello' }),
    fileHistory: vi.fn().mockResolvedValue({ kind: 'ok', entries: [] }),
    fileWrite: vi.fn().mockResolvedValue({ kind: 'ok' }),
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
    editorBuffers: {},
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

describe('EditorPanel authoring (markdown authoring, P3)', () => {
  it('an edit marks the doc dirty and a Cmd-S save writes it to disk + clears dirty', async () => {
    render(<EditorPanel />);
    // The editable view is built after the async readFile resolves.
    await waitFor(() => expect(lastEdit.opts).not.toBeNull());
    // Type → the buffer diverges from disk → dirty + a dot in the tab.
    lastEdit.opts?.onChange('hello world');
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="editor-tab-a.ts"]')?.getAttribute('data-dirty'),
      ).toBe('true'),
    );
    expect(useCockpitStore.getState().editorBuffers['/p/a.ts']).toBe('hello world');

    // Save → fileWrite with the exact text, then dirty clears.
    lastEdit.opts?.onSave('hello world');
    const cockpit = (window as unknown as { cockpit: { fileWrite: ReturnType<typeof vi.fn> } })
      .cockpit;
    expect(cockpit.fileWrite).toHaveBeenCalledWith({ path: '/p/a.ts', text: 'hello world' });
    await waitFor(() => expect(useCockpitStore.getState().editorDocs[0].dirty).toBeFalsy());
    expect('/p/a.ts' in useCockpitStore.getState().editorBuffers).toBe(false);
  });

  it('an undo back to the on-disk text un-dirties the doc', async () => {
    render(<EditorPanel />);
    await waitFor(() => expect(lastEdit.opts).not.toBeNull());
    lastEdit.opts?.onChange('changed');
    await waitFor(() => expect(useCockpitStore.getState().editorDocs[0].dirty).toBe(true));
    // Back to the loaded disk text ('hello') → clean again.
    lastEdit.opts?.onChange('hello');
    await waitFor(() => expect(useCockpitStore.getState().editorDocs[0].dirty).toBeFalsy());
    expect('/p/a.ts' in useCockpitStore.getState().editorBuffers).toBe(false);
  });

  it('closing a dirty tab asks first — declining keeps it open', async () => {
    const { getByLabelText } = render(<EditorPanel />);
    await waitFor(() => expect(lastEdit.opts).not.toBeNull());
    lastEdit.opts?.onChange('dirty edit');
    await waitFor(() => expect(useCockpitStore.getState().editorDocs[0].dirty).toBe(true));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(getByLabelText('Close a.ts'));
    expect(confirmSpy).toHaveBeenCalled();
    // Declined → the doc stays open.
    expect(useCockpitStore.getState().editorDocs.some((d) => d.path === '/p/a.ts')).toBe(true);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(getByLabelText('Close a.ts'));
    expect(useCockpitStore.getState().editorDocs.some((d) => d.path === '/p/a.ts')).toBe(false);
    confirmSpy.mockRestore();
  });

  it('Code mode edits a markdown doc as raw source (live-preview off)', async () => {
    useCockpitStore.setState({
      editorDocs: [doc('/p/notes.md', 'code')],
      activeDocPath: '/p/notes.md',
      editorBuffers: {},
    });
    render(<EditorPanel />);
    await waitFor(() => expect(lastEdit.opts).not.toBeNull());
    expect((lastEdit.opts as { livePreview?: boolean }).livePreview).toBe(false);
  });

  it('Preview mode is the editable WYSIWYG (live-preview on) — the same CodeEditor', async () => {
    useCockpitStore.setState({
      editorDocs: [doc('/p/notes.md', 'preview')],
      activeDocPath: '/p/notes.md',
      editorBuffers: {},
    });
    const { getByTestId } = render(<EditorPanel />);
    await waitFor(() => expect(lastEdit.opts).not.toBeNull());
    expect((lastEdit.opts as { livePreview?: boolean }).livePreview).toBe(true);
    // It's the editable editor, not a separate read-only preview surface.
    expect(getByTestId('editor-cm-host')).toBeTruthy();
  });
});
