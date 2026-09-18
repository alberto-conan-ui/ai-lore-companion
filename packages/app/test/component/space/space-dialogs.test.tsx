import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SpaceDialogs } from '../../../src/renderer/src/space/dialogs/SpaceDialogs.js';
import type {
  PendingDialog,
  PendingDialogsPayload,
  SpaceDialogsResult,
  WritingDialogView,
} from '../../../src/shared/ipc.js';

const SESSION = { engine: 'claude-code', startedAt: '2026-09-18T09:00:00.000Z', item: 12 };
const HOLDER = 'the claude-code session on item #7 that started at 2026-09-18T08:00:00.000Z';

const WRITING: PendingDialog = {
  kind: 'writing',
  ticket: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  askedAt: '2026-09-18T09:05:00.000Z',
  session: SESSION,
  reason: 'Write the report of item #12.',
  item: 12,
  targets: ['the Lore', 'the repository "app" on the branch "main"'],
};

const GATE: PendingDialog = {
  kind: 'gate',
  ticket: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  askedAt: '2026-09-18T09:06:00.000Z',
  session: SESSION,
  process: 'specify',
  step: 'confirm',
  question: 'Is the draft agreed?',
  bearsOn: 'workbench/spec.md',
};

function writingView(overrides: Partial<WritingDialogView> = {}): WritingDialogView {
  return {
    ticket: WRITING.ticket,
    askedAt: WRITING.askedAt,
    session: SESSION,
    reason: 'Write the report of item #12.',
    item: 12,
    targets: [
      { kind: 'lore', name: null, branch: null, heldBy: HOLDER, problem: null },
      { kind: 'repository', name: 'app', branch: 'main', heldBy: null, problem: null },
    ],
    github: { reachable: true },
    ...overrides,
  };
}

let pushed: ((payload: PendingDialogsPayload) => void) | null = null;

const cockpit = {
  spaceDialogsPending: vi.fn<(arg: unknown) => Promise<SpaceDialogsResult<unknown>>>(),
  spaceDialogWritingView: vi.fn<(arg: unknown) => Promise<SpaceDialogsResult<unknown>>>(),
  spaceDialogAnswerWriting: vi.fn<(arg: unknown) => Promise<SpaceDialogsResult<unknown>>>(),
  spaceDialogAnswerGate: vi.fn<(arg: unknown) => Promise<SpaceDialogsResult<unknown>>>(),
  onSpaceDialogsPending: vi.fn((listener: (payload: PendingDialogsPayload) => void) => {
    pushed = listener;
    return () => {
      pushed = null;
    };
  }),
};

function pending(requests: PendingDialog[]): void {
  cockpit.spaceDialogsPending.mockResolvedValue({ ok: true, value: { requests } });
}

function push(requests: PendingDialog[], settled: PendingDialogsPayload['settled'] = null): void {
  act(() => pushed?.({ requests, settled }));
}

beforeEach(() => {
  pushed = null;
  pending([]);
  cockpit.spaceDialogWritingView.mockReset().mockResolvedValue({ ok: true, value: writingView() });
  cockpit.spaceDialogAnswerWriting
    .mockReset()
    .mockResolvedValue({ ok: true, value: { granted: true, message: 'Granted.' } });
  cockpit.spaceDialogAnswerGate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { answer: 'yes', answeredAt: '' } });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test('a held target is disabled and names who holds it; Confirm sends the free targets', async () => {
  pending([WRITING]);
  render(<SpaceDialogs />);
  await screen.findByTestId('writing-dialog');
  const held = await screen.findByTestId('writing-target-held-lore:');
  expect(held.textContent).toContain(HOLDER);
  expect((screen.getByTestId('writing-target-check-lore:') as HTMLInputElement).disabled).toBe(
    true,
  );
  expect((screen.getByTestId('writing-target-check-lore:') as HTMLInputElement).checked).toBe(
    false,
  );
  expect(screen.getByTestId('writing-session').textContent).toBe(
    'The claude-code session on item #12 that started at 2026-09-18T09:00:00.000Z',
  );
  expect(screen.queryByTestId('writing-github-unreachable')).toBeNull();

  fireEvent.change(screen.getByTestId('writing-target-branch-repository:app'), {
    target: { value: 'feature/report' },
  });
  expect(screen.getByTestId('writing-target-allows-repository:app').textContent).toBe(
    'The session may write in the repository "app", only on the branch "feature/report".',
  );
  fireEvent.click(screen.getByTestId('writing-confirm'));
  await waitFor(() => expect(cockpit.spaceDialogAnswerWriting).toHaveBeenCalledTimes(1));
  expect(cockpit.spaceDialogAnswerWriting).toHaveBeenCalledWith({
    ticket: WRITING.ticket,
    confirm: true,
    targets: [{ kind: 'repository', name: 'app', branch: 'feature/report' }],
  });
});

