import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { AssistantFeed } from '../../src/renderer/src/components/AssistantFeed.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

let helperAsk: ReturnType<typeof vi.fn>;
let pushHandler: ((p: HelperEventPayload) => void) | null;

const disabled = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).disabled;

const cards = (): HTMLElement[] => screen.queryAllByTestId('assistant-answer');

beforeEach(() => {
  helperAsk = vi.fn();
  pushHandler = null;
  (window as unknown as { cockpit: unknown }).cockpit = {
    helperAsk,
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

/** Push a helper event through the captured subscription (the feed has no
 *  Connect button — it rides the host's session over the shared Channel C). */
function emit(event: HelperEventPayload): void {
  act(() => pushHandler?.(event));
}

test('starts disconnected — actions disabled, the "start it" hint, no Connect or input', () => {
  render(<AssistantFeed />);
  expect(disabled('assistant-ask')).toBe(true);
  expect(disabled('assistant-what-changed')).toBe(true);
  expect(screen.getByTestId('assistant-hint').textContent).toMatch(/Start the assistant/);
  // The feed is output-only: no Connect, and no free-text input (no typing).
  expect(screen.queryByTestId('assistant-connect')).toBeNull();
  expect(screen.queryByTestId('assistant-input')).toBeNull();
});

test('ready enables the actions; clicking asks; thinking re-disables', () => {
  render(<AssistantFeed />);
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  expect(disabled('assistant-ask')).toBe(false);

  fireEvent.click(screen.getByTestId('assistant-ask'));
  expect(helperAsk).toHaveBeenCalledWith('summarize-pending');

  emit({ sessionId: 's1', phase: 'thinking' });
  expect(disabled('assistant-ask')).toBe(true);
  expect(disabled('assistant-what-changed')).toBe(true);

  emit({ sessionId: 's1', phase: 'answered', answer: 'whatever' });
  expect(disabled('assistant-ask')).toBe(false);
});

test('the second action asks for the change summary', () => {
  render(<AssistantFeed />);
  emit({ sessionId: 's1', phase: 'ready' });
  fireEvent.click(screen.getByTestId('assistant-what-changed'));
  expect(helperAsk).toHaveBeenCalledWith('what-changed');
});

test('answers accumulate into a feed, newest first, labelled by what asked', () => {
  render(<AssistantFeed />);
  emit({ sessionId: 's1', phase: 'connecting' });
  emit({ sessionId: 's1', phase: 'ready' });

  // The host's auto-orient answer arrives with no pending feed action → labelled
  // "Orientation".
  emit({ sessionId: 's1', phase: 'answered', answer: 'Oriented and ready.' });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toMatch(/Orientation/);
  expect(cards()[0].textContent).toMatch(/Oriented and ready/);

  // A clicked action labels its own answer, and lands on top.
  fireEvent.click(screen.getByTestId('assistant-ask'));
  emit({ sessionId: 's1', phase: 'thinking' });
  emit({ sessionId: 's1', phase: 'answered', answer: 'Pending: CR9 phase 2.' });

  const c = cards();
  expect(c).toHaveLength(2);
  expect(c[0].textContent).toMatch(/What's pending/);
  expect(c[0].textContent).toMatch(/CR9 phase 2/);
  expect(c[1].textContent).toMatch(/Orientation/); // older entry kept below
});

test('a new session (connecting) clears the previous feed', () => {
  render(<AssistantFeed />);
  emit({ sessionId: 's1', phase: 'ready' });
  emit({ sessionId: 's1', phase: 'answered', answer: 'first session answer' });
  expect(cards()).toHaveLength(1);

  // Reconnect (e.g. after an engine switch) → fresh feed.
  emit({ sessionId: 's2', phase: 'connecting' });
  expect(cards()).toHaveLength(0);
  expect(screen.getByTestId('assistant-hint')).toBeTruthy();
});

test('an error phase renders the error message', () => {
  render(<AssistantFeed />);
  emit({ sessionId: 's1', phase: 'error', error: 'The assistant failed to answer.' });
  expect(screen.getByTestId('assistant-error').textContent).toMatch(/failed to answer/);
});
