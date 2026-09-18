import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  RootBaselinePicker,
  type RootBaselinePickerProps,
} from '../../../src/renderer/src/space/files/RootBaselinePicker.js';
import { formatAt } from '../../../src/renderer/src/space/files/baselinePickerModel.js';
import type { TrackedRootSummary } from '../../../src/renderer/src/space/files/filesTypes.js';
import type {
  BaselinePoint,
  BaselinePoints,
  BaselineRow,
  DefaultBaseline,
  RootBaselinePoints,
  RootSnapshot,
} from '../../../src/shared/ipc/space/roots.types.js';

// The baseline picker of phase M5.4: the present baseline in words, the four
// kinds of point told apart by a text label, commits grouped under their
// session and collapsible, merged pull requests left out with the reason,
// the limits, choosing a point, going back to the default, the notice.

const MARK = 'a'.repeat(40);
const OLD_MARK = 'b'.repeat(40);
const PR = 'c'.repeat(40);
const CLOSE = 'd'.repeat(40);
const COMMIT_1 = 'e'.repeat(40);
const COMMIT_2 = 'f'.repeat(40);
const LONE = '1'.repeat(40);
const GONE = '2'.repeat(40);

const markPoint: BaselinePoint = {
  kind: 'reviewed-mark',
  commit: MARK,
  at: '2026-09-17T10:00:00Z',
};
const prPoint: BaselinePoint = {
  kind: 'merged-pull-request',
  commit: PR,
  at: '2026-09-16T12:00:00Z',
  number: 42,
  title: 'Add the Files window',
};
const closePoint: BaselinePoint & { kind: 'session-close' } = {
  kind: 'session-close',
  commit: CLOSE,
  at: '2026-09-15T18:00:00Z',
  sessionId: 's-1',
  engine: 'claude-code',
};
const commit1: BaselinePoint & { kind: 'commit' } = {
  kind: 'commit',
  commit: COMMIT_1,
  at: '2026-09-15T17:00:00Z',
  subject: 'Write the picker',
  sessionId: 's-1',
};
const commit2: BaselinePoint & { kind: 'commit' } = {
  kind: 'commit',
  commit: COMMIT_2,
  at: '2026-09-15T16:00:00Z',
  subject: 'Start the picker',
  sessionId: 's-1',
};
const lonePoint: BaselinePoint = {
  kind: 'commit',
  commit: LONE,
  at: '2026-09-14T09:00:00Z',
  subject: 'A commit of no session',
};
const oldMarkPoint: BaselinePoint = {
  kind: 'reviewed-mark',
  commit: OLD_MARK,
  at: '2026-09-10T09:00:00Z',
};
const gonePoint: BaselinePoint = {
  kind: 'reviewed-mark',
  commit: GONE,
  at: '2026-09-01T09:00:00Z',
  commitMissing: true,
};

const ROWS: BaselineRow[] = [
  { kind: 'point', point: markPoint },
  { kind: 'point', point: prPoint },
  {
    kind: 'session',
    sessionId: 's-1',
    at: closePoint.at,
    closes: [closePoint],
    commits: [commit1, commit2],
  },
  { kind: 'point', point: lonePoint },
  { kind: 'point', point: oldMarkPoint },
  { kind: 'point', point: gonePoint },
];

function points(overrides: Partial<BaselinePoints> = {}): RootBaselinePoints {
  return {
    points: {
      rootId: 'repo:app',
      head: COMMIT_1,
      points: [
        markPoint,
        prPoint,
        closePoint,
        commit1,
        commit2,
        lonePoint,
        oldMarkPoint,
        gonePoint,
      ],
      mergedPullRequests: { status: 'read', withoutCommit: 0 },
      limits: {
        commits: 200,
        records: 200,
        pullRequests: 50,
        commitsTruncated: false,
        reviewedMarksTruncated: false,
        sessionClosesTruncated: false,
      },
      ...overrides,
    },
    rows: ROWS,
  };
}

function markDefault(): DefaultBaseline {
  return {
    rootId: 'repo:app',
    baseline: MARK,
    source: 'reviewed-mark',
    at: '2026-09-17T10:00:00Z',
    firstSeenRecorded: false,
    missing: [],
    notice: null,
  };
}

function summary(
  baseline: string,
  defaultBaseline: DefaultBaseline | null = markDefault(),
  baselineNotice: string | null = null,
): TrackedRootSummary {
  return {
    root: {
      id: 'repo:app',
      kind: 'repository',
      name: 'app',
      path: '/work/space/repos/app',
      tracking: { tracked: true, workTree: '/work/space/repos/app', subPath: '' },
    },
    baseline,
    defaultBaseline,
    baselineNotice,
    snapshot: { rootId: 'repo:app', baseline, status: 'ok' } as unknown as RootSnapshot,
    github: 'owner/app',
  } as TrackedRootSummary;
}

