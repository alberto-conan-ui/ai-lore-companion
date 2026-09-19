import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeSpaceApp, withSpaceApp } from './space-fixture';

// The Space window, end to end, with detection routing on (phase M3.8). The Space is a
// fixture in a temporary folder and `userData` is a temporary folder: nothing here touches
// the real project, the real Lore, the real `userData` or GitHub. No test here needs the
// machine check to be ready: under `COCKPIT_E2E=1` the app's runner refuses `gh`.
// `withSpaceApp` closes the app and removes the fixture also when a test fails.

/**
 * The fixture Space is not installed into Claude Code, so `+ AI` is disabled with the
 * sentence of `spaceSessionReadiness` (phase M4.6). Every such sentence starts so.
 */
const AI_SENTENCE = /^No AI session/;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.describe('the Space window', () => {
  test('a fixture Space opens in the Space window, and a shell tab runs in the Space folder', async () => {
    await withSpaceApp('e2e-space', async ({ app, page, fixture }) => {
      // The header: the Space's name and its folder.
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('space-name')).toHaveText('e2e-space');
      await expect(page.getByTestId('space-root')).toHaveText(fixture.root);

      // The rail: the four entries, named as they are inside; the window opens on Sessions.
      const rail = page.getByRole('navigation', { name: 'Space' });
      for (const label of ['Dashboard', 'Sessions', 'Files', 'Search']) {
        await expect(rail.getByRole('button', { name: label })).toBeVisible();
      }
      await expect(page.getByTestId('space-rail-sessions')).toHaveAttribute('aria-current', 'page');

      // `+ AI` is disabled while the guarded start is not ready, and the sentence says why.
      const empty = page.getByTestId('space-sessions-empty');
      await expect(empty.getByTestId('new-ai')).toBeDisabled();
      await expect(empty.getByTestId('space-sessions-ai-note')).toHaveText(AI_SENTENCE);

      // The engine menu lists every catalog engine; one that cannot run a guarded
      // session at all (Codex CLI, here, whether or not it is installed) is greyed
      // with its reason on the line.
      await empty.getByRole('button', { name: 'Choose the engine' }).click();
      const engineMenu = page.getByTestId('space-sessions-engine-menu');
      await expect(engineMenu).toBeVisible();
      const codexOption = engineMenu.getByTestId('space-sessions-engine-menu-option-default.codex');
      await expect(codexOption).toHaveAttribute('aria-disabled', 'true');
      await expect(codexOption).toContainText('Codex CLI');
      await expect(codexOption).toContainText(
        'guarded Space sessions are not available for this engine yet',
      );
      await page.keyboard.press('Escape');
      await expect(engineMenu).toHaveCount(0);

      // A shell tab in the dock workspace.
      await empty.getByTestId('new-shell').click();
      await expect(page.getByTestId('dock-workspace').getByTestId('tab-shell')).toBeVisible({
        timeout: 5_000,
      });
      const terminal = page.getByTestId('terminal').first();
      await expect(terminal).toBeVisible();

      // The dock's own `+ AI` is disabled too, with the same sentence as its tooltip.
      const dockAi = page.getByTestId('space-sessions').getByTestId('new-ai').first();
      await expect(dockAi).toBeDisabled();
      await expect(dockAi).toHaveAttribute('title', AI_SENTENCE);
      await expect(page.getByTestId('space-sessions-ai-note')).toHaveText(AI_SENTENCE);
      await expect(page.getByTestId('tab-ai')).toHaveCount(0);

      await terminal.click();

      // The command prints the working directory between two markers and writes it to a
      // file named by a relative path. The typed line holds `$(pwd -P)`, not the folder, so
      // the folder between the markers is the command's output. The shell's process id is
      // written too, to check after the app closes that the process is gone.
      await page.keyboard.type(
        'echo "CWD=$(pwd -P)=END"; pwd -P > e2e-cwd.txt; echo $$ > e2e-pid.txt',
      );
      await page.keyboard.press('Enter');
      await expect(page.locator('.xterm-rows')).toContainText(`CWD=${fixture.root}=END`, {
        timeout: 15_000,
      });
      const written = join(fixture.root, 'e2e-cwd.txt');
      await expect.poll(() => existsSync(written), { timeout: 10_000 }).toBe(true);
      expect(readFileSync(written, 'utf8').trim()).toBe(fixture.root);
      const pidFile = join(fixture.root, 'e2e-pid.txt');
      await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true);
      const shellPid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isInteger(shellPid) && shellPid > 1).toBe(true);
      expect(isAlive(shellPid)).toBe(true);

      // The Dashboard is shown (its content is `space-dashboard.spec.ts`'s); the shell tab is
      // kept while it is shown.
      await page.getByTestId('space-rail-dashboard').click();
      await expect(page.getByTestId('dashboard')).toBeVisible();
      await expect(page.getByTestId('dashboard-state')).toBeVisible();
      expect(isAlive(shellPid)).toBe(true);
      await page.getByTestId('space-rail-sessions').click();
      await expect(page.locator('.xterm-rows')).toContainText(`CWD=${fixture.root}=END`);

      // Closing the app ends the shell of the window.
      await closeSpaceApp(app);
      await expect.poll(() => isAlive(shellPid), { timeout: 10_000 }).toBe(false);
    });
  });

  test('Search finds a file of the Space, and Files opens the Files window', async () => {
    await withSpaceApp('e2e-search-space', async ({ app, page, fixture }) => {
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });

      // Search is the search dialog of the app, with the Space's folder as its one scope.
      await page.getByTestId('space-rail-search').click();
      await expect(page.getByTestId('search-dialog-note')).toContainText(
        'is not updated while the window is open',
      );
      await page
        .getByPlaceholder(/search/i)
        .first()
        .fill('space.md');
      await expect(page.getByTestId('search-result').first()).toContainText('space.md', {
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');

      // Files opens the second window of the Space (phase M5.2; `files-window.spec.ts` tests it).
      const opened = app.waitForEvent('window');
      await page.getByTestId('space-rail-files').click();
      const filesPage = await opened;
      await expect(filesPage.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
      await expect(filesPage.getByTestId('space-files-root')).toHaveText(fixture.root);
    });
  });
});
