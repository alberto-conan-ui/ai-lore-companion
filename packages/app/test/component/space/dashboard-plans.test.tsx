import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  PLANS_REFRESH_MS,
  type PlansStateView,
  nextPlansDelay,
  usePlansState,
} from '../../../src/renderer/src/space/dashboard/usePlansState.js';
import { BandPlans } from '../../../src/renderer/src/space/dashboard/v2/BandPlans.js';
import type {
  SpacePlansOpenResult,
  SpacePlansState,
  SpacePlansStateResult,
  SpacePlansUnit,
} from '../../../src/shared/ipc.js';

// The Plans band (alberto-conan-ui/ai-lore-companion#34): its states (list, incomplete, refused, not reachable, failed,
// empty, reading), opening a row, and the wiring: the hook's 30 s schedule, its visibility rule, and what it does with an
// answer it cannot use. The design: specs/plan-visual/designs/5a/5a-companion-plans-band.html in the ai-lore repository.

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

const NOTE =
  'except a unit that enters Epic or Focus any way other than being created among the newest 20 issues (its Level changed, an older issue added to the Project, or more than 20 new issues at once), which can take a minute or more (measured once at about 80 seconds) to show';

const row = (number: number, extra: Partial<SpacePlansUnit> = {}): SpacePlansUnit => ({
  number,
  title: `Unit ${String(number)}`,
  kind: 'focus',
  depth: 1,
  stage: 'Build',
  updated: NOW - 20_000,
  updatedExact: true,
  onGitHub: true,
  ...extra,
});

const ROWS: SpacePlansUnit[] = [
  row(131, {
    kind: 'epic',
    depth: 0,
    stage: 'Spec and Planning',
    title: 'AI-Lore becomes a factory',
    updated: NOW - 30_000,
    onGitHub: false,
  }),
  row(222, {
    kind: 'sub-epic',
    depth: 1,
    title: 'Plan using visual dashboards',
    updated: NOW - 20_000,
  }),
  row(346, {
    depth: 2,
    stage: 'Review',
    title: 'A planning unit as an issue',
    updated: NOW - 60_000,
  }),
  row(347, {
    depth: 2,
    stage: 'Locked',
    title: 'The AI proposes the breakdown',
    updated: NOW - 3 * 60_000,
  }),
];

const state = (extra: Partial<SpacePlansState> = {}): SpacePlansState => ({
  version: 1,
  reading: false,
  outcome: 'complete',
  units: ROWS,
  readAt: NOW - 5_000,
  lastReadAt: NOW - 5_000,
  head: '',
  text: '',
  missing: [],
  note: NOTE,
  leftOut: [],
  demo: false,
  ...extra,
});

const down = (
  outcome: 'refused' | 'unreachable' | 'failed',
  extra: Partial<SpacePlansState> = {},
): SpacePlansState =>
  state({
    outcome,
    units: null,
    readAt: null,
    head:
      outcome === 'refused'
        ? 'GitHub refused'
        : outcome === 'unreachable'
          ? 'GitHub not reachable'
          : 'Plans could not be read',
    text:
      outcome === 'refused'
        ? 'GitHub refused GraphQL (primary rate limit, resets 14:10)'
        : 'GitHub gave no answer over GraphQL',
    ...extra,
  });