let cockpit: {
  spaceRootBaselinePoints: ReturnType<typeof vi.fn>;
  spaceRootSetBaseline: ReturnType<typeof vi.fn>;
  spaceRootResetBaseline: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  cockpit = {
    spaceRootBaselinePoints: vi.fn(async () => ({ ok: true as const, value: points() })),
    spaceRootSetBaseline: vi.fn(async (arg: { rootId: string; baseline: string }) => ({
      ok: true as const,
      value: { rootId: arg.rootId, baseline: arg.baseline, snapshot: {} },
    })),
    spaceRootResetBaseline: vi.fn(async (arg: { rootId: string }) => ({
      ok: true as const,
      value: { rootId: arg.rootId, baseline: MARK, snapshot: {} },
    })),
  };
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

function renderPicker(overrides: Partial<RootBaselinePickerProps> = {}) {
  const props: RootBaselinePickerProps = {
    summary: summary(MARK),
    reloadRoots: vi.fn(),
    ...overrides,
  };
  const view = render(<RootBaselinePicker {...props} />);
  return { props, view };
}

async function openList(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('files-baseline-trigger'));
  return screen.findByRole('tree', { name: 'Baseline points' });
}

test('states the default baseline in words, reviewed mark or first seen, and reads no points for it', () => {
  const { view } = renderPicker();
  expect(screen.getByTestId('files-baseline').textContent).toBe(
    `reviewed mark of ${formatAt('2026-09-17T10:00:00Z')}`,
  );
  expect(screen.getByTestId('files-baseline-trigger').textContent).toContain('default');
  expect(screen.getByTestId('files-baseline-reset')).toHaveProperty('disabled', true);
  expect(cockpit.spaceRootBaselinePoints).not.toHaveBeenCalled();

  const firstSeen: DefaultBaseline = {
    ...markDefault(),
    source: 'first-seen',
    at: '2026-09-01T08:00:00Z',
  };
  view.rerender(<RootBaselinePicker summary={summary(MARK, firstSeen)} reloadRoots={vi.fn()} />);
  expect(screen.getByTestId('files-baseline').textContent).toBe(
    `first seen ${formatAt('2026-09-01T08:00:00Z')}`,
  );
});

test('states a baseline away from the default by its point: pull request, session close, commit', async () => {
  const { view } = renderPicker({ summary: summary(PR) });
  await waitFor(() =>
    expect(screen.getByTestId('files-baseline').textContent).toBe(
      'merged pull request #42 Add the Files window',
    ),
  );
  expect(screen.getByTestId('files-baseline-reset')).toHaveProperty('disabled', false);

  view.rerender(<RootBaselinePicker summary={summary(CLOSE)} reloadRoots={vi.fn()} />);
  expect(screen.getByTestId('files-baseline').textContent).toBe(
    `session close ${formatAt(closePoint.at)}, engine claude-code`,
  );
  view.rerender(<RootBaselinePicker summary={summary(LONE)} reloadRoots={vi.fn()} />);
  expect(screen.getByTestId('files-baseline').textContent).toBe(
    'commit 1111111 A commit of no session',
  );
});

test('lists the points newest first, each kind labelled in text, commits grouped under their session', async () => {
  renderPicker();
  const tree = await openList();
  expect(within(tree).getAllByRole('treeitem')).toHaveLength(9);

  const pointRows = within(tree).getAllByTestId('files-baseline-point');
  expect(pointRows.map((row) => row.getAttribute('data-kind'))).toEqual([
    'reviewed-mark',
    'merged-pull-request',
    'session-close',
    'commit',
    'commit',
    'commit',
    'reviewed-mark',
    'reviewed-mark',
  ]);
  // The label of each kind is text in the row, one to one with the kind's name.
  expect(within(pointRows[0] as HTMLElement).getByText('reviewed mark')).toBeTruthy();
  expect(within(pointRows[1] as HTMLElement).getByText('merged pull request')).toBeTruthy();
  expect(within(pointRows[2] as HTMLElement).getByText('session close')).toBeTruthy();
  expect(within(pointRows[3] as HTMLElement).getByText('commit')).toBeTruthy();

  const session = within(tree).getByTestId('files-baseline-session');
  expect(session.textContent).toContain('session');
  expect(session.textContent).toContain('s-1');
  expect(session.textContent).toContain('3 points');
  expect(session.getAttribute('aria-expanded')).toBe('true');
  for (const row of pointRows.slice(2, 5)) expect(row.getAttribute('aria-level')).toBe('2');
  expect(pointRows[5]?.getAttribute('aria-level')).toBe('1');

  // The present baseline is the selected point.
  expect(pointRows[0]?.getAttribute('aria-selected')).toBe('true');
  expect(pointRows[1]?.getAttribute('aria-selected')).toBe('false');

  // A mark whose commit is gone cannot be chosen, and says why.
  expect(pointRows[7]?.getAttribute('aria-disabled')).toBe('true');
  expect(pointRows[7]?.textContent).toContain('its commit is not in the repository');

  // The group collapses and opens again.
  fireEvent.click(session);
  expect(session.getAttribute('aria-expanded')).toBe('false');
  expect(within(tree).getAllByTestId('files-baseline-point')).toHaveLength(5);
  fireEvent.click(session);
  expect(within(tree).getAllByTestId('files-baseline-point')).toHaveLength(8);

  // The session close names its session's engine.
  expect(pointRows[2]?.textContent).toContain('engine claude-code');

  // Reading and browsing the points sets nothing.
  expect(cockpit.spaceRootBaselinePoints).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
  expect(cockpit.spaceRootResetBaseline).not.toHaveBeenCalled();
});

