import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The engine start control's sign-in fix mounts `CommandPanel`, which uses `useXtermSession`;
// mocked as `machine-check.test.tsx` mocks it, calling `spawn` once on mount so the panel's own
// `spaceCommandRun` call is exercised.
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: (config: { spawn?: () => Promise<string | null> }) => {
    // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once, like the real hook's spawn-on-mount effect.
    useEffect(() => {
      void config.spawn?.();
    }, []);
    return { hostRef: { current: null }, focus: () => {}, search: {} };
  },
}));

import { EngineStartControl } from '../../../src/renderer/src/space/window/EngineStartControl.js';
import type {
  SpaceCommandCode,
  SpaceCommandExit,
  SpaceCommandRunResult,
  SpaceEngineChoice,
  SpaceWindowResult,
} from '../../../src/shared/ipc.js';

const cockpit = {
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceCommandRun: vi.fn<(arg: unknown) => Promise<SpaceCommandRunResult>>(),
  onSpaceCommandCode: vi.fn<(cb: (p: SpaceCommandCode) => void) => () => void>(),
  onSpaceCommandExit: vi.fn<(cb: (p: SpaceCommandExit) => void) => () => void>(),
};

beforeEach(() => {
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.onSpaceCommandCode.mockReturnValue(() => {});
  cockpit.onSpaceCommandExit.mockReturnValue(() => {});
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

function props(
  choice: SpaceEngineChoice | null,
  extra: Partial<Parameters<typeof EngineStartControl>[0]> = {},
) {
  return {
    choice,
    onStart: vi.fn(),
    onPick: vi.fn(),
    onReinstall: vi.fn(),
    onRefresh: vi.fn(),
    menu: 'when-several' as const,
    buttonTestId: 'dashboard-start-session',
    noteTestId: 'dashboard-start-session-note',
    menuTestId: 'dashboard-start-menu',
    ...extra,
  };
}

const readyOption = (engineId: string, name: string) => ({
  engineId,
  name,
  canStart: true,
  reason: null,
  fix: null,
});

test('the button names the engine of the choice', () => {
  const choice: SpaceEngineChoice = {
    options: [readyOption('default.claude', 'Claude Code')],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  render(<EngineStartControl {...props(choice)} />);
  expect(screen.getByTestId('dashboard-start-session').textContent).toBe(
    'Start a Claude Code session',
  );
});

test('menu: when-several shows only with two or more startable options', () => {
  const one: SpaceEngineChoice = {
    options: [readyOption('default.claude', 'Claude Code')],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  const { rerender } = render(<EngineStartControl {...props(one)} />);
  expect(screen.queryByLabelText('Choose the engine')).toBeNull();

  const two: SpaceEngineChoice = {
    options: [
      readyOption('default.claude', 'Claude Code'),
      readyOption('default.opencode', 'OpenCode'),
    ],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  rerender(<EngineStartControl {...props(two)} />);
  expect(screen.getByLabelText('Choose the engine')).toBeTruthy();
});

test('menu: always shows Codex CLI aria-disabled with its reason, even with one startable option', async () => {
  const choice: SpaceEngineChoice = {
    options: [
      readyOption('default.claude', 'Claude Code'),
      {
        engineId: 'default.codex',
        name: 'Codex CLI',
        canStart: false,
        reason: 'guarded Space sessions are not available for this engine yet',
        fix: null,
      },
    ],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  render(<EngineStartControl {...props(choice, { menu: 'always' })} />);
  fireEvent.click(screen.getByLabelText('Choose the engine'));
  const item = await screen.findByTestId('dashboard-start-menu-option-default.codex');
  expect(item.getAttribute('aria-disabled')).toBe('true');
  expect(item.textContent).toContain(
    'Codex CLI — guarded Space sessions are not available for this engine yet',
  );

  // The disabled row must render in the app's font, same as the enabled
  // "Claude Code" row above it — not the browser's serif default, which is
  // what an unstyled portalled row falls back to.
  expect(item.style.font).toContain('inherit');
  const enabledItem = screen.getByTestId('dashboard-start-menu-option-default.claude');
  expect(enabledItem.style.font).toContain('inherit');
  const menu = screen.getByTestId('dashboard-start-menu');
  expect(menu.style.fontFamily.toLowerCase()).toContain('system-ui');
});

test('picking a startable option calls onPick', async () => {
  const choice: SpaceEngineChoice = {
    options: [
      readyOption('default.claude', 'Claude Code'),
      readyOption('default.opencode', 'OpenCode'),
    ],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  const onPick = vi.fn();
  render(<EngineStartControl {...props(choice, { onPick })} />);
  fireEvent.click(screen.getByLabelText('Choose the engine'));
  fireEvent.click(await screen.findByTestId('dashboard-start-menu-option-default.opencode'));
  expect(onPick).toHaveBeenCalledWith('default.opencode');
});

test('a sign-in refusal shows the fix, its command line, and mounts the command panel on click', async () => {
  const choice: SpaceEngineChoice = {
    options: [
      {
        engineId: 'default.claude',
        name: 'Claude Code',
        canStart: false,
        reason: 'not signed in',
        fix: {
          kind: 'sign-in',
          label: 'Sign in to Claude Code',
          commandId: 'engine-sign-in:claude-code',
          commandLine: 'claude auth login',
          section: null,
        },
      },
    ],
    engineId: null,
    buttonName: 'Claude Code',
    refusal: {
      message: 'No AI session was started: Claude Code is installed and not signed in.',
      fix: {
        kind: 'sign-in',
        label: 'Sign in to Claude Code',
        commandId: 'engine-sign-in:claude-code',
        commandLine: 'claude auth login',
        section: null,
      },
    },
  };
  cockpit.spaceCommandRun.mockResolvedValue({
    ok: true,
    value: {
      ptyId: 'pty-1',
      commandId: 'engine-sign-in:claude-code',
      commandLine: 'claude auth login',
    },
  });
  render(<EngineStartControl {...props(choice)} />);
  expect(screen.getByTestId('dashboard-start-session-refusal').textContent).toContain(
    'No AI session can start yet',
  );
  expect(screen.getByTestId('dashboard-start-session-fix').textContent).toBe(
    'Sign in to Claude Code',
  );
  expect(screen.getByText('Runs: claude auth login')).toBeTruthy();

  fireEvent.click(screen.getByTestId('dashboard-start-session-fix'));
  await screen.findByTestId('command-panel');
  expect(cockpit.spaceCommandRun).toHaveBeenCalledWith({ commandId: 'engine-sign-in:claude-code' });
});

test('set-up-claude-code navigates to Set up this computer at the engines section', () => {
  const choice: SpaceEngineChoice = {
    options: [
      {
        engineId: 'default.claude',
        name: 'Claude Code',
        canStart: false,
        reason: 'not installed',
        fix: {
          kind: 'set-up-claude-code',
          label: 'Set up Claude Code',
          commandId: null,
          commandLine: null,
          section: 'engines',
        },
      },
    ],
    engineId: null,
    buttonName: 'Claude Code',
    refusal: {
      message: 'No AI session was started: Claude Code is not installed.',
      fix: {
        kind: 'set-up-claude-code',
        label: 'Set up Claude Code',
        commandId: null,
        commandLine: null,
        section: 'engines',
      },
    },
  };
  cockpit.spaceNavigate.mockResolvedValue({ ok: true, value: { mode: 'machine-check' } });
  render(<EngineStartControl {...props(choice)} />);
  fireEvent.click(screen.getByTestId('dashboard-start-session-fix'));
  expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'machine-check', section: 'engines' });
});

test('checking (choice null) shows the checking note and a disabled button', () => {
  render(<EngineStartControl {...props(null)} />);
  expect(screen.getByTestId('dashboard-start-session-note').textContent).toBe(
    'Checking whether an AI session can start in this Space.',
  );
  expect((screen.getByTestId('dashboard-start-session') as HTMLButtonElement).disabled).toBe(true);
});

test('a click starts the engine and shows "Starting <name>…" until a new choice arrives', () => {
  const choice: SpaceEngineChoice = {
    options: [readyOption('default.claude', 'Claude Code')],
    engineId: 'default.claude',
    buttonName: 'Claude Code',
    refusal: null,
  };
  const onStart = vi.fn();
  render(<EngineStartControl {...props(choice, { onStart })} />);
  fireEvent.click(screen.getByTestId('dashboard-start-session'));
  expect(onStart).toHaveBeenCalledWith('default.claude');
  expect(screen.getByTestId('dashboard-start-session').textContent).toBe('Starting Claude Code…');
});
