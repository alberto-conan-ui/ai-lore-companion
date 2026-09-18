import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  baselineNotRestoredNotice,
  missingFileNotice,
  missingRootDocNotice,
  missingSelectedRootNotice,
  pickedBaselines,
  useFilesMemory,
} from '../../../src/renderer/src/space/files/useFilesMemory.js';
import { useSelectedRoot } from '../../../src/renderer/src/space/files/useSelectedRoot.js';
import type { SpaceSummary } from '../../../src/shared/ipc.js';
import type { RootSummary } from '../../../src/shared/ipc/space/roots.types.js';
import type { UiRendererConcern } from '../../../src/shared/ipc/space/ui.types.js';

// Phase M5.7: what the Files window restores after a restart. A remembered entry whose
// root or file no longer exists is dropped with a literal notice.

const OLD = 'b'.repeat(40);
const MARK = 'c'.repeat(40);

function tracked(
  id: string,
  name: string,
  baseline: string,
  byDefault: string | null,
): RootSummary {
  return {
    root: {
      id,
      kind: id === 'lore' ? 'lore' : 'repository',
      name,
      path: `/space/${name}`,
      tracking: { tracked: true, workTree: '/space', subPath: '' },
    },
    baseline,
    defaultBaseline:
      byDefault === null
        ? null
        : ({ rootId: id, baseline: byDefault } as RootSummary['defaultBaseline']),
    baselineNotice: null,
    snapshot: { rootId: id, baseline, status: 'unread' },
    github: null,
  } as RootSummary;
}

const SPACE = { root: '/space', key: 'k1', name: 'space' } as unknown as SpaceSummary;

let saved: Partial<Record<UiRendererConcern, unknown>>;
let notices: Partial<Record<UiRendererConcern, string>>;
let cockpit: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  saved = {};
  notices = {};
  cockpit = {
    spaceUiRead: vi.fn(async (arg: { concern: UiRendererConcern }) => ({
      ok: true,
      value: { state: saved[arg.concern] ?? null, notice: notices[arg.concern] ?? null },
    })),
    spaceUiSave: vi.fn(async () => ({ ok: true, value: { outcome: 'scheduled' } })),
    spaceRootReadFile: vi.fn(async (arg: { path: string }) =>
      arg.path === 'gone.md'
        ? { ok: true, value: { kind: 'absent' } }
        : { ok: true, value: { kind: 'text', text: 'x', mtimeMs: 1 } },
    ),
    spaceRootSetBaseline: vi.fn(async (arg: { rootId: string; baseline: string }) =>
      arg.baseline === 'd'.repeat(40)
        ? {
            ok: false,
            error: {
              kind: 'baseline-missing',
              message: 'The commit is not in the repository of this root.',
            },
          }
        : { ok: true, value: { rootId: arg.rootId, baseline: arg.baseline, snapshot: {} } },
    ),
  };
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

const pin = { kind: 'commit' as const, commit: OLD, at: '2026-09-10T09:00:00Z', label: 'Older' };

