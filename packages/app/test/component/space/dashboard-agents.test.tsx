import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Phase M7.4: the Dashboard's Agents board, Needs you and Start a session, with the real gate
// dialogs and the real Sessions. The dock is a stand-in that renders each tab's kind, and the
// terminal parts are inert, as in `space-ai-session.test.tsx`.
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: () => ({ hostRef: { current: null }, focus: () => {}, search: {} }),
  useTerminalFindShortcut: () => {},
}));
vi.mock('../../../src/renderer/src/components/TerminalTab.js', () => ({
  TerminalTab: () => <div data-testid="body-shell" />,
}));
vi.mock('../../../src/renderer/src/components/BrowserTab.js', () => ({
  BrowserTab: () => <div data-testid="body-browser" />,
}));
vi.mock('../../../src/renderer/src/components/Pane.js', () => ({
  Pane: () => <div data-testid="body-pane" />,
}));
vi.mock('../../../src/renderer/src/components/PublishPane.js', () => ({
  PublishPane: () => <div data-testid="body-publish" />,
}));
vi.mock('../../../src/renderer/src/components/AssistantHost.js', () => ({
  AssistantHost: () => <div data-testid="body-assistant-host" />,
}));
vi.mock('../../../src/renderer/src/components/DockWorkspace.js', async () => {
  const { TAB_KINDS } = await import('../../../src/renderer/src/components/tabKinds.js');
  type Tab = import('../../../src/renderer/src/components/TabbedPanel.js').WorkspaceTab;
  type Ctx = import('../../../src/renderer/src/components/tabKinds.js').TabRenderContext;
  return {
    DockWorkspace: (props: { panels: Record<string, { tabs: Tab[] }>; renderCtx: Ctx }) => (
      <div data-testid="dock-workspace">
        {Object.values(props.panels).flatMap((panel) =>
          panel.tabs.map((tab) => (
            <div key={tab.id} data-testid="dock-tab" data-kind={tab.kind}>
              {TAB_KINDS[tab.kind].renderBody(tab, true, props.renderCtx)}
            </div>
          )),
        )}
      </div>
    ),
  };
});

import type { BoardRow, NeedsYouEntry } from '@ai-lore-companion/core';
import { AgentsBoard } from '../../../src/renderer/src/space/dashboard/AgentsBoard.js';
import { NeedsYou } from '../../../src/renderer/src/space/dashboard/NeedsYou.js';
import { StartSession } from '../../../src/renderer/src/space/dashboard/StartSession.js';
import { SpaceDialogs } from '../../../src/renderer/src/space/dialogs/SpaceDialogs.js';
import { SpaceSessions } from '../../../src/renderer/src/space/window/SpaceSessions.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type {
  PendingDialog,
  SpaceEngineChoice,
  SpaceSessionEnginesResult,
} from '../../../src/shared/ipc.js';

/** A ready `SpaceEngineChoice`: one engine, startable. */
function readyChoice(engineId = 'claude-code', name = 'Claude Code'): SpaceEngineChoice {
  return {
    options: [{ engineId, name, canStart: true, reason: null, fix: null }],
    engineId,
    buttonName: name,
    refusal: null,
  };
}

const REPO = 'fake-human/dash-space';
const ref = (number: number) => ({
  repository: REPO,
  number,
  url: `https://github.com/${REPO}/issues/${number}`,
});
const DAY = 24 * 60 * 60 * 1000;

function row(number: number, column: BoardRow['column'], extra: Partial<BoardRow> = {}): BoardRow {
  return {
    issue: ref(number),
    title: `The claude-code session that started at 2026-09-18T0${number}:00:00.000Z`,
    column,
    targets: [],
    attended: true,
    person: 'fake-human',
    machine: 'desk-1',
    updatedAt: '2026-09-18T09:00:00.000Z',
    idleMs: 1000,
    stale: false,
    local: null,
    gateTicket: null,
    ...extra,
  };
}

const GATE_TICKET = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GATE: PendingDialog = {
  kind: 'gate',
  ticket: GATE_TICKET,
  askedAt: '2026-09-18T09:06:00.000Z',
  session: { engine: 'claude-code', startedAt: '2026-09-18T09:00:00.000Z', item: 12 },
  process: 'specify',
  step: 'confirm',
  question: 'Is the draft agreed?',
  bearsOn: 'workbench/spec.md',
};

