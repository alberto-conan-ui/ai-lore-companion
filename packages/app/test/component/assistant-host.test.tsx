import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { AssistantHost } from '../../src/renderer/src/components/AssistantHost.js';
import type { HelperEventPayload } from '../../src/shared/ipc.js';

// The host body is now the Activity console (both engines report there); there is
// no per-engine terminal or headless hint anymore.

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

test('starts disconnected — Connect shown, the activity console is the body', () => {
  render(<AssistantHost active={true} />);
  expect(screen.getByTestId('assistant-connect')).toBeTruthy();
  expect(screen.getByTestId('activity-console')).toBeTruthy();
});

test('Connect launches the session and shows connecting', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  expect(helperConnect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('assistant-host-status').textContent).toMatch(/Connecting/);
  expect(disabled('assistant-connect')).toBe(true);
});

test('a connecting event (with a ptyId) marks connected and hides Connect', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  expect(screen.queryByTestId('assistant-connect')).toBeNull();
});

test('the host fires no turn of its own on ready (the dashboard drives the first turn)', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  emit({ sessionId: 's1', phase: 'connecting', ptyId: 'pty-42' });
  emit({ sessionId: 's1', phase: 'ready' });
  // Turns are serialized; the dashboard surface fires the first one, so the host
  // must stay quiet or one of the two would be dropped.
  expect(helperAsk).not.toHaveBeenCalled();
});

test('a headless engine (no ptyId) connects on ready and hides Connect', () => {
  render(<AssistantHost active={true} />);
  fireEvent.click(screen.getByTestId('assistant-connect'));
  // Gemini (CR7): connecting then ready, both without a ptyId.
  emit({ sessionId: 'g1', phase: 'connecting' });
  emit({ sessionId: 'g1', phase: 'ready' });
  expect(screen.queryByTestId('assistant-connect')).toBeNull();
  expect(screen.getByTestId('activity-console')).toBeTruthy();
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
