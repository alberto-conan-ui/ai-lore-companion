import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../../src/renderer/src/components/TerminalTab.js', () => ({
  TerminalTab: () => <div data-testid="body-shell" />,
}));

import { SpaceSurface } from '../../../src/renderer/src/space/SpaceSurface.js';
import type { SpaceSummary, SpaceWindowResult } from '../../../src/shared/ipc.js';

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
  // Every screen is now shown beside `<SpaceSettings />` (M9.10), which listens for it.
  onSettingsOpen: vi.fn(() => () => {}),
};

beforeEach(() => {
  cockpit.spaceOpenInCockpit
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'cockpit' } });
  cockpit.spaceOpenFolder.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

// Every window mode's screen is built; the migration screen (M6.5) is tested in `migration.test.tsx`.

test('the not-a-Space mode renders the screen itself, not a placeholder', () => {
  render(
    <SpaceSurface
      init={{ mode: 'not-a-space', folder: '/work/x', plainRepository: false, reason: 'Why.' }}
    />,
  );
  expect(screen.getByTestId('not-a-space')).toBeTruthy();
  expect(screen.queryByText(/This screen is built in phase/)).toBeNull();
});

// The session header and the Skills column (M4.6) are tested in `space-ai-session.test.tsx`;
// the Dashboard (M7.3) in `dashboard.test.tsx`.

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
