import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { ROOT_SEARCH_NOTE, RootSearch } from '../../../src/renderer/src/space/files/RootSearch.js';
import type {
  RootSearchGroup,
  SpaceRootSearchArg,
  SpaceRootSearchResult,
} from '../../../src/shared/ipc/space/root-search.types.js';
import type { RootSummary } from '../../../src/shared/ipc/space/roots.types.js';

// Phase M5.6: search in the Files window, grouped by root in the order of the tabs, through
// the v0.8 search dialog given a source.

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

function summary(id: string, name: string, path: string): RootSummary {
  return {
    root: {
      id,
      kind: id === 'lore' ? 'lore' : id === 'workbench' ? 'workbench' : 'repository',
      name,
      path,
      tracking:
        id === 'workbench'
          ? { tracked: false, reason: 'not-a-repository', message: 'Not tracked.' }
          : { tracked: true, workTree: path, subPath: '' },
    },
    baseline: 'HEAD',
    defaultBaseline: null,
    baselineNotice: null,
    snapshot: { rootId: id, baseline: 'HEAD', status: 'unread' },
    github: null,
  } as unknown as RootSummary;
}

/** The tabs' order: Lore, then the repository, then a root whose folder is not known. */
const ROOTS: RootSummary[] = [
  summary('lore', 'lore', '/work/my-space/lore'),
  summary('repo:app', 'app', '/work/my-space/repos/app'),
  summary('repo:gone', 'gone', ''),
];

function group(
  rootId: string,
  query: string,
  over: Partial<RootSearchGroup> = {},
): RootSearchGroup {
  return {
    rootId,
    query,
    outcome: 'done',
    timeLimitMs: 10_000,
    names: { hits: [], limit: 40, truncated: false, finished: true },
    content: { hits: [], limit: 50, truncated: false, finished: true },
    indexTruncated: false,
    indexLimit: 100_000,
    ripgrepMissing: false,
    ...over,
  };
}

/** Answers held until the test releases them, per `rootId:query`. */
let held: Map<string, (result: SpaceRootSearchResult) => void>;

const cockpit = {
  spaceRootSearch: vi.fn(
    (arg: SpaceRootSearchArg) =>
      new Promise<SpaceRootSearchResult>((resolve) => {
        held.set(`${arg.rootId}:${arg.query}`, resolve);
      }),
  ),
  spaceRootSearchCancel: vi.fn(async () => ({ ok: true as const, value: { cancelled: 1 } })),
};

async function release(key: string, result: SpaceRootSearchResult): Promise<void> {
  await waitFor(() => expect(held.has(key)).toBe(true));
  await act(async () => {
    held.get(key)?.(result);
    held.delete(key);
  });
}

