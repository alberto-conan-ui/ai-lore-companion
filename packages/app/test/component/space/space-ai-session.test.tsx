import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Phase M4.6: an AI tab in a Space window, with the real AiTab and the real tab kinds. The
// dock is replaced by a stand-in that renders each tab's body as the dock would, and the
// xterm hook by an inert one. The cockpit's engine spawn is a spy that must never be called.
const attachedPtyIds: string[] = [];
const focusedPtyIds: string[] = [];
const activatedPanels: string[] = [];
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: (config: { ptyId?: string }) => {
    if (config.ptyId !== undefined) attachedPtyIds.push(config.ptyId);
    return {
      hostRef: { current: null },
      focus: () => {
        if (config.ptyId) focusedPtyIds.push(config.ptyId);
      },
      search: {},
    };
  },
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
    DockWorkspace: (props: {
      panels: Record<string, { tabs: Tab[] }>;
      renderCtx: Ctx;
      onCloseTab: (id: string) => void;
      onApi: (api: unknown) => void;
      onLayoutChange: () => void;
    }) => {
      useEffect(() => {
        const api = {
          activePanel: { id: '' },
          getPanel: (id: string) => ({
            api: {
              setActive: () => {
                activatedPanels.push(id);
                api.activePanel = { id };
                props.onLayoutChange();
              },
            },
          }),
        };
        props.onApi(api);
      }, [props.onApi, props.onLayoutChange]);
      return (
        <div data-testid="dock-workspace">
          {Object.values(props.panels).flatMap((panel) =>
            panel.tabs.map((tab) => (
              <div key={tab.id} data-testid="dock-tab" data-kind={tab.kind} data-title={tab.title}>
                <button
                  type="button"
                  data-testid="dock-tab-close"
                  onClick={() => props.onCloseTab(tab.id)}
                >
                  close
                </button>
                {TAB_KINDS[tab.kind].renderBody(tab, true, props.renderCtx)}
              </div>
            )),
          )}
        </div>
      );
    },
  };
});

import type { WorkspaceTab } from '../../../src/renderer/src/components/TabbedPanel.js';
import { StartSession } from '../../../src/renderer/src/space/dashboard/StartSession.js';
import { SpaceSessions } from '../../../src/renderer/src/space/window/SpaceSessions.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type {
  DashboardReportState,
  SpaceEngineChoice,
  SpaceSessionEnginesResult,
  SpaceSessionHeader,
} from '../../../src/shared/ipc.js';

const ENGINE = { id: 'claude-code', name: 'Claude Code', binary: 'claude' };

/** A ready `SpaceEngineChoice`: Claude Code, startable. */
const READY_CHOICE: SpaceEngineChoice = {
  options: [
    {
      engineId: 'claude-code',
      name: 'Claude Code',
      canStart: true,
      reason: null,
      fix: null,
      params: [],
    },
  ],
  engineId: 'claude-code',
  buttonName: 'Claude Code',
  refusal: null,
};

const headerListeners = new Set<(header: SpaceSessionHeader) => void>();
const headerBySession = new Map<string, SpaceSessionHeader>();
let reportListener: ((state: DashboardReportState) => void) | null = null;
function emitHeader(header: SpaceSessionHeader): void {
  headerBySession.set(header.sessionId, header);
  for (const listener of headerListeners) listener(header);
}

const readOnly: SpaceSessionHeader = {
  sessionId: 's-1',
  engineId: 'claude-code',
  mode: 'read-only',
  targets: [],
  item: null,
  closed: false,
  unguarded: [],
};

