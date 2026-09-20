import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SettingsSheetModal } from '../../src/renderer/src/components/SettingsSheet.js';
import type {
  EngineEntry,
  SettingDef,
  SettingsSnapshot,
  SpaceSpacesFolderResult,
} from '../../src/shared/ipc.js';

// M9.10: the Spaces folder is reachable from Settings (product document section 4), and
// catalog engines cannot be removed there (section 3.2).

const SPACES_FOLDER_DEF: SettingDef = {
  key: 'spaces.folder',
  label: 'Spaces folder',
  section: 'Spaces',
  type: 'string',
  tier: 'global',
  default: '',
};

function snapshotWith(spacesFolder: string): SettingsSnapshot {
  return {
    registry: [SPACES_FOLDER_DEF],
    resolved: { 'spaces.folder': spacesFolder },
    global: { schemaVersion: 1, values: { 'spaces.folder': spacesFolder }, ignores: [] },
    project: null,
    defaultIgnores: [],
  };
}

let settingsListener: ((snap: SettingsSnapshot) => void) | null = null;

const cockpit = {
  settingsGet: vi.fn<() => Promise<SettingsSnapshot>>(),
  onSettingsChanged: vi.fn((listener: (snap: SettingsSnapshot) => void) => {
    settingsListener = listener;
    return () => {
      settingsListener = null;
    };
  }),
  browserSuppressAll: vi.fn(),
  settingsSet: vi.fn(),
  settingsSetIgnores: vi.fn(),
  spaceSpacesFolderChoose: vi.fn<(arg: unknown) => Promise<SpaceSpacesFolderResult>>(),
  enginesList: vi.fn<() => Promise<EngineEntry[]>>(),
  onEnginesChanged: vi.fn(() => () => {}),
  enginesSave: vi.fn(),
};

