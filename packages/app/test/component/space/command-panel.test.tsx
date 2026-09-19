import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Phase M9.8: the terminal panel of architecture document A.8. `useXtermSession` is mocked as
// `dashboard-agents.test.tsx` mocks it; this mock also calls the `spawn` config once on mount, as
// the real hook does, so the panel's own `spaceCommandRun` call is exercised.
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: (config: { spawn?: () => Promise<string | null> }) => {
    // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once, like the real hook's spawn-on-mount effect.
    useEffect(() => {
      void config.spawn?.();
    }, []);
    return { hostRef: { current: null }, focus: () => {}, search: {} };
  },
}));

import { CommandPanel } from '../../../src/renderer/src/space/common/CommandPanel.js';
import type {
  SpaceCommandCode,
  SpaceCommandExit,
  SpaceCommandRunResult,
} from '../../../src/shared/ipc.js';

const cockpit = {
  spaceCommandRun: vi.fn<(arg: unknown) => Promise<SpaceCommandRunResult>>(),
  onSpaceCommandCode: vi.fn<(cb: (p: SpaceCommandCode) => void) => () => void>(),
  onSpaceCommandExit: vi.fn<(cb: (p: SpaceCommandExit) => void) => () => void>(),
};

let codeHandler: ((p: SpaceCommandCode) => void) | null = null;
let exitHandler: ((p: SpaceCommandExit) => void) | null = null;

beforeEach(() => {
  cockpit.spaceCommandRun.mockReset().mockResolvedValue({
    ok: true,
    value: { ptyId: 'pty-1', commandId: 'github-sign-in', commandLine: 'gh auth login --web' },
  });
  codeHandler = null;
  exitHandler = null;
  cockpit.onSpaceCommandCode.mockReset().mockImplementation((cb) => {
    codeHandler = cb;
    return () => {
      codeHandler = null;
    };
  });
  cockpit.onSpaceCommandExit.mockReset().mockImplementation((cb) => {
    exitHandler = cb;
    return () => {
      exitHandler = null;
    };
  });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => cleanup());

test('shows the command line before anything else, and runs it through spaceCommandRun', async () => {
  render(
    <CommandPanel
      commandId="github-sign-in"
      commandLine="gh auth login --web"
      onExit={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId('command-panel-command').textContent).toBe(
    'Running: gh auth login --web',
  );
  await waitFor(() =>
    expect(cockpit.spaceCommandRun).toHaveBeenCalledWith({ commandId: 'github-sign-in' }),
  );
  expect(screen.getByTestId('command-panel-status').dataset.state).toBe('running');
});

test('a one-time code arrives, is shown and copies to the clipboard', async () => {
  render(
    <CommandPanel
      commandId="github-sign-in"
      commandLine="gh auth login --web"
      onExit={() => {}}
      onClose={() => {}}
    />,
  );
  await waitFor(() => expect(cockpit.spaceCommandRun).toHaveBeenCalled());
  act(() => {
    codeHandler?.({ ptyId: 'pty-1', code: 'ABCD-1234' });
  });
  const codeBlock = await screen.findByTestId('command-panel-code');
  expect(codeBlock.textContent).toContain('First copy your one-time code:');
  expect(screen.getByTestId('command-panel-code-value').textContent).toBe('ABCD-1234');
  expect(codeBlock.textContent).toContain(
    'Paste this code on the GitHub page that opened in your browser. It is already on the clipboard.',
  );
  fireEvent.click(screen.getByTestId('command-panel-copy-code'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD-1234');

  // A code push for another PTY is ignored.
  act(() => {
    codeHandler?.({ ptyId: 'pty-other', code: 'ZZZZ-9999' });
  });
  expect(screen.getByTestId('command-panel-code-value').textContent).toBe('ABCD-1234');
});

test('an exit for this PTY shows the status and calls onExit once; another PTY is ignored', async () => {
  const onExit = vi.fn();
  render(
    <CommandPanel
      commandId="install-gh"
      commandLine="brew install gh"
      onExit={onExit}
      onClose={() => {}}
    />,
  );
  await waitFor(() => expect(cockpit.spaceCommandRun).toHaveBeenCalled());

  act(() => {
    exitHandler?.({ ptyId: 'pty-other', commandId: 'install-gh', exitCode: 1 });
  });
  expect(screen.getByTestId('command-panel-status').dataset.state).toBe('running');
  expect(onExit).not.toHaveBeenCalled();

  act(() => {
    exitHandler?.({ ptyId: 'pty-1', commandId: 'install-gh', exitCode: 2 });
  });
  const status = screen.getByTestId('command-panel-status');
  expect(status.dataset.state).toBe('exited');
  expect(status.textContent).toBe('Ended with exit code 2.');
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(onExit).toHaveBeenCalledWith(2);

  // A second exit for the same PTY does not call onExit again.
  act(() => {
    exitHandler?.({ ptyId: 'pty-1', commandId: 'install-gh', exitCode: 0 });
  });
  expect(onExit).toHaveBeenCalledTimes(1);
});

test('exit code 0 reads Finished.; Close calls onClose', async () => {
  const onClose = vi.fn();
  render(
    <CommandPanel
      commandId="install-gh"
      commandLine="brew install gh"
      onExit={() => {}}
      onClose={onClose}
    />,
  );
  await waitFor(() => expect(cockpit.spaceCommandRun).toHaveBeenCalled());
  act(() => {
    exitHandler?.({ ptyId: 'pty-1', commandId: 'install-gh', exitCode: 0 });
  });
  expect(screen.getByTestId('command-panel-status').textContent).toBe('Finished.');
  fireEvent.click(screen.getByTestId('command-panel-close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('spaceCommandRun refused: the message is shown, not written into the terminal', async () => {
  cockpit.spaceCommandRun.mockResolvedValue({
    ok: false,
    error: { kind: 'unknown-command', message: 'oops is not a command the companion may run.' },
  });
  render(<CommandPanel commandId="oops" commandLine="oops" onExit={() => {}} onClose={() => {}} />);
  expect((await screen.findByTestId('command-panel-error')).textContent).toContain(
    'oops is not a command the companion may run.',
  );
});
