import type { RepositoriesModel, RepositoryRow } from '@ai-lore-companion/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Repositories } from '../../../src/renderer/src/space/dashboard/Repositories.js';
import type {
  SpaceRepositoriesState,
  SpaceRepositoriesStateResult,
} from '../../../src/shared/ipc.js';

// The Repositories section of the Dashboard (stage D1, phase D1.4): one row
// per repository root, with its branch, its uncommitted changes, its
// comparison with its remote and its changes since the reviewed mark. Every
// sentence asserted here is section 6.3 of `dashboard-repositories-
// architecture.md`, word for word, since the sentences are the specification.

const NOW = Date.parse('2026-09-20T12:00:00.000Z');

/** A `RepositoryRow` with the fields a test does not care about filled in. */
function row(
  over: Partial<RepositoryRow> & Pick<RepositoryRow, 'rootId' | 'status'>,
): RepositoryRow {
  return {
    rootId: over.rootId,
    kind: 'repository',
    name: 'app',
    path: '/work/space/repos/app',
    github: null,
    alsoCovers: [],
    status: over.status,
    notKnown: null,
    head: null,
    operation: null,
    remote: null,
    changes: null,
    ...over,
  };
}

const model = (rows: RepositoryRow[]): RepositoriesModel => ({ rows });

const pushState = (m: RepositoriesModel | null): SpaceRepositoriesState => ({
  version: 1,
  reading: false,
  model: m,
  readAt: '2026-09-20T11:59:00.000Z',
  problem: null,
});

let pushed: ((payload: SpaceRepositoriesState) => void) | null = null;

const cockpit = {
  spaceRepositoriesState: vi.fn<(arg: unknown) => Promise<SpaceRepositoriesStateResult>>(),
  spaceRepositoriesRefresh: vi.fn<(arg: unknown) => Promise<SpaceRepositoriesStateResult>>(),
  spaceRepositoriesFocus: vi.fn<(arg: unknown) => Promise<SpaceRepositoriesStateResult>>(),
  onSpaceRepositoriesState: vi.fn((listener: (payload: SpaceRepositoriesState) => void) => {
    pushed = listener;
    return () => {
      pushed = null;
    };
  }),
  spaceNavigate: vi.fn(async () => ({ ok: true, value: {} })),
};

const answer = (m: RepositoriesModel | null): SpaceRepositoriesStateResult => ({
  ok: true,
  value: pushState(m),
});

