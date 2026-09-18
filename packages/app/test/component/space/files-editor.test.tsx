import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The editor of the Files window, phase M5.5: documents as tabs by root and path, Code
// and Preview on the working-tree file, Diff against the root's baseline or a pinned
// point without moving the root's baseline, the file's history, files that are not
// text said literally, unsaved changes guarded, and the state M5.7 restores.

type EditOpts = {
  text: string;
  livePreview?: boolean;
  onChange: (text: string) => void;
  onSave: (text: string) => void;
};
const cm = vi.hoisted(() => ({
  edits: [] as EditOpts[],
  diffs: [] as { before: string; after: string }[],
  codes: [] as string[],
  livePreview: [] as boolean[],
}));

vi.mock('../../../src/renderer/src/components/editor/codemirror.js', () => {
  const view = { destroy: () => {} };
  return {
    makeDiffView: (_el: HTMLElement, _name: string, before: string, after: string) => {
      cm.diffs.push({ before, after });
      return view;
    },
    makeCodeView: (_el: HTMLElement, _name: string, text: string) => {
      cm.codes.push(text);
      return view;
    },
    makeNoticeView: (el: HTMLElement, message: string) => {
      const p = document.createElement('p');
      p.textContent = message;
      p.setAttribute('data-testid', 'cm-notice');
      el.appendChild(p);
      return { destroy: () => p.remove() };
    },
    makeEditView: (opts: EditOpts) => {
      cm.edits.push(opts);
      return {
        view,
        setTheme: () => {},
        setLivePreview: (on: boolean) => cm.livePreview.push(on),
        destroy: () => {},
      };
    },
  };
});

import { FilesEditor } from '../../../src/renderer/src/space/files/FilesEditor.js';
import type { FilesEditorState } from '../../../src/renderer/src/space/files/filesEditorModel.js';
import type {
  FilesOpenRequest,
  RootSummary,
  SpaceSummary,
} from '../../../src/renderer/src/space/files/filesTypes.js';
import type {
  BaselinePoint,
  RootBaselinePoints,
} from '../../../src/shared/ipc/space/roots.types.js';

const HEAD = 'a'.repeat(40);
const CLOSE = 'c'.repeat(40);
const PR = 'd'.repeat(40);
const OLD = 'e'.repeat(40);

const closePoint: BaselinePoint = {
  kind: 'session-close',
  commit: CLOSE,
  at: '2026-09-15T18:00:00Z',
  sessionId: 's-1',
  engine: 'claude-code',
};
const prPoint: BaselinePoint = {
  kind: 'merged-pull-request',
  commit: PR,
  at: '2026-09-16T12:00:00Z',
  number: 42,
  title: 'Add the Files window',
};

const points: RootBaselinePoints = {
  points: {
    rootId: 'repo:app',
    head: HEAD,
    points: [prPoint, closePoint],
    mergedPullRequests: { status: 'read', withoutCommit: 0 },
    limits: {
      commits: 200,
      records: 200,
      pullRequests: 50,
      commitsTruncated: false,
      reviewedMarksTruncated: false,
      sessionClosesTruncated: false,
    },
  },
  rows: [
    { kind: 'point', point: prPoint },
    { kind: 'point', point: closePoint },
  ],
};

function summary(id: string, name: string, tracked = true): RootSummary {
  return {
    root: {
      id,
      kind: id === 'workbench' ? 'workbench' : id === 'lore' ? 'lore' : 'repository',
      name,
      path: `/space/${name}`,
      tracking: tracked
        ? { tracked: true, workTree: `/space/${name}`, subPath: '' }
        : {
            tracked: false,
            reason: 'git-ignored',
            message: 'The Workbench is not tracked by git.',
          },
    },
    baseline: HEAD,
    defaultBaseline: {
      rootId: id,
      baseline: HEAD,
      source: 'first-seen',
      at: '2026-09-10T09:00:00Z',
      firstSeenRecorded: true,
      missing: [],
      notice: null,
    },
    baselineNotice: null,
    snapshot: { rootId: id, baseline: HEAD, changes: [] },
    github: null,
  } as unknown as RootSummary;
}

const ROOTS = [
  summary('lore', 'lore'),
  summary('repo:app', 'app'),
  summary('workbench', 'workbench', false),
];
const SPACE = { root: '/space', name: 'space' } as unknown as SpaceSummary;

