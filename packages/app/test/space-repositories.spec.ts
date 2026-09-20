import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Locator, expect, test } from '@playwright/test';
import type { Page } from 'playwright';
import { withSpaceApp } from './space-fixture';

// The Repositories section of the Dashboard, end to end (stage D1, phase D1.5), against the
// fixture Space's own repository under `repos/app` (D1.2's `withSpaceApp` third argument).
// Section 7's `D1.5` entry of `packages/docs/dashboard-repositories-architecture.md` is the
// specification; the exact sentences come from section 6.3. Every git command below runs
// against the fixture's own folders and a temporary second clone, never this repository.
//
// The fixture repository (`makeSpaceFixture`'s `makeRepository`) is a clone of a bare
// remote that received one commit (`baseCommit`), then given a second commit
// (`headCommit`) that was never pushed, plus three uncommitted entries (one added, one
// changed, one deleted). So before this test changes anything it is on `main`, tracking
// `origin/main`, ahead 1 and behind 0, with 3 uncommitted changes and no `FETCH_HEAD` (a
// fresh clone never fetched). Confirmed against `packages/core/src/space/testing/space-
// fixture.ts` rather than assumed.
//
// There is no repository-specific "Refresh" control on the Dashboard (D1.4 wired only a
// 60 second timer, a window-focus read and a 500 ms debounced file-event re-emit that does
// not re-run the repository read). A synthetic `focus` DOM event is dispatched instead,
// which is the real mechanism `useRepositoriesState` listens to
// (`window.addEventListener('focus', …)` calling `spaceRepositoriesFocus`).

function gitOutput(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args],
    { encoding: 'utf8' },
  ).trim();
}

function git(dir: string, ...args: string[]): void {
  gitOutput(dir, ...args);
}

async function focusWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

function repositoryRow(page: Page): Locator {
  return page.locator('[data-testid="repository-row"][data-root-id="repo:app"]');
}

test.describe('the Repositories section', () => {
  test('shows the fixture repository end to end: initial state, ahead and behind after a fetch, an upstream that was deleted, first paint before any row, and opening the Files window', async () => {
    test.setTimeout(120_000);
    await withSpaceApp(
      'e2e-repositories',
      async ({ app, page, fixture }) => {
        // First paint: the Dashboard's own state line is on screen while no repository row
        // has appeared yet. This is the stage's gate condition that the Dashboard never
        // waits on a git read (architecture document, section 5.1). The Repositories
        // component answers its first `spaceRepositoriesState` call with `model: null`
        // before any git command has finished, so this window is not a fluke of scheduling.
        await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('space-rail-dashboard').click();
        await expect(page.getByTestId('dashboard')).toBeVisible();
        await expect(page.getByTestId('dashboard-state')).toBeVisible();
        await expect(page.getByTestId('repository-row')).toHaveCount(0);

        const row = repositoryRow(page);

        // 1. The fixture repository's initial state.
        await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
        await expect(row).toHaveAttribute('data-kind', 'repository');
        await expect(row.getByTestId('repository-row-branch')).toHaveText('On the branch main.');
        await expect(row.getByTestId('repository-row-uncommitted')).toHaveText(
          '3 uncommitted changes.',
        );
        await expect(row.getByTestId('repository-row-remote')).toHaveText(
          '1 commit ahead of origin/main. Read from what this repository already knows; ' +
            'there is no record of a fetch in it.',
        );

        // 2. Clone the bare remote a second time, commit and push there, then fetch back
        // into the fixture repository: the row shows both ahead and behind, and that it
        // fetched just now. The bare remote's address is read from the checkout's own git
        // configuration rather than assumed, since `withSpaceApp`'s fixture does not expose
        // the remote's path, only the Space's root and the repository's name.
        const checkoutDir = join(fixture.root, 'repos', 'app');
        const remoteUrl = gitOutput(checkoutDir, 'remote', 'get-url', 'origin');
        const secondClone = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-repositories-clone-'));
        try {
          execFileSync('git', ['clone', '--quiet', remoteUrl, secondClone], { encoding: 'utf8' });
          writeFileSync(join(secondClone, 'from-second-clone.md'), '# From the second clone\n');
          git(secondClone, 'add', '-A');
          git(secondClone, 'commit', '--quiet', '-m', 'A commit pushed from a second clone');
          git(secondClone, 'push', '--quiet', 'origin', 'main');
        } finally {
          rmSync(secondClone, { recursive: true, force: true, maxRetries: 3 });
        }
        git(checkoutDir, 'fetch', '--quiet', 'origin');

        await focusWindow(page);
        await expect(row.getByTestId('repository-row-remote')).toHaveText(
          '1 commit ahead of and 1 commit behind origin/main. Read from what this repository ' +
            'already knows; it last fetched less than a minute ago.',
          { timeout: 30_000 },
        );

        // 3. Delete the tracking ref: the row shows the upstream-missing sentence and no
        // number.
        git(checkoutDir, 'update-ref', '-d', 'refs/remotes/origin/main');
        await focusWindow(page);
        const remoteLine = row.getByTestId('repository-row-remote');
        await expect(remoteLine).toHaveText(
          'Ahead and behind are not known: the tracking branch origin/main is not in this ' +
            'repository. It has not been fetched, or it was deleted on the remote.',
          { timeout: 30_000 },
        );
        await expect(remoteLine).not.toContainText(/\d/);

        // 5. Clicking the row's name opens the Files window on that root.
        const opened = app.waitForEvent('window');
        await row.getByTestId('repository-row-name').click();
        const files = await opened;
        await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
        await expect(files.getByTestId('files-root-tab-repo:app')).toHaveAttribute(
          'aria-selected',
          'true',
          { timeout: 15_000 },
        );
      },
      { repositories: ['app'] },
    );
  });
});
