import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// The editor of the Files window, phase M5.5, end to end: a diff pinned to a session
// close and one pinned to a merged pull request from the fake GitHub, the root's
// baseline unchanged after each. The Space, its repository, the fake GitHub's state
// and `userData` are all in one temporary folder: nothing here touches the real
// project, the real Lore, the real `userData` or GitHub.

const APP_DIR = resolve(process.cwd());
const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');

/** Run an ES-module script against core in a child process, as `space-fixture.ts` explains. */
function runCoreScript(lines: string[]): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null');
}

type Prepared = { root: string; baseCommit: string; headCommit: string };

/**
 * A Space with the repository `app` (`fake-human/app`), a fake GitHub that knows the
 * repository and one merged pull request whose merge commit is the repository's first
 * commit, and a session close of `s-e2e` on the same root at that commit, written in
 * the desk under the test's `userData`.
 */
function prepare(temp: string, userData: string, stateFile: string): Prepared {
  return runCoreScript([
    "const core = await import('@ai-lore-companion/core');",
    "const testing = await import('@ai-lore-companion/core/testing');",
    `const fixture = await testing.makeSpaceFixture(${JSON.stringify({
      templateDir: LORE_TEMPLATE_DIR,
      name: 'e2e-editor',
      owner: 'fake-human',
      repositories: ['app'],
    })});`,
    'const repo = fixture.repositories[0];',
    `const fake = testing.createFakeGitHub(${JSON.stringify({
      stateFile,
      reposDir: join(temp, 'remotes'),
    })});`,
    "const created = await fake.createRepository({ owner: 'fake-human', name: 'app', private: true });",
    "if (!created.ok) throw new Error('the fake did not create the repository');",
    "fake.addMergedPullRequest('fake-human/app', { number: 7, title: 'Add the first files', url: 'https://github.com/fake-human/app/pull/7', mergedAt: '2026-09-17T10:00:00Z', mergeCommit: repo.baseCommit, headBranch: 'first-files', baseBranch: 'main' });",
    `fake.save(${JSON.stringify(stateFile)});`,
    `const desk = core.openDesk(core.deskPaths(${JSON.stringify(userData)}, fixture.root));`,
    "if (!desk.ok) throw new Error('the desk did not open');",
    "const closed = core.recordSessionClose(desk.value, { rootId: 'repo:app', commit: repo.baseCommit, sessionId: 's-e2e' });",
    "if (!closed.ok) throw new Error('the session close was not recorded');",
    'core.closeDesk(desk.value);',
    'console.log(JSON.stringify({ root: fixture.root, baseCommit: repo.baseCommit, headCommit: repo.headCommit }));',
  ]) as Prepared;
}

/** The root `repo:app`'s baseline as main holds it. */
async function appBaseline(files: Page): Promise<string> {
  const list = await files.evaluate(() => window.cockpit.spaceRootsList({}));
  if (!list.ok) throw new Error(list.error.message);
  const app = list.value.roots.find((summary) => summary.root.id === 'repo:app');
  if (!app) throw new Error('no root repo:app');
  return app.baseline;
}

test.describe('the editor of the Files window', () => {
  test('a diff pinned to a session close, then to a merged pull request; the root baseline does not move', async () => {
    test.setTimeout(120_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-editor-')));
    const userData = join(temp, 'user-data');
    const stateFile = join(temp, 'fake-github.json');
    mkdirSync(userData);
    let app: ElectronApplication | undefined;
    let spaceRoot: string | undefined;
    try {
      const prepared = prepare(temp, userData, stateFile);
      spaceRoot = prepared.root;
      const launched = await launchSpaceApp({
        root: prepared.root,
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });

      const opened = app.waitForEvent('window');
      await page.getByTestId('space-rail-files').click();
      const files = await opened;
      await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
      await expect(files.getByTestId('files-root-tab-repo:app')).toBeVisible({ timeout: 15_000 });

      // A file the second commit changed: open it, then show its diff.
      await page.evaluate(() =>
        window.cockpit.spaceNavigate({
          to: 'space-files',
          open: { rootId: 'repo:app', relPath: 'src/change-me.ts' },
        }),
      );
      await expect(files.getByTestId('files-doc-tab-repo:app-src/change-me.ts')).toBeVisible({
        timeout: 15_000,
      });
      const before = await appBaseline(files);
      await files.getByTestId('files-editor-mode-diff').click();
      const sentence = files.getByTestId('files-diff-against');
      await expect(sentence).toContainText(
        "src/change-me.ts: the working tree against the root's baseline",
      );

      // Pin to the session close.
      await files.getByTestId('files-diff-pin').click();
      const panel = files.getByRole('region', { name: 'Points to pin this diff to' });
      await panel
        .getByRole('treeitem', { name: /session close/ })
        .first()
        .click();
      await expect(sentence).toContainText('against session close', { timeout: 15_000 });
      await expect(sentence).toContainText(`(${prepared.baseCommit.slice(0, 7)})`);
      await expect(sentence).toContainText('pinned for this document only');
      await expect(files.getByTestId('files-diff-host')).toHaveAttribute('data-shown', 'diff', {
        timeout: 15_000,
      });
      expect(await appBaseline(files)).toBe(before);

      // Pin to the merged pull request from the fake GitHub.
      await files.getByTestId('files-diff-pin').click();
      await panel
        .getByRole('treeitem', { name: /merged pull request #7 Add the first files/ })
        .click();
      await expect(sentence).toContainText(
        `against merged pull request #7 Add the first files (${prepared.baseCommit.slice(0, 7)})`,
        { timeout: 15_000 },
      );
      await expect(files.getByTestId('files-diff-host')).toHaveAttribute('data-shown', 'diff', {
        timeout: 15_000,
      });
      expect(await appBaseline(files)).toBe(before);

      // Unpinned, the diff is against the root's baseline again.
      await files.getByTestId('files-diff-unpin').click();
      await expect(sentence).toContainText("against the root's baseline");
      expect(await appBaseline(files)).toBe(before);
    } finally {
      await closeSpaceApp(app);
      if (spaceRoot)
        rmSync(resolve(spaceRoot, '..'), { recursive: true, force: true, maxRetries: 3 });
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