test('Home, End and a typed letter move through the lines, and the tree is one tab stop', async () => {
  renderPicker();
  const tree = await openList();
  expect(tree.getAttribute('tabindex')).toBe('0');
  for (const item of within(tree).getAllByRole('treeitem')) {
    expect(item.hasAttribute('tabindex')).toBe(false);
  }
  const activeId = (): string | null => tree.getAttribute('aria-activedescendant');
  const items = within(tree).getAllByRole('treeitem');
  fireEvent.keyDown(tree, { key: 'End' });
  expect(activeId()).toBe(items.at(-1)?.id);
  fireEvent.keyDown(tree, { key: 'Home' });
  expect(activeId()).toBe(items[0]?.id);
  fireEvent.keyDown(tree, { key: 'm' });
  expect(activeId()).toBe(items[1]?.id);
  fireEvent.keyDown(tree, { key: 's' });
  expect(activeId()).toBe(items[2]?.id);
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
});

test('a root with no GitHub repository says so in a sentence of its own', async () => {
  cockpit.spaceRootBaselinePoints.mockResolvedValue({
    ok: true,
    value: points({ mergedPullRequests: { status: 'not-applicable' } }),
  });
  renderPicker();
  await openList();
  const sentences = screen.getAllByTestId('files-baseline-sentence').map((p) => p.textContent);
  expect(sentences).toEqual([
    'Merged pull requests are not listed because this root is not a repository root with a GitHub repository.',
  ]);
});

test('the limit of merged pull requests counts those given without a merge commit', async () => {
  cockpit.spaceRootBaselinePoints.mockResolvedValue({
    ok: true,
    value: points({
      mergedPullRequests: { status: 'read', withoutCommit: 1 },
      limits: {
        commits: 200,
        records: 200,
        pullRequests: 2,
        commitsTruncated: false,
        reviewedMarksTruncated: false,
        sessionClosesTruncated: false,
      },
    }),
  });
  renderPicker();
  await openList();
  const sentences = screen.getAllByTestId('files-baseline-sentence').map((p) => p.textContent);
  expect(sentences).toEqual([
    '1 merged pull request is not listed because GitHub gave no merge commit for it.',
    'Only the newest 2 merged pull requests are listed.',
  ]);
});

test('a failed read of the points is shown as main said it, and nothing is set', async () => {
  cockpit.spaceRootBaselinePoints.mockResolvedValue({
    ok: false,
    error: { kind: 'git-failed', message: 'git log exited with code 128.' },
  });
  renderPicker();
  fireEvent.click(screen.getByTestId('files-baseline-trigger'));
  expect((await screen.findByTestId('files-baseline-points-error')).textContent).toBe(
    'git log exited with code 128.',
  );
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
});

test('choosing a point sets the baseline, reads the roots again and announces the new baseline', async () => {
  const { props } = renderPicker();
  const tree = await openList();
  fireEvent.click(
    within(tree).getByRole('treeitem', { name: 'merged pull request #42 Add the Files window' }),
  );
  await waitFor(() => expect(props.reloadRoots).toHaveBeenCalledTimes(1));
  expect(cockpit.spaceRootSetBaseline).toHaveBeenCalledWith({ rootId: 'repo:app', baseline: PR });
  expect(screen.getByTestId('files-baseline-status').textContent).toBe(
    'Baseline set to merged pull request #42 Add the Files window.',
  );
  expect(screen.queryByRole('tree')).toBeNull();
});