const ENTRIES: NeedsYouEntry[] = [
  {
    kind: 'gate',
    ticket: GATE_TICKET,
    sessionId: 's-1',
    askedAt: GATE.askedAt,
    process: 'specify',
    step: 'confirm',
    question: 'Is the draft agreed?',
    item: ref(12),
  },
  { kind: 'review', focus: ref(3), title: 'A focus' },
  { kind: 'stale-session', issue: ref(8), column: 'Writing', idleMs: 2 * DAY, sessionId: 's-8' },
  { kind: 'stale-session', issue: ref(9), column: 'Blocked', idleMs: 30 * 60_000, sessionId: null },
];

const ENGINE = { id: 'claude-code', name: 'Claude Code', binary: 'claude' };

const cockpit = {
  urlOpenExternal: vi.fn(),
  enginesList: vi.fn(async () => [ENGINE]),
  onEnginesChanged: vi.fn(() => () => {}),
  spaceSessionEngines: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionEnginePick: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionReinstall: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionStart: vi.fn<(arg: unknown) => Promise<unknown>>(),
  spaceSessionEnd: vi.fn(async () => ({ ok: true, value: { sessionId: 's-1' } })),
  spaceDialogsPending: vi.fn(async () => ({ ok: true, value: { requests: [GATE] } })),
  onSpaceDialogsPending: vi.fn(() => () => {}),
  spaceDialogAnswerGate: vi.fn(),
  onTerminalExit: vi.fn(() => () => {}),
  sendTerminalInput: vi.fn(),
  aiPromptsWidthGet: vi.fn(async () => null),
  aiPromptsWidthSet: vi.fn(),
  spaceSessionHeader: vi.fn(async () => ({
    ok: true,
    value: {
      sessionId: 's-1',
      engineId: 'claude-code',
      mode: 'read-only',
      targets: [],
      item: null,
      closed: false,
    },
  })),
  onSpaceSessionHeader: vi.fn(() => () => {}),
  spaceSkillsList: vi.fn(async () => ({ ok: true, value: { skills: [], notInstalled: [] } })),
};

beforeEach(() => {
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: readyChoice() });
  cockpit.spaceSessionStart.mockResolvedValue({
    ok: true,
    value: { sessionId: 's-1', ptyId: 'pty-1', engineId: 'claude-code' },
  });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  useSpaceNavStore.setState({ screen: 'dashboard', sessionsRequest: null, sessionsWithTab: [] });
});

afterEach(() => cleanup());

test('the Agents board has the four columns, a row per session, stale in words and links to issues', () => {
  render(
    <AgentsBoard
      board={[
        row(1, 'Writing', {
          stale: true,
          idleMs: 2 * DAY,
          local: {
            sessionId: 's-1',
            engine: 'claude-code',
            startedAt: '2026-09-18T01:00:00.000Z',
            closed: false,
            item: ref(12),
          },
          gateTicket: GATE_TICKET,
        }),
        row(2, 'Read only'),
        row(4, 'Done'),
      ]}
    />,
  );
  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(['Read only (1)', 'Writing (1)', 'Blocked (0)', 'Done (1)']);
  const writing = within(screen.getByTestId('agents-column-writing'));
  expect(
    writing.getByText('The claude-code session that started at 2026-09-18T01:00:00.000Z'),
  ).toBeTruthy();
  expect(screen.getByTestId('agents-row-stale-1').textContent).toBe(
    'Stale: no change on GitHub for 2 days.',
  );
  expect(screen.queryByTestId('agents-row-stale-2')).toBeNull();
  expect(within(screen.getByTestId('agents-column-blocked')).getByText('No session.')).toBeTruthy();
  expect(screen.getByTestId('agents-row-2').textContent).toContain(
    'Item: not recorded on this desk',
  );

  // A row is named by its engine and start time, never by the session's id.
  expect(screen.getByTestId('agents-board').textContent).not.toContain('s-1');
  // Buttons, never links: nothing on the board can open GitHub inside the app.
  expect(screen.queryAllByRole('link')).toEqual([]);
  fireEvent.click(writing.getByRole('button', { name: `${REPO}#12` }));
  expect(cockpit.urlOpenExternal).toHaveBeenLastCalledWith(ref(12).url);
  fireEvent.click(writing.getByRole('button', { name: `Issue ${REPO}#1` }));
  expect(cockpit.urlOpenExternal).toHaveBeenLastCalledWith(ref(1).url);
});

