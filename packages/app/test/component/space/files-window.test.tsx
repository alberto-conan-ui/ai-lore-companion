import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { SpaceSurface } from '../../../src/renderer/src/space/SpaceSurface.js';
import {
  DESK_NOT_WRITABLE,
  WORKBENCH_NOTICE,
} from '../../../src/renderer/src/space/files/FilesWindow.js';
import type { SpaceSummary } from '../../../src/shared/ipc.js';
import type {
  RootTreeEntry,
  SpaceRootTreeExpandArg,
} from '../../../src/shared/ipc/space/root-tree.types.js';
import type {
  BaselinePoint,
  RootChangesPayload,
  RootFileEventsPayload,
  RootSnapshot,
  RootSummary,
  SpaceRootsList,
} from '../../../src/shared/ipc/space/roots.types.js';

// The Files window of phase M5.2: the roots as tabs with their counts, the Workbench's
// sentence in place of a changes list, the tree of the selected root with change markers,
// the three parts later phases build, and counts and markers that follow main's pushes.

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 440,
  });
});

const space: SpaceSummary = {
  root: '/work/my-space',
  key: 'abc',
  name: 'my-space',
  manifest: {
    format: 1,
    name: 'my-space',
    github: { repository: 'me/my-space', project: 7 },
    repositories: [{ name: 'app', path: 'repos/app' }],
    publishAreas: [],
  } as unknown as SpaceSummary['manifest'],
};

function okSnapshot(rootId: string, paths: [string, string][]): RootSnapshot {
  return {
    rootId,
    baseline: 'HEAD',
    status: 'ok',
    changes: {
      baseline: 'HEAD',
      baselineCommit: 'a'.repeat(40),
      baselineIsAncestor: true,
      head: 'a'.repeat(40),
      branch: { name: 'main', detached: false } as never,
      entries: paths.map(([code, path]) => ({ code, path })) as never,
      total: paths.length,
      truncated: false,
      limit: 1000,
    },
  };
}

function tracked(id: string, kind: RootSummary['root']['kind'], name: string, path: string) {
  return {
    id,
    kind,
    name,
    path,
    tracking: { tracked: true as const, workTree: '/work/my-space', subPath: '' },
  };
}

const LORE: RootSummary = {
  root: tracked('lore', 'lore', 'lore', '/work/my-space/lore'),
  baseline: 'HEAD',
  defaultBaseline: null,
  baselineNotice: null,
  snapshot: okSnapshot('lore', [
    [' M', 'space.md'],
    ['??', 'cards/new.md'],
    ['A ', 'cards/other.md'],
  ]),
  github: null,
};

const WORKBENCH: RootSummary = {
  root: {
    id: 'workbench',
    kind: 'workbench',
    name: 'workbench',
    path: '/work/my-space/workbench',
    tracking: { tracked: false, reason: 'git-ignored', message: 'The folder is ignored by git.' },
  },
  baseline: 'HEAD',
  defaultBaseline: null,
  baselineNotice: null,
  snapshot: {
    rootId: 'workbench',
    baseline: 'HEAD',
    status: 'untracked',
    reason: 'git-ignored',
    message: 'The folder is ignored by git.',
  },
  github: null,
};

const REPO: RootSummary = {
  root: tracked('repo:app', 'repository', 'app', '/work/my-space/repos/app'),
  baseline: 'HEAD',
  defaultBaseline: null,
  baselineNotice: null,
  snapshot: okSnapshot('repo:app', []),
  github: 'me/app',
};

const LISTINGS: Record<string, RootTreeEntry[]> = {
  'lore:': [
    { name: 'cards', path: 'cards', isDir: true },
    { name: 'space.md', path: 'space.md', isDir: false },
  ],
  'lore:cards': [
    { name: 'new.md', path: 'cards/new.md', isDir: false },
    { name: 'other.md', path: 'cards/other.md', isDir: false },
  ],
  'workbench:': [{ name: 'draft.md', path: 'draft.md', isDir: false }],
  'repo:app:': [{ name: 'README.md', path: 'README.md', isDir: false }],
};

