import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Phase M4.6: an AI tab in a Space window, with the real AiTab and the real tab kinds. The
// dock is replaced by a stand-in that renders each tab's body as the dock would, and the
// xterm hook by an inert one. The cockpit's engine spawn is a spy that must never be called.
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
    DockWorkspace: (props: {
      panels: Record<string, { tabs: Tab[] }>;
      renderCtx: Ctx;
      onCloseTab: (id: string) => void;
    }) => (
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
    ),
  };
});

import type { WorkspaceTab } from '../../../src/renderer/src/components/TabbedPanel.js';
import { StartSession } from '../../../src/renderer/src/space/dashboard/StartSession.js';
import { SpaceSessions } from '../../../src/renderer/src/space/window/SpaceSessions.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import type {
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

let headerListener: ((header: SpaceSessionHeader) => void) | null = null;

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
  spaceSessionEnd: vi.fn(async () => ({ ok: true, value: { sessionId: 's-1' } })),
  spaceSessionHeader: vi.fn(async () => ({ ok: true, value: readOnly })),
  spaceSessionLeaveWriting: vi.fn<(arg: unknown) => Promise<unknown>>(),
  onSpaceSessionHeader: vi.fn((listener: (header: SpaceSessionHeader) => void) => {
    headerListener = listener;
    return () => {
      headerListener = null;
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
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: READY_CHOICE });
  cockpit.spaceSessionStart.mockResolvedValue({
    ok: true,
    value: { sessionId: 's-1', ptyId: 'pty-1', engineId: 'claude-code', unguarded: [] },
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
    headerListener?.({
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
  act(() => headerListener?.({ ...readOnly, sessionId: 's-other' }));
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
    headerListener?.({
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
  cockpit.spaceSessionHeader.mockResolvedValueOnce({
    ok: true,
    value: { ...readOnly, unguarded: ['--dangerously-skip-permissions'] },
  });
  await startFromNewAi();
  expect(cockpit.spaceSessionStart).toHaveBeenCalledWith({
    engineId: 'claude-code',
    params: ['--dangerously-skip-permissions'],
  });
  const header = screen.getByTestId('session-header');
  expect(within(header).getByTestId('session-header-unguarded').textContent).toBe('Unguarded');
  expect(screen.getByTestId('dock-tab').dataset.title).toContain('· unguarded');
});