beforeEach(() => {
  held = new Map();
  for (const fn of Object.values(cockpit)) fn.mockClear();
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => {
  cleanup();
});

function openDialog(onOpenResult = vi.fn()): { onOpenResult: ReturnType<typeof vi.fn> } {
  render(<RootSearch roots={ROOTS} onOpenResult={onOpenResult} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  return { onOpenResult };
}

function type(text: string): void {
  fireEvent.change(screen.getByTestId('search-dialog-input'), { target: { value: text } });
}

test('the dialog searches every root whose folder is known, states the caps, and has no incl. ignored switch', async () => {
  openDialog();
  const dialog = screen.getByRole('dialog', { name: 'Search the roots of the Space' });
  expect(within(dialog).getByTestId('search-dialog-note').textContent).toBe(ROOT_SEARCH_NOTE);
  expect(ROOT_SEARCH_NOTE).toContain('at most 40 file names and 50 lines');
  expect(within(dialog).queryByTestId('search-include-ignored')).toBeNull();
  expect(within(dialog).getByTestId('search-scope-lore')).toBeTruthy();
  expect(within(dialog).getByTestId('search-scope-repo:app')).toBeTruthy();
  expect(within(dialog).queryByTestId('search-scope-repo:gone')).toBeNull();

  type('needle');
  await waitFor(() => expect(cockpit.spaceRootSearch).toHaveBeenCalledTimes(2));
  expect(cockpit.spaceRootSearch).toHaveBeenCalledWith({ rootId: 'lore', query: 'needle' });
  expect(cockpit.spaceRootSearch).toHaveBeenCalledWith({ rootId: 'repo:app', query: 'needle' });
});

test('results are grouped by root in the order of the tabs, whatever the order they arrive in, with paths relative to the root', async () => {
  openDialog();
  type('needle');
  await release('repo:app:needle', {
    ok: true,
    value: group('repo:app', 'needle', {
      names: {
        hits: [{ name: 'needle.md', path: 'docs/needle.md' }],
        limit: 40,
        truncated: false,
        finished: true,
      },
    }),
  });
  expect(screen.getByTestId('search-group-repo:app')).toBeTruthy();
  expect(screen.queryByTestId('search-group-lore')).toBeNull();

  await release('lore:needle', {
    ok: true,
    value: group('lore', 'needle', {
      content: {
        hits: [
          { name: 'space.md', path: 'space.md', line: 3, column: 1, snippet: 'a needle here' },
        ],
        limit: 50,
        truncated: false,
        finished: true,
      },
    }),
  });
  const groups = screen.getAllByTestId(/^search-group-/);
  expect(groups.map((g) => g.dataset.testid)).toEqual([
    'search-group-lore',
    'search-group-repo:app',
  ]);
  const app = screen.getByTestId('search-group-repo:app');
  expect(within(app).getByText('app')).toBeTruthy();
  expect(within(app).getByText('docs')).toBeTruthy();
  expect(within(screen.getByTestId('search-group-lore')).getByText('a needle here')).toBeTruthy();
});

test('a cap reached, a time limit and a failing root are each said under the root, and the other root still shows', async () => {
  openDialog();
  type('x');
  await release('lore:x', {
    ok: false,
    error: { kind: 'path-refused', message: 'The folder of this root is not known.' },
  });
  await release('repo:app:x', {
    ok: true,
    value: group('repo:app', 'x', {
      outcome: 'timed-out',
      names: {
        hits: [{ name: 'x.md', path: 'x.md' }],
        limit: 40,
        truncated: true,
        finished: true,
      },
      content: { hits: [], limit: 50, truncated: false, finished: false },
    }),
  });
  const lore = screen.getByTestId('search-group-lore');
  expect(within(lore).getByTestId('search-group-notice').textContent).toBe(
    'This root was not searched: The folder of this root is not known.',
  );
  const notices = within(screen.getByTestId('search-group-repo:app'))
    .getAllByTestId('search-group-notice')
    .map((n) => n.textContent);
  expect(notices).toEqual([
    'The search of this root stopped after 10 seconds; the results shown are those found by then.',
    'More than 40 file names match; the 40 best are shown.',
  ]);
  expect(screen.getAllByTestId('search-result')).toHaveLength(1);
});

test('opening a result gives its root and its path, and closes the dialog', async () => {
  const { onOpenResult } = openDialog();
  type('needle');
  await release('lore:needle', { ok: true, value: group('lore', 'needle') });
  await release('repo:app:needle', {
    ok: true,
    value: group('repo:app', 'needle', {
      names: {
        hits: [{ name: 'needle.md', path: 'docs/needle.md' }],
        limit: 40,
        truncated: false,
        finished: true,
      },
    }),
  });
  fireEvent.doubleClick(screen.getByTestId('search-result'));
  expect(onOpenResult).toHaveBeenCalledWith('repo:app', 'docs/needle.md');
  expect(screen.queryByTestId('search-dialog')).toBeNull();
});

test('a newer query drops the results of the older one and asks main to stop it', async () => {
  openDialog();
  type('old');
  await waitFor(() => expect(cockpit.spaceRootSearch).toHaveBeenCalledTimes(2));
  type('new');
  await waitFor(() => expect(cockpit.spaceRootSearchCancel).toHaveBeenCalledTimes(1));
  await release('lore:old', {
    ok: true,
    value: group('lore', 'old', {
      names: {
        hits: [{ name: 'old.md', path: 'old.md' }],
        limit: 40,
        truncated: false,
        finished: true,
      },
    }),
  });
  expect(screen.queryByTestId('search-group-lore')).toBeNull();
  await release('lore:new', {
    ok: true,
    value: group('lore', 'new', {
      names: {
        hits: [{ name: 'new.md', path: 'new.md' }],
        limit: 40,
        truncated: false,
        finished: true,
      },
    }),
  });
  const lore = screen.getByTestId('search-group-lore');
  expect(within(lore).getAllByTestId('search-result')).toHaveLength(1);
  expect(within(lore).queryByText('old.md')).toBeNull();
  expect(within(lore).getAllByText('new.md').length).toBeGreaterThan(0);
});

test('a cancelled result is not shown', async () => {
  openDialog();
  type('q');
  await release('lore:q', { ok: true, value: group('lore', 'q', { outcome: 'cancelled' }) });
  await release('repo:app:q', { ok: true, value: group('repo:app', 'q') });
  expect(screen.queryByTestId('search-group-lore')).toBeNull();
});
