import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../../src/renderer/src/components/TerminalTab.js', () => ({
  TerminalTab: () => <div data-testid="body-shell" />,
}));

import { SpaceSurface } from '../../../src/renderer/src/space/SpaceSurface.js';
import { Dashboard } from '../../../src/renderer/src/space/dashboard/Dashboard.js';
import { SessionHeader } from '../../../src/renderer/src/space/session-header/SessionHeader.js';
import { SkillsColumn } from '../../../src/renderer/src/space/skills/SkillsColumn.js';
import type {
  SpaceSummary,
  SpaceWindowInitPayload,
  SpaceWindowResult,
} from '../../../src/shared/ipc.js';

// The surface renders the screen of each 1.0 window mode. Until its phase builds it, a screen
// is a placeholder that says which phase builds it. When a phase replaces a placeholder, its
// row here is replaced by that phase's own component test.

const space: SpaceSummary = {
  root: '/work/my-space',
  key: 'abc',
  name: 'my-space',
  manifest: {
    format: 1,
    name: 'my-space',
    github: { repository: 'me/my-space', project: 7 },
    repositories: [],
    publishAreas: [],
  },
};

const cockpit = {
  spaceOpenInCockpit: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceOpenFolder: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
};

beforeEach(() => {
  cockpit.spaceOpenInCockpit
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'cockpit' } });
  cockpit.spaceOpenFolder.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

const PLACEHOLDERS: [SpaceWindowInitPayload, string, string][] = [
  [{ mode: 'space-welcome', recents: [] }, 'space-welcome', 'M3.6'],
  [{ mode: 'machine-check' }, 'machine-check', 'M3.6'],
  [{ mode: 'setup', start: { kind: 'new' } }, 'setup', 'M3.7'],
  [
    {
      mode: 'migration',
      folder: '/work/old-project',
      legacy: {
        projectName: 'old-project',
        lorePath: '/work/old-project/.ai-lore-old-project',
        coreVersion: '0.8',
        manifestLocation: 'memory-folder',
        migratable: true,
        versionStanding: 'v0.8',
        reason: 'This is the AI-Lore project old-project. It can be migrated.',
      },
    },
    'migration',
    'M6.5',
  ],
  [{ mode: 'space', space }, 'space', 'M3.8'],
  [{ mode: 'space-files', space }, 'space-files', 'M5.2'],
];

test.each(PLACEHOLDERS)('mode %o renders its placeholder', (init, id, phase) => {
  render(<SpaceSurface init={init} />);
  const placeholder = screen.getByTestId(`space-placeholder-${id}`);
  expect(placeholder.textContent).toContain(`This screen is built in phase ${phase}.`);
  expect(placeholder.dataset.phase).toBe(phase);
});

test('the not-a-Space mode renders the screen itself, not a placeholder', () => {
  render(
    <SpaceSurface
      init={{ mode: 'not-a-space', folder: '/work/x', plainRepository: false, reason: 'Why.' }}
    />,
  );
  expect(screen.getByTestId('not-a-space')).toBeTruthy();
  expect(screen.queryByText(/This screen is built in phase/)).toBeNull();
});

test('the parts that are not windows say which phase builds them', () => {
  render(
    <>
      <Dashboard />
      <SessionHeader />
      <SkillsColumn />
    </>,
  );
  expect(screen.getByTestId('space-placeholder-dashboard').dataset.phase).toBe('M7.3');
  expect(screen.getByTestId('space-placeholder-session-header').dataset.phase).toBe('M4.6');
  expect(screen.getByTestId('space-placeholder-skills').dataset.phase).toBe('M4.6');
});

test('the migration screen carries Open in the v0.8 cockpit, which sends no path', async () => {
  const [init] = PLACEHOLDERS[3] ?? [];
  if (!init) throw new Error('the migration row is missing');
  render(<SpaceSurface init={init} />);
  expect(screen.getByTestId('migration-reason').textContent).toContain('can be migrated');
  const button = screen.getByTestId('migration-open-in-cockpit');
  expect(button.textContent).toBe('Open in the v0.8 cockpit');
  fireEvent.click(button);
  await waitFor(() => expect(cockpit.spaceOpenInCockpit).toHaveBeenCalledWith({}));
});

test('error state: a refused Open in the v0.8 cockpit shows the message', async () => {
  cockpit.spaceOpenInCockpit.mockResolvedValue({
    ok: false,
    error: { kind: 'not-allowed-here', message: 'Not from this screen.' },
  });
  const [init] = PLACEHOLDERS[3] ?? [];
  if (!init) throw new Error('the migration row is missing');
  render(<SpaceSurface init={init} />);
  fireEvent.click(screen.getByTestId('migration-open-in-cockpit'));
  const error = await screen.findByTestId('migration-open-in-cockpit-error');
  expect(error.textContent).toBe('Not from this screen.');
});

test('the welcome placeholder opens a folder and shows why a launch folder was not opened', async () => {
  render(
    <SpaceSurface
      init={{ mode: 'space-welcome', recents: [], notice: '/work/gone is not a folder' }}
    />,
  );
  expect(screen.getByTestId('space-welcome-error').textContent).toBe('/work/gone is not a folder');
  fireEvent.click(screen.getByTestId('space-welcome-open'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
});
