import type { DashboardModel, FocusCard, ItemCard } from '@ai-lore-companion/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Dashboard } from '../../../src/renderer/src/space/dashboard/Dashboard.js';
import type {
  SpaceEngineChoice,
  SpaceProjectState,
  SpaceProjectStateResult,
  SpaceSessionEnginesResult,
} from '../../../src/shared/ipc.js';

/** A ready `SpaceEngineChoice`: Claude Code, startable. */
const READY_CHOICE: SpaceEngineChoice = {
  options: [
    { engineId: 'default.claude', name: 'Claude Code', canStart: true, reason: null, fix: null },
  ],
  engineId: 'default.claude',
  buttonName: 'Claude Code',
  refusal: null,
};

const REPO = 'owner/space';
const ref = (number: number) => ({
  repository: REPO,
  number,
  url: `https://github.com/${REPO}/issues/${number}`,
});

const item = (number: number, over: Partial<ItemCard> = {}): ItemCard => ({
  issue: ref(number),
  title: `Item ${number}`,
  state: 'open',
  status: null,
  labels: [],
  done: false,
  paused: false,
  ...over,
});

const focus = (number: number, over: Partial<FocusCard> = {}): FocusCard => ({
  issue: ref(number),
  title: `Focus ${number}`,
  state: 'open',
  status: null,
  labels: [],
  stage: 'Build',
  kind: 'feature',
  specUrl: null,
  items: [],
  itemsDone: 0,
  itemsTotal: 0,
  gateNote: null,
  done: false,
  ...over,
});

const MODEL: DashboardModel = {
  columns: [
    { id: 's1', name: 'Spec', focuses: [] },
    {
      id: 's2',
      name: 'Build',
      focuses: [
        focus(1, {
          specUrl: 'https://example.test/spec-1',
          items: [item(11, { state: 'closed', done: true }), item(12, { status: 'In progress' })],
          itemsDone: 1,
          itemsTotal: 2,
          gateNote: 'Is the draft agreed?',
        }),
      ],
    },
    {
      id: 's3',
      name: 'Review',
      focuses: [focus(2, { stage: 'Review', kind: null, labels: ['paused'] })],
    },
  ],
  unstaged: [focus(3, { stage: null }), focus(4, { stage: 'Later' })],
  standalone: [item(20, { paused: true, labels: ['paused'] }), item(21)],
  board: [],
  needsYou: [],
};

const FETCHED = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const state = (over: Partial<SpaceProjectState> = {}): SpaceProjectState => ({
  version: 1,
  snapshot: null,
  fetchedAt: FETCHED,
  state: 'fresh',
  failure: null,
  refreshing: false,
  model: MODEL,
  ...over,
});

let pushed: ((payload: SpaceProjectState) => void) | null = null;

const cockpit = {
  spaceProjectState: vi.fn<(arg: unknown) => Promise<SpaceProjectStateResult>>(),
  spaceProjectRefresh: vi.fn<(arg: unknown) => Promise<SpaceProjectStateResult>>(),
  spaceProjectFocus: vi.fn<(arg: unknown) => Promise<SpaceProjectStateResult>>(),
  onSpaceProjectState: vi.fn((listener: (payload: SpaceProjectState) => void) => {
    pushed = listener;
    return () => {
      pushed = null;
    };
  }),
  urlOpenExternal: vi.fn(),
  // Start a session (phase M7.4, engine choice M9.10).
  enginesList: vi.fn(async () => []),
  onEnginesChanged: vi.fn(() => () => {}),
  spaceSessionEngines: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionEnginePick: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionReinstall: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceNavigate: vi.fn(),
};

const push = (payload: SpaceProjectState): void => {
  act(() => pushed?.(payload));
};

const answer = (value: SpaceProjectState): SpaceProjectStateResult => ({ ok: true, value });

beforeEach(() => {
  pushed = null;
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceProjectState.mockResolvedValue(answer(state()));
  cockpit.spaceProjectRefresh.mockResolvedValue(answer(state()));
  cockpit.spaceProjectFocus.mockResolvedValue(answer(state()));
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: READY_CHOICE });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

const shown = async (): Promise<void> => {
  render(<Dashboard />);
  await screen.findByTestId('dashboard-columns');
};

test('before the first answer the state line says it is reading; with no model a literal sentence stands', async () => {
  let resolve: (value: SpaceProjectStateResult) => void = () => {};
  cockpit.spaceProjectState.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<Dashboard />);
  expect(screen.getByTestId('dashboard-state').textContent).toBe(
    'Reading the state of the Project from the companion.',
  );
  await act(async () =>
    resolve(answer(state({ model: null, fetchedAt: null, state: 'stale', refreshing: true }))),
  );
  expect(screen.getByTestId('dashboard-no-model').textContent).toBe(
    'No Project has been read from GitHub for this Space yet, so there is nothing to show. A refresh is running.',
  );
  expect(screen.getByTestId('dashboard-state').textContent).toBe(
    'stale, refreshing. No refresh has succeeded since the app opened this Space.',
  );
  expect(screen.queryByTestId('dashboard-columns')).toBeNull();
  expect(screen.queryByTestId('agents-board')).toBeNull();
});

