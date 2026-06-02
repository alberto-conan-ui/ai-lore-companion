import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// HelperTerminal pulls xterm; stub it so the host's connect wiring and the
// terminal-binding logic are assertable without a real terminal.
vi.mock('../../src/renderer/src/components/HelperTerminal.js', () => ({
  HelperTerminal: ({ ptyId }: { ptyId: string }) => (
    <div data-testid="helper-terminal" data-pty={ptyId} />
  ),
}));

import { AssistantHost } from '../../src/renderer/src/components/AssistantHost.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

let helperConnect: ReturnType<typeof vi.fn>;
let helperAsk: ReturnType<typeof vi.fn>;
let helperEngineSet: ReturnType<typeof vi.fn>;
let helperReset: ReturnType<typeof vi.fn>;
let enginesList: ReturnType<typeof vi.fn>;
let helperEngineGet: ReturnType<typeof vi.fn>;
let pushHandler: ((p: HelperEventPayload) => void) | null;

const disabled = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).disabled;

beforeEach(() => {
  helperConnect = vi.fn();
  helperAsk = vi.fn();
  helperEngineSet = vi.fn(async () => {});
  helperReset = vi.fn(async () => {});
  enginesList = vi.fn(async () => []);
  helperEngineGet = vi.fn(async () => null);
  pushHandler = null;
  (window as unknown as { cockpit: unknown }).cockpit = {
    helperConnect,
    helperAsk,
    helperEngineSet,
    helperReset,
    enginesList,
    helperEngineGet,
    onHelperEvent: (handler: (p: HelperEventPayload) => void) => {
      pushHandler = handler;
      return () => {
        pushHandler = null;
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Push a helper event through the captured subscription. */
function emit(event: HelperEventPayload): void {
  act(() => pushHandler?.(event));
}

test('starts disconnected — Connect shown, no terminal, the host hint', () => {
  render(<AssistantHost active={true} />);
  expect(screen.getByTestId('assistant-connect')).toBeTruthy();
  expect(screen.queryByTestId('helper-terminal')).toBeNull();
  expect(screen.getByTestId('assistant-host-hint')).toBeTruthy();
});

test('Connect launches the session and shows connecting', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  expect(helperConnect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('assistant-host-status').textContent).toMatch(/Connecting/);
  expect(disabled('assistant-connect')).toBe(true);
});

test('the connecting event binds the terminal and hides Connect', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });

  expect(screen.getByTestId('helper-terminal').getAttribute('data-pty')).toBe('pty-42');
  expect(screen.queryByTestId('assistant-connect')).toBeNull();
});

test('the host orients itself automatically on the first ready (once)', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  expect(helperAsk).toHaveBeenCalledWith('orient');

  // A later ready (e.g. after a turn) must not re-orient.
  helperAsk.mockClear();
  emit({ sessionId: 's1', phase: 'ready' });
  expect(helperAsk).not.toHaveBeenCalledWith('orient');
});

test('a headless engine (no ptyId) connects and shows the headless indicator, no terminal', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  // Gemini (CR7): connecting then ready, both without a ptyId — no terminal.
  emit({ sessionId: 'g1', phase: 'connecting' });
  emit({ sessionId: 'g1', phase: 'ready' });

  expect(screen.queryByTestId('helper-terminal')).toBeNull();
  expect(screen.getByTestId('assistant-host-headless')).toBeTruthy();
});

test('the engine dropdown lists helper-capable engines; switching persists + resets', async () => {
  enginesList.mockResolvedValue([
    { id: 'default.claude', name: 'Claude', binary: 'claude' },
    { id: 'default.gemini', name: 'Gemini', binary: 'gemini' },
    { id: 'custom.cursor', name: 'Cursor', binary: 'cursor' }, // not helper-capable → filtered
  ]);
  render(<AssistantHost active={true} />);

  const select = (await screen.findByTestId('assistant-engine')) as HTMLSelectElement;
  expect([...select.options].map((o) => o.value)).toEqual(['default.claude', 'default.gemini']);
  expect(select.value).toBe('default.claude');

  await act(async () => {
    fireEvent.change(select, { target: { value: 'default.gemini' } });
  });
  expect(helperEngineSet).toHaveBeenCalledWith('default.gemini');
  expect(helperReset).toHaveBeenCalled();
});

test('an error phase renders the error message', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'error', error: 'The assistant did not start in time.' });
  expect(screen.getByTestId('assistant-host-error').textContent).toMatch(/did not start/);
});