const cockpit = {
  enginesList: vi.fn(async () => [ENGINE]),
  onEnginesChanged: vi.fn(() => () => {}),
  urlOpenExternal: vi.fn(),
  onTerminalExit: vi.fn(() => () => {}),
  sendTerminalInput: vi.fn(),
  /** The cockpit's unguarded engine start. A Space window must never call it. */
  spawnTerminalEngine: vi.fn(async () => 'unguarded-pty'),
  aiPromptsWidthGet: vi.fn(async () => null),
  aiPromptsWidthSet: vi.fn(),
  spaceSessionEngines: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionEnginePick: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionReinstall: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionStart: vi.fn<(arg: unknown) => Promise<unknown>>(),
  /** PM auto-start is opt-in per test; the normal fixture keeps old session tests focused. */
  spacePmEnsure: vi.fn<(arg: unknown) => Promise<unknown>>(),
  spaceSessionEnd: vi.fn(async () => ({ ok: true, value: { sessionId: 's-1' } })),
  spaceDashboardReport: vi.fn(async () => ({
    ok: true,
    value: {
      version: 1,
      definition: null,
      context: null,
      report: null,
      refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
    } as DashboardReportState,
  })),
  spaceDashboardRefresh: vi.fn(async () => ({
    ok: true,
    value: {
      version: 1,
      definition: null,
      context: null,
      report: null,
      refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
    },
  })),
  onSpaceDashboardReport: vi.fn((listener: (state: DashboardReportState) => void) => {
    reportListener = listener;
    return () => {
      reportListener = null;
    };
  }),
  spaceSessionHeader: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    ok: true,
    value: headerBySession.get(sessionId) ?? { ...readOnly, sessionId },
  })),
  spaceSessionLeaveWriting: vi.fn<(arg: unknown) => Promise<unknown>>(),
  onSpaceSessionHeader: vi.fn((listener: (header: SpaceSessionHeader) => void) => {
    headerListeners.add(listener);
    return () => {
      headerListeners.delete(listener);
    };
  }),
  spaceSkillsList: vi.fn(async () => ({
    ok: true,
    value: {
      skills: [
        {
          name: 'start-work',
          part: 'processes',
          layer: 'core',
          description: 'From intention.',
          invocation: '/lore:start-work',
        },
        {
          name: 'orient',
          part: 'verbs',
          layer: 'core',
          description: 'Open a session.',
          invocation: '/lore:orient',
        },
        {
          name: 'my-verb',
          part: 'verbs',
          layer: 'own',
          description: 'Our own verb.',
          invocation: '/lore:my-verb',
        },
      ],
      notInstalled: [],
    },
  })),
};

beforeEach(() => {
  attachedPtyIds.length = 0;
  focusedPtyIds.length = 0;
  activatedPanels.length = 0;
  headerBySession.clear();
  headerListeners.clear();
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: READY_CHOICE });
  cockpit.spaceSessionStart.mockResolvedValue({
    ok: true,
    value: { sessionId: 's-1', ptyId: 'pty-1', engineId: 'claude-code', unguarded: [] },
  });
  cockpit.spacePmEnsure.mockResolvedValue({
    ok: false,
    error: { kind: 'pm-unavailable', message: 'PM is disabled for this test.' },
  });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  useSpaceNavStore.setState({ tickedParams: {} });
});

afterEach(() => cleanup());

/** Render Sessions and press `+ AI` once it is enabled. */
async function startFromNewAi(): Promise<void> {
  render(<SpaceSessions spaceRoot="/work/space" />);
  const ai = screen.getByTestId('new-ai') as HTMLButtonElement;
  await waitFor(() => expect(ai.disabled).toBe(false));
  fireEvent.click(ai);
  await screen.findByTestId('session-header');
}

test('mounting a Space auto-starts PM once and attaches its returned PTY without a second spawn', async () => {
  cockpit.spacePmEnsure.mockResolvedValue({
    ok: true,
    value: { sessionId: 'pm-1', ptyId: 'pm-pty-1', engineId: 'claude-code', unguarded: [] },
  });
  render(<SpaceSessions spaceRoot="/work/space" />);

  await waitFor(() => expect(screen.getByTestId('session-header')).toBeTruthy());
  expect(screen.getAllByTestId('dock-tab').map((tab) => tab.getAttribute('data-title'))).toContain(
    'PM',
  );
  expect(cockpit.spacePmEnsure).toHaveBeenCalledWith({});
  expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
  expect(attachedPtyIds).toContain('pm-pty-1');
  expect(screen.getByTestId('ai-tab').dataset.aiState).toBe('running');
});