test('the state line says fresh, stale with its age, offline with the failure and the last good read', async () => {
  await shown();
  expect(screen.getByTestId('dashboard-state').getAttribute('data-state')).toBe('fresh');
  expect(screen.getByTestId('dashboard-state-name').textContent).toBe('fresh');
  expect(screen.getByTestId('dashboard-state-sentence').textContent).toMatch(
    /^Read from GitHub at .+, 3 hours ago\.$/,
  );

  push(
    state({
      state: 'stale',
      failure: { kind: 'rate-limited', message: 'GitHub limited the requests.', at: FETCHED },
    }),
  );
  expect(screen.getByTestId('dashboard-state-name').textContent).toBe('stale');
  expect(screen.getByTestId('dashboard-state-sentence').textContent).toMatch(
    /^The shown Project was read from GitHub at .+, 3 hours ago\. The last refresh failed at .+: GitHub limited the requests\.$/,
  );

  push(
    state({
      state: 'offline',
      failure: { kind: 'unreachable', message: 'github.com could not be reached.', at: FETCHED },
    }),
  );
  expect(screen.getByTestId('dashboard-state-name').textContent).toBe('offline');
  const sentence = screen.getByTestId('dashboard-state-sentence').textContent ?? '';
  expect(sentence).toMatch(
    /^GitHub could not be reached\. The last refresh failed at .+: github\.com could not be reached\./,
  );
  expect(sentence).toMatch(/The last good read is from .+, 3 hours ago\.$/);
  // The cache is still shown.
  expect(screen.getAllByTestId('dashboard-column')).toHaveLength(3);

  push(state({ refreshing: true }));
  expect(screen.getByTestId('dashboard-state').getAttribute('data-refreshing')).toBe('true');
  expect(screen.getByTestId('dashboard-state').textContent).toMatch(/^fresh, refreshing\. /);
  expect((screen.getByTestId('dashboard-refresh') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByTestId('dashboard-refresh').textContent).toBe('Refreshing');
});

test('a push older than the shown state is ignored, as pushes can arrive out of order', async () => {
  await shown();
  push(state({ version: 5 }));
  push(state({ version: 4, refreshing: true, model: null }));
  expect(screen.getByTestId('dashboard-state').getAttribute('data-refreshing')).toBe('false');
  expect(screen.getByTestId('dashboard-columns')).toBeTruthy();
  push(state({ version: 6, refreshing: true }));
  expect(screen.getByTestId('dashboard-state').getAttribute('data-refreshing')).toBe('true');
});

test('Refresh asks main for a refresh; a refused request is shown', async () => {
  await shown();
  cockpit.spaceProjectRefresh.mockResolvedValueOnce({
    ok: false,
    error: { kind: 'not-a-space-window', message: 'This window shows no Space.' },
  });
  fireEvent.click(screen.getByTestId('dashboard-refresh'));
  expect(cockpit.spaceProjectRefresh).toHaveBeenCalledWith({});
  expect((await screen.findByTestId('dashboard-problem')).textContent).toBe(
    'This window shows no Space.',
  );
});

test('the window gaining focus calls space:project-focus', async () => {
  await shown();
  expect(cockpit.spaceProjectFocus).not.toHaveBeenCalled();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(cockpit.spaceProjectFocus).toHaveBeenCalledWith({}));
});

