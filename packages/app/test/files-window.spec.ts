import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { withSpaceApp } from './space-fixture';

// The Files window of phase M5.2, end to end, with detection routing on. The Space is a
// fixture in a temporary folder and `userData` is a temporary folder: nothing here touches
// the real project, the real Lore, the real `userData` or GitHub.

const WORKBENCH_NOTICE = 'The Workbench is not tracked by git, so it has no changes list.';

test.describe('the Files window', () => {
  test('Files in the Space window opens the Files window: roots as tabs with counts, the tree, the Workbench sentence, live counts', async () => {
    await withSpaceApp('e2e-files-space', async ({ app, page, fixture }) => {
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });

      const opened = app.waitForEvent('window');
      await page.getByTestId('space-rail-files').click();
      const files = await opened;
      await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
      await expect(files.getByTestId('space-files-root')).toHaveText(fixture.root);

      // One tab per root, named as the root is named; the Lore is selected and has a count.
      const tabs = files.getByRole('tablist', { name: 'Roots' });
      await expect(tabs.getByTestId('files-root-tab-lore')).toBeVisible({ timeout: 15_000 });
      await expect(tabs.getByTestId('files-root-tab-workbench')).toBeVisible();
      await expect(tabs.getByTestId('files-root-tab-lore')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const loreCount = files.getByTestId('files-root-count-lore');
      await expect(loreCount).toHaveText(/^\d+$/, { timeout: 15_000 });
      const before = Number(await loreCount.textContent());

      // The tree of the Lore, with the placeholders of the parts later phases build.
      const tree = files.getByRole('region', { name: 'Tree of lore' });
      await expect(tree.getByText('space.md', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(files.getByTestId('files-changes-slot')).toBeVisible();
      await expect(files.getByTestId('files-picker-slot')).toBeVisible();
      await expect(files.getByTestId('files-editor-slot')).toBeVisible();

      // The Workbench says in one sentence that it has no changes list.
      await tabs.getByTestId('files-root-tab-workbench').click();
      await expect(files.getByTestId('files-untracked-notice')).toHaveText(WORKBENCH_NOTICE);
      await expect(files.getByTestId('files-changes-slot')).toHaveCount(0);

      // A new file in the Lore: its count and its tree follow without a reload.
      await tabs.getByTestId('files-root-tab-lore').click();
      writeFileSync(join(fixture.root, 'lore', 'e2e-new-note.md'), '# A new note\n');
      await expect(loreCount).toHaveText(String(before + 1), { timeout: 15_000 });
      await expect(tree.getByText('e2e-new-note.md', { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Files again brings the same window forward rather than a second one.
      await page.getByTestId('space-rail-files').click();
      await expect(files.getByTestId('files-window')).toBeVisible();
      expect(app.windows().length).toBe(2);

      // Open in Files with a file: the same window selects the root, reveals the file in
      // its tree and asks the editor to open it. No screen sends it yet, so the Space
      // window calls the channel as those screens will.
      await tabs.getByTestId('files-root-tab-workbench').click();
      await page.evaluate(() =>
        window.cockpit.spaceNavigate({
          to: 'space-files',
          open: { rootId: 'lore', relPath: 'space.md' },
        }),
      );
      await expect(tabs.getByTestId('files-root-tab-lore')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15_000 },
      );
      await expect(files.getByTestId('files-editor-request')).toHaveText('lore: space.md (code)');
      await expect(tree.getByRole('treeitem', { name: /space\.md/ }).first()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(app.windows().length).toBe(2);
    });
  });
});
