import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The terminal pulls xterm, which jsdom cannot run; the screen only has to mount it.
vi.mock('../../../src/renderer/src/components/TerminalTab.js', () => ({
  TerminalTab: () => <div data-testid="body-shell" />,
}));

import { NotASpaceScreen } from '../../../src/renderer/src/space/not-a-space/NotASpaceScreen.js';
import type { SpaceInitOf, SpaceWindowResult } from '../../../src/shared/ipc.js';

const cockpit = {
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceOpenFolder: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  reload: vi.fn<() => Promise<void>>(),
};

const plainRepository: SpaceInitOf<'not-a-space'> = {
  mode: 'not-a-space',
  folder: '/work/some-repo',
  plainRepository: true,
  reason: 'The folder is a git repository with no Lore and no remote named origin.',
};

const otherFolder: SpaceInitOf<'not-a-space'> = {
  mode: 'not-a-space',
  folder: '/work/notes',
  plainRepository: false,
  reason: 'The folder has no lore/space.md, no .ai-lore-<name> folder and no git repository.',
};

beforeEach(() => {
  cockpit.spaceNavigate.mockReset().mockResolvedValue({ ok: true, value: { mode: 'setup' } });
  cockpit.spaceOpenFolder.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.reload.mockReset().mockResolvedValue(undefined);
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test('a plain repository: the folder, the reason from detection, the offer, and a terminal', () => {
  render(<NotASpaceScreen init={plainRepository} />);
  expect(screen.getByTestId('not-a-space-folder').textContent).toBe('/work/some-repo');
  expect(screen.getByTestId('not-a-space-reason').textContent).toBe(plainRepository.reason);
  expect(screen.getByTestId('not-a-space').textContent).toContain(
    'This folder is a git repository, not a Space.',
  );
  expect(screen.getByTestId('not-a-space-create').textContent).toBe('Create a Space about it');
  expect(screen.getByTestId('body-shell')).toBeTruthy();
});

test('the offer asks main for setup about this folder and sends no path', async () => {
  render(<NotASpaceScreen init={plainRepository} />);
  fireEvent.click(screen.getByTestId('not-a-space-create'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledTimes(1));
  expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'about-this-folder' });
});

test('any other folder: no offer to create a Space, the terminal is still there', () => {
  render(<NotASpaceScreen init={otherFolder} />);
  expect(screen.queryByTestId('not-a-space-create')).toBeNull();
  expect(screen.getByTestId('not-a-space').textContent).toContain('This folder is not a Space.');
  expect(screen.getByTestId('not-a-space-reason').textContent).toBe(otherFolder.reason);
  expect(screen.getByTestId('body-shell')).toBeTruthy();
});

test('open another folder asks main for the folder dialog; check again reloads the window', async () => {
  render(<NotASpaceScreen init={otherFolder} />);
  fireEvent.click(screen.getByTestId('not-a-space-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
  fireEvent.click(screen.getByTestId('not-a-space-reload'));
  expect(cockpit.reload).toHaveBeenCalledTimes(1);
});

test('error state: a refusal from main is shown in the screen error area', async () => {
  cockpit.spaceNavigate.mockResolvedValue({
    ok: false,
    error: { kind: 'not-allowed-here', message: 'A Space about a folder is created elsewhere.' },
  });
  render(<NotASpaceScreen init={plainRepository} />);
  expect(screen.queryByTestId('not-a-space-error')).toBeNull();
  fireEvent.click(screen.getByTestId('not-a-space-create'));
  const error = await screen.findByTestId('not-a-space-error');
  expect(error.textContent).toBe('A Space about a folder is created elsewhere.');
  expect(error.getAttribute('role')).toBe('alert');
});

test('a cancelled folder dialog is not shown as an error', async () => {
  cockpit.spaceOpenFolder.mockResolvedValue({
    ok: false,
    error: { kind: 'cancelled', message: 'No folder was chosen.' },
  });
  render(<NotASpaceScreen init={otherFolder} />);
  fireEvent.click(screen.getByTestId('not-a-space-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect((screen.getByTestId('not-a-space-open') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.queryByTestId('not-a-space-error')).toBeNull();
});