beforeEach(() => {
  pushed = null;
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceRepositoriesState.mockResolvedValue(answer(null));
  cockpit.spaceRepositoriesRefresh.mockResolvedValue(answer(null));
  cockpit.spaceRepositoriesFocus.mockResolvedValue(answer(null));
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

/** Render with the given rows already answered, and wait for the section to settle. */
const shownWith = async (rows: RepositoryRow[]): Promise<void> => {
  cockpit.spaceRepositoriesState.mockResolvedValue(answer(model(rows)));
  render(<Repositories now={NOW} />);
  if (rows.length === 0) {
    await screen.findByTestId('dashboard-repositories-empty');
  } else {
    await screen.findAllByTestId('repository-row');
  }
};

test('before any answer the section shows its heading and the reading sentence, at once', async () => {
  let resolve: (value: SpaceRepositoriesStateResult) => void = () => {};
  cockpit.spaceRepositoriesState.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<Repositories now={NOW} />);
  expect(screen.getByTestId('dashboard-repositories')).toBeTruthy();
  expect(screen.getByTestId('dashboard-repositories-reading').textContent).toBe(
    "Reading the Space's repositories.",
  );
  await act(async () => resolve(answer(model([]))));
  expect(screen.getByTestId('dashboard-repositories-empty').textContent).toBe(
    'This Space has no repository.',
  );
});

test('a section with no row at all shows the literal sentence', async () => {
  await shownWith([]);
  expect(screen.getByTestId('dashboard-repositories-empty').textContent).toBe(
    'This Space has no repository.',
  );
  expect(screen.queryByTestId('repository-row')).toBeNull();
});

test('a ready row shows the branch line, the uncommitted line, the remote line and the changes line', async () => {
  await shownWith([
    row({
      rootId: 'repo:app',
      status: 'ready',
      head: { kind: 'branch', branch: 'main', commit: 'a'.repeat(40) },
      operation: null,
      remote: {
        remote: 'origin',
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        unknown: null,
        lastFetchAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
      },
      changes: {
        total: 3,
        uncommitted: 3,
        truncated: false,
        baseline: 'HEAD',
        baselineSource: 'reviewed-mark',
        baselineAt: '2026-09-19T09:00:00.000Z',
        baselineIsAncestor: true,
      },
    }),
  ]);
  const item = screen.getByTestId('repository-row');
  expect(item.getAttribute('data-root-id')).toBe('repo:app');
  expect(item.getAttribute('data-status')).toBe('ready');
  expect(item.getAttribute('data-kind')).toBe('repository');
  expect(within(item).getByTestId('repository-row-branch').textContent).toBe('On the branch main.');
  expect(within(item).getByTestId('repository-row-uncommitted').textContent).toBe(
    '3 uncommitted changes.',
  );
  expect(within(item).getByTestId('repository-row-remote').textContent).toBe(
    '2 commits ahead of and 1 commit behind origin/main. Read from what this repository already knows; it last fetched 5 minutes ago.',
  );
  expect(within(item).getByTestId('repository-row-changes').textContent).toBe(
    `3 files have changed since the reviewed mark of ${new Date('2026-09-19T09:00:00.000Z').toLocaleString()}.`,
  );
});

test('a row mid-merge shows the operation line and still shows the counts', async () => {
  await shownWith([
    row({
      rootId: 'repo:app',
      status: 'ready',
      head: { kind: 'branch', branch: 'main', commit: 'a'.repeat(40) },
      operation: 'merge',
      remote: {
        remote: 'origin',
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
        unknown: null,
        lastFetchAt: null,
      },
      changes: null,
    }),
  ]);
  const item = screen.getByTestId('repository-row');
  expect(within(item).getByTestId('repository-row-operation').textContent).toBe(
    'A merge is in progress.',
  );
  expect(within(item).getByTestId('repository-row-remote').textContent).toBe(
    '1 commit ahead of origin/main. Read from what this repository already knows; there is no record of a fetch in it.',
  );
});

test('a row mid-rebase shows the rebase line and the detached-head sentence, with no number', async () => {
  await shownWith([
    row({
      rootId: 'repo:app',
      status: 'ready',
      head: { kind: 'detached', commit: 'e'.repeat(40), rebasing: 'feature' },
      operation: 'rebase',
      remote: {
        remote: null,
        upstream: null,
        ahead: null,
        behind: null,
        unknown: { reason: 'detached-head', message: 'This repository is not on a branch.' },
        lastFetchAt: null,
      },
      changes: null,
    }),
  ]);
  const item = screen.getByTestId('repository-row');
  expect(within(item).getByTestId('repository-row-operation').textContent).toBe(
    'A rebase of feature is in progress.',
  );
  const remoteText = within(item).getByTestId('repository-row-remote').textContent ?? '';
  expect(remoteText).toBe('Ahead and behind are not known: this repository is not on a branch.');
  expect(remoteText).not.toMatch(/\d/);
});

const UNKNOWN_CASES: {
  name: string;
  head: RepositoryRow['head'];
  remote: NonNullable<RepositoryRow['remote']>;
  expected: string;
}[] = [
  {
    name: 'no-remote',
    head: { kind: 'branch', branch: 'main', commit: 'a'.repeat(40) },
    remote: {
      remote: null,
      upstream: null,
      ahead: null,
      behind: null,
      unknown: { reason: 'no-remote', message: 'This repository has no remote.' },
      lastFetchAt: null,
    },
    expected: 'Ahead and behind are not known: this repository has no remote.',
  },
  {
    name: 'no-upstream',
    head: { kind: 'branch', branch: 'solo', commit: 'a'.repeat(40) },
    remote: {
      remote: 'origin',
      upstream: null,
      ahead: null,
      behind: null,
      unknown: { reason: 'no-upstream', message: 'The branch solo has no tracking branch.' },
      lastFetchAt: null,
    },
    expected: 'Ahead and behind are not known: the branch solo has no tracking branch.',
  },
  {
    name: 'upstream-missing',
    head: { kind: 'branch', branch: 'gonebr', commit: 'a'.repeat(40) },
    remote: {
      remote: 'origin',
      upstream: 'origin/gonebr',
      ahead: null,
      behind: null,
      unknown: {
        reason: 'upstream-missing',
        message: 'The tracking branch origin/gonebr is not in this repository.',
      },
      lastFetchAt: null,
    },
    expected:
      'Ahead and behind are not known: the tracking branch origin/gonebr is not in this repository. It has not been fetched, or it was deleted on the remote.',
  },
  {
    name: 'detached-head',
    head: { kind: 'detached', commit: 'd'.repeat(40), rebasing: null },
    remote: {
      remote: null,
      upstream: null,
      ahead: null,
      behind: null,
      unknown: { reason: 'detached-head', message: 'This repository is not on a branch.' },
      lastFetchAt: null,
    },
    expected: 'Ahead and behind are not known: this repository is not on a branch.',
  },
  {
    name: 'unborn-branch',
    head: { kind: 'unborn-branch', branch: 'main' },
    remote: {
      remote: null,
      upstream: null,
      ahead: null,
      behind: null,
      unknown: { reason: 'unborn-branch', message: 'The branch main has no commit yet.' },
      lastFetchAt: null,
    },
    expected: 'Ahead and behind are not known: the branch main has no commit yet.',
  },
  {
    name: 'git-failed',
    head: { kind: 'branch', branch: 'main', commit: 'a'.repeat(40) },
    remote: {
      remote: 'origin',
      upstream: 'origin/main',
      ahead: null,
      behind: null,
      unknown: { reason: 'git-failed', message: 'git rev-list did not finish in time' },
      lastFetchAt: null,
    },
    expected: 'Ahead and behind are not known: git rev-list did not finish in time.',
  },
];

for (const testCase of UNKNOWN_CASES) {
  test(`the ${testCase.name} reason gives its sentence and no number`, async () => {
    await shownWith([
      row({
        rootId: 'repo:app',
        status: 'ready',
        head: testCase.head,
        operation: null,
        remote: testCase.remote,
        changes: null,
      }),
    ]);
    const text = screen.getByTestId('repository-row-remote').textContent ?? '';
    expect(text).toBe(testCase.expected);
    expect(text).not.toMatch(/\d/);
  });
}

test('a reading row shows the name and one line', async () => {
  await shownWith([row({ rootId: 'repo:app', status: 'reading' })]);
  const item = screen.getByTestId('repository-row');
  expect(item.getAttribute('data-status')).toBe('reading');
  expect(within(item).getByTestId('repository-row-reading').textContent).toBe(
    'Reading this repository.',
  );
  expect(within(item).queryByTestId('repository-row-branch')).toBeNull();
});

test('an untracked row shows the root’s own message, unchanged', async () => {
  await shownWith([
    row({
      rootId: 'repo:gone',
      status: 'untracked',
      notKnown: 'There is no folder at /work/space/repos/gone.',
    }),
  ]);
  const item = screen.getByTestId('repository-row');
  expect(item.getAttribute('data-status')).toBe('untracked');
  expect(within(item).getByTestId('repository-row-untracked').textContent).toBe(
    'There is no folder at /work/space/repos/gone.',
  );
});

test('a failed row shows its message', async () => {
  await shownWith([
    row({
      rootId: 'repo:app',
      status: 'failed',
      notKnown: 'git status did not finish in time',
    }),
  ]);
  const item = screen.getByTestId('repository-row');
  expect(item.getAttribute('data-status')).toBe('failed');
  expect(within(item).getByTestId('repository-row-failed').textContent).toBe(
    'This repository could not be read: git status did not finish in time',
  );
});

test('the name button calls spaceNavigate with the Files window and this root', async () => {
  await shownWith([row({ rootId: 'repo:app', status: 'reading' })]);
  fireEvent.click(screen.getByTestId('repository-row-name'));
  expect(cockpit.spaceNavigate).toHaveBeenCalledWith({
    to: 'space-files',
    open: { rootId: 'repo:app' },
  });
});

test('the name is the root’s name, and a GitHub repository follows it with owner/name', async () => {
  await shownWith([
    row({ rootId: 'repo:app', status: 'reading', name: 'app', github: 'octocat/app' }),
    row({ rootId: 'lore', status: 'reading', kind: 'lore', name: 'Lore', github: null }),
  ]);
  const items = screen.getAllByTestId('repository-row');
  expect(within(items[0]).getByTestId('repository-row-name').textContent).toBe('app');
  expect(within(items[0]).getByText('— octocat/app')).toBeTruthy();
  expect(within(items[1]).getByTestId('repository-row-name').textContent).toBe('Lore');
  expect(within(items[1]).queryByText(/—/)).toBeNull();
});
