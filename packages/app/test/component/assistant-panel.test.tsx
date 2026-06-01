import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// HelperTerminal pulls xterm; stub it so the panel's connect/ask wiring and the
// button-state logic are assertable without a real terminal.
vi.mock('../../src/renderer/src/components/HelperTerminal.js', () => ({
  HelperTerminal: ({ ptyId }: { ptyId: string }) => (
    <div data-testid="helper-terminal" data-pty={ptyId} />
  ),
}));

import { AssistantPanel } from '../../src/renderer/src/components/AssistantPanel.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

let helperConnect: ReturnType<typeof vi.fn>;
let helperAsk: ReturnType<typeof vi.fn>;
let helperAskText: ReturnType<typeof vi.fn>;
let pushHandler: ((p: HelperEventPayload) => void) | null;

/** The visible button's disabled state — jest-dom matchers aren't configured. */
const disabled = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).disabled;

beforeEach(() => {
  helperConnect = vi.fn();
  helperAsk = vi.fn();
  helperAskText = vi.fn();
  pushHandler = null;
  (window as unknown as { cockpit: unknown }).cockpit = {
    helperConnect,
    helperAsk,
    helperAskText,
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

test('starts disconnected — Connect shown, no terminal, no ask', () => {
  render(<AssistantPanel active={true} />);
  expect(screen.getByTestId('assistant-connect')).toBeTruthy();
  expect(screen.queryByTestId('assistant-ask')).toBeNull();
  expect(screen.queryByTestId('helper-terminal')).toBeNull();
  expect(screen.getByTestId('assistant-hint')).toBeTruthy();
});

test('Connect launches the session and shows connecting', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  expect(helperConnect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('assistant-status').textContent).toMatch(/Connecting/);
  expect(disabled('assistant-connect')).toBe(true);
});

test('the connecting event binds the terminal and swaps Connect for the action', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });

  // Terminal is bound to the helper PTY; Connect is gone, the action appears.
  expect(screen.getByTestId('helper-terminal').getAttribute('data-pty')).toBe('pty-42');
  expect(screen.queryByTestId('assistant-connect')).toBeNull();
  // Still busy (connecting) → the action is disabled.
  expect(disabled('assistant-ask')).toBe(true);
});

test('ready enables the action; clicking it asks; thinking re-disables', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  expect(disabled('assistant-ask')).toBe(false);

  fireEvent.click(screen.getByTestId('assistant-ask'));
  expect(helperAsk).toHaveBeenCalledWith('summarize-pending');

  emit({ sessionId: 's1', phase: 'thinking' });
  expect(disabled('assistant-ask')).toBe(true);

  emit({ sessionId: 's1', phase: 'answered', answer: 'whatever' });
  expect(disabled('assistant-ask')).toBe(false);
});

test('the helper orients itself automatically on the first ready (once)', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  expect(helperAsk).toHaveBeenCalledWith('orient');

  // A later ready (e.g. after a turn) must not re-orient.
  helperAsk.mockClear();
  emit({ sessionId: 's1', phase: 'ready' });
  expect(helperAsk).not.toHaveBeenCalledWith('orient');
});

test('the second action asks for the change summary', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  fireEvent.click(screen.getByTestId('assistant-what-changed'));
  expect(helperAsk).toHaveBeenCalledWith('what-changed');
});

test('typing a question and sending it routes free text and clears the box', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });

  const input = screen.getByTestId('assistant-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'which CR is active?' } });
  fireEvent.click(screen.getByTestId('assistant-send'));
  expect(helperAskText).toHaveBeenCalledWith('which CR is active?');
  expect(input.value).toBe('');
});

test('the ask box + actions are disabled while a turn is thinking', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'thinking' });
  expect(disabled('assistant-ask')).toBe(true);
  expect(disabled('assistant-what-changed')).toBe(true);
  expect((screen.getByTestId('assistant-input') as HTMLInputElement).disabled).toBe(true);
});

test('an error phase renders the error message', () => {
  render(<AssistantPanel active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'error', error: 'The assistant did not start in time.' });
  expect(screen.getByTestId('assistant-error').textContent).toMatch(/did not start/);
});
