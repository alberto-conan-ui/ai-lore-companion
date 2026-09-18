import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import {
  MARK_REVIEWED_ALREADY_REASON,
  MARK_REVIEWED_NO_COMMITS_REASON,
  MARK_REVIEWED_SENTENCE,
  RootChangesPanel,
  type RootChangesPanelProps,
} from '../../../src/renderer/src/space/files/RootChangesPanel.js';
import type { TrackedRootSummary } from '../../../src/renderer/src/space/files/filesTypes.js';
import type {
  RootMarkedReviewed,
  RootSnapshot,
  SpaceRootsResult,
} from '../../../src/shared/ipc/space/roots.types.js';

// The Changes panel of phase M5.3: the list per root with committed and uncommitted
// told apart, the count, the filter, the index-files switch, opening and revealing a
// change, and Mark as reviewed with its disabled states, its result and its errors.

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

const MARK = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);

type Entry = { code: string; path: string; oldPath?: string };

function snapshot(
  entries: Entry[],
  uncommitted: string[],
  { head = HEAD, baseline = MARK }: { head?: string | null; baseline?: string } = {},
): RootSnapshot {
  return {
    rootId: 'repo:app',
    baseline,
    status: 'ok',
    changes: {
      baseline,
      baselineCommit: baseline,
      baselineIsAncestor: true,
      head,
      branch: { branch: 'main', detached: false },
      entries,
      uncommitted,
      total: entries.length,
      truncated: false,
      limit: 20000,
    },
  } as RootSnapshot;
}

/** The gate's repository: committed since the mark, a rename, and uncommitted files. */
const GATE_ENTRIES: Entry[] = [
  { code: 'A ', path: 'src/added.ts' },
  { code: 'M ', path: 'src/change-me.ts' },
  { code: 'D ', path: 'src/delete-me.ts' },
  { code: 'R ', path: 'src/renamed.ts', oldPath: 'src/rename-me.ts' },
  { code: 'M ', path: 'docs/edit-uncommitted.md' },
  { code: 'D ', path: 'docs/delete-uncommitted.md' },
  { code: '??', path: 'notes/untracked.md' },
];
const GATE_UNCOMMITTED = [
  'docs/edit-uncommitted.md',
  'docs/delete-uncommitted.md',
  'notes/untracked.md',
];

function summary(snap: RootSnapshot, markCommit: string | null = MARK): TrackedRootSummary {
  return {
    root: {
      id: 'repo:app',
      kind: 'repository',
      name: 'app',
      path: '/work/space/repos/app',
      tracking: { tracked: true, workTree: '/work/space/repos/app', subPath: '' },
    },
    baseline: snap.baseline,
    defaultBaseline:
      markCommit === null
        ? null
        : {
            rootId: 'repo:app',
            baseline: markCommit,
            source: 'reviewed-mark',
            at: '2026-09-17T10:00:00.000Z',
            firstSeenRecorded: false,
          },
    baselineNotice: null,
    snapshot: snap,
    github: null,
  } as TrackedRootSummary;
}

let markReviewed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  markReviewed = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = { spaceRootMarkReviewed: markReviewed };
});

afterEach(() => cleanup());

function renderPanel(overrides: Partial<RootChangesPanelProps> = {}) {
  const props: RootChangesPanelProps = {
    summary: summary(snapshot(GATE_ENTRIES, GATE_UNCOMMITTED)),
    deskWritable: true,
    deskNotice: null,
    onRevealFile: vi.fn(),
    onOpenFile: vi.fn(),
    reloadRoots: vi.fn(),
    ...overrides,
  };
  const view = render(<RootChangesPanel {...props} />);
  return { props, view };
}

function listed(): { path: string; kind: string; state: string }[] {
  return screen.queryAllByTestId('root-change').map((row) => ({
    path: row.getAttribute('data-path') ?? '',
    kind: row.getAttribute('data-kind') ?? '',
    state: row.getAttribute('data-state') ?? '',
  }));
}

test('lists added, changed, deleted and renamed changes, committed and uncommitted apart, with a count', () => {
  renderPanel();
  expect(screen.getByTestId('root-changes-count').textContent).toBe('7 changes');
  const list = screen.getByRole('listbox');
  const options = within(list).getAllByRole('option');
  expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
    'added src/added.ts, committed',
    'changed src/change-me.ts, committed',
    'deleted src/delete-me.ts, committed',
    'renamed src/renamed.ts from src/rename-me.ts, committed',
    'deleted docs/delete-uncommitted.md, uncommitted',
    'changed docs/edit-uncommitted.md, uncommitted',
    'added notes/untracked.md, uncommitted',
  ]);
  expect(screen.getByTestId('root-changes-group-committed').textContent).toBe('committed 4');
  expect(screen.getByTestId('root-changes-group-uncommitted').textContent).toBe('uncommitted 3');
  expect(within(options[3] as HTMLElement).getByText('from src/rename-me.ts')).toBeTruthy();
  expect(within(options[3] as HTMLElement).getByText('renamed')).toBeTruthy();
});

