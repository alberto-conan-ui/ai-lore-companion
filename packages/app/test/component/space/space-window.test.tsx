import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The bodies of the cockpit's tab kinds and the dock itself are replaced: this file tests the
// Space window's own parts. The dock stand-in shows what `SpaceSessions` gives it.
vi.mock('../../../src/renderer/src/components/AiTab.js', () => ({
  AiTab: () => <div data-testid="body-ai" />,
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
vi.mock('../../../src/renderer/src/components/DockWorkspace.js', () => ({
  DockWorkspace: (props: {
    panels: Record<string, { tabs: { id: string; kind: string; title: string }[] }>;
    renderCtx: {
      projectRoot: string;
      handleTerminalStatus: (id: string, status: 'idle' | 'running', command: string) => void;
    };
    newTabCtx: {
      onNewShell: () => void;
      onNewAi: (engineId: string) => void;
      aiUnavailableReason?: string;
    };
    onCloseTab: (id: string) => void;
    onRenameTab: (id: string, name: string) => void;
  }) => (
    <div
      data-testid="dock-workspace"
      data-project-root={props.renderCtx.projectRoot}
      data-ai-unavailable-reason={props.newTabCtx.aiUnavailableReason ?? ''}
    >
      <button type="button" data-testid="dock-new-shell" onClick={props.newTabCtx.onNewShell}>
        + shell
      </button>
      {/* A caller that ignores the disabled state and asks for an AI tab anyway. */}
      <button
        type="button"
        data-testid="dock-force-new-ai"
        onClick={() => props.newTabCtx.onNewAi('default.claude')}
      >
        force + AI
      </button>
      {Object.entries(props.panels).flatMap(([panelId, panel]) =>
        panel.tabs.map((tab) => (
          <div key={tab.id} data-testid="dock-tab" data-panel={panelId} data-kind={tab.kind}>
            <span data-testid="dock-tab-title">{tab.title}</span>
            <button
              type="button"
              data-testid="dock-tab-run"
              onClick={() => props.renderCtx.handleTerminalStatus(tab.id, 'running', 'npm test')}
            >
              run
            </button>
            <button
              type="button"
              data-testid="dock-tab-rename"
              onClick={() => props.onRenameTab(tab.id, 'By hand')}
            >
              rename
            </button>
            <button
              type="button"
              data-testid="dock-tab-close"
              onClick={() => props.onCloseTab(tab.id)}
            >
              close
            </button>
          </div>
        )),
      )}
    </div>
  ),
}));
vi.mock('../../../src/renderer/src/components/SearchDialog.js', () => ({
  SearchDialog: (props: {
    scopes: { id: string; label: string; dirs: string[] }[];
    onPick: (path: string) => void;
    displayPath: (abs: string) => string;
    onClose: () => void;
    note?: string;
  }) => (
    <div data-testid="search-dialog" data-scopes={JSON.stringify(props.scopes)}>
      <span data-testid="search-note">{props.note ?? ''}</span>
      <span data-testid="search-display">{props.displayPath('/work/my-space/lore/space.md')}</span>
      <button
        type="button"
        data-testid="search-pick"
        onClick={() => props.onPick('/work/my-space/lore/space.md')}
      >
        pick
      </button>
      <button type="button" data-testid="search-close" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

import { SpaceSurface } from '../../../src/renderer/src/space/SpaceSurface.js';
import { useSpaceNavStore } from '../../../src/renderer/src/space/window/spaceNavStore.js';
import { projectState } from './dashboard-fixtures.js';

test('a newly opened Space starts on the Dashboard', () => {
  expect(useSpaceNavStore.getInitialState().screen).toBe('dashboard');
});
import type {
  SpaceEngineChoice,
  SpaceSessionEnginesResult,
  SpaceSummary,
  SpaceWindowResult,
} from '../../../src/shared/ipc.js';

/** A ready `SpaceEngineChoice`: one engine, startable. */
function readyChoice(engineId = 'default.claude', name = 'Claude'): SpaceEngineChoice {
  return {
    options: [{ engineId, name, canStart: true, reason: null, fix: null }],
    engineId,
    buttonName: name,
    refusal: null,
  };
}

/** A refused `SpaceEngineChoice`: no engine can start, with `message` as the refusal's sentence. */
function refusedChoice(
  message: string,
  engineId = 'default.claude',
  name = 'Claude',
): SpaceEngineChoice {
  return {
    options: [{ engineId, name, canStart: false, reason: message, fix: null }],
    engineId: null,
    buttonName: name,
    refusal: { message, fix: null },
  };
}

const space: SpaceSummary = {
  root: '/work/my-space',
  key: 'abc',
  name: 'my-space',
  manifest: {
    format: 1,
    name: 'my-space',
    github: { repository: 'me/my-space', project: 7 },
    repositories: [],
    publishAreas: [],
  },
};

let focusGlobalSearch: (() => void) | null = null;

const cockpit = {
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  enginesList: vi.fn(async () => []),
  onEnginesChanged: vi.fn(() => () => {}),
  onFocusGlobalSearch: vi.fn((listener: () => void) => {
    focusGlobalSearch = listener;
    return () => {
      focusGlobalSearch = null;
    };
  }),
  onSettingsOpen: vi.fn(() => () => {}),
  urlOpenExternal: vi.fn(),
  // Phase M9.10: the engine start control asks the engine choice.
  spaceSessionEngines: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionEnginePick: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionReinstall: vi.fn<(arg: unknown) => Promise<SpaceSessionEnginesResult>>(),
  spaceSessionStart: vi.fn(),
  // PM auto-start is refused by default so these window tests stay about chrome/navigation.
  spacePmEnsure: vi.fn(async () => ({
    ok: false,
    error: { kind: 'pm-unavailable', message: 'PM is disabled for this test.' },
  })),
  spaceSessionEnd: vi.fn(async () => ({ ok: true })),
  // The channels the cockpit uses to save a layout. The Space window must not call them.
  settingsSetLayout: vi.fn(),
  dockLayoutSet: vi.fn(),
  // The dialogs of phase M4.5, mounted once by the Space window: no request waits.
  spaceDialogsPending: vi.fn(async () => ({ ok: true, value: { requests: [] } })),
  onSpaceDialogsPending: vi.fn(() => () => {}),
  // The Dashboard of phase M7.3, mounted hidden: no Project has been read yet.
  spaceProjectState: vi.fn(async () => ({
    ok: true,
    value: projectState({ snapshot: null, fetchedAt: null, state: 'stale', model: null }),
  })),
  spaceProjectFocus: vi.fn(async () => ({ ok: true, value: null })),
  spaceProjectRefresh: vi.fn(),
  onSpaceProjectState: vi.fn(() => () => {}),
  // The Dashboard mounts the Repositories section unconditionally (stage D1) and
  // that section reads its own state, so these four are needed even though no test
  // here asserts a repository. An empty model keeps it to a heading and one line.
  spaceRepositoriesState: vi.fn(async () => ({
    ok: true,
    value: { version: 1, reading: false, model: null, readAt: null, problem: null },
  })),
  spaceRepositoriesRefresh: vi.fn(async () => ({
    ok: true,
    value: { version: 1, reading: false, model: null, readAt: null, problem: null },
  })),
  spaceRepositoriesFocus: vi.fn(async () => ({
    ok: true,
    value: { version: 1, reading: false, model: null, readAt: null, problem: null },
  })),
  onSpaceRepositoriesState: vi.fn(() => () => {}),
  // Dashboard mounts the PM report; this window fixture keeps it empty.
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
};

beforeEach(() => {
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.spaceNavigate.mockResolvedValue({ ok: true, value: { mode: 'space-files' } });
  // Sessions and the Dashboard's Start a session (M7.4) both read the engines.
  cockpit.enginesList.mockResolvedValue([]);
  // No engine configured by default, as an empty `enginesList` used to mean.
  cockpit.spaceSessionEngines.mockResolvedValue({
    ok: true,
    value: refusedChoice(
      'No AI session can start: the list of engines is empty. Add Claude Code under Settings, Engines.',
    ),
  });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  useSpaceNavStore.setState({ screen: 'sessions' });
});

afterEach(() => cleanup());

const renderWindow = (summary: SpaceSummary = space): void => {
  render(<SpaceSurface init={{ mode: 'space', space: summary }} />);
};

const shown = (id: string): boolean => screen.getByTestId(id).style.display !== 'none';

test('the header shows the name and the folder of the Space', () => {
  renderWindow();
  expect(screen.getByRole('banner')).toBe(screen.getByTestId('space-header'));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('my-space');
  expect(screen.getByTestId('space-root').textContent).toBe('/work/my-space');
});

test('a Space that setup has not named yet is headed Space', () => {
  renderWindow({ ...space, name: '' });
  expect(screen.getByTestId('space-name').textContent).toBe('Space');
});

test('the window opens on Sessions; Dashboard shows the Dashboard and keeps Sessions mounted', async () => {
  renderWindow();
  expect(shown('space-screen-sessions')).toBe(true);
  expect(shown('space-screen-dashboard')).toBe(false);

  fireEvent.click(screen.getByTestId('new-shell'));
  expect(screen.getAllByTestId('dock-tab')).toHaveLength(1);

  fireEvent.click(screen.getByTestId('space-rail-dashboard'));
  expect(shown('space-screen-dashboard')).toBe(true);
  expect(shown('space-screen-sessions')).toBe(false);
  expect(await screen.findByTestId('dashboard-v2')).toBeTruthy();
  // The tab is still there, only hidden: its terminal keeps its process.
  expect(screen.getAllByTestId('dock-tab')).toHaveLength(1);

  fireEvent.click(screen.getByTestId('space-rail-sessions'));
  expect(shown('space-screen-sessions')).toBe(true);
});

test('Sessions offers the creators while no tab is open, and hosts the dock with the Space folder as its root', () => {
  renderWindow();
  const empty = screen.getByTestId('space-sessions-empty');
  expect(empty.textContent).toContain("A shell starts in the Space's folder.");
  // No engine is configured: the AI creator is there and disabled.
  expect((screen.getByTestId('new-ai') as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByTestId('new-shell'));
  const dock = screen.getByTestId('dock-workspace');
  expect(dock.dataset.projectRoot).toBe('/work/my-space');
  const [tab] = screen.getAllByTestId('dock-tab');
  expect(tab?.dataset.kind).toBe('shell');
  expect(tab?.dataset.panel).toBe('centre');
  expect(screen.getByTestId('dock-tab-title').textContent).toBe('Shell 1');
});

test('+ AI is disabled in a Space window while the guarded start is not ready, and the reason is written', async () => {
  const sentence =
    'No AI session was started: python3 3.8 or later was not found. The write-guard of a session runs with python3, and a session without it would not be guarded. Install python3 and run the machine check again.';
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: refusedChoice(sentence) });
  cockpit.enginesList.mockResolvedValue([
    { id: 'default.claude', name: 'Claude', binary: 'claude' },
  ] as never);
  renderWindow();
  await waitFor(() => expect(cockpit.spaceSessionEngines).toHaveBeenCalledWith({}));
  await act(async () => {});

  const ai = screen.getByTestId('new-ai') as HTMLButtonElement;
  expect(ai.disabled).toBe(true);
  const note = screen.getByTestId('space-sessions-ai-note');
  expect(note.textContent).toContain(sentence);
  expect(ai.getAttribute('aria-describedby')).toBe(note.id);
  fireEvent.click(ai);
  expect(screen.queryByTestId('dock-workspace')).toBeNull();
  // The shell creator stays.
  expect((screen.getByTestId('new-shell') as HTMLButtonElement).disabled).toBe(false);

  // With the dock shown: the reason reaches the dock's own creators, the sentence stays
  // on the screen, and a request for an AI tab that arrives anyway creates none.
  fireEvent.click(screen.getByTestId('new-shell'));
  expect(screen.getByTestId('dock-workspace').dataset.aiUnavailableReason).toContain(sentence);
  expect(screen.getByTestId('space-sessions-ai-note').textContent).toContain(sentence);
  fireEvent.click(screen.getByTestId('dock-force-new-ai'));
  expect(screen.getAllByTestId('dock-tab').map((tab) => tab.dataset.kind)).toEqual(['shell']);
});

test('+ AI is enabled when the guarded start is ready, and makes an AI tab', async () => {
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: readyChoice() });
  cockpit.enginesList.mockResolvedValue([
    { id: 'default.claude', name: 'Claude', binary: 'claude' },
  ] as never);
  renderWindow();
  const ai = screen.getByTestId('new-ai') as HTMLButtonElement;
  await waitFor(() => expect(ai.disabled).toBe(false));
  fireEvent.click(ai);
  expect(screen.getAllByTestId('dock-tab').map((tab) => tab.dataset.kind)).toEqual(['ai']);
});

test('a Space window opened with justCreated shows the Dashboard, not Sessions', () => {
  cockpit.spaceSessionEngines.mockResolvedValue({ ok: true, value: readyChoice() });
  render(<SpaceSurface init={{ mode: 'space', space, justCreated: true }} />);
  expect(shown('space-screen-dashboard')).toBe(true);
  expect(shown('space-screen-sessions')).toBe(false);
});

test('a tab follows the rules of the cockpit: the running command is its title, a name set by hand stays, close removes it', () => {
  renderWindow();
  fireEvent.click(screen.getByTestId('new-shell'));
  fireEvent.click(screen.getByTestId('dock-new-shell'));
  expect(screen.getAllByTestId('dock-tab-title').map((el) => el.textContent)).toEqual([
    'Shell 1',
    'Shell 2',
  ]);

  fireEvent.click(screen.getAllByTestId('dock-tab-run')[0] as HTMLElement);
  expect(screen.getAllByTestId('dock-tab-title')[0]?.textContent).toBe('npm test');

  fireEvent.click(screen.getAllByTestId('dock-tab-rename')[1] as HTMLElement);
  fireEvent.click(screen.getAllByTestId('dock-tab-run')[1] as HTMLElement);
  expect(screen.getAllByTestId('dock-tab-title')[1]?.textContent).toBe('By hand');

  // The first tab runs a task, so the shell kind asks before it closes.
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getAllByTestId('dock-tab-close')[0] as HTMLElement);
  expect(screen.getAllByTestId('dock-tab')).toHaveLength(2);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getAllByTestId('dock-tab-close')[0] as HTMLElement);
  expect(screen.getAllByTestId('dock-tab')).toHaveLength(1);
  confirm.mockRestore();

  fireEvent.click(screen.getByTestId('dock-tab-close'));
  expect(screen.getByTestId('space-sessions-empty')).toBeTruthy();
});

test('Files asks main for the Files window and sends no path; the screen that is shown stays', async () => {
  renderWindow();
  fireEvent.click(screen.getByTestId('space-rail-files'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'space-files' }));
  expect(shown('space-screen-sessions')).toBe(true);
  expect(screen.queryByTestId('space-window-error')).toBeNull();
});

test('error state: a refused Files request shows its message as an alert', async () => {
  cockpit.spaceNavigate.mockResolvedValue({
    ok: false,
    error: { kind: 'not-allowed-here', message: 'Not from this window.' },
  });
  renderWindow();
  fireEvent.click(screen.getByTestId('space-rail-files'));
  const alert = await screen.findByTestId('space-window-error');
  expect(alert.textContent).toBe('Not from this window.');
});

test('Search opens the search dialog scoped to the Space folder; a picked result opens the Files window', async () => {
  renderWindow();
  expect(screen.queryByTestId('search-dialog')).toBeNull();
  fireEvent.click(screen.getByTestId('space-rail-search'));
  const dialog = screen.getByTestId('search-dialog');
  expect(JSON.parse(dialog.dataset.scopes ?? '[]')).toEqual([
    { id: 'space', label: 'Space', dirs: ['/work/my-space'] },
  ]);
  expect(screen.getByTestId('search-display').textContent).toBe('lore/space.md');
  // No watcher feeds the file-name index of a Space window; the dialog says so.
  expect(screen.getByTestId('search-note').textContent).toContain(
    'is not updated while the window is open',
  );

  fireEvent.click(screen.getByTestId('search-pick'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'space-files' }));

  fireEvent.click(screen.getByTestId('search-close'));
  expect(screen.queryByTestId('search-dialog')).toBeNull();
});

test('the find shortcut and the Find menu item open Search', () => {
  renderWindow();
  fireEvent.keyDown(window, { key: 'f', metaKey: true });
  expect(screen.getByTestId('search-dialog')).toBeTruthy();
  fireEvent.click(screen.getByTestId('search-close'));

  act(() => focusGlobalSearch?.());
  expect(screen.getByTestId('search-dialog')).toBeTruthy();
});

test('the Space window saves no layout through the channels of the cockpit', () => {
  renderWindow();
  fireEvent.click(screen.getByTestId('new-shell'));
  fireEvent.click(screen.getByTestId('space-rail-dashboard'));
  expect(cockpit.settingsSetLayout).not.toHaveBeenCalled();
  expect(cockpit.dockLayoutSet).not.toHaveBeenCalled();
});