let cockpit: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  cm.edits.length = 0;
  cm.diffs.length = 0;
  cm.codes.length = 0;
  cm.livePreview.length = 0;
  cockpit = {
    spaceRootReadFile: vi.fn(async (arg: { path: string }) => {
      if (arg.path.endsWith('.png')) return { ok: true, value: { kind: 'binary', bytes: 120 } };
      if (arg.path === 'huge.log') {
        return { ok: true, value: { kind: 'too-large', bytes: 3_000_000, limit: 2_097_152 } };
      }
      if (arg.path === 'gone.ts') return { ok: true, value: { kind: 'absent' } };
      return { ok: true, value: { kind: 'text', text: `now ${arg.path}\n`, mtimeMs: 111 } };
    }),
    spaceRootWriteFile: vi.fn(async (arg: { rootId: string; path: string; text: string }) => ({
      ok: true,
      value: { rootId: arg.rootId, path: arg.path, mtimeMs: 222, bytes: arg.text.length },
    })),
    spaceRootDiff: vi.fn(async (arg: { baseline?: string }) => ({
      ok: true,
      value: { kind: 'text', baseline: arg.baseline ?? HEAD, text: '@@ -1 +1 @@\n-old\n+now\n' },
    })),
    spaceRootFileAt: vi.fn(async (arg: { commit: string }) => ({
      ok: true,
      value: { kind: 'text', text: `at ${arg.commit.slice(0, 1)}\n` },
    })),
    spaceRootBlob: vi.fn(),
    spaceRootFileHistory: vi.fn(async () => ({
      ok: true,
      value: {
        entries: [
          {
            sha: OLD,
            subject: 'Change the file',
            author: 'Ada',
            body: '',
            timestamp: Date.parse('2026-09-14T09:00:00Z'),
            blob: '1'.repeat(40),
            prevBlob: '2'.repeat(40),
            change: 'M',
          },
        ],
        truncated: false,
        limit: 200,
      },
    })),
    spaceRootBaselinePoints: vi.fn(async () => ({ ok: true, value: points })),
    spaceRootSetBaseline: vi.fn(),
  };
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function request(
  seq: number,
  rootId: string,
  path: string,
  mode: 'code' | 'diff' = 'code',
): FilesOpenRequest {
  return { seq, rootId, path, mode };
}

function renderEditor(
  openRequest: FilesOpenRequest | null,
  extra: { initialState?: FilesEditorState; onStateChange?: (s: FilesEditorState) => void } = {},
) {
  const onRevealFile = vi.fn();
  const utils = render(
    <FilesEditor
      space={SPACE}
      roots={ROOTS}
      openRequest={openRequest}
      onRevealFile={onRevealFile}
      {...extra}
    />,
  );
  const rerender = (next: FilesOpenRequest | null): void =>
    utils.rerender(
      <FilesEditor
        space={SPACE}
        roots={ROOTS}
        openRequest={next}
        onRevealFile={onRevealFile}
        {...extra}
      />,
    );
  return { ...utils, rerender, onRevealFile };
}

const tabs = () =>
  within(screen.getByRole('tablist', { name: 'Open documents' })).getAllByRole('tab');

test('with nothing open it says so', () => {
  renderEditor(null);
  expect(screen.getByTestId('files-editor-empty').textContent).toContain('No document is open.');
});

test('requests open one document per root and path, taken once by seq', async () => {
  const { rerender } = renderEditor(request(1, 'repo:app', 'src/a.ts'));
  expect(tabs()).toHaveLength(1);
  rerender(request(1, 'repo:app', 'src/a.ts'));
  rerender(request(2, 'repo:app', 'src/b.ts'));
  rerender(request(3, 'lore', 'src/a.ts'));
  expect(tabs()).toHaveLength(3);
  // A new request for an open document selects it rather than opening a second one.
  rerender(request(4, 'repo:app', 'src/a.ts'));
  expect(tabs()).toHaveLength(3);
  expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
  expect(tabs()[0]?.textContent).toBe('a.tsapp');
  expect(tabs()[2]?.textContent).toBe('a.tslore');
  await waitFor(() => expect(cm.edits.length).toBeGreaterThan(0));
});

