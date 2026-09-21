import { expect, test } from '@playwright/test';
import { withSpaceApp } from './space-fixture';

test.describe('repository roots in Files', () => {
  test('keeps a repository out of the Dashboard and opens its tracked Files root', async () => {
    test.setTimeout(90_000);
    await withSpaceApp(
      'e2e-repositories',
      async ({ app, page }) => {
        await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('dashboard')).toBeVisible();
        await expect(page.getByTestId('repository-row')).toHaveCount(0);

        const opened = app.waitForEvent('window');
        await page.getByTestId('space-rail-files').click();
        const files = await opened;
        await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
        const repository = files.getByTestId('files-root-tab-repo:app');
        await repository.click();
        await expect(repository).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
        await expect(files.getByTestId('files-root-panel')).toBeVisible();
        await expect(files.getByTestId('root-changes-panel')).toBeVisible({ timeout: 15_000 });
      },
      { repositories: ['app'] },
    );
  });
});