/** The change dot of a tree row: the 6px span the v0.8 row draws. */
function dotOf(row: HTMLElement): HTMLElement {
  const dot = [...row.querySelectorAll('span')].find((span) => span.style.width === '6px');
  if (!dot) throw new Error('no dot');
  return dot;
}

type Listener<P> = (payload: P) => void;

/** The one baseline point the picker of phase M5.4 is given here. */
const PICKED: BaselinePoint = {
  kind: 'commit',
  commit: 'b'.repeat(40),
  at: '2026-09-10T09:00:00Z',
  subject: 'An older commit',
};

let list: SpaceRootsList;
let changesListeners: Listener<RootChangesPayload>[];
let fileEventListeners: Listener<RootFileEventsPayload>[];
let findListeners: (() => void)[] = [];

const cockpit = {
  spaceRootsList: vi.fn(async () => ({ ok: true as const, value: list })),
  spaceRootsRefresh: vi.fn(async () => ({ ok: true as const, value: list })),
  spaceRootTreeExpand: vi.fn(async (arg: SpaceRootTreeExpandArg) => {
    const entries = LISTINGS[`${arg.rootId}:${arg.path ?? ''}`] ?? [];
    return {
      ok: true as const,
      value: {
        rootId: arg.rootId,
        path: arg.path ?? '',
        entries,
        total: entries.length,
        truncated: false,
        limit: 5000,
      },
    };
  }),
  onSpaceRootChanges: vi.fn((listener: Listener<RootChangesPayload>) => {
    changesListeners.push(listener);
    return () => {
      changesListeners = changesListeners.filter((l) => l !== listener);
    };
  }),
  onSpaceRootFileEvents: vi.fn((listener: Listener<RootFileEventsPayload>) => {
    fileEventListeners.push(listener);
    return () => {
      fileEventListeners = fileEventListeners.filter((l) => l !== listener);
    };
  }),
  onSpaceRootsReloaded: vi.fn(() => () => undefined),
  spaceRootBaselinePoints: vi.fn(async () => ({
    ok: true as const,
    value: {
      points: {
        rootId: 'lore',
        head: 'a'.repeat(40),
        points: [PICKED],
        mergedPullRequests: { status: 'not-applicable' as const },
        limits: {
          commits: 200,
          records: 200,
          pullRequests: 50,
          commitsTruncated: false,
          reviewedMarksTruncated: false,
          sessionClosesTruncated: false,
        },
      },
      rows: [{ kind: 'point' as const, point: PICKED }],
    },
  })),
  spaceRootSetBaseline: vi.fn(async (arg: { rootId: string; baseline: string }) => ({
    ok: true as const,
    value: { rootId: arg.rootId, baseline: arg.baseline, snapshot: {} },
  })),
  spaceRootReveal: vi.fn(async () => ({ ok: true as const, value: null })),
  spaceRootSearch: vi.fn(async (arg: { rootId: string; query: string }) => ({
    ok: true as const,
    value: {
      rootId: arg.rootId,
      query: arg.query,
      outcome: 'done' as const,
      timeLimitMs: 10_000,
      names: {
        hits: arg.rootId === 'repo:app' ? [{ name: 'guide.md', path: 'docs/guide.md' }] : [],
        limit: 40,
        truncated: false,
        finished: true,
      },
      content: { hits: [], limit: 50, truncated: false, finished: true },
      indexTruncated: false,
      indexLimit: 100_000,
      ripgrepMissing: false,
    },
  })),
  spaceRootSearchCancel: vi.fn(async () => ({ ok: true as const, value: { cancelled: 0 } })),
  onFocusGlobalSearch: vi.fn((listener: () => void) => {
    findListeners.push(listener);
    return () => {
      findListeners = findListeners.filter((l) => l !== listener);
    };
  }),
  revealInFinder: vi.fn(),
  openPath: vi.fn(),
  // Phase M5.7: nothing remembered in these tests; `files-memory.test.tsx` covers the restore.
  spaceUiRead: vi.fn(async () => ({ ok: true as const, value: { state: null, notice: null } })),
  spaceUiSave: vi.fn(async () => ({ ok: true as const, value: { outcome: 'scheduled' as const } })),
};