test('Confirm is disabled when every target is held', async () => {
  pending([WRITING]);
  cockpit.spaceDialogWritingView.mockResolvedValue({
    ok: true,
    value: writingView({
      targets: [{ kind: 'lore', name: null, branch: null, heldBy: HOLDER, problem: null }],
    }),
  });
  render(<SpaceDialogs />);
  await screen.findByTestId('writing-target-held-lore:');
  expect((screen.getByTestId('writing-confirm') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('writing-decline'));
  await waitFor(() =>
    expect(cockpit.spaceDialogAnswerWriting).toHaveBeenCalledWith({
      ticket: WRITING.ticket,
      confirm: false,
    }),
  );
});

test('the dialog says when GitHub cannot be reached', async () => {
  pending([WRITING]);
  cockpit.spaceDialogWritingView.mockResolvedValue({
    ok: true,
    value: writingView({ github: { reachable: false, message: 'No network.' } }),
  });
  render(<SpaceDialogs />);
  const notice = await screen.findByTestId('writing-github-unreachable');
  expect(notice.textContent).toContain('GitHub cannot be reached: No network.');
  expect(notice.textContent).toContain('The claim is still recorded on this desk');
  expect(notice.textContent).toContain('will fail, and the session is told so');
  expect((screen.getByTestId('writing-confirm') as HTMLButtonElement).disabled).toBe(false);
});

test.each([
  ['yes', 'Yes'],
  ['no', 'No'],
  ['take-over', 'Take over'],
] as const)('the gate answer %s is sent with the ticket', async (answer, label) => {
  pending([GATE]);
  render(<SpaceDialogs />);
  await screen.findByTestId('gate-dialog');
  expect(screen.getByTestId('gate-process').textContent).toBe('specify');
  expect(screen.getByTestId('gate-step').textContent).toBe('confirm');
  expect(screen.getByTestId('gate-question').textContent).toBe('Is the draft agreed?');
  expect(screen.getByTestId('gate-bears-on').textContent).toBe('workbench/spec.md');
  const button = screen.getByTestId(`gate-answer-${answer}`);
  expect(button.textContent).toBe(label);
  fireEvent.click(button);
  await waitFor(() =>
    expect(cockpit.spaceDialogAnswerGate).toHaveBeenCalledWith({ ticket: GATE.ticket, answer }),
  );
  expect(cockpit.spaceDialogAnswerGate).toHaveBeenCalledTimes(1);
});

test('Escape closes the dialog without answering; the request stays listed and reopens', async () => {
  pending([GATE, WRITING]);
  render(<SpaceDialogs />);
  const dialog = await screen.findByTestId('gate-dialog');
  expect(screen.getByTestId('dialog-count').textContent).toBe('Request 1 of 2');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  // The next request opens after the pause that follows a key (Escape is one); the closed one
  // answers nothing and stays in the list.
  await screen.findByTestId('writing-dialog', {}, { timeout: 4000 });
  expect(screen.queryByTestId('gate-dialog')).toBeNull();
  expect(cockpit.spaceDialogAnswerGate).not.toHaveBeenCalled();
  expect(screen.getByTestId('dialog-requests-count').textContent).toBe(
    '2 requests wait for your answer.',
  );
  fireEvent.keyDown(screen.getByTestId('writing-dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('writing-dialog')).toBeNull());
  expect(cockpit.spaceDialogAnswerWriting).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId(`dialog-request-open-${GATE.ticket}`));
  await screen.findByTestId('gate-dialog');
});

test('a request cancelled by its session closes its dialog', async () => {
  pending([GATE]);
  render(<SpaceDialogs />);
  await screen.findByTestId('gate-dialog');
  push([], {
    ticket: GATE.ticket,
    kind: 'gate',
    outcome: 'cancelled',
    message: 'The session ended before the Human Lead answered.',
  });
  await waitFor(() => expect(screen.queryByTestId('gate-dialog')).toBeNull());
  expect(screen.getByTestId('dialog-last-settled').textContent).toContain(
    'The session ended before the Human Lead answered.',
  );
});

test('a double click on Confirm, or on a gate answer, answers once', async () => {
  // Main takes its time: the second click arrives before the first answer returns.
  let release: (() => void) | null = null;
  cockpit.spaceDialogAnswerWriting.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, value: { granted: true, message: 'Granted.' } });
      }),
  );
  pending([WRITING]);
  render(<SpaceDialogs />);
  await screen.findByTestId('writing-target-allows-repository:app');
  const confirmButton = screen.getByTestId('writing-confirm');
  fireEvent.click(confirmButton);
  fireEvent.click(confirmButton);
  fireEvent.doubleClick(confirmButton);
  await act(async () => release?.());
  // Answered, but the push that removes the request has not come yet: still one call.
  fireEvent.click(confirmButton);
  expect(cockpit.spaceDialogAnswerWriting).toHaveBeenCalledTimes(1);
  cleanup();

  pending([GATE]);
  render(<SpaceDialogs />);
  const yes = await screen.findByTestId('gate-answer-yes');
  fireEvent.click(yes);
  fireEvent.click(yes);
  fireEvent.click(screen.getByTestId('gate-answer-no'));
  await waitFor(() => expect(cockpit.spaceDialogAnswerGate).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(cockpit.spaceDialogAnswerGate).toHaveBeenCalledTimes(1);
});