test('a refused PM auto-start can be retried, and the successful retry still uses the attached PTY', async () => {
  cockpit.spacePmEnsure
    .mockResolvedValueOnce({
      ok: false,
      error: { kind: 'pm-unavailable', message: 'PM is not ready yet.' },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: { sessionId: 'pm-2', ptyId: 'pm-pty-2', engineId: 'claude-code', unguarded: [] },
    });
  render(<SpaceSessions spaceRoot="/work/space" />);

  await waitFor(() => expect(screen.getByTestId('pm-retry')).toBeTruthy());
  expect(screen.getByRole('alert').textContent).toBe('PM is not ready yet.');
  fireEvent.click(screen.getByTestId('pm-retry'));
  await waitFor(() => expect(screen.getByTestId('session-header')).toBeTruthy());
  expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(2);
  expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('closing the PM tab ends its session and removes the tab', async () => {
  cockpit.spacePmEnsure.mockResolvedValue({
    ok: true,
    value: { sessionId: 'pm-3', ptyId: 'pm-pty-3', engineId: 'claude-code', unguarded: [] },
  });
  render(<SpaceSessions spaceRoot="/work/space" />);
  await waitFor(() => expect(screen.getByTestId('session-header')).toBeTruthy());

  const pmTab = screen
    .getAllByTestId('dock-tab')
    .find((tab) => tab.getAttribute('data-title') === 'PM');
  expect(pmTab).toBeTruthy();
  fireEvent.click(within(pmTab as HTMLElement).getByTestId('dock-tab-close'));
  expect(cockpit.spaceSessionEnd).toHaveBeenCalledWith({ sessionId: 'pm-3' });
  expect(screen.queryByTestId('session-header')).toBeNull();
});

test('an exited PM offers Restart and attaches the replacement PM without a normal AI start', async () => {
  let exited: ((payload: { id: string }) => void) | null = null;
  cockpit.onTerminalExit.mockImplementation(((listener: (payload: { id: string }) => void) => {
    exited = listener;
    return () => {};
  }) as never);
  cockpit.spacePmEnsure
    .mockResolvedValueOnce({
      ok: true,
      value: {
        sessionId: 'pm-before',
        ptyId: 'pm-before-pty',
        engineId: 'claude-code',
        unguarded: [],
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: {
        sessionId: 'pm-after',
        ptyId: 'pm-after-pty',
        engineId: 'claude-code',
        unguarded: [],
      },
    });
  try {
    render(<SpaceSessions spaceRoot="/work/space" />);
    await screen.findByTestId('session-header');
    act(() => exited?.({ id: 'pm-before-pty' }));
    fireEvent.click(await screen.findByTestId('ai-restart'));
    await screen.findByTestId('session-header');
    expect(attachedPtyIds).toContain('pm-after-pty');
    expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(2);
    expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
    expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
  } finally {
    cockpit.onTerminalExit.mockImplementation(() => () => {});
  }
});

test('an in-flight PM ensure cannot resurrect a closed Space component', async () => {
  let resolveEnsure: (value: unknown) => void = () => {};
  cockpit.spacePmEnsure.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveEnsure = resolve;
      }),
  );
  const view = render(<SpaceSessions spaceRoot="/work/space" />);
  await waitFor(() => expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(1));
  view.unmount();
  resolveEnsure({
    ok: true,
    value: { sessionId: 'pm-late', ptyId: 'pm-pty-late', engineId: 'claude-code', unguarded: [] },
  });
  await act(async () => {});
  expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('StrictMode remounts do not create duplicate PM tabs or ordinary AI spawns', async () => {
  cockpit.spacePmEnsure.mockResolvedValue({
    ok: true,
    value: {
      sessionId: 'pm-strict',
      ptyId: 'pm-pty-strict',
      engineId: 'claude-code',
      unguarded: [],
    },
  });
  render(
    <StrictMode>
      <SpaceSessions spaceRoot="/work/space" />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByTestId('session-header')).toBeTruthy());
  expect(
    screen.getAllByTestId('dock-tab').filter((tab) => tab.getAttribute('data-title') === 'PM'),
  ).toHaveLength(1);
  expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('+ AI starts the guarded session through spaceSessionStart and never the unguarded engine spawn', async () => {
  await startFromNewAi();
  expect(cockpit.spaceSessionStart).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({ engineId: 'claude-code', params: [] });
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
  // No width is read from or saved to the v0.8 settings file.
  expect(cockpit.aiPromptsWidthGet).not.toHaveBeenCalled();
  expect(screen.getByTestId('ai-tab').dataset.aiState).toBe('running');
});

test('Start a session on the Dashboard starts the guarded session and never the unguarded engine spawn', async () => {
  useSpaceNavStore.setState({ screen: 'dashboard', sessionsRequest: null, sessionsWithTab: [] });
  render(
    <>
      <StartSession />
      <SpaceSessions spaceRoot="/work/space" />
    </>,
  );
  const start = screen.getByTestId('dashboard-start-session') as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByTestId('session-header');
  expect(useSpaceNavStore.getState().screen).toBe('sessions');
  expect(cockpit.spaceSessionStart).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({ engineId: 'claude-code', params: [] });
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('a refused start shows its sentence and starts nothing else', async () => {
  cockpit.spaceSessionStart.mockResolvedValue({
    ok: false,
    error: { kind: 'plugin-missing', message: 'No AI session was started: the plugin is missing.' },
  });
  render(<SpaceSessions spaceRoot="/work/space" />);
  const ai = screen.getByTestId('new-ai') as HTMLButtonElement;
  await waitFor(() => expect(ai.disabled).toBe(false));
  fireEvent.click(ai);
  expect((await screen.findByTestId('ai-start-error')).textContent).toBe(
    'No AI session was started: the plugin is missing.',
  );
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('the header shows Read only, then Writing with the targets, their branches and the item', async () => {
  await startFromNewAi();
  const header = screen.getByTestId('session-header');
  await waitFor(() => expect(header.dataset.mode).toBe('read-only'));
  expect(within(header).getByTestId('session-header-mode').textContent).toBe('Read only');
  expect(within(header).getByTestId('session-header-engine').textContent).toBe('Claude Code');
  expect(within(header).queryByTestId('session-header-targets')).toBeNull();
  expect(within(header).queryByTestId('session-header-leave-writing')).toBeNull();

  act(() =>
    emitHeader({
      ...readOnly,
      mode: 'writing',
      targets: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'feat/12-header' }],
      item: { repository: 'me/space', number: 12, url: 'https://github.com/me/space/issues/12' },
    }),
  );
  expect(within(header).getByTestId('session-header-mode').textContent).toBe('Writing');
  expect(
    within(header)
      .getAllByTestId('session-header-target')
      .map((chip) => chip.textContent),
  ).toEqual(['lore', 'repository app, branch feat/12-header']);
  expect(within(header).getByTestId('session-header-item').textContent).toBe('item me/space#12');

  // A push for another session changes nothing here.
  act(() => emitHeader({ ...readOnly, sessionId: 's-other' }));
  expect(within(header).getByTestId('session-header-mode').textContent).toBe('Writing');
});

test('Leave Writing asks for no confirmation and says what it released', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  cockpit.spaceSessionLeaveWriting.mockResolvedValue({
    ok: true,
    value: {
      sessionId: 's-1',
      released: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'feat/12-header' }],
    },
  });
  await startFromNewAi();
  act(() =>
    emitHeader({
      ...readOnly,
      mode: 'writing',
      targets: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'feat/12-header' }],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Leave Writing' }));
  await waitFor(() =>
    expect(screen.getByTestId('session-header-notice').textContent).toBe(
      'Left Writing. Released: lore; repository app, branch feat/12-header.',
    ),
  );
  expect(cockpit.spaceSessionLeaveWriting).toHaveBeenCalledWith({ sessionId: 's-1' });
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByTestId('session-header-mode').textContent).toBe('Read only');
  expect(screen.queryByTestId('session-header-leave-writing')).toBeNull();
  confirm.mockRestore();
});

test('the Skills column lists lore:<name> by part with its layer, and a click types /lore:<name> without sending it', async () => {
  await startFromNewAi();
  const column = await screen.findByTestId('skills-column');
  await within(column).findByTestId('skill-row-orient');
  expect(within(column).getByRole('heading', { name: 'processes' })).toBeTruthy();
  const verbs = within(column).getByTestId('skills-group-verbs');
  expect(within(verbs).getByTestId('skill-row-my-verb').textContent).toContain('lore:my-verb');
  expect(within(verbs).getByTestId('skill-row-my-verb').textContent).toContain('own');
  expect(within(verbs).getByTestId('skill-row-orient').textContent).toContain('Open a session.');

  fireEvent.click(within(column).getByTestId('skill-row-orient'));
  expect(cockpit.sendTerminalInput).toHaveBeenCalledWith({ id: 'pty-1', data: '/lore:orient' });
});

test('Restart after the engine exits starts a guarded session again, never the unguarded spawn', async () => {
  let exited: ((payload: { id: string }) => void) | null = null;
  cockpit.onTerminalExit.mockImplementation(((listener: (payload: { id: string }) => void) => {
    exited = listener;
    return () => {};
  }) as never);
  await startFromNewAi();
  act(() => exited?.({ id: 'pty-1' }));
  const restart = await screen.findByTestId('ai-restart');
  expect(screen.queryByTestId('session-header')).toBeNull();
  fireEvent.click(restart);
  await screen.findByTestId('session-header');
  expect(cockpit.spaceSessionStart).toHaveBeenCalledTimes(2);
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
  cockpit.onTerminalExit.mockImplementation(() => () => {});
});

test('closing an AI tab ends its session through spaceSessionEnd', async () => {
  await startFromNewAi();
  fireEvent.click(screen.getByTestId('dock-tab-close'));
  expect(cockpit.spaceSessionEnd).toHaveBeenCalledWith({ sessionId: 's-1' });
  expect(screen.queryByTestId('dock-tab')).toBeNull();
});

test('a restored AI tab in a Space window stays dormant: no engine starts until Start', async () => {
  const restored: WorkspaceTab = {
    id: 'restored-ai',
    kind: 'ai',
    title: 'AI (Claude Code)',
    baseTitle: 'AI (Claude Code)',
    engine: 'claude-code',
    lastSession: { kind: 'ai', detail: 'Claude Code' },
  };
  render(<SpaceSessions spaceRoot="/work/space" initialTabs={[restored]} />);
  await screen.findByTestId('restore-banner');
  const start = await screen.findByTestId('ai-start');
  await act(async () => {});
  expect(cockpit.spaceSessionStart).not.toHaveBeenCalled();
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
  expect(screen.getByTestId('ai-tab').dataset.aiState).toBe('empty');

  fireEvent.click(start);
  await screen.findByTestId('session-header');
  expect(cockpit.spaceSessionStart).toHaveBeenCalledTimes(1);
  expect(cockpit.spawnTerminalEngine).not.toHaveBeenCalled();
});

test('a start sends the ticked parameter texts, and an unguarded start suffixes the tab title and shows the header pill', async () => {
  useSpaceNavStore.setState({
    tickedParams: { 'claude-code': ['--dangerously-skip-permissions'] },
  });
  cockpit.spaceSessionStart.mockResolvedValueOnce({
    ok: true,
    value: {
      sessionId: 's-1',
      ptyId: 'pty-1',
      engineId: 'claude-code',
      unguarded: ['--dangerously-skip-permissions'],
    },
  });
  headerBySession.set('s-1', { ...readOnly, unguarded: ['--dangerously-skip-permissions'] });
  await startFromNewAi();
  expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({
    engineId: 'claude-code',
    params: ['--dangerously-skip-permissions'],
  });
  const header = screen.getByTestId('session-header');
  expect(within(header).getByTestId('session-header-unguarded').textContent).toBe('Unguarded');
  expect(screen.getByTestId('dock-tab').dataset.title).toContain('· unguarded');
});

test('the roster selects the real worker dock panel, tracks header pushes and survives collapse', async () => {
  await startFromNewAi();
  const roster = screen.getByTestId('session-roster');
  const worker = within(roster).getByTestId('session-roster-worker');
  const select = within(worker).getAllByRole('button')[0];
  fireEvent.click(select);
  expect(activatedPanels).toEqual([worker.dataset.tabId]);
  expect(select.getAttribute('aria-pressed')).toBe('true');
  act(() =>
    emitHeader({
      ...readOnly,
      mode: 'writing',
      targets: [{ kind: 'repository', name: 'app', branch: 'feature-roster' }],
    }),
  );
  expect(worker.textContent).toContain('Writing');
  expect(worker.textContent).toContain('repository app, branch feature-roster');
  const dock = screen.getByTestId('dock-workspace');
  fireEvent.click(screen.getByTestId('session-roster-toggle'));
  expect(screen.getByTestId('session-roster-toggle').getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByTestId('dock-workspace')).toBe(dock);
  fireEvent.click(screen.getByTestId('session-roster-toggle'));
  expect(screen.getByTestId('session-roster')).toBe(roster);
  expect(cockpit.spaceSessionStart).toHaveBeenCalledTimes(1);
});

test('the pinned PM restart ends the old session and attaches exactly one replacement', async () => {
  cockpit.spacePmEnsure.mockResolvedValueOnce({
    ok: true,
    value: { sessionId: 'pm-old', ptyId: 'pty-old', engineId: 'claude-code', unguarded: [] },
  });
  cockpit.spacePmEnsure.mockResolvedValueOnce({
    ok: true,
    value: { sessionId: 'pm-new', ptyId: 'pty-new', engineId: 'claude-code', unguarded: [] },
  });
  render(<SpaceSessions spaceRoot="/work/space" />);
  await screen.findByTestId('pm-restart');
  fireEvent.click(screen.getByTestId('pm-restart'));
  await waitFor(() => expect(attachedPtyIds).toContain('pty-new'));
  expect(cockpit.spaceSessionEnd).toHaveBeenCalledWith({ sessionId: 'pm-old' });
  expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(2);
  expect(screen.getAllByTestId('session-roster-pm')).toHaveLength(1);
  expect(screen.getAllByTestId('dock-tab')).toHaveLength(1);
  expect(screen.queryByTestId('session-roster-worker')).toBeNull();
  fireEvent.click(screen.getByTestId('pm-dashboard-request'));
  expect(cockpit.spaceDashboardRefresh).toHaveBeenCalledWith({ reason: 'human' });
  expect(cockpit.sendTerminalInput).not.toHaveBeenCalled();
});

test('roster report pushes retain their version and survive a late failed initial read', async () => {
  let failRead: ((reason: Error) => void) | undefined;
  cockpit.spaceDashboardReport.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failRead = reject;
      }),
  );
  render(<SpaceSessions spaceRoot="/work/space" />);
  const report: DashboardReportState['report'] = {
    definitionHash: 'hash',
    components: [{ id: 'position', type: 'text', text: 'A report' }],
    basis: 'Project',
    sessionId: 'pm-source',
    receivedAt: '2026-09-20T12:00:00Z',
    stale: true,
    staleReason: 'project-changed',
  };
  act(() =>
    reportListener?.({
      ...{
        version: 1,
        definition: null,
        context: null,
        report: null,
        refresh: {
          status: 'idle',
          requestId: null,
          reason: null,
          requestedAt: null,
          failure: null,
        },
      },
      version: 2,
      report,
    }),
  );
  const pm = screen.getByTestId('session-roster-pm');
  expect(pm.textContent).toContain('Source: pm-source');
  expect(pm.textContent).toContain('the Project source changed.');
  act(() =>
    reportListener?.({
      version: 1,
      definition: null,
      context: null,
      report: null,
      refresh: { status: 'idle', requestId: null, reason: null, requestedAt: null, failure: null },
    }),
  );
  await act(async () => failRead?.(new Error('late read failure')));
  expect(pm.textContent).toContain('Source: pm-source');
  expect(pm.textContent).not.toContain('late read failure');
  fireEvent.click(within(pm).getByRole('button', { name: 'Read report on Dashboard' }));
  expect(useSpaceNavStore.getState().screen).toBe('dashboard');
});

