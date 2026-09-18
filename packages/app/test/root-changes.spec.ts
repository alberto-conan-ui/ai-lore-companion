import { execFileSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { withSpaceApp } from './space-fixture';

// The Changes panel of phase M5.3, end to end, for the Reviews gate of stage M5: in a
// Space whose repository has files committed since the reviewed mark, a renamed file and
// uncommitted files, the panel lists exactly those, and Mark as reviewed leaves only the
// uncommitted ones. The Space is a fixture in a temporary folder with a `userData` of its
// own: nothing here touches the real project, the real Lore or GitHub.

function git(root: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args],
    { encoding: 'utf8' },
  );
}

type Listed = { path: string; kind: string; state: string };

async function listed(files: Page): Promise<Listed[]> {
  return files.getByTestId('root-change').evaluateAll((rows) =>
    rows.map((row) => ({
      path: row.getAttribute('data-path') ?? '',
      kind: row.getAttribute('data-kind') ?? '',
      state: row.getAttribute('data-state') ?? '',
    })),
  );
}

test.describe('the Changes panel', () => {
  test('Reviews gate: committed since the mark, renamed and uncommitted files are listed; Mark as reviewed leaves only the uncommitted', async () => {
    await withSpaceApp('e2e-root-changes', async ({ app, page, fixture }) => {
      const lore = join(fixture.root, 'lore');
      const body = (name: string): string =>
        `# ${name}\n\n${'A line of this note that stays the same.\n'.repeat(20)}`;

      // Files the scenario changes later, committed with whatever the fixture left.
      writeFileSync(join(lore, 'e2e-change-me.md'), body('change me'));
      writeFileSync(join(lore, 'e2e-rename-me.md'), body('rename me'));
      writeFileSync(join(lore, 'e2e-edit-uncommitted.md'), body('edit uncommitted'));
      git(fixture.root, 'add', '-A');
      git(fixture.root, 'commit', '--allow-empty', '-m', 'e2e: the reviewed state');

      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
      const opened = app.waitForEvent('window');
      await page.getByTestId('space-rail-files').click();
      const files = await opened;
      await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
      await expect(files.getByTestId('files-root-tab-lore')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15_000 },
      );
      const panel = files.getByTestId('root-changes-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByTestId('root-mark-reviewed-sentence')).toContainText(
        "Mark as reviewed records the root's current commit as the reviewed mark.",
      );

      // Mark the present commit, so the scenario starts from a reviewed mark and no change.
      const mark = panel.getByRole('button', { name: 'Mark as reviewed' });
      await expect(mark).toBeEnabled({ timeout: 15_000 });
      await mark.click();
      await expect(panel.getByTestId('root-mark-reviewed-result')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByTestId('root-changes-empty')).toBeVisible({ timeout: 15_000 });
      await expect(mark).toBeDisabled();

      // Committed since the mark: an added, a changed and a renamed file.
      writeFileSync(join(lore, 'e2e-added.md'), body('added'));
      writeFileSync(join(lore, 'e2e-change-me.md'), `${body('change me')}One more line.\n`);
      renameSync(join(lore, 'e2e-rename-me.md'), join(lore, 'e2e-renamed.md'));
      git(fixture.root, 'add', '-A');
      git(fixture.root, 'commit', '-m', 'e2e: committed since the mark');
      // Not committed: an edited file and an untracked one.
      writeFileSync(join(lore, 'e2e-edit-uncommitted.md'), `${body('edit uncommitted')}Edited.\n`);
      writeFileSync(join(lore, 'e2e-untracked.md'), body('untracked'));

      await expect
        .poll(() => listed(files), { timeout: 15_000 })
        .toEqual([
          { path: 'e2e-added.md', kind: 'added', state: 'committed' },
          { path: 'e2e-change-me.md', kind: 'changed', state: 'committed' },
          { path: 'e2e-renamed.md', kind: 'renamed', state: 'committed' },
          { path: 'e2e-edit-uncommitted.md', kind: 'changed', state: 'uncommitted' },
          { path: 'e2e-untracked.md', kind: 'added', state: 'uncommitted' },
        ]);
      await expect(
        panel.getByRole('option', { name: /^renamed e2e-renamed\.md from e2e-rename-me\.md/ }),
      ).toBeVisible();
      await expect(panel.getByTestId('root-changes-count')).toHaveText('5 changes');

      // Mark as reviewed: the committed changes clear, the uncommitted stay.
      await expect(mark).toBeEnabled({ timeout: 15_000 });
      await mark.click();
      await expect(panel.getByTestId('root-mark-reviewed-result')).toContainText(
        'Files changed and not committed stay listed: 2.',
        { timeout: 15_000 },
      );
      await expect
        .poll(() => listed(files), { timeout: 15_000 })
        .toEqual([
          { path: 'e2e-edit-uncommitted.md', kind: 'changed', state: 'uncommitted' },
          { path: 'e2e-untracked.md', kind: 'added', state: 'uncommitted' },
        ]);
      await expect(mark).toBeDisabled();
    });
  });
});