test('a dialog opens with the focus on Close, never on an answer, and gives the focus back to the terminal', async () => {
  render(
    <>
      <textarea aria-label="terminal input" data-testid="terminal-input" />
      <SpaceDialogs />
    </>,
  );
  await waitFor(() => expect(pushed).not.toBeNull());
  const terminal = screen.getByTestId('terminal-input');
  terminal.focus();
  push([GATE]);
  const dialog = await screen.findByTestId('gate-dialog', {}, { timeout: 4000 });
  expect(dialog.getAttribute('role')).toBe('dialog');
  await waitFor(() => expect(document.activeElement?.textContent).toBe('Close without answering'));
  // Enter or Space typed now lands on Close, which answers nothing.
  fireEvent.click(document.activeElement as HTMLElement);
  await waitFor(() => expect(screen.queryByTestId('gate-dialog')).toBeNull());
  expect(cockpit.spaceDialogAnswerGate).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(terminal));
});

test('a key held down keeps the dialog from opening until the keys stop', async () => {
  render(<SpaceDialogs />);
  await waitFor(() => expect(pushed).not.toBeNull());
  // The key goes down, the request arrives, and the key repeats for 2 seconds.
  fireEvent.keyDown(window, { key: 'Enter' });
  push([GATE]);
  const started = Date.now();
  while (Date.now() - started < 2000) {
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(screen.queryByTestId('gate-dialog')).toBeNull();
  }
  await screen.findByTestId('gate-dialog', {}, { timeout: 4000 });
  expect(cockpit.spaceDialogAnswerGate).not.toHaveBeenCalled();
});

test('the count names every waiting request, and a push replaces the list', async () => {
  pending([GATE, WRITING]);
  render(<SpaceDialogs />);
  await screen.findByTestId('gate-dialog');
  expect(screen.getByTestId('dialog-count').textContent).toBe('Request 1 of 2');
  push([GATE]);
  expect(screen.getByTestId('dialog-requests-count').textContent).toBe(
    '1 request waits for your answer.',
  );
  expect(screen.getByTestId('dialog-count').textContent).toBe('Request 1 of 1');
});

test('a request that arrives while a key was just pressed waits for a pause before it opens', async () => {
  render(<SpaceDialogs />);
  await waitFor(() => expect(pushed).not.toBeNull());
  fireEvent.keyDown(window, { key: 'a' });
  push([GATE]);
  // The list shows it at once; the dialog, which takes the focus, waits.
  expect(screen.getByTestId('dialog-requests-count').textContent).toBe(
    '1 request waits for your answer.',
  );
  expect(screen.queryByTestId('gate-dialog')).toBeNull();
  await screen.findByTestId('gate-dialog', {}, { timeout: 4000 });
});
