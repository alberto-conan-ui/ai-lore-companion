import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SpaceWelcomeScreen } from '../../../src/renderer/src/space/welcome/SpaceWelcomeScreen.js';
import type {
  MachineCheck,
  MachineCheckReport,
  RecentSpace,
  SpaceInitOf,
  SpaceMachineCheckResult,
  SpaceWindowResult,
} from '../../../src/shared/ipc.js';

const cockpit = {
  spaceMachineCheck: vi.fn<(arg: unknown) => Promise<SpaceMachineCheckResult>>(),
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceOpenFolder: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceRecentsRemove: vi.fn<(arg: unknown) => Promise<RecentSpace[]>>(),
};

const RECENTS: RecentSpace[] = [
  { path: '/work/companion-space', name: 'companion-space', openedAt: 2 },
  { path: '/work/other-space', name: 'other-space', openedAt: 1 },
];

function fineCheck(): MachineCheck {
  return {
    requirements: [
      {
        id: 'git',
        binary: 'git',
        state: { kind: 'fine', version: '2.43.0' },
        guidance: null,
        command: null,
      },
      {
        id: 'gh',
        binary: 'gh',
        state: { kind: 'fine', version: '2.60.1' },
        guidance: null,
        command: null,
      },
      {
        id: 'engine',
        binary: 'claude',
        state: { kind: 'fine', version: '2.1.0' },
        guidance: null,
        command: null,
      },
      {
        id: 'python3',
        binary: 'python3',
        state: { kind: 'fine', version: '3.12.1' },
        guidance: null,
        command: null,
      },
    ],
    engines: [],
    ready: true,
    github: { account: 'alberto-conan-ui', organisations: [] },
    tools: { brew: true, npm: true },
  };
}

function report(ready: boolean): MachineCheckReport {
  const check = fineCheck();
  if (!ready) {
    check.requirements[1] = {
      id: 'gh',
      binary: 'gh',
      state: { kind: 'not-signed-in' },
      guidance: null,
      command: null,
    };
    check.requirements[2] = {
      id: 'engine',
      binary: 'claude',
      state: { kind: 'missing' },
      guidance: null,
      command: null,
    };
    check.ready = false;
  }
  return {
    check,
    checkedAt: 1_789_000_000_000,
    pathSource: 'login-shell',
    spacesFolder: {
      value: ready ? '/Users/alberto/Spaces' : null,
      proposed: '/Users/alberto/Spaces',
    },
    setUp: ready
      ? { ready: true, left: [] }
      : {
          ready: false,
          left: [
            { id: 'github', text: 'sign in to GitHub' },
            { id: 'claude-code', text: 'install Claude Code' },
            { id: 'spaces-folder', text: 'choose a Spaces folder' },
          ],
        },
    commands: {},
  };
}

const init = (extra: Partial<SpaceInitOf<'space-welcome'>> = {}): SpaceInitOf<'space-welcome'> => ({
  mode: 'space-welcome',
  recents: RECENTS,
  ...extra,
});

beforeEach(() => {
  cockpit.spaceMachineCheck.mockReset().mockResolvedValue({ ok: true, value: report(true) });
  cockpit.spaceNavigate.mockReset().mockResolvedValue({ ok: true, value: { mode: 'setup' } });
  cockpit.spaceOpenFolder.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.spaceRecentsRemove.mockReset().mockResolvedValue([RECENTS[1] as RecentSpace]);
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

async function settled(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('space-welcome-machine-status').dataset.ready).not.toBe('unknown'),
  );
}

test('the recents of Spaces are listed by name and folder, and a recent opens by its folder', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  const recents = screen.getAllByTestId('space-welcome-recent');
  expect(recents.map((recent) => recent.textContent)).toEqual([
    'companion-space/work/companion-space',
    'other-space/work/other-space',
  ]);
  fireEvent.click(recents[0] as HTMLElement);
  await waitFor(() =>
    expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({ folder: '/work/companion-space' }),
  );
});

test('removing a recent asks main and shows the list main answers with', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  const remove = screen.getAllByTestId('space-welcome-recent-remove')[0] as HTMLElement;
  expect(remove.getAttribute('aria-label')).toBe('Remove companion-space from the recent Spaces');
  fireEvent.click(remove);
  await waitFor(() => expect(screen.getAllByTestId('space-welcome-recent')).toHaveLength(1));
  expect(cockpit.spaceRecentsRemove).toHaveBeenCalledWith({ path: '/work/companion-space' });
  expect(screen.getByTestId('space-welcome-recent').textContent).toContain('other-space');
});