test('markdown opens in the live-preview editor, other files in the plain editor', async () => {
  const { rerender } = renderEditor(request(1, 'lore', 'notes/plan.md'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  expect(cm.edits[0]?.livePreview).toBe(true);
  expect(screen.getByTestId('files-editor-mode-preview').getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByTestId('files-editor-mode-code'));
  expect(cm.livePreview).toContain(false);
  expect(cm.edits).toHaveLength(1);
  rerender(request(2, 'repo:app', 'src/a.ts'));
  await waitFor(() => expect(cm.edits).toHaveLength(2));
  expect(cm.edits[1]?.livePreview).toBe(false);
  expect(screen.queryByTestId('files-editor-mode-preview')).toBeNull();
});

test('binary, too-large and absent files are said literally', async () => {
  const { rerender } = renderEditor(request(1, 'repo:app', 'logo.png'));
  expect((await screen.findByTestId('files-editor-status-not-text')).textContent).toBe(
    'The file is binary (120 bytes) in the working tree. It is not shown as text.',
  );
  rerender(request(2, 'repo:app', 'huge.log'));
  await waitFor(() =>
    expect(screen.getByTestId('files-editor-status-not-text').textContent).toBe(
      'The file is 3000000 bytes in the working tree, more than the 2097152 bytes the editor shows.',
    ),
  );
  rerender(request(3, 'repo:app', 'gone.ts'));
  await waitFor(() =>
    expect(screen.getByTestId('files-editor-status-not-text').textContent).toBe(
      'There is no file at this path in the working tree.',
    ),
  );
});

test('a save sends the text with the time it was read; a refusal is shown', async () => {
  renderEditor(request(1, 'repo:app', 'src/a.ts'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  const edit = cm.edits[0] as EditOpts;
  act(() => edit.onSave('changed\n'));
  await waitFor(() =>
    expect(cockpit.spaceRootWriteFile).toHaveBeenCalledWith({
      rootId: 'repo:app',
      path: 'src/a.ts',
      text: 'changed\n',
      expectedMtimeMs: 111,
    }),
  );
  expect(await screen.findByTestId('files-editor-saved')).toBeTruthy();
  cockpit.spaceRootWriteFile?.mockResolvedValueOnce({
    ok: false,
    error: { kind: 'changed-on-disk', message: 'The file changed on disk since it was opened.' },
  });
  act(() => edit.onSave('again\n'));
  expect((await screen.findByTestId('files-editor-save-error')).textContent).toBe(
    'Not saved: The file changed on disk since it was opened.',
  );
  // The second save carries the time the first save gave back.
  expect(cockpit.spaceRootWriteFile).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedMtimeMs: 222 }),
  );
});

test('a file with CRLF line endings is saved with CRLF', async () => {
  cockpit.spaceRootReadFile?.mockResolvedValueOnce({
    ok: true,
    value: { kind: 'text', text: 'one\r\ntwo\r\n', mtimeMs: 111 },
  });
  renderEditor(request(1, 'repo:app', 'src/win.ts'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  const edit = cm.edits[0] as EditOpts;
  expect(edit.text).toBe('one\ntwo\n');
  act(() => edit.onSave('one\ntwo\nthree\n'));
  await waitFor(() =>
    expect(cockpit.spaceRootWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'one\r\ntwo\r\nthree\r\n' }),
    ),
  );
});

test('a restored document whose root or file is gone says so literally', async () => {
  cockpit.spaceRootReadFile?.mockImplementation(async (arg: { rootId: string }) =>
    arg.rootId === 'repo:gone'
      ? { ok: false, error: { kind: 'unknown-root', message: 'The Space has no root repo:gone.' } }
      : { ok: true, value: { kind: 'absent' } },
  );
  const initialState: FilesEditorState = {
    version: 1,
    docs: [
      { rootId: 'repo:gone', path: 'a.ts', mode: 'code', pin: null, against: null, atCommit: null },
      { rootId: 'repo:gone', path: 'b.ts', mode: 'diff', pin: null, against: null, atCommit: null },
      {
        rootId: 'repo:app',
        path: 'deleted.ts',
        mode: 'code',
        pin: null,
        against: null,
        atCommit: null,
      },
    ],
    activeKey: JSON.stringify(['repo:gone', 'a.ts']),
  };
  renderEditor(null, { initialState });
  expect((await screen.findByTestId('files-editor-status-failed')).textContent).toBe(
    'The file could not be read: The Space has no root repo:gone.',
  );
  fireEvent.click(tabs()[1] as HTMLElement);
  expect((await screen.findByTestId('files-diff-untracked')).textContent).toBe(
    'The Space has no root of this id now.',
  );
  fireEvent.click(tabs()[2] as HTMLElement);
  expect((await screen.findByTestId('files-editor-status-not-text')).textContent).toBe(
    'There is no file at this path in the working tree.',
  );
});

test('closing a document with unsaved changes asks first', async () => {
  renderEditor(request(1, 'repo:app', 'src/a.ts'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  act(() => cm.edits[0]?.onChange('unsaved\n'));
  const tab = screen.getByTestId('files-doc-tab-repo:app-src/a.ts');
  expect(tab.getAttribute('data-dirty')).toBe('true');
  expect(within(tab).getByRole('img', { name: 'Unsaved changes' })).toBeTruthy();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close src/a.ts of app' }));
  expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to src/a.ts? They are not saved.');
  expect(tabs()).toHaveLength(1);
  confirm.mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close src/a.ts of app' }));
  expect(screen.getByTestId('files-editor-empty')).toBeTruthy();
});

test('undoing back to the saved text clears the unsaved mark', async () => {
  renderEditor(request(1, 'repo:app', 'src/a.ts'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  act(() => cm.edits[0]?.onChange('unsaved\n'));
  act(() => cm.edits[0]?.onChange('now src/a.ts\n'));
  expect(
    screen.getByTestId('files-doc-tab-repo:app-src/a.ts').getAttribute('data-dirty'),
  ).toBeNull();
});

test('a diff reads against the root baseline by default and says so', async () => {
  renderEditor(request(1, 'repo:app', 'src/a.ts', 'diff'));
  await waitFor(() => expect(cm.diffs).toHaveLength(1));
  expect(cockpit.spaceRootDiff).toHaveBeenCalledWith({ rootId: 'repo:app', path: 'src/a.ts' });
  expect(cm.diffs[0]).toEqual({ before: 'at a\n', after: 'now src/a.ts\n' });
  expect(screen.getByTestId('files-diff-against').textContent).toMatch(
    /^src\/a\.ts: the working tree against the root's baseline, first seen /,
  );
});

test('pinning to a session close diffs against it and leaves the root baseline alone', async () => {
  const states: FilesEditorState[] = [];
  renderEditor(request(1, 'repo:app', 'src/a.ts', 'diff'), {
    onStateChange: (s) => states.push(s),
  });
  await waitFor(() => expect(cm.diffs).toHaveLength(1));
  fireEvent.click(screen.getByTestId('files-diff-pin'));
  const panel = await screen.findByRole('region', { name: 'Points to pin this diff to' });
  // The kinds are labelled as the picker labels them.
  fireEvent.click(await within(panel).findByText(/claude-code/));
  await waitFor(() =>
    expect(cockpit.spaceRootDiff).toHaveBeenLastCalledWith({
      rootId: 'repo:app',
      path: 'src/a.ts',
      baseline: CLOSE,
    }),
  );
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
  const sentence = screen.getByTestId('files-diff-against').textContent ?? '';
  expect(sentence).toContain('against session close');
  expect(sentence).toContain('engine claude-code (ccccccc), pinned for this document only.');
  expect(sentence).toContain("The root's baseline stays first seen");
  const last = states[states.length - 1];
  expect(last?.docs[0]?.pin).toMatchObject({ kind: 'session-close', commit: CLOSE });
  // Serialisable as it is.
  expect(JSON.parse(JSON.stringify(last))).toEqual(last);

  fireEvent.click(screen.getByTestId('files-diff-unpin'));
  await waitFor(() =>
    expect(cockpit.spaceRootDiff).toHaveBeenLastCalledWith({
      rootId: 'repo:app',
      path: 'src/a.ts',
    }),
  );
});

test('the pin is remembered per document', async () => {
  const { rerender } = renderEditor(request(1, 'repo:app', 'src/a.ts', 'diff'));
  fireEvent.click(await screen.findByTestId('files-diff-pin'));
  const panel = await screen.findByRole('region', { name: 'Points to pin this diff to' });
  fireEvent.click(await within(panel).findByText(/#42/));
  await waitFor(() =>
    expect(screen.getByTestId('files-diff-against').textContent).toContain(
      'merged pull request #42 Add the Files window (ddddddd)',
    ),
  );
  rerender(request(2, 'repo:app', 'src/b.ts', 'diff'));
  await waitFor(() =>
    expect(screen.getByTestId('files-diff-against').textContent).toContain(
      "root's baseline, first",
    ),
  );
  fireEvent.click(tabs()[0] as HTMLElement);
  await waitFor(() =>
    expect(screen.getByTestId('files-diff-against').textContent).toContain('#42'),
  );
  expect(cockpit.spaceRootDiff).toHaveBeenLastCalledWith({
    rootId: 'repo:app',
    path: 'src/a.ts',
    baseline: PR,
  });
});

test('the history opens the file at a commit and diffs two points', async () => {
  renderEditor(request(1, 'repo:app', 'src/a.ts', 'diff'));
  const history = await screen.findByRole('region', { name: 'History of src/a.ts' });
  fireEvent.click(
    await within(history).findByRole('button', { name: 'Open src/a.ts at commit eeeeeee' }),
  );
  await waitFor(() => expect(cm.codes).toContain('at e\n'));
  expect(cockpit.spaceRootFileAt).toHaveBeenLastCalledWith({
    rootId: 'repo:app',
    path: 'src/a.ts',
    commit: OLD,
  });
  expect(screen.getByTestId('files-diff-against').textContent).toBe(
    'src/a.ts as it was at commit eeeeeee Change the file. Read only.',
  );
  expect(screen.getByTestId('files-editor-mode-at-commit').getAttribute('aria-pressed')).toBe(
    'true',
  );

  // Diff from the history's commit to the working tree, then between two points.
  fireEvent.click(screen.getByRole('button', { name: 'Diff from commit eeeeeee' }));
  await waitFor(() =>
    expect(cockpit.spaceRootDiff).toHaveBeenLastCalledWith({
      rootId: 'repo:app',
      path: 'src/a.ts',
      baseline: OLD,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Diff to commit eeeeeee' }));
  await waitFor(() =>
    expect(screen.getByTestId('files-diff-against').textContent).toContain(
      'src/a.ts: commit eeeeeee Change the file against commit eeeeeee Change the file, pinned for this document only.',
    ),
  );
  expect(await screen.findByTestId('cm-notice')).toHaveProperty('textContent', 'No differences.');
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
});

test('a root git does not track has no diff', async () => {
  renderEditor(request(1, 'workbench', 'draft.md'));
  await waitFor(() => expect(cm.edits).toHaveLength(1));
  expect((screen.getByTestId('files-editor-mode-diff') as HTMLButtonElement).disabled).toBe(true);
});

test('a document can be shown in the tree', async () => {
  const { onRevealFile } = renderEditor(request(1, 'repo:app', 'src/a.ts'));
  fireEvent.click(screen.getByTestId('files-editor-reveal'));
  expect(onRevealFile).toHaveBeenCalledWith('repo:app', 'src/a.ts');
});

test('the state given back starts the editor with its documents, modes and pins', async () => {
  const initialState: FilesEditorState = {
    version: 1,
    docs: [
      {
        rootId: 'repo:app',
        path: 'src/a.ts',
        mode: 'diff',
        pin: {
          kind: 'session-close',
          commit: CLOSE,
          at: '2026-09-15T18:00:00Z',
          label: 'session close of a restored document',
        },
        against: null,
        atCommit: null,
      },
      {
        rootId: 'lore',
        path: 'space.md',
        mode: 'code',
        pin: null,
        against: null,
        atCommit: null,
      },
    ],
    activeKey: JSON.stringify(['repo:app', 'src/a.ts']),
  };
  renderEditor(null, { initialState });
  expect(tabs()).toHaveLength(2);
  await waitFor(() =>
    expect(cockpit.spaceRootDiff).toHaveBeenCalledWith({
      rootId: 'repo:app',
      path: 'src/a.ts',
      baseline: CLOSE,
    }),
  );
  expect(screen.getByTestId('files-diff-against').textContent).toContain(
    'against session close of a restored document (ccccccc)',
  );
});