const view = (
  plans: SpacePlansState | null,
  extra: Partial<PlansStateView> = {},
): PlansStateView => ({
  plans,
  problem: null,
  requested: false,
  active: true,
  opening: null,
  openProblem: null,
  refresh: vi.fn(),
  open: vi.fn(),
  bandRef: vi.fn(),
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- the band's states ----

test('a list: each unit is a row with its kind, Stage, number, title and when it was updated, nested by depth', () => {
  render(<BandPlans view={view(state())} now={NOW} />);
  expect(screen.getByRole('heading', { name: 'PLANS' })).toBeTruthy();
  expect(screen.getByTestId('plans-state').textContent).toContain('4 PLANS');
  expect(screen.getByTestId('plans-state').textContent).toContain('READ 5S AGO');
  const rows = screen.getAllByTestId('plans-row');
  expect(rows.map((r) => r.getAttribute('data-number'))).toEqual(['131', '222', '346', '347']);
  expect(rows[0]?.textContent).toContain('EPIC');
  expect(rows[0]?.textContent).toContain('Spec and Planning');
  expect(rows[0]?.textContent).toContain('#131');
  expect(rows[0]?.textContent).toContain('AI-Lore becomes a factory');
  expect(rows[0]?.textContent).toContain('updated 30s ago');
  expect(rows[1]?.textContent).toContain('SUB-EPIC');
  expect(rows[2]?.textContent).toContain('updated 1m ago');
  expect(rows[3]?.textContent).toContain('updated 3m ago');
  expect(rows[3]?.textContent).toContain('Locked');
  const pad = (r?: HTMLElement): string =>
    (r?.querySelector('.dashboard-v2-plan-title') as HTMLElement).style.paddingLeft;
  expect(pad(rows[2])).toBe('44px');
  expect(pad(rows[0])).toBe('0px');
  expect(rows[0]?.querySelector('.dashboard-v2-plan-level')?.getAttribute('data-kind')).toBe(
    'epic',
  );
  expect(rows[2]?.querySelector('.dashboard-v2-plan-stage')?.getAttribute('data-stage')).toBe(
    'Review',
  );
  expect(screen.getByTestId('plans-footer').textContent).toContain(
    `Each row opens its dashboard. Changes show within a minute, ${NOTE}.`,
  );
  expect(screen.getByTestId('plans-footer').textContent).not.toContain('brand-new');
  expect(screen.getByTestId('plans-footer').textContent).not.toContain('or from');
  expect(screen.queryByTestId('plans-problem')).toBeNull();
});

test('a time that was not read is said as not read, and one read from only half the facts says "or later"', () => {
  render(
    <BandPlans
      view={view(state({ units: [row(1, { updated: null }), row(2, { updatedExact: false })] }))}
      now={NOW}
    />,
  );
  const rows = screen.getAllByTestId('plans-row');
  expect(rows[0]?.textContent).toContain('updated: not read');
  expect(rows[1]?.textContent).toContain('updated 20s ago or later');
});

test('a unit with no Stage says so; it is not shown as a Stage or hidden', () => {
  render(<BandPlans view={view(state({ units: [row(1, { stage: null })] }))} now={NOW} />);
  expect(screen.getByTestId('plans-row').textContent).toContain('No Stage');
});

test('an empty complete read says there is nothing on the Project, and is not the state of an unread list', () => {
  render(<BandPlans view={view(state({ units: [] }))} now={NOW} />);
  expect(screen.getByTestId('plans-empty').textContent).toContain('No epics or focuses');
  expect(screen.getByTestId('plans-state').textContent).toContain('0 PLANS');
  expect(screen.queryByTestId('plans-problem')).toBeNull();
  expect(screen.queryByTestId('plans-row')).toBeNull();
});

test('before the first answer it says it is reading, and draws no list and no empty message', () => {
  render(<BandPlans view={view(null)} now={NOW} />);
  expect(screen.getByTestId('plans-reading').getAttribute('aria-busy')).toBe('true');
  expect(screen.getByTestId('plans-state').textContent).toContain('READING');
  expect(screen.queryByTestId('plans-empty')).toBeNull();
  expect(screen.queryByTestId('plans-row')).toBeNull();
});

test('a window hidden from the start says it has not read yet, not that it is reading', () => {
  render(<BandPlans view={view(null, { active: false })} now={NOW} />);
  expect(screen.getByTestId('plans-reading').textContent).toContain('have not been read yet');
  expect(screen.getByTestId('plans-reading').textContent).toContain('hidden');
  expect(screen.getByTestId('plans-reading').getAttribute('aria-busy')).toBe('false');
  expect(screen.getByTestId('plans-state').textContent).toContain('NOT READ YET');
  expect(screen.getByTestId('plans-state').textContent).not.toContain('READING');
});

test('the footer is a plain sentence, in sentence case', () => {
  render(<BandPlans view={view(state())} now={NOW} />);
  expect(screen.getByTestId('plans-footer').className).toBe('dashboard-v2-muted');
});

test('an incomplete read is said as incomplete, names what was not read, and still lists what was', () => {
  render(
    <BandPlans
      view={view(
        state({
          outcome: 'incomplete',
          head: 'Incomplete read',
          text: 'part of the plan was not read, so what is shown is not the whole plan',
          missing: ['the list of units: more than 500 units: only the first 500 were read'],
        }),
      )}
      now={NOW}
    />,
  );
  const alert = screen.getByTestId('plans-problem');
  expect(alert.getAttribute('role')).toBe('alert');
  expect(alert.textContent).toContain('Incomplete read');
  expect(alert.textContent).toContain('not the whole plan');
  expect(alert.textContent).toContain('only the first 500 were read');
  expect(screen.getByTestId('plans-state').textContent).toContain('INCOMPLETE');
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
  expect(screen.queryByTestId('plans-last-read')).toBeNull();
});

for (const [outcome, word] of [
  ['refused', 'REFUSED'],
  ['unreachable', 'NOT REACHABLE'],
  ['failed', 'NOT READ'],
] as const) {
  test(`a ${outcome} read is said as that, draws no list, and gives the time of the last read that answered`, () => {
    render(<BandPlans view={view(down(outcome, { lastReadAt: NOW - 95_000 }))} now={NOW} />);
    const alert = screen.getByTestId('plans-problem');
    expect(alert.getAttribute('data-outcome')).toBe(outcome);
    expect(alert.textContent).toContain(down(outcome).head);
    expect(alert.textContent).toContain(down(outcome).text);
    expect(alert.textContent).toContain('No list is shown, and nothing saved stands in for it');
    expect(screen.getByTestId('plans-last-read').textContent).toMatch(
      /last read that answered was at \d\d:\d\d/,
    );
    expect(screen.getByTestId('plans-last-read').textContent).toContain('1m ago');
    expect(screen.getByTestId('plans-last-read').textContent).toContain('It is not shown');
    expect(screen.getByTestId('plans-state').textContent).toContain(word);
    expect(screen.queryByTestId('plans-row')).toBeNull();
    expect(screen.queryByTestId('plans-empty')).toBeNull();
  });
}

test('a down read with no read ever answered says that, and does not invent a time', () => {
  render(<BandPlans view={view(down('unreachable', { lastReadAt: null }))} now={NOW} />);
  expect(screen.getByTestId('plans-last-read').textContent).toBe('No read has answered yet.');
});

test('Read again asks for another read, and is disabled while one runs', () => {
  const v = view(down('refused'));
  const { rerender } = render(<BandPlans view={v} now={NOW} />);
  fireEvent.click(screen.getByTestId('plans-read-again'));
  expect(v.refresh).toHaveBeenCalledOnce();
  rerender(<BandPlans view={view(down('refused', { reading: true }))} now={NOW} />);
  const button = screen.getByTestId('plans-read-again') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Reading');
  rerender(<BandPlans view={view(down('refused'), { requested: true })} now={NOW} />);
  expect((screen.getByTestId('plans-read-again') as HTMLButtonElement).disabled).toBe(true);
});

test('main could not be asked: that is said, no list is drawn, whatever was read before', () => {
  render(
    <BandPlans
      view={view(null, { problem: 'Plans could not be asked for: the channel closed' })}
      now={NOW}
    />,
  );
  expect(screen.getByTestId('plans-problem').textContent).toContain('the channel closed');
  expect(screen.getByTestId('plans-problem').textContent).toContain('No list is shown');
  expect(screen.getByTestId('plans-state').textContent).toContain('NOT READ');
  expect(screen.queryByTestId('plans-row')).toBeNull();
});

test('a Space that has no plans tool has no Plans band', () => {
  const { container } = render(
    <BandPlans view={view(state({ outcome: 'unavailable', units: null }))} now={NOW} />,
  );
  expect(container.textContent).toBe('');
  expect(container.firstChild).toBeNull();
});

test('a window hidden says the band is paused and is not refreshing', () => {
  render(<BandPlans view={view(state(), { active: false })} now={NOW} />);
  expect(screen.getByTestId('plans-state').textContent).toContain('PAUSED');
  expect(screen.getByTestId('plans-minute').textContent).toContain(
    'Not refreshing while this window is hidden, so the minute is not promised',
  );
  expect(screen.getByTestId('plans-footer').textContent).not.toContain('within a minute');
});

test('a long list shows twelve rows and opens the rest on "show all"', () => {
  const many = Array.from({ length: 15 }, (_, i) => row(1000 + i));
  render(<BandPlans view={view(state({ units: many }))} now={NOW} />);
  expect(screen.getAllByTestId('plans-row')).toHaveLength(12);
  fireEvent.click(screen.getByRole('button', { name: '+3 more plans · show all' }));
  expect(screen.getAllByTestId('plans-row')).toHaveLength(15);
});

test('H3: an incomplete read with no rows never also says the Project has no epics or focuses', () => {
  render(
    <BandPlans
      view={view(
        state({
          outcome: 'incomplete',
          units: [],
          head: 'Incomplete read',
          text: 'part was not read',
          missing: [
            'the Level field: the Project has no Level field with the options Epic and Focus',
          ],
        }),
      )}
      now={NOW}
    />,
  );
  expect(screen.queryByTestId('plans-empty')).toBeNull();
  expect(screen.getByTestId('plans-problem').textContent).toContain('Level field');
});

test('H3: what the tool left out is said under the list', () => {
  render(
    <BandPlans
      view={view(state({ leftOut: ['2 issues with no Level were left out.'] }))}
      now={NOW}
    />,
  );
  expect(screen.getByTestId('plans-left-out').textContent).toBe(
    '2 issues with no Level were left out.',
  );
});

test('H5: demo data says it is demo data, in the heading', () => {
  render(<BandPlans view={view(state({ demo: true }))} now={NOW} />);
  expect(screen.getByTestId('plans-state').textContent).toContain('DEMO DATA');
});

test('H9: an incomplete heading also shows the age of its read', () => {
  render(
    <BandPlans
      view={view(
        state({ outcome: 'incomplete', head: 'Incomplete read', text: 't', readAt: NOW - 65_000 }),
      )}
      now={NOW}
    />,
  );
  expect(screen.getByTestId('plans-state').textContent).toContain('INCOMPLETE · READ 1M AGO');
});

// ---- opening a row ----

test('a click on a row asks to open that unit; while one opens, every row is disabled and that one says so', () => {
  const v = view(state());
  const { rerender } = render(<BandPlans view={v} now={NOW} />);
  fireEvent.click(screen.getAllByTestId('plans-row')[2] as HTMLElement);
  expect(v.open).toHaveBeenCalledWith(346);
  rerender(<BandPlans view={view(state(), { opening: 346 })} now={NOW} />);
  const rows = screen.getAllByTestId('plans-row') as HTMLButtonElement[];
  expect(rows.every((r) => r.disabled)).toBe(true);
  expect(within(rows[2] as HTMLElement).getByText('opening…')).toBeTruthy();
  expect(rows[2]?.getAttribute('aria-busy')).toBe('true');
});

test('a row that could not be opened says why, in an alert under the list', () => {
  render(
    <BandPlans
      view={view(state(), {
        openProblem:
          "The dashboards' server is not running. Start it with: python3 tools/plan/edit.py",
      })}
      now={NOW}
    />,
  );
  expect(screen.getByTestId('plans-open-problem').getAttribute('role')).toBe('alert');
  expect(screen.getByTestId('plans-open-problem').textContent).toContain(
    'python3 tools/plan/edit.py',
  );
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
});

// ---- the wiring: the hook with a scripted window.cockpit ----

type Cockpit = {
  spacePlansState: ReturnType<typeof vi.fn>;
  spacePlansRefresh: ReturnType<typeof vi.fn>;
  spacePlansOpen: ReturnType<typeof vi.fn>;
  onSpacePlansState: ReturnType<typeof vi.fn>;
};

let cockpit: Cockpit;
let push: (s: SpacePlansState) => void;
let readVersion = 1;
let focused = true;
let visibility = 'visible';

const ok = (value: SpacePlansState): SpacePlansStateResult => ({ ok: true, value });

function Harness(): JSX.Element {
  const plans = usePlansState();
  return <BandPlans view={plans} now={NOW} />;
}

beforeEach(() => {
  readVersion = 1;
  focused = true;
  visibility = 'visible';
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  cockpit = {
    spacePlansState: vi.fn(async () =>
      ok(state({ outcome: null, units: null, readAt: null, lastReadAt: null })),
    ),
    spacePlansRefresh: vi.fn(async () => ok(state({ version: ++readVersion, readAt: Date.now() }))),
    spacePlansOpen: vi.fn(
      async (): Promise<SpacePlansOpenResult> => ({
        ok: true,
        url: 'http://127.0.0.1:8765/gh/346',
        startedServer: false,
      }),
    ),
    onSpacePlansState: vi.fn((listener: typeof push) => {
      push = listener;
      return () => undefined;
    }),
  };
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

test('the band reads at once when it is shown, then every 30 seconds while it can be seen', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
  await settle(PLANS_REFRESH_MS - 1);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
  await settle(1);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(2);
  await settle(PLANS_REFRESH_MS);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(3);
});

test('nothing is read while the window is hidden, and a read follows when it is shown', async () => {
  vi.useFakeTimers();
  visibility = 'hidden';
  render(<Harness />);
  await settle(PLANS_REFRESH_MS * 3);
  expect(cockpit.spacePlansRefresh).not.toHaveBeenCalled();
  expect(screen.getByTestId('plans-state').textContent).toContain('PAUSED');
  visibility = 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('plans-state').textContent).not.toContain('PAUSED');
  visibility = 'hidden';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(PLANS_REFRESH_MS * 2);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
});

test('H7: a window that is visible but has not the focus keeps refreshing (visible means visible)', async () => {
  vi.useFakeTimers();
  focused = false;
  render(<Harness />);
  await settle(PLANS_REFRESH_MS * 4);
  expect(cockpit.spacePlansRefresh.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(screen.getByTestId('plans-state').textContent).not.toContain('PAUSED');
});

test('showing the window inside 30 seconds of the newest read does not read again; after 30 seconds it does', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(10_000);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
});

test('H2: the next ask is when the newest read is 30 s old, not 30 s after the last ask', () => {
  expect(nextPlansDelay(1000, null, null)).toBe(0);
  expect(nextPlansDelay(10_000, 10_000, null)).toBe(30_000);
  // asked at 10_000, the tool's read started at 10_400 (its start-up): the next ask is when THAT read is 30 s old
  expect(nextPlansDelay(10_500, 10_000, 10_400)).toBe(29_900);
  expect(nextPlansDelay(40_400, 10_000, 10_400)).toBe(0);
  // never sooner than the minimum gap after the last ask
  expect(nextPlansDelay(50_000, 49_000, 10_000)).toBe(4_000);
});

test('a band that is out of view is not read; it is read when it comes into view', async () => {
  vi.useFakeTimers();
  let observe: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
  class FakeObserver {
    constructor(callback: typeof observe) {
      observe = callback;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  try {
    render(<Harness />);
    await settle();
    expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
    act(() => observe([{ isIntersecting: false }]));
    await settle(PLANS_REFRESH_MS * 3);
    expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
    act(() => observe([{ isIntersecting: true }]));
    await settle();
    expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('a Space with no plans tool is not read on the timer', async () => {
  vi.useFakeTimers();
  cockpit.spacePlansRefresh.mockResolvedValue(ok(state({ outcome: 'unavailable', units: null })));
  render(<Harness />);
  await settle(PLANS_REFRESH_MS * 4);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
});

test('a refused read replaces the list: the rows of the read before are gone, not kept', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
  cockpit.spacePlansRefresh.mockResolvedValue(ok(down('refused', { version: 3 })));
  await settle(PLANS_REFRESH_MS);
  expect(screen.queryByTestId('plans-row')).toBeNull();
  expect(screen.getByTestId('plans-problem').textContent).toContain('GitHub refused');
});

test('a push that is older than the state shown does not replace it', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  act(() => push(down('unreachable', { version: 1 })));
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
  act(() => push(down('unreachable', { version: 5 })));
  expect(screen.queryByTestId('plans-row')).toBeNull();
});

test('an answer main could not give is shown as that, with no list, and is not taken for success', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  cockpit.spacePlansRefresh.mockRejectedValue(new Error('the channel closed'));
  await settle(PLANS_REFRESH_MS);
  expect(screen.queryByTestId('plans-row')).toBeNull();
  expect(screen.getByTestId('plans-problem').textContent).toContain('the channel closed');
  cockpit.spacePlansRefresh.mockResolvedValue({
    ok: false,
    error: { kind: 'not-a-space-window', message: 'Not a Space window.' },
  });
  await settle(PLANS_REFRESH_MS);
  expect(screen.getByTestId('plans-problem').textContent).toContain('Not a Space window.');
  expect(screen.queryByTestId('plans-row')).toBeNull();
});

test('clicking a row calls the open channel with its number, and a failure to open is shown, the list kept', async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await settle();
  fireEvent.click(screen.getAllByTestId('plans-row')[2] as HTMLElement);
  await settle();
  expect(cockpit.spacePlansOpen).toHaveBeenCalledWith({ number: 346 });
  expect(screen.queryByTestId('plans-open-problem')).toBeNull();
  cockpit.spacePlansOpen.mockResolvedValue({
    ok: false,
    error: { kind: 'server-not-started', message: "The dashboards' server is not running." },
  });
  fireEvent.click(screen.getAllByTestId('plans-row')[0] as HTMLElement);
  await settle();
  expect(screen.getByTestId('plans-open-problem').textContent).toContain('server is not running');
  expect(screen.getAllByTestId('plans-row')).toHaveLength(4);
  cockpit.spacePlansOpen.mockRejectedValue(new Error('ipc gone'));
  fireEvent.click(screen.getAllByTestId('plans-row')[0] as HTMLElement);
  await settle();
  expect(screen.getByTestId('plans-open-problem').textContent).toContain('ipc gone');
  expect((screen.getAllByTestId('plans-row')[0] as HTMLButtonElement).disabled).toBe(false);
});

test('the hook unsubscribes from pushes when the band goes away', async () => {
  vi.useFakeTimers();
  const off = vi.fn();
  cockpit.onSpacePlansState.mockImplementation((listener: typeof push) => {
    push = listener;
    return off;
  });
  const { unmount } = render(<Harness />);
  await settle();
  unmount();
  expect(off).toHaveBeenCalledOnce();
  await settle(PLANS_REFRESH_MS * 2);
  expect(cockpit.spacePlansRefresh).toHaveBeenCalledTimes(1);
});

// ---- K2: the minute promise follows the read ----

const promised = (): boolean =>
  screen.getByTestId('dashboard-v2-plans').getAttribute('data-minute') === 'promised';

test('K2: the promise is made while the shown read is under a minute old and a refresh is not late', () => {
  const { rerender } = render(<BandPlans view={view(state({ readAt: NOW - 59_000 }))} now={NOW} />);
  expect(promised()).toBe(true);
  expect(screen.getByTestId('plans-footer').textContent).toContain('Changes show within a minute');
  expect(screen.queryByTestId('plans-minute')).toBeNull();
  // a refresh is due and pending, but not late: still promised
  rerender(
    <BandPlans
      view={view(state({ readAt: NOW - 40_000 }), { pendingSince: NOW - 10_000 })}
      now={NOW}
    />,
  );
  expect(promised()).toBe(true);
});

for (const outcome of ['complete', 'incomplete'] as const) {
  test(`K2: a ${outcome} list withdraws the promise once its read is a minute old, and says why`, () => {
    render(
      <BandPlans
        view={view(state({ outcome, readAt: NOW - 61_000, head: 'h', text: 't' }))}
        now={NOW}
      />,
    );
    expect(promised()).toBe(false);
    expect(screen.getByTestId('plans-minute').textContent).toBe(
      'The minute is not promised: the list shown is from a read that started 61 seconds ago.',
    );
    expect(screen.getByTestId('plans-footer').textContent).not.toContain('within a minute');
  });

  test(`K2: a ${outcome} list withdraws the promise while a refresh has been pending more than 30 s`, () => {
    render(
      <BandPlans
        view={view(state({ outcome, readAt: NOW - 45_000, head: 'h', text: 't' }), {
          pendingSince: NOW - 31_000,
        })}
        now={NOW}
      />,
    );
    expect(promised()).toBe(false);
    expect(screen.getByTestId('plans-minute').textContent).toBe(
      'The minute is not promised: the list shown is from a read that started 45 seconds ago; a refresh is still running.',
    );
  });
}

test('K2: with no list shown (reading, refused) nothing is promised and nothing is said about it', () => {
  const { rerender } = render(<BandPlans view={view(null)} now={NOW} />);
  expect(promised()).toBe(false);
  expect(screen.queryByTestId('plans-minute')).toBeNull();
  expect(screen.getByTestId('plans-footer').textContent).toBe('Each row opens its dashboard.');
  rerender(<BandPlans view={view(down('refused'))} now={NOW} />);
  expect(promised()).toBe(false);
  expect(screen.getByTestId('plans-footer').textContent).toBe('Each row opens its dashboard.');
});

// ---- the real hook with fake timers (the independent review's probes of slice 5a) ----

const T0 = 1_800_000_000_000;

function Real() {
  const v = usePlansState();
  return <BandPlans view={v} now={Date.now()} />;
}

function realCockpit(over: Record<string, unknown> = {}) {
  const push: { fn: (x: unknown) => void } = { fn: () => undefined };
  const refresh = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = {
    onSpacePlansState: (fn: (x: unknown) => void) => {
      push.fn = fn;
      return () => undefined;
    },
    spacePlansState: async () => ({ ok: true, value: { ...state(), outcome: null, units: null } }),
    spacePlansRefresh: refresh,
    spacePlansOpen: vi.fn(),
    ...over,
  };
  return { refresh, push };
}

function later(): { promise: Promise<unknown>; resolve: (x: unknown) => void } {
  let resolve: (x: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const visibleNow = (): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
};

test('K1: a read that finishes after the band unmounted starts no polling, and nothing is read in 5 minutes', async () => {
  vi.useFakeTimers({ now: T0 });
  visibleNow();
  const pending = later();
  const { refresh } = realCockpit();
  refresh
    .mockImplementationOnce(() => pending.promise)
    .mockImplementation(async () => ok(state({ version: 10, readAt: Date.now() })));
  const mounted = render(<Real />);
  await act(async () => {});
  expect(refresh).toHaveBeenCalledTimes(1);
  mounted.unmount();
  await act(async () => pending.resolve(ok(state({ version: 2, readAt: Date.now() }))));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('K1: after unmount no timer is left, and a late push, subscription answer and open set nothing', async () => {
  vi.useFakeTimers({ now: T0 });
  visibleNow();
  const answerState = later();
  const answerOpen = later();
  const { refresh, push } = realCockpit({
    spacePlansState: () => answerState.promise,
    spacePlansOpen: () => answerOpen.promise,
  });
  refresh.mockImplementation(async () => ok(state({ readAt: Date.now() })));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const mounted = render(<Real />);
  await act(async () => {});
  act(() => {
    (screen.getAllByTestId('plans-row')[0] as HTMLElement).click();
  });
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    push.fn(state({ version: 99 }));
    answerState.resolve(ok(state({ version: 98 })));
    answerOpen.resolve({ ok: false, error: { kind: 'not-listed', message: 'late' } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5 * 60_000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(errors).not.toHaveBeenCalled();
});

test('K2: a refresh left unanswered withdraws the minute promise on a timer, before any timeout', async () => {
  vi.useFakeTimers({ now: T0 });
  visibleNow();
  const { refresh } = realCockpit({
    spacePlansState: async () => ok(state({ readAt: Date.now() })),
  });
  refresh
    .mockResolvedValueOnce(ok(state({ readAt: Date.now() })))
    .mockImplementation(() => new Promise(() => undefined));
  render(<Real />);
  await act(async () => {});
  expect(promised()).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000); // the refresh asked at 30 s has been pending 15 s
  });
  expect(promised()).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000); // pending 35 s, and the read is 65 s old
  });
  expect(promised()).toBe(false);
  expect(screen.getByTestId('plans-minute').textContent).toMatch(/The minute is not promised/);
  expect(screen.getByTestId('plans-minute').textContent).toContain('a refresh is still running');
});