test('no recents: the list is not shown, and New Space uses the primary style', () => {
  render(<SpaceWelcomeScreen init={init({ recents: [] })} />);
  expect(screen.queryByTestId('space-welcome-recents')).toBeNull();
  const create = screen.getByTestId('space-welcome-create');
  expect(create.getAttribute('style')).toContain('surface-blue');
});

test('open a folder asks main for the folder dialog and sends no path', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  fireEvent.click(screen.getByTestId('space-welcome-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
});

test('the screen asks for the last machine check, not for a new one', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  await settled();
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: false });
});

test('ready: the status line names the account and the folder, with Change… back to setup', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  await settled();
  expect(screen.getByTestId('space-welcome-machine-status').textContent).toBe(
    '✓ This computer is set up: GitHub alberto-conan-ui, Claude Code signed in, Spaces in /Users/alberto/Spaces.',
  );
  expect(screen.queryByTestId('space-welcome-setup-card')).toBeNull();
  fireEvent.click(screen.getByTestId('space-welcome-change-setup'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'machine-check' }));
});

test('ready: the three entries lead to setup with their own start', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  await settled();
  expect(screen.queryByTestId('space-welcome-setup-reason')).toBeNull();
  fireEvent.click(screen.getByTestId('space-welcome-create'));
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'new' }),
  );
  fireEvent.click(screen.getByTestId('space-welcome-open-address'));
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'from-address' }),
  );
  fireEvent.click(screen.getByTestId('space-welcome-from-repository'));
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'from-repository' }),
  );
});

test('not ready: a card names what is left, the entries are disabled, and Continue setup navigates', async () => {
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report(false) });
  render(<SpaceWelcomeScreen init={init()} />);
  await settled();
  expect(screen.getByTestId('space-welcome-setup-card').textContent).toContain(
    'AI-Lore needs Git, Python 3, a GitHub sign-in, Claude Code and a Spaces folder before it can create a Space. 2 of 5 are ready.',
  );
  for (const id of ['create', 'open-address', 'from-repository']) {
    const entry = screen.getByTestId(`space-welcome-${id}`);
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(entry);
  }
  expect(cockpit.spaceNavigate).not.toHaveBeenCalled();
  expect(screen.getByTestId('space-welcome-setup-reason').textContent).toContain(
    'Finish setting up this computer first.',
  );
  // Opening a folder and a recent Space need no setup, and stay available.
  expect((screen.getByTestId('space-welcome-open') as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(screen.getByTestId('space-welcome-continue-setup'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'machine-check' }));
});

test('checkOnLaunch with a not-ready report navigates to Set up this computer once; without it, it does not', async () => {
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report(false) });
  render(<SpaceWelcomeScreen init={init({ checkOnLaunch: true })} />);
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'machine-check' }));
  expect(cockpit.spaceNavigate).toHaveBeenCalledTimes(1);
  cleanup();

  cockpit.spaceNavigate.mockClear();
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report(false) });
  render(<SpaceWelcomeScreen init={init()} />);
  await settled();
  expect(cockpit.spaceNavigate).not.toHaveBeenCalled();
});

test('while the check runs, the card says so', () => {
  cockpit.spaceMachineCheck.mockReturnValue(new Promise<SpaceMachineCheckResult>(() => {}));
  render(<SpaceWelcomeScreen init={init()} />);
  expect(screen.getByTestId('space-welcome-setup-card').textContent).toContain(
    'Checking this computer…',
  );
  expect(screen.getByTestId('space-welcome-create').getAttribute('aria-disabled')).toBe('true');
});

test('error state: the notice of a launch folder, then the message of a refused request', async () => {
  cockpit.spaceOpenFolder.mockResolvedValue({
    ok: false,
    error: { kind: 'not-allowed-here', message: 'Only a folder from the recents is opened.' },
  });
  render(<SpaceWelcomeScreen init={init({ notice: '/work/gone is not a folder' })} />);
  const notice = screen.getByTestId('space-welcome-error');
  expect(notice.textContent).toBe('/work/gone is not a folder');
  expect(notice.getAttribute('role')).toBe('alert');
  fireEvent.click(screen.getAllByTestId('space-welcome-recent')[0] as HTMLElement);
  await waitFor(() =>
    expect(screen.getByTestId('space-welcome-error').textContent).toBe(
      'Only a folder from the recents is opened.',
    ),
  );
});

test('a cancelled folder dialog is not shown as an error', async () => {
  cockpit.spaceOpenFolder.mockResolvedValue({
    ok: false,
    error: { kind: 'cancelled', message: 'No folder was chosen.' },
  });
  render(<SpaceWelcomeScreen init={init()} />);
  fireEvent.click(screen.getByTestId('space-welcome-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('space-welcome-error')).toBeNull();
});