test('the text filter narrows the list and the count, on the path and on the old path', () => {
  renderPanel();
  const filter = screen.getByRole('searchbox', { name: 'Filter changes' });
  fireEvent.change(filter, { target: { value: 'RENAME-ME' } });
  expect(listed().map((row) => row.path)).toEqual(['src/renamed.ts']);
  expect(screen.getByTestId('root-changes-count').textContent).toBe('1 change');
  fireEvent.change(filter, { target: { value: 'nothing-like-this' } });
  expect(screen.getByTestId('root-changes-empty').textContent).toBe('No change matches.');
});

test('the index-files switch hides index.md and <name>.index.md files by default and shows them when on', () => {
  const entries: Entry[] = [
    { code: ' M', path: 'lore/index.md' },
    { code: ' M', path: 'lore/memory/status/status.index.md' },
    { code: ' M', path: 'lore/memory/notes.md' },
    { code: ' M', path: 'lore/reindex.md' },
  ];
  renderPanel({
    summary: summary(
      snapshot(
        entries,
        entries.map((entry) => entry.path),
        { baseline: HEAD },
      ),
    ),
  });
  const toggle = screen.getByRole('switch', { name: 'index files: hidden' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(listed().map((row) => row.path)).toEqual(['lore/memory/notes.md', 'lore/reindex.md']);
  expect(screen.getByTestId('root-changes-hidden-index').textContent).toBe('2 index files hidden');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(listed()).toHaveLength(4);
  expect(screen.getByTestId('root-changes-count').textContent).toBe('4 changes');
});

test('a click reveals a change in the tree; a double click and Enter open its diff; Open code opens the file', () => {
  const { props } = renderPanel();
  const renamed = screen.getByRole('option', { name: /^renamed src\/renamed.ts/ });
  fireEvent.click(renamed);
  expect(props.onRevealFile).toHaveBeenCalledWith('src/renamed.ts');
  expect(renamed.getAttribute('aria-selected')).toBe('true');

  fireEvent.doubleClick(renamed);
  expect(props.onOpenFile).toHaveBeenLastCalledWith({
    path: 'src/renamed.ts',
    mode: 'diff',
    oldPath: 'src/rename-me.ts',
  });

  const list = screen.getByRole('listbox');
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  const next = screen.getByRole('option', { name: /^deleted docs\/delete-uncommitted.md/ });
  expect(next.getAttribute('aria-selected')).toBe('true');
  expect(list.getAttribute('aria-activedescendant')).toBe(next.id);
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(props.onOpenFile).toHaveBeenLastCalledWith({
    path: 'docs/delete-uncommitted.md',
    mode: 'diff',
  });
  // A deleted file has no code to open.
  expect((screen.getByRole('button', { name: 'Open code' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.keyDown(list, { key: 'End' });
  fireEvent.click(screen.getByRole('button', { name: 'Open code' }));
  expect(props.onOpenFile).toHaveBeenLastCalledWith({ path: 'notes/untracked.md', mode: 'code' });
  fireEvent.click(screen.getByRole('button', { name: 'Reveal in tree' }));
  expect(props.onRevealFile).toHaveBeenLastCalledWith('notes/untracked.md');
});

test('Mark as reviewed says what it does, and is disabled with the desk notice when the desk is not writable', () => {
  const notice = 'Another instance of the companion owns this desk (pid 42).';
  renderPanel({ deskWritable: false, deskNotice: notice });
  const button = screen.getByRole('button', { name: 'Mark as reviewed' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  const sentence = screen.getByTestId('root-mark-reviewed-sentence');
  expect(sentence.textContent).toContain(MARK_REVIEWED_SENTENCE);
  expect(screen.getByTestId('root-mark-reviewed-reason').textContent).toBe(
    `Not available: ${notice}`,
  );
  expect(button.getAttribute('aria-describedby')).toBe(sentence.id);
});

test('Mark as reviewed is disabled with a reason when nothing committed is left to mark', () => {
  const { view } = renderPanel({
    summary: summary(snapshot([{ code: '??', path: 'a.md' }], ['a.md'], { baseline: HEAD }), HEAD),
  });
  expect(
    (screen.getByRole('button', { name: 'Mark as reviewed' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByTestId('root-mark-reviewed-reason').textContent).toBe(
    `Not available: ${MARK_REVIEWED_ALREADY_REASON}`,
  );
  view.unmount();

  renderPanel({
    summary: summary(
      snapshot([{ code: '??', path: 'a.md' }], ['a.md'], { head: null, baseline: 'HEAD' }),
      null,
    ),
  });
  expect(screen.getByTestId('root-mark-reviewed-reason').textContent).toBe(
    `Not available: ${MARK_REVIEWED_NO_COMMITS_REASON}`,
  );
});

test('marking as reviewed shows the result and leaves only the uncommitted changes, live', async () => {
  const after = snapshot(
    GATE_ENTRIES.filter((entry) => GATE_UNCOMMITTED.includes(entry.path)),
    GATE_UNCOMMITTED,
    { baseline: HEAD },
  );
  const reply: SpaceRootsResult<RootMarkedReviewed> = {
    ok: true,
    value: {
      rootId: 'repo:app',
      mark: { rootId: 'repo:app', commit: HEAD, markedAt: '2026-09-18T12:00:00.000Z' },
      baseline: HEAD,
      snapshot: after,
    },
  };
  let resolve: (value: typeof reply) => void = () => undefined;
  markReviewed.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { props, view } = renderPanel();

  const button = screen.getByRole('button', { name: 'Mark as reviewed' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(markReviewed).toHaveBeenCalledWith({ rootId: 'repo:app' });
  const busy = screen.getByRole('button', { name: 'Marking as reviewed…' });
  expect(busy.getAttribute('aria-busy')).toBe('true');
  expect((busy as HTMLButtonElement).disabled).toBe(true);

  await act(async () => resolve(reply));
  expect(screen.getByTestId('root-mark-reviewed-result').textContent).toBe(
    'Marked commit ccccccc as reviewed at 2026-09-18T12:00:00.000Z. Files changed and not committed stay listed: 3.',
  );
  expect(listed().map((row) => row.state)).toEqual(['uncommitted', 'uncommitted', 'uncommitted']);
  expect(screen.queryByTestId('root-changes-group-committed')).toBeNull();
  expect(props.reloadRoots).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('root-mark-reviewed-reason').textContent).toBe(
    `Not available: ${MARK_REVIEWED_ALREADY_REASON}`,
  );

  // A later push from main replaces the list.
  const pushed = snapshot([{ code: '??', path: 'notes/new.md' }], ['notes/new.md'], {
    baseline: HEAD,
  });
  view.rerender(<RootChangesPanel {...props} summary={summary(pushed, HEAD)} />);
  expect(listed().map((row) => row.path)).toEqual(['notes/new.md']);
});

test('two clicks on Mark as reviewed before it re-renders mark once', async () => {
  markReviewed.mockReturnValue(new Promise(() => undefined));
  renderPanel();
  const button = screen.getByRole('button', { name: 'Mark as reviewed' });
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(markReviewed).toHaveBeenCalledTimes(1);
});

test('a refused mark shows the message literally and leaves the list as it was', async () => {
  const message = 'Another running instance of the companion owns the desk of this Space.';
  markReviewed.mockResolvedValue({ ok: false, error: { kind: 'desk-not-writable', message } });
  const { props } = renderPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mark as reviewed' }));
  });
  expect(screen.getByRole('alert').textContent).toBe(message);
  expect(listed()).toHaveLength(7);
  expect(props.reloadRoots).not.toHaveBeenCalled();
});

test('a failed read of the changes is shown literally', () => {
  const failed = {
    rootId: 'repo:app',
    baseline: MARK,
    status: 'failed',
    error: {
      kind: 'baseline-missing',
      message: 'the commit bbbb is not in this repository any more',
    },
  } as RootSnapshot;
  renderPanel({ summary: summary(failed) });
  expect(screen.getByTestId('root-changes-error').textContent).toBe(
    'the commit bbbb is not in this repository any more',
  );
});

test('a list of 5,000 changes mounts only the rows in view and filters at once', () => {
  const entries: Entry[] = Array.from({ length: 5000 }, (_, i) => ({
    code: 'M ',
    path: `src/file-${String(i).padStart(4, '0')}.ts`,
  }));
  const started = performance.now();
  renderPanel({ summary: summary(snapshot(entries, [])) });
  expect(screen.getByTestId('root-changes-count').textContent).toBe('5000 changes');
  expect(screen.getAllByRole('option').length).toBeLessThan(60);
  expect(screen.getByRole('option', { name: /file-0000/ }).getAttribute('aria-setsize')).toBe(
    '5000',
  );
  // The keyboard reaches a row far outside the mounted window.
  const list = screen.getByRole('listbox');
  fireEvent.keyDown(list, { key: 'End' });
  const active = list.getAttribute('aria-activedescendant');
  expect(active).not.toBeNull();
  expect(document.getElementById(active ?? '')?.getAttribute('data-path')).toBe('src/file-4999.ts');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'file-4999' } });
  expect(listed().map((row) => row.path)).toEqual(['src/file-4999.ts']);
  expect(performance.now() - started).toBeLessThan(3000);
});
