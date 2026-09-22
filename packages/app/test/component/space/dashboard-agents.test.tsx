import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { StartSession } from '../../../src/renderer/src/space/dashboard/StartSession.js';
import { BandNeedsYou } from '../../../src/renderer/src/space/dashboard/v2/BandNeedsYou.js';
import { WaitingBand } from '../../../src/renderer/src/space/dashboard/v2/WaitingBand.js';
import { SpaceDialogs } from '../../../src/renderer/src/space/dialogs/SpaceDialogs.js';
import { SpaceSessions } from '../../../src/renderer/src/space/window/SpaceSessions.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type {
  DashboardPanel,
  DashboardReportState,
  SpaceProjectState,
} from '../../../src/shared/ipc.js';
import type {
  PendingDialog,
  SpaceEngineChoice,
  SpaceSessionEnginesResult,
} from '../../../src/shared/ipc.js';
/** A ready `SpaceEngineChoice`: one engine, startable. */
function readyChoice(engineId = 'claude-code', name = 'Claude Code'): SpaceEngineChoice {
  return {
    options: [{ engineId, name, canStart: true, reason: null, fix: null, params: [] }],
    engineId,
    buttonName: name,
    refusal: null,
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

const ENGINE = { id: 'claude-code', name: 'Claude Code', binary: 'claude' };

const cockpit = {
  spaceDashboardReport: vi.fn(async () => ({
    ok: true,
    value: {
      version: 1,
      definition: null,
      context: null,
      report: null,
      refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
    },
  })),
  onSpaceDashboardReport: vi.fn(() => () => {}),
  urlOpenExternal: vi.fn(),
  enginesList: vi.fn(async () => [ENGINE]),
  onEnginesChanged: vi.fn(() => () => {}),
  spaceSessionEngines: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionEnginePick: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionReinstall: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionStart: vi.fn<(arg: unknown) => Promise<unknown>>(),
  // PM auto-start is opt-in for the session tests; this fixture keeps it refused.
  spacePmEnsure: vi.fn<(arg: unknown) => Promise<unknown>>(),
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
      unguarded: [],
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
    value: { sessionId: 's-1', ptyId: 'pty-1', engineId: 'claude-code', unguarded: [] },
  });
  cockpit.spacePmEnsure.mockResolvedValue({
    ok: false,
    error: { kind: 'pm-unavailable', message: 'PM is disabled for this test.' },
  });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  useSpaceNavStore.setState({ screen: 'dashboard', sessionsRequest: null, sessionsWithTab: [] });
});

afterEach(() => cleanup());

const WAITING_PANELS = [
  { id: 'pulls', kind: 'pull-requests', source: 'companion' },
  { id: 'sessions', kind: 'live-sessions', source: 'companion' },
  { id: 'agents', kind: 'agents-board', source: 'companion' },
  { id: 'stats', kind: 'space-stats', source: 'companion' },
] as unknown as DashboardPanel[];

function reportState(): DashboardReportState {
  return {
    version: 1,
    definition: null,
    context: {
      observedAt: '2026-09-18T09:00:00.000Z',
      documents: [],
      handovers: [],
      activity: [],
      problems: [],
    },
    report: null,
    refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
  };
}

function projectState(overrides: Partial<SpaceProjectState> = {}): SpaceProjectState {
  return {
    version: 1,
    snapshot: null,
    fetchedAt: null,
    state: 'fresh',
    failure: null,
    refreshing: false,
    model: { columns: [], unstaged: [], standalone: [], needsYou: [], board: [] },
    pullRequests: [],
    pullRequestsFailure: null,
    nextActions: [],
    moving: { inProgress: [], queued: [], untriaged: [], dormant: [], done: [] },
    dormant: { count: 0, paused: 0, oldestAgeMs: null, medianAgeMs: null },
    stats: { focusesOpen: 0, itemsOpen: 0, openPullRequests: 0, liveSessions: 0 },
    ...overrides,
  } as SpaceProjectState;
}

test('WaitingBand keeps live activity separate from Agents board and uses readable states', () => {
  const report = reportState();
  report.context = {
    observedAt: '2026-09-18T09:00:00.000Z',
    documents: [],
    handovers: [],
    activity: [
      { id: 'live-1', startedAt: '2026-09-18T09:00:00.000Z', mode: 'writing', purpose: 'testing' },
    ],
    problems: [],
  };
  const project = projectState({
    model: {
      columns: [],
      unstaged: [],
      standalone: [],
      needsYou: [],
      board: [
        {
          issue: {
            repository: 'fake-human/dash-space',
            number: 4,
            url: 'https://github.com/fake-human/dash-space/issues/4',
          },
          title: 'session issue',
          column: 'Blocked',
          targets: [],
          attended: true,
          person: '',
          machine: '',
          updatedAt: null,
          idleMs: null,
          stale: true,
          local: null,
          gateTicket: null,
        },
      ],
    },
  });
  render(
    <WaitingBand
      panels={WAITING_PANELS}
      project={project}
      reportState={report}
      now={Date.parse('2026-09-18T10:00:00.000Z')}
    />,
  );
  expect(screen.getByText('WRITING')).toBeTruthy();
  expect(screen.getByText('BLOCKED')).toBeTruthy();
  expect(screen.queryByText('NO OPEN PULL REQUESTS')).toBeTruthy();
});

test('the Needs you gate still opens the real gate dialog from the v2 band', async () => {
  const project = projectState({
    model: {
      columns: [],
      unstaged: [],
      standalone: [],
      board: [],
      needsYou: [
        {
          kind: 'gate',
          ticket: GATE_TICKET,
          sessionId: 's-1',
          askedAt: GATE.askedAt,
          process: GATE.process,
          step: GATE.step,
          question: GATE.question,
          item: null,
        },
      ],
    },
    nextActions: [
      {
        kind: 'gate',
        ticket: GATE_TICKET,
        sessionId: 's-1',
        askedAt: GATE.askedAt,
        process: GATE.process,
        step: GATE.step,
        question: GATE.question,
        item: null,
        headline: GATE.question,
      },
    ],
  });
  render(
    <>
      <BandNeedsYou
        panels={[{ id: 'next', kind: 'next-action', source: 'companion' }]}
        project={project}
        reportState={reportState()}
        repositories={null}
        now={Date.parse(GATE.askedAt)}
        onOpenFocus={vi.fn()}
      />
      <SpaceDialogs />
    </>,
  );
  expect(await screen.findByTestId('gate-dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByTestId('gate-dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('gate-dialog')).toBeNull());
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
          params: [],
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
    expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({ engineId: 'claude-code', params: [] }),
  );
  await waitFor(() => expect(useSpaceNavStore.getState().sessionsWithTab).toEqual(['s-1']));
});