test('Needs you lists its entries in order, labelled by kind, with one action each', () => {
  const onOpenFocus = vi.fn();
  useSpaceNavStore.setState({ sessionsWithTab: ['s-8'] });
  render(<NeedsYou entries={ENTRIES} onOpenFocus={onOpenFocus} />);
  const items = screen.getAllByRole('listitem');
  expect(items.map((item) => item.firstChild?.textContent)).toEqual([
    'Gate',
    'Review',
    'Stale session',
    'Stale session',
  ]);
  expect(items[0]?.textContent).toContain(
    `The process specify asks at the step confirm: Is the draft agreed? The session is on ${REPO}#12.`,
  );
  expect(items[2]?.textContent).toContain(
    `The session issue ${REPO}#8 is in Writing with no change on GitHub for 2 days.`,
  );
  expect(items.map((item) => within(item).getByRole('button').textContent)).toEqual([
    'Open the gate dialog',
    'Open the focus',
    'Open its tab',
    'Open its issue',
  ]);

  fireEvent.click(within(items[1] as HTMLElement).getByRole('button'));
  expect(onOpenFocus).toHaveBeenCalledWith(ref(3));
  fireEvent.click(within(items[3] as HTMLElement).getByRole('button'));
  expect(cockpit.urlOpenExternal).toHaveBeenLastCalledWith(ref(9).url);
  fireEvent.click(within(items[2] as HTMLElement).getByRole('button'));
  expect(useSpaceNavStore.getState().screen).toBe('sessions');
  expect(useSpaceNavStore.getState().sessionsRequest).toMatchObject({
    kind: 'show-session',
    sessionId: 's-8',
  });
});

test('a review with no focus sheet opens the focus issue; nothing pending says so', () => {
  const { unmount } = render(<NeedsYou entries={[ENTRIES[1] as NeedsYouEntry]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open the focus' }));
  expect(cockpit.urlOpenExternal).toHaveBeenLastCalledWith(ref(3).url);
  unmount();
  render(<NeedsYou entries={[]} />);
  expect(screen.getByText('Nothing needs you.')).toBeTruthy();
});

test('the gate of Needs you opens the gate dialog of its ticket', async () => {
  render(
    <>
      <NeedsYou entries={ENTRIES} />
      <SpaceDialogs />
    </>,
  );
  // The oldest request opens on its own; closing it answers nothing.
  const dialog = await screen.findByTestId('gate-dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('gate-dialog')).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Open the gate dialog' }));
  expect(await screen.findByTestId('gate-dialog')).toBeTruthy();
  expect(cockpit.spaceDialogAnswerGate).not.toHaveBeenCalled();
});

test('Start a session is disabled with the reason while a session cannot start', async () => {
  cockpit.spaceSessionEngines.mockResolvedValue({
    ok: true,
    value: {
      options: [
        {
          engineId: 'claude-code',
          name: 'Claude Code',
          canStart: false,
          reason: 'Python 3 was not found.',
          fix: null,
        },
      ],
      engineId: null,
      buttonName: 'Claude Code',
      refusal: { message: 'Python 3 was not found.', fix: null },
    },
  });
  render(<StartSession />);
  await waitFor(() =>
    expect(screen.getByTestId('dashboard-start-session-note').textContent).toBe(
      'Python 3 was not found.',
    ),
  );
  const button = screen.getByRole('button', {
    name: 'Start a Claude Code session',
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-describedby')).toBe('dashboard-start-session-note');
});

test('Start a session shows Sessions, opens an AI tab there and starts its guarded session', async () => {
  render(
    <>
      <StartSession />
      <SpaceSessions spaceRoot="/space" />
    </>,
  );
  const button = screen.getByTestId('dashboard-start-session') as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(button.textContent).toBe('Start a Claude Code session');
  expect(cockpit.spaceSessionEngines).toHaveBeenCalledWith({});
  await act(async () => {
    fireEvent.click(button);
  });
  expect(useSpaceNavStore.getState().screen).toBe('sessions');
  const tabs = await screen.findAllByTestId('dock-tab');
  expect(tabs.map((tab) => tab.getAttribute('data-kind'))).toEqual(['ai']);
  expect(useSpaceNavStore.getState().sessionsRequest).toBeNull();
  await waitFor(() =>
    expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({ engineId: 'claude-code' }),
  );
  await waitFor(() => expect(useSpaceNavStore.getState().sessionsWithTab).toEqual(['s-1']));
});