test('roster header failures display unavailable and a later push recovers', async () => {
  // The roster subscribes first; leave the native header's independent read successful.
  cockpit.spaceSessionHeader.mockRejectedValueOnce(new Error('Desk read failed'));
  cockpit.spaceSessionHeader.mockResolvedValueOnce({ ok: true, value: readOnly });
  await startFromNewAi();
  const worker = screen.getByTestId('session-roster-worker');
  await waitFor(() => expect(worker.textContent).toContain('Session details unavailable'));
  expect(worker.textContent).toContain('Desk read failed');
  act(() => emitHeader({ ...readOnly, mode: 'writing' }));
  expect(worker.textContent).toContain('Writing');
  expect(worker.textContent).not.toContain('Desk read failed');
});

test('closing the PM dock tab while restart waits for session end cancels the replacement', async () => {
  let finishEnd: ((result: { ok: boolean; value: { sessionId: string } }) => void) | undefined;
  cockpit.spacePmEnsure.mockResolvedValueOnce({
    ok: true,
    value: {
      sessionId: 'pm-closing',
      ptyId: 'pty-closing',
      engineId: 'claude-code',
      unguarded: [],
    },
  });
  cockpit.spaceSessionEnd.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishEnd = resolve;
      }),
  );
  render(<SpaceSessions spaceRoot="/work/space" />);
  await screen.findByTestId('pm-restart');
  fireEvent.click(screen.getByTestId('pm-restart'));
  expect(cockpit.spaceSessionEnd).toHaveBeenCalledWith({ sessionId: 'pm-closing' });
  fireEvent.click(screen.getByTestId('dock-tab-close'));
  await act(async () => finishEnd?.({ ok: true, value: { sessionId: 'pm-closing' } }));
  expect(cockpit.spacePmEnsure).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('dock-tab')).toBeNull();
  expect(screen.getByTestId('pm-retry').textContent).toBe('Start PM');
  expect(screen.getByTestId('pm-status').textContent).toContain('Not running');
});

