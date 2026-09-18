import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SpaceWelcomeScreen } from '../../../src/renderer/src/space/welcome/SpaceWelcomeScreen.js';
import type {
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

function report(ready: boolean): MachineCheckReport {
  return {
    check: {
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
          state: ready ? { kind: 'fine', version: '2.60.1' } : { kind: 'not-signed-in' },
          guidance: ready ? null : 'gh is installed and not signed in.',
          command: ready ? null : 'gh auth login --hostname github.com --scopes project',
        },
        {
          id: 'engine',
          binary: 'claude',
          state: ready ? { kind: 'fine', version: '2.1.0' } : { kind: 'missing' },
          guidance: ready ? null : 'Claude was not found on this machine.',
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
      ready,
    },
    checkedAt: 1_789_000_000_000,
    pathSource: 'login-shell',
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

async function ready(): Promise<void> {
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

test('no recents: the list is not shown', () => {
  render(<SpaceWelcomeScreen init={init({ recents: [] })} />);
  expect(screen.queryByTestId('space-welcome-recents')).toBeNull();
});

test('open a folder asks main for the folder dialog and sends no path', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  fireEvent.click(screen.getByTestId('space-welcome-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
});

test('the screen asks for the last machine check, not for a new one', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  await ready();
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: false });
  expect(screen.getByTestId('space-welcome-machine-status').textContent).toBe(
    '✓ Machine check: ready.',
  );
});

test('ready: create and open by address lead to setup, adopt to the folder dialog', async () => {
  render(<SpaceWelcomeScreen init={init()} />);
  await ready();
  expect(screen.queryByTestId('space-welcome-setup-reason')).toBeNull();
  const create = screen.getByTestId('space-welcome-create');
  fireEvent.click(create);
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'new' }),
  );
  await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('false'));
  fireEvent.click(screen.getByTestId('space-welcome-open-by-address'));
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'from-address' }),
  );
  await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('false'));
  fireEvent.click(screen.getByTestId('space-welcome-adopt'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
});

test('not ready: the three entries do nothing and the reason names the requirements; opening stays', async () => {
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report(false) });
  render(<SpaceWelcomeScreen init={init()} />);
  await ready();
  expect(screen.getByTestId('space-welcome-machine-status').textContent).toBe(
    '✗ Machine check: not ready.',
  );
  expect(screen.getByTestId('space-welcome-setup-reason').textContent).toBe(
    'Not available: the machine check is not ready. gh is not-signed-in, engine is missing.',
  );
  for (const id of ['create', 'adopt', 'open-by-address']) {
    const entry = screen.getByTestId(`space-welcome-${id}`);
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(entry);
  }
  expect(cockpit.spaceNavigate).not.toHaveBeenCalled();
  expect(cockpit.spaceOpenFolder).not.toHaveBeenCalled();
  // Opening a folder and a recent Space need no setup, and stay available.
  expect((screen.getByTestId('space-welcome-open') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId('space-welcome-machine-check'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'machine-check' }));
});

test('while the check runs the entries are not available and the reason says so', () => {
  cockpit.spaceMachineCheck.mockReturnValue(new Promise<SpaceMachineCheckResult>(() => {}));
  render(<SpaceWelcomeScreen init={init()} />);
  expect(screen.getByTestId('space-welcome-machine-status').textContent).toBe(
    'Checking the machine…',
  );
  expect(screen.getByTestId('space-welcome-setup-reason').textContent).toBe(
    'Not available: the machine check is running.',
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