beforeEach(() => {
  settingsListener = null;
  for (const mock of Object.values(cockpit)) mock.mockClear();
  cockpit.settingsGet.mockResolvedValue(snapshotWith('/Users/alberto/Spaces'));
  cockpit.enginesList.mockResolvedValue([
    { id: 'default.claude', name: 'Claude Code', binary: 'claude' },
    { id: 'my-own-cli', name: 'My CLI', binary: 'my-cli' },
  ]);
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test('the Spaces section shows the folder and Choose… calls spaceSpacesFolderChoose', async () => {
  cockpit.spaceSpacesFolderChoose.mockResolvedValue({
    ok: true,
    value: { folder: '/Users/alberto/Elsewhere' },
  });
  render(<SettingsSheetModal onClose={() => {}} initialSection="spaces" />);
  await screen.findByText('/Users/alberto/Spaces');
  fireEvent.click(screen.getByTestId('setting-spaces.folder-choose'));
  await waitFor(() => expect(cockpit.spaceSpacesFolderChoose).toHaveBeenCalledWith({}));

  // Main pushes the new snapshot after saving the choice; the sheet follows it.
  settingsListener?.(snapshotWith('/Users/alberto/Elsewhere'));
  await screen.findByText('/Users/alberto/Elsewhere');
});

test('a cancelled Choose… leaves the folder as it is and shows no message', async () => {
  cockpit.spaceSpacesFolderChoose.mockResolvedValue({
    ok: false,
    error: { kind: 'cancelled', message: 'No folder was chosen.' },
  });
  render(<SettingsSheetModal onClose={() => {}} initialSection="spaces" />);
  await screen.findByText('/Users/alberto/Spaces');
  fireEvent.click(screen.getByTestId('setting-spaces.folder-choose'));
  await waitFor(() => expect(cockpit.spaceSpacesFolderChoose).toHaveBeenCalledWith({}));
  expect(screen.queryByText('No folder was chosen.')).toBeNull();
});

test('the Engines section has no Remove for default.claude and has one for a hand-added engine', async () => {
  render(<SettingsSheetModal onClose={() => {}} initialSection="engines" />);
  const claudeRow = await screen.findByTestId('engine-row-default.claude');
  expect(within(claudeRow).queryByTestId('engine-remove-default.claude')).toBeNull();
  expect(claudeRow.textContent).toContain(
    'Listed by AI-Lore; it cannot be removed. Its parameters can be edited.',
  );

  const ownRow = screen.getByTestId('engine-row-my-own-cli');
  expect(within(ownRow).getByTestId('engine-remove-my-own-cli')).toBeTruthy();
  expect(ownRow.textContent).not.toContain(
    'Listed by AI-Lore; it cannot be removed. Its parameters can be edited.',
  );
});

test('editing an engine adds a parameter, ticks it by default and saves params through enginesSave', async () => {
  cockpit.enginesSave.mockImplementation(async (next: EngineEntry[]) => next);
  render(<SettingsSheetModal onClose={() => {}} initialSection="engines" />);
  const ownRow = await screen.findByTestId('engine-row-my-own-cli');
  fireEvent.click(within(ownRow).getByTestId('engine-edit-my-own-cli'));

  fireEvent.click(screen.getByTestId('engine-draft-param-add'));
  fireEvent.change(screen.getByTestId('engine-draft-param-0'), {
    target: { value: '--dangerously-skip-permissions' },
  });
  fireEvent.click(screen.getByTestId('engine-draft-param-default-0'));
  fireEvent.click(screen.getByTestId('engine-draft-save'));

  await waitFor(() => expect(cockpit.enginesSave).toHaveBeenCalled());
  const saved = cockpit.enginesSave.mock.calls[0]?.[0] as EngineEntry[];
  const own = saved.find((e) => e.id === 'my-own-cli');
  expect(own?.params).toEqual([{ text: '--dangerously-skip-permissions', defaultOn: true }]);
});

test("model survives an edit that only changes the engine's name", async () => {
  cockpit.enginesList.mockResolvedValue([
    { id: 'default.claude', name: 'Claude Code', binary: 'claude' },
    { id: 'my-own-cli', name: 'My CLI', binary: 'my-cli', model: 'opus' },
  ]);
  cockpit.enginesSave.mockImplementation(async (next: EngineEntry[]) => next);
  render(<SettingsSheetModal onClose={() => {}} initialSection="engines" />);
  const ownRow = await screen.findByTestId('engine-row-my-own-cli');
  fireEvent.click(within(ownRow).getByTestId('engine-edit-my-own-cli'));
  fireEvent.change(screen.getByTestId('engine-draft-name'), {
    target: { value: 'My CLI, renamed' },
  });
  fireEvent.click(screen.getByTestId('engine-draft-save'));

  await waitFor(() => expect(cockpit.enginesSave).toHaveBeenCalled());
  const saved = cockpit.enginesSave.mock.calls[0]?.[0] as EngineEntry[];
  const own = saved.find((e) => e.id === 'my-own-cli');
  expect(own?.model).toBe('opus');
  expect(own?.name).toBe('My CLI, renamed');
});

test('typing a model into the engine editor saves it on the entry', async () => {
  cockpit.enginesSave.mockImplementation(async (next: EngineEntry[]) => next);
  render(<SettingsSheetModal onClose={() => {}} initialSection="engines" />);
  const ownRow = await screen.findByTestId('engine-row-my-own-cli');
  fireEvent.click(within(ownRow).getByTestId('engine-edit-my-own-cli'));

  fireEvent.change(screen.getByTestId('engine-draft-model'), {
    target: { value: 'opus' },
  });
  fireEvent.click(screen.getByTestId('engine-draft-save'));

  await waitFor(() => expect(cockpit.enginesSave).toHaveBeenCalled());
  const saved = cockpit.enginesSave.mock.calls[0]?.[0] as EngineEntry[];
  const own = saved.find((e) => e.id === 'my-own-cli');
  expect(own?.model).toBe('opus');
});