test('documents come back with their modes and pins; a gone root or a gone file is dropped with a notice', async () => {
  saved['files-editor'] = {
    version: 1,
    docs: [
      { rootId: 'lore', path: 'a.md', mode: 'preview', pin: null, against: null, atCommit: null },
      { rootId: 'repo:app', path: 'src/x.ts', mode: 'diff', pin, against: null, atCommit: null },
      { rootId: 'repo:gone', path: 'y.ts', mode: 'code', pin: null, against: null, atCommit: null },
      { rootId: 'lore', path: 'gone.md', mode: 'code', pin: null, against: null, atCommit: null },
      // A document in Diff whose file is gone is kept: a deleted file has a diff.
      { rootId: 'lore', path: 'gone.md', mode: 'diff', pin: null, against: null, atCommit: null },
    ],
    activeKey: JSON.stringify(['repo:gone', 'y.ts']),
  };
  const roots = [
    tracked('lore', 'lore', 'HEAD', 'HEAD'),
    tracked('repo:app', 'app', 'HEAD', 'HEAD'),
  ];
  const { result } = renderHook(() =>
    useFilesMemory({ spaceKey: 'k1', roots, selectedId: null, select: vi.fn() }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  const docs = result.current.editorInitial.docs;
  expect(docs.map((doc) => [doc.rootId, doc.path, doc.mode])).toEqual([
    ['lore', 'a.md', 'preview'],
    ['repo:app', 'src/x.ts', 'diff'],
    ['lore', 'gone.md', 'diff'],
  ]);
  expect(docs[1]?.pin).toEqual(pin);
  // The active document was dropped, so the first one left is active.
  expect(result.current.editorInitial.activeKey).toBe(JSON.stringify(['lore', 'a.md']));
  expect(result.current.notices).toEqual([
    missingRootDocNotice('repo:gone', 'y.ts'),
    missingFileNotice('lore', 'gone.md'),
  ]);

  // The editor's state is saved from now on.
  act(() => result.current.saveEditor(result.current.editorInitial));
  expect(cockpit.spaceUiSave).toHaveBeenCalledWith({
    concern: 'files-editor',
    state: result.current.editorInitial,
  });
  act(() => result.current.dismissNotices());
  expect(result.current.notices).toEqual([]);
});

test('each picked baseline is set again through main; a gone root or a gone commit is dropped with a notice', async () => {
  saved.baselines = {
    version: 1,
    roots: { lore: OLD, 'repo:app': 'd'.repeat(40), 'repo:gone': OLD },
  };
  let roots = [tracked('lore', 'lore', MARK, MARK), tracked('repo:app', 'app', 'HEAD', 'HEAD')];
  const { result, rerender } = renderHook(
    ({ list }) =>
      useFilesMemory({ spaceKey: 'k1', roots: list, selectedId: null, select: vi.fn() }),
    { initialProps: { list: roots } },
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(cockpit.spaceRootSetBaseline).toHaveBeenCalledWith({ rootId: 'lore', baseline: OLD });
  expect(cockpit.spaceRootSetBaseline).toHaveBeenCalledWith({
    rootId: 'repo:app',
    baseline: 'd'.repeat(40),
  });
  expect(result.current.notices).toEqual([
    baselineNotRestoredNotice('app', 'The commit is not in the repository of this root.'),
    baselineNotRestoredNotice('repo:gone', 'this Space no longer has that root.'),
  ]);

  // Main pushes the lore root's new baseline; the entries that were dropped are written away.
  roots = [tracked('lore', 'lore', OLD, MARK), tracked('repo:app', 'app', 'HEAD', 'HEAD')];
  rerender({ list: roots });
  await waitFor(() =>
    expect(cockpit.spaceUiSave).toHaveBeenCalledWith({
      concern: 'baselines',
      state: { version: 1, roots: { lore: OLD } },
    }),
  );

  // A reset to the default is saved as no entry, so a later reviewed mark moves the root.
  roots = [tracked('lore', 'lore', MARK, MARK), tracked('repo:app', 'app', 'HEAD', 'HEAD')];
  rerender({ list: roots });
  await waitFor(() =>
    expect(cockpit.spaceUiSave).toHaveBeenLastCalledWith({
      concern: 'baselines',
      state: { version: 1, roots: {} },
    }),
  );
});

test('a root on its default baseline is not remembered', () => {
  expect(
    pickedBaselines([
      tracked('lore', 'lore', MARK, MARK),
      tracked('repo:app', 'app', OLD, 'HEAD'),
      tracked('repo:b', 'b', 'HEAD', null),
    ]),
  ).toEqual({ 'repo:app': OLD });
});

test('the selected root comes back, and a choice is saved', async () => {
  saved['selected-root'] = { version: 1, rootId: 'repo:app' };
  const { result } = renderHook(() => useSelectedRoot(SPACE));
  await waitFor(() => expect(result.current[0]).toBe('repo:app'));
  act(() => result.current[1]('lore'));
  expect(result.current[0]).toBe('lore');
  expect(cockpit.spaceUiSave).toHaveBeenCalledWith({
    concern: 'selected-root',
    state: { version: 1, rootId: 'lore' },
  });
});

test('a remembered selected root the Space no longer has is dropped with a notice', async () => {
  const select = vi.fn();
  const roots = [tracked('lore', 'lore', 'HEAD', 'HEAD')];
  const { result } = renderHook(() =>
    useFilesMemory({ spaceKey: 'k1', roots, selectedId: 'repo:gone', select }),
  );
  await waitFor(() =>
    expect(result.current.notices).toContain(missingSelectedRootNotice('repo:gone')),
  );
  expect(select).toHaveBeenCalledWith('lore');
});

test('a file main set aside is said, and the window opens with defaults', async () => {
  notices['files-editor'] =
    'What this window remembered (files-editor.json) could not be read (it is not JSON). It was set aside as x, and the window opens with defaults.';
  const roots = [tracked('lore', 'lore', 'HEAD', 'HEAD')];
  const { result } = renderHook(() =>
    useFilesMemory({ spaceKey: 'k1', roots, selectedId: null, select: vi.fn() }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.editorInitial.docs).toEqual([]);
  expect(result.current.notices).toEqual([notices['files-editor']]);
});

test('nothing is saved before the restore, so a restart does not overwrite what it restores', async () => {
  const { result } = renderHook(() =>
    useFilesMemory({ spaceKey: 'k1', roots: null, selectedId: null, select: vi.fn() }),
  );
  act(() => result.current.saveEditor({ version: 1, docs: [], activeKey: null }));
  expect(result.current.ready).toBe(false);
  expect(cockpit.spaceUiSave).not.toHaveBeenCalled();
});