test('columns follow the model order and carry their focuses as cards', async () => {
  await shown();
  const columns = screen.getAllByTestId('dashboard-column');
  expect(columns.map((column) => column.getAttribute('data-stage'))).toEqual([
    'Spec',
    'Build',
    'Review',
  ]);
  expect(within(columns[0]).getByRole('heading', { level: 3 }).textContent).toBe('Spec (0)');
  expect(within(columns[0]).getByText('No focus.')).toBeTruthy();

  const card = within(columns[1]).getByTestId('dashboard-focus-card');
  expect(within(card).getByRole('heading', { level: 4 }).textContent).toBe('#1 Focus 1');
  expect(within(card).getByTestId('dashboard-focus-kind').textContent).toBe('kind feature');
  expect(within(card).getByTestId('dashboard-focus-items').textContent).toBe('1 of 2 items done');
  expect(within(card).getByTestId('dashboard-focus-gate').textContent).toBe(
    'Waits at a gate: Is the draft agreed?',
  );
  fireEvent.click(within(card).getByTestId('dashboard-focus-spec'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith('https://example.test/spec-1');
  expect(within(card).queryByTestId('dashboard-focus-paused')).toBeNull();

  const review = within(columns[2]).getByTestId('dashboard-focus-card');
  expect(within(review).getByTestId('dashboard-focus-kind').textContent).toBe('no kind');
  expect(within(review).queryByTestId('dashboard-focus-spec')).toBeNull();
  expect(within(review).queryByTestId('dashboard-focus-gate')).toBeNull();
  // A paused focus says so in words.
  expect(within(review).getByTestId('dashboard-focus-paused').textContent).toBe('Paused.');
  fireEvent.click(within(review).getByTestId('dashboard-focus-open'));
  expect(
    within(await screen.findByTestId('dashboard-focus-sheet')).getByTestId(
      'dashboard-sheet-summary',
    ).textContent,
  ).toBe('Stage Review; no kind; open; 0 of 0 items done; paused');
});

test('unstaged focuses are listed with their reason; standalone items sit beside the columns, paused ones marked', async () => {
  await shown();
  const unstaged = within(screen.getByTestId('dashboard-unstaged'));
  const reasons = unstaged.getAllByTestId('dashboard-focus-reason').map((node) => node.textContent);
  expect(reasons).toEqual([
    'It has no Stage.',
    'Its Stage "Later" is not an option of the Stage field.',
  ]);

  const row = screen.getByTestId('dashboard-columns');
  const standalone = within(row).getByTestId('dashboard-standalone');
  const items = within(standalone).getAllByTestId('dashboard-standalone-state');
  expect(items.map((node) => node.textContent)).toEqual([
    'open, no Status, paused',
    'open, no Status',
  ]);
  fireEvent.click(within(standalone).getAllByTestId('dashboard-standalone-github')[1]);
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith(`https://github.com/${REPO}/issues/21`);
});

test('opening a card shows the focus sheet with its items, their state and links to GitHub', async () => {
  await shown();
  const open = screen.getAllByTestId('dashboard-focus-open')[0];
  open.focus();
  fireEvent.click(open);
  const sheet = within(await screen.findByTestId('dashboard-focus-sheet'));
  expect(screen.getByRole('dialog', { name: 'Focus #1' })).toBeTruthy();
  expect(sheet.getByText('#1 Focus 1')).toBeTruthy();
  expect(sheet.getByTestId('dashboard-sheet-summary').textContent).toBe(
    'Stage Build; kind feature; open; 1 of 2 items done',
  );
  expect(
    sheet.getAllByTestId('dashboard-sheet-item-state').map((node) => node.textContent),
  ).toEqual(['closed, no Status, done', 'open, Status In progress']);
  fireEvent.click(sheet.getAllByTestId('dashboard-sheet-item-github')[1]);
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith(`https://github.com/${REPO}/issues/12`);
  fireEvent.click(sheet.getByTestId('dashboard-sheet-github'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith(`https://github.com/${REPO}/issues/1`);
  fireEvent.click(sheet.getByTestId('dashboard-sheet-spec'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith('https://example.test/spec-1');

  fireEvent.click(sheet.getByTestId('dashboard-sheet-close'));
  expect(screen.queryByTestId('dashboard-focus-sheet')).toBeNull();
});

test('the parts of phase M7.4 are mounted: Start a session, Needs you, the Agents board', async () => {
  cockpit.spaceProjectState.mockResolvedValue(
    answer(
      state({
        model: { ...MODEL, needsYou: [{ kind: 'review', focus: ref(2), title: 'Focus 2' }] },
      }),
    ),
  );
  await shown();
  const start = screen.getByTestId('dashboard-start');
  const needsYou = screen.getByTestId('needs-you');
  const columns = screen.getByTestId('dashboard-columns');
  const board = screen.getByTestId('agents-board');
  const before = (a: Element, b: Element): boolean =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(start, needsYou) && before(needsYou, columns) && before(columns, board)).toBe(true);

  // A focus at Review in Needs you opens its sheet.
  fireEvent.click(within(needsYou).getByRole('button', { name: 'Open the focus' }));
  expect(await screen.findByRole('dialog', { name: 'Focus #2' })).toBeTruthy();
});

test('Start a session is shown before the first read of the Project', async () => {
  cockpit.spaceProjectState.mockResolvedValue(answer(state({ model: null, fetchedAt: null })));
  render(<Dashboard />);
  await screen.findByTestId('dashboard-no-model');
  expect(screen.getByTestId('dashboard-start')).toBeTruthy();
  expect(screen.queryByTestId('needs-you')).toBeNull();
  expect(screen.queryByTestId('agents-board')).toBeNull();
});

test('the start button names the engine of a stubbed choice (M9.10)', async () => {
  await shown();
  expect(await screen.findByRole('button', { name: 'Start a Claude Code session' })).toBeTruthy();
});

test('justCreated shows the ready line above the start control', async () => {
  render(<Dashboard justCreated />);
  await screen.findByTestId('dashboard-columns');
  expect(screen.getByTestId('dashboard-just-created').textContent).toBe(
    'The Space is ready. Start a session to begin work; it starts in Read only.',
  );
});