const LORE_LISTING = LISTINGS['lore:'];

beforeEach(() => {
  LISTINGS['lore:'] = LORE_LISTING;
  list = { roots: [LORE, WORKBENCH, REPO], deskWritable: true, deskNotice: null };
  changesListeners = [];
  fileEventListeners = [];
  for (const fn of Object.values(cockpit)) fn.mockClear();
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

async function renderWindow(open?: { rootId: string; relPath?: string }) {
  render(
    <SpaceSurface init={{ mode: 'space-files', space, ...(open === undefined ? {} : { open }) }} />,
  );
  return screen.findByRole('tablist', { name: 'Roots' });
}

test('one tab per root, named as the root is named, with the count of its changes', async () => {
  const tablist = await renderWindow();
  const tabs = within(tablist).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['lore3', 'workbench', 'app0']);
  expect(screen.getByTestId('files-root-count-lore').textContent).toBe('3');
  expect(screen.getByTestId('files-root-count-repo:app').textContent).toBe('0');
  expect(screen.queryByTestId('files-root-count-workbench')).toBeNull();
  expect(tabs[0]?.getAttribute('aria-label')).toBe('lore, 3 changes');
  expect(tabs[1]?.getAttribute('aria-label')).toBe('workbench, not tracked by git');
  expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
});

test('the Workbench tab says in one sentence that it has no changes list, and still has a tree', async () => {
  await renderWindow();
  fireEvent.click(screen.getByTestId('files-root-tab-workbench'));
  expect(screen.getByTestId('files-untracked-notice').textContent).toBe(WORKBENCH_NOTICE);
  expect(WORKBENCH_NOTICE).toBe('The Workbench is not tracked by git, so it has no changes list.');
  expect(screen.queryByTestId('files-changes-slot')).toBeNull();
  expect(screen.queryByTestId('files-picker-slot')).toBeNull();
  expect(await inTree().findByText('draft.md')).toBeTruthy();
});

test('a tracked root places the parts later phases build: the picker, the Changes panel, the editor', async () => {
  await renderWindow();
  // The slots are the layout's; what is in them is M5.3's, M5.4's and M5.5's.
  expect(screen.getByTestId('files-picker-slot').childElementCount).toBe(1);
  expect(screen.getByTestId('files-changes-slot').childElementCount).toBe(1);
  expect(screen.getByTestId('files-editor-slot').childElementCount).toBe(1);
  expect(screen.queryByTestId('files-untracked-notice')).toBeNull();
});

/** Queries inside the tree of the selected root; the Changes panel lists some of the same names. */
const inTree = () => within(screen.getByTestId('files-tree'));

test('the keyboard moves between tabs and selects', async () => {
  const tablist = await renderWindow();
  const [lore] = within(tablist).getAllByRole('tab');
  if (!lore) throw new Error('no tab');
  lore.focus();
  fireEvent.keyDown(lore, { key: 'ArrowRight' });
  expect(screen.getByTestId('files-root-tab-workbench').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByTestId('files-root-tab-workbench'));
  fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
  expect(screen.getByTestId('files-root-tab-repo:app').getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
  expect(screen.getByTestId('files-root-tab-lore').getAttribute('aria-selected')).toBe('true');
});

test('the tree of the selected root shows change markers, and a double click asks the editor to open', async () => {
  await renderWindow();
  const tree = screen.getByRole('region', { name: 'Tree of lore' });
  const file = await within(tree).findByText('space.md');
  const row = file.closest('[role="treeitem"]') as HTMLElement;
  // A changed file's dot has a colour; the folder `cards` holds two changes.
  const dot = dotOf(row);
  expect(dot.style.background).toBe('var(--color-warn)');
  const cards = within(tree).getByText('cards').closest('[role="treeitem"]') as HTMLElement;
  expect(dotOf(cards).style.background).toBe('var(--color-success)');
  fireEvent.doubleClick(row);
  expect(screen.getByTestId('files-editor-request').textContent).toBe('lore: space.md (code)');
});

test('a pushed snapshot updates the count and the markers live', async () => {
  await renderWindow();
  await inTree().findByText('space.md');
  act(() => {
    for (const listener of changesListeners)
      listener({ snapshot: okSnapshot('lore', [['??', 'cards/new.md']]) });
  });
  expect(screen.getByTestId('files-root-count-lore').textContent).toBe('1');
  const row = inTree().getByText('space.md').closest('[role="treeitem"]') as HTMLElement;
  expect(dotOf(row).style.background).toBe('transparent');
});

test('choosing a baseline point sets it through main, and the snapshot main pushes updates the Changes panel', async () => {
  await renderWindow();
  await inTree().findByText('space.md');
  fireEvent.click(screen.getByTestId('files-baseline-trigger'));
  const tree = await screen.findByRole('tree', { name: 'Baseline points' });
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
  fireEvent.click(within(tree).getByRole('treeitem', { name: 'commit bbbbbbb An older commit' }));
  await waitFor(() =>
    expect(cockpit.spaceRootSetBaseline).toHaveBeenCalledWith({
      rootId: 'lore',
      baseline: 'b'.repeat(40),
    }),
  );
  // The picker reads the list again; main's push is what the panel follows.
  await waitFor(() => expect(cockpit.spaceRootsList).toHaveBeenCalledTimes(2));
  await act(async () => undefined);
  expect(screen.getAllByTestId('root-change')).toHaveLength(3);
  const snapshot = okSnapshot('lore', [
    [' M', 'space.md'],
    ['D ', 'old.md'],
  ]);
  act(() => {
    for (const listener of changesListeners)
      listener({ snapshot: { ...snapshot, baseline: 'b'.repeat(40) } });
  });
  expect(screen.getAllByTestId('root-change')).toHaveLength(2);
  expect(screen.getByTestId('files-root-count-lore').textContent).toBe('2');
  expect(screen.getByTestId('files-baseline').textContent).toBe('commit bbbbbbb An older commit');
});

test('a file event reads the folder again, and a new file appears in the tree', async () => {
  await renderWindow();
  await inTree().findByText('space.md');
  LISTINGS['lore:'] = [...(LISTINGS['lore:'] ?? []), { name: 'z.md', path: 'z.md', isDir: false }];
  act(() => {
    for (const listener of fileEventListeners)
      listener({ rootId: 'lore', events: [{ event: 'add', path: 'z.md' }], overflow: false });
  });
  expect(await inTree().findByText('z.md')).toBeTruthy();
});

test('the tree is a tree of treeitems; the arrows move down and open a folder, reading it', async () => {
  await renderWindow();
  const tree = screen.getByRole('tree');
  const cards = (await within(tree).findByText('cards')).closest(
    '[role="treeitem"]',
  ) as HTMLElement;
  expect(cards.getAttribute('aria-expanded')).toBe('false');
  // The root's row has the focus first; down reaches `cards`, right opens it.
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  fireEvent.keyDown(tree, { key: 'ArrowRight' });
  expect(await within(tree).findByText('other.md')).toBeTruthy();
  expect(cards.getAttribute('aria-expanded')).toBe('true');
  expect(cockpit.spaceRootTreeExpand).toHaveBeenCalledWith({ rootId: 'lore', path: 'cards' });
});

test('Reveal in Finder asks main with the root id and the relative path, never an absolute path', async () => {
  await renderWindow();
  const row = (await inTree().findByText('space.md')).closest('[role="treeitem"]') as HTMLElement;
  fireEvent.click(within(row).getByTitle('Reveal in Finder'));
  fireEvent.contextMenu(row);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in Finder' }));
  expect(cockpit.spaceRootReveal).toHaveBeenCalledTimes(2);
  for (const call of cockpit.spaceRootReveal.mock.calls as unknown[][]) {
    expect(call[0]).toEqual({ rootId: 'lore', path: 'space.md' });
  }
  expect(cockpit.openPath).not.toHaveBeenCalled();
  expect(cockpit.revealInFinder).not.toHaveBeenCalled();
});

test('a folder main capped says how many entries it holds', async () => {
  cockpit.spaceRootTreeExpand.mockResolvedValueOnce({
    ok: true,
    value: {
      rootId: 'lore',
      path: '',
      entries: LISTINGS['lore:'] ?? [],
      total: 100_000,
      truncated: true,
      limit: 5000,
    },
  } as never);
  await renderWindow();
  expect((await screen.findByTestId('files-tree-truncated')).textContent).toBe(
    'lore holds 100000 entries; the first 5000 are shown.',
  );
});

test('closing the window releases its listeners', async () => {
  await renderWindow();
  await inTree().findByText('space.md');
  expect(changesListeners.length).toBeGreaterThan(0);
  expect(fileEventListeners.length).toBeGreaterThan(0);
  cleanup();
  expect(changesListeners).toEqual([]);
  expect(fileEventListeners).toEqual([]);
});

test('a desk this window cannot write is shown with its notice', async () => {
  list = {
    ...list,
    deskWritable: false,
    deskNotice: 'Another instance of AI-Lore owns this desk.',
  };
  await renderWindow();
  expect(screen.getByTestId('files-desk-notice').textContent).toBe(
    'Another instance of AI-Lore owns this desk.',
  );
  cleanup();
  list = { ...list, deskWritable: false, deskNotice: null };
  await renderWindow();
  expect(screen.getByTestId('files-desk-notice').textContent).toBe(DESK_NOT_WRITABLE);
});

test('Open in Files with a file selects the root, reveals the file and asks the editor to open it', async () => {
  await renderWindow({ rootId: 'lore', relPath: 'cards/new.md' });
  await waitFor(() =>
    expect(screen.getByTestId('files-editor-request').textContent).toBe(
      'lore: cards/new.md (code)',
    ),
  );
  const row = (await inTree().findByText('new.md')).closest('[role="treeitem"]') as HTMLElement;
  await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'));
  expect(cockpit.spaceRootTreeExpand).toHaveBeenCalledWith({ rootId: 'lore', path: 'cards' });
});

test('Search (M5.6) in the header: the find shortcut opens it, a result selects its root and opens the file', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  await renderWindow();
  expect(screen.getByTestId('files-search-open')).toBeTruthy();
  expect(screen.queryByTestId('search-dialog')).toBeNull();
  fireEvent.keyDown(window, { key: 'f', metaKey: true });
  const dialog = await screen.findByRole('dialog', { name: 'Search the roots of the Space' });
  fireEvent.change(within(dialog).getByTestId('search-dialog-input'), {
    target: { value: 'guide' },
  });
  const result = await screen.findByTestId('search-result');
  fireEvent.doubleClick(result);
  expect(screen.queryByTestId('search-dialog')).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId('files-editor-request').textContent).toBe(
      'repo:app: docs/guide.md (code)',
    ),
  );
  expect(screen.getByTestId('files-root-tab-repo:app').getAttribute('aria-selected')).toBe('true');
  await waitFor(() =>
    expect(cockpit.spaceRootTreeExpand).toHaveBeenCalledWith({ rootId: 'repo:app', path: 'docs' }),
  );
  // The Edit menu's Find reaches the window as the find push, and opens Search again.
  expect(findListeners).toHaveLength(1);
  act(() => findListeners[0]?.());
  expect(await screen.findByTestId('search-dialog')).toBeTruthy();
});

test('a failed first read says why', async () => {
  cockpit.spaceRootsList.mockResolvedValueOnce({
    ok: false,
    error: { kind: 'roots-unavailable', message: 'The manifest could not be read.' },
  } as never);
  render(<SpaceSurface init={{ mode: 'space-files', space }} />);
  expect((await screen.findByTestId('files-roots-error')).textContent).toBe(
    'The manifest could not be read.',
  );
});
