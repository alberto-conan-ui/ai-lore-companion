import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { PromptsColumn } from '../../src/renderer/src/components/AiTab.js';

type PromptEntry = { name: string; slash: string; description: string };

let promptsList: ReturnType<typeof vi.fn>;
let engineBindingInstalled: ReturnType<typeof vi.fn>;
let sendTerminalInput: ReturnType<typeof vi.fn>;

const PROMPTS: PromptEntry[] = [
  { name: 'orient', slash: '/ai-lore-orient', description: 'Session open' },
  { name: 'execute', slash: '/ai-lore-execute', description: 'Produce the Payload' },
  { name: 'install', slash: '/ai-lore-install', description: 'Bind into an engine' }, // → Advanced
];

beforeEach(() => {
  promptsList = vi.fn(async () => PROMPTS);
  engineBindingInstalled = vi.fn(async () => true);
  sendTerminalInput = vi.fn();
  (window as unknown as { cockpit: unknown }).cockpit = {
    promptsList,
    engineBindingInstalled,
    sendTerminalInput,
    onPromptsChanged: () => () => {},
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const present = (testId: string): boolean => screen.queryByTestId(testId) !== null;

/** Installed project: the catalog is redundant (the CLI autocompletes the slash
 *  forms), so it sits collapsed behind a `▸ Skills` toggle and no verb rows show
 *  until the user opens it. */
test('installed → Skills toggle collapsed by default, opens the catalog', async () => {
  render(<PromptsColumn ptyId="pty-1" focusPty={() => {}} />);

  // The toggle appears (collapsed) and no curated rows are visible yet.
  const toggle = await screen.findByTestId('prompts-skills-toggle');
  expect(toggle.textContent).toContain('▸');
  expect(present('prompt-row-orient')).toBe(false);

  fireEvent.click(toggle);

  // Expanded: curated rows render, and the uncurated verb is still tucked under
  // the nested Advanced toggle (not shown until that opens).
  expect(await screen.findByTestId('prompt-row-orient')).toBeTruthy();
  expect(screen.getByTestId('prompts-skills-toggle').textContent).toContain('▾');
  expect(present('prompt-row-install')).toBe(false);
  fireEvent.click(screen.getByTestId('prompts-advanced-toggle'));
  expect(await screen.findByTestId('prompt-row-install')).toBeTruthy();
});

/** Still checking (`installed === null`): render the collapsed toggle, never the
 *  full catalog — no optimistic flash. */
test('while checking → collapsed toggle, no catalog flash', async () => {
  // A promise that never resolves keeps `installed` at null.
  engineBindingInstalled = vi.fn(() => new Promise<boolean>(() => {}));
  (
    window as unknown as { cockpit: { engineBindingInstalled: unknown } }
  ).cockpit.engineBindingInstalled = engineBindingInstalled;

  render(<PromptsColumn ptyId="pty-1" focusPty={() => {}} />);

  expect(await screen.findByTestId('prompts-skills-toggle')).toBeTruthy();
  expect(present('prompt-row-orient')).toBe(false);
  expect(present('prompts-bootstrap-hint')).toBe(false);
});

/** Plain-text project (`installed === false`): the slash forms wouldn't resolve,
 *  so show the bootstrap hint and no Skills toggle. */
test('plain-text project → bootstrap hint, no Skills toggle', async () => {
  engineBindingInstalled = vi.fn(async () => false);
  (
    window as unknown as { cockpit: { engineBindingInstalled: unknown } }
  ).cockpit.engineBindingInstalled = engineBindingInstalled;

  render(<PromptsColumn ptyId="pty-1" focusPty={() => {}} />);

  expect(await screen.findByTestId('prompts-bootstrap-hint')).toBeTruthy();
  await waitFor(() => expect(present('prompts-skills-toggle')).toBe(false));
});