test('Sessions folds options and readiness while preserving active unguarded warnings and parameter choices', async () => {
  cockpit.spaceSessionEngines.mockResolvedValue({
    ok: true,
    value: {
      ...READY_CHOICE,
      options: [
        {
          ...READY_CHOICE.options[0],
          params: [
            {
              text: '--dangerously-skip-permissions',
              defaultOn: true,
              effect: 'unguarded',
              options: ['--dangerously-skip-permissions'],
            },
          ],
          lore: {
            asClaudeCode: true,
            lines: [{ aspect: 'guard', state: 'yes', text: 'Guard is installed.' }],
          },
        },
      ],
    },
  });
  render(<SpaceSessions spaceRoot="/work/space" />);
  const toggle = await screen.findByRole('button', { name: 'Options and readiness' });
  await waitFor(() => expect(screen.getByTestId('new-ai').textContent).toContain('unguarded'));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByTestId('new-ai-unguarded-note').closest('[hidden]')).toBeNull();
  expect(screen.getByTestId('new-ai-lore').closest('[hidden]')).not.toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  expect(screen.queryByTestId('new-ai-unguarded-note')).toBeNull();
  expect(screen.getByTestId('new-ai').textContent).toBe('Start a Claude Code session');
  fireEvent.click(toggle);
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByTestId('new-ai'));
  await screen.findByTestId('session-header');
  expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({ engineId: 'claude-code', params: [] });
});