test('a point whose commit is gone is not chosen', async () => {
  renderPicker();
  const tree = await openList();
  const gone = within(tree).getAllByTestId('files-baseline-point').at(-1) as HTMLElement;
  fireEvent.click(gone);
  expect(cockpit.spaceRootSetBaseline).not.toHaveBeenCalled();
});

test('the keyboard moves through the points, closes and opens a group, and chooses with Enter', async () => {
  renderPicker();
  const tree = await openList();
  const activeLabel = (): string | null => {
    const id = tree.getAttribute('aria-activedescendant');
    const element = id === null ? null : document.getElementById(id);
    return element?.getAttribute('aria-label') ?? element?.getAttribute('data-session-id') ?? null;
  };
  // Starts on the selected point.
  expect(activeLabel()).toBe(`reviewed mark of ${formatAt(markPoint.at)}`);
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  expect(activeLabel()).toBe('s-1');
  fireEvent.keyDown(tree, { key: 'ArrowLeft' });
  expect(within(tree).getByTestId('files-baseline-session').getAttribute('aria-expanded')).toBe(
    'false',
  );
  fireEvent.keyDown(tree, { key: 'ArrowRight' });
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  expect(activeLabel()).toBe('commit eeeeeee Write the picker');
  fireEvent.keyDown(tree, { key: 'ArrowLeft' });
  expect(activeLabel()).toBe('s-1');
  fireEvent.keyDown(tree, { key: 'ArrowDown' });
  fireEvent.keyDown(tree, { key: 'Enter' });
  await waitFor(() =>
    expect(cockpit.spaceRootSetBaseline).toHaveBeenCalledWith({
      rootId: 'repo:app',
      baseline: CLOSE,
    }),
  );
});

test('merged pull requests left out when GitHub cannot be reached are stated in one sentence', async () => {
  cockpit.spaceRootBaselinePoints.mockResolvedValue({
    ok: true,
    value: points({
      mergedPullRequests: {
        status: 'omitted',
        reason: 'unreachable',
        message: 'getaddrinfo ENOTFOUND',
      },
    }),
  });
  renderPicker();
  await openList();
  const sentences = screen.getAllByTestId('files-baseline-sentence').map((p) => p.textContent);
  expect(sentences).toEqual([
    'Merged pull requests are not listed because GitHub could not be reached.',
  ]);
});

test('the limits are stated when the list was cut', async () => {
  cockpit.spaceRootBaselinePoints.mockResolvedValue({
    ok: true,
    value: points({
      limits: {
        commits: 200,
        records: 200,
        pullRequests: 50,
        commitsTruncated: true,
        reviewedMarksTruncated: true,
        sessionClosesTruncated: false,
      },
    }),
  });
  renderPicker();
  await openList();
  const sentences = screen.getAllByTestId('files-baseline-sentence').map((p) => p.textContent);
  expect(sentences).toEqual([
    'Only the newest 200 commits are listed.',
    'Only the newest 200 reviewed marks are listed.',
  ]);
});

test('back to the default resets the baseline and reads the roots again', async () => {
  const { props } = renderPicker({ summary: summary(LONE) });
  fireEvent.click(screen.getByTestId('files-baseline-reset'));
  await waitFor(() => expect(props.reloadRoots).toHaveBeenCalledTimes(1));
  expect(cockpit.spaceRootResetBaseline).toHaveBeenCalledWith({ rootId: 'repo:app' });
  expect(screen.getByTestId('files-baseline-status').textContent).toBe(
    `Baseline set back to the default, reviewed mark of ${formatAt(markPoint.at)}.`,
  );
});

test('a refused baseline is reported and nothing is read again', async () => {
  cockpit.spaceRootSetBaseline.mockResolvedValue({
    ok: false,
    error: { kind: 'baseline-missing', message: 'The commit is not in the repository.' },
  });
  const { props } = renderPicker();
  const tree = await openList();
  fireEvent.click(
    within(tree).getByRole('treeitem', { name: 'commit 1111111 A commit of no session' }),
  );
  expect((await screen.findByTestId('files-baseline-error')).textContent).toBe(
    'The commit is not in the repository.',
  );
  expect(props.reloadRoots).not.toHaveBeenCalled();
});

test('the baseline notice of the root is shown', async () => {
  await act(async () => {
    renderPicker({
      summary: summary(
        OLD_MARK,
        markDefault(),
        'The reviewed mark of 1 September is not in the repository.',
      ),
    });
  });
  expect(screen.getByTestId('files-baseline-notice').textContent).toBe(
    'The reviewed mark of 1 September is not in the repository.',
  );
});
