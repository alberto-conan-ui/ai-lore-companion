import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// What the Files window remembers, phase M5.7, end to end: open two documents in
// different modes, one with its diff pinned, choose a root and a baseline, move the
// window, restart the app, and see all of it restored. The Space, its repository, the
// fake GitHub's state and `userData` are all in one temporary folder: nothing here
// touches the real project, the real Lore, the real `userData` or GitHub.

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

/** A Space with the repository `app`, and a session close of `s-e2e` on it at its first commit. */
function prepare(temp: string, userData: string, stateFile: string): Prepared {
  return runCoreScript([
    "const core = await import('@ai-lore-companion/core');",
    "const testing = await import('@ai-lore-companion/core/testing');",
    `const fixture = await testing.makeSpaceFixture(${JSON.stringify({
      templateDir: LORE_TEMPLATE_DIR,
      name: 'e2e-remembered',
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

type Rect = { x: number; y: number; width: number; height: number };

/** The bounds of the window whose title ends with ` — Files`. */
async function filesBounds(app: ElectronApplication): Promise<Rect | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().endsWith(' — Files'));
    return win ? win.getBounds() : null;
  });
}

/** Open the Space's Files window from the rail and wait for its roots. */
async function openFiles(app: ElectronApplication, page: Page): Promise<Page> {
  await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
  const opened = app.waitForEvent('window');
  await page.getByTestId('space-rail-files').click();
  const files = await opened;
  await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
  await expect(files.getByTestId('files-root-tab-repo:app')).toBeVisible({ timeout: 15_000 });
  return files;
}

const readJson = (path: string): unknown =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;

test.describe('what the Files window remembers', () => {
  test('documents, modes, a pin, the selected root, a baseline and the window position come back after a restart', async () => {
    test.setTimeout(180_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-remembered-')));
    const userData = join(temp, 'user-data');
    const stateFile = join(temp, 'fake-github.json');
    mkdirSync(userData);
    let app: ElectronApplication | undefined;
    let spaceRoot: string | undefined;
    try {
      const prepared = prepare(temp, userData, stateFile);
      spaceRoot = prepared.root;
      const key = createHash('sha1').update(realpathSync(prepared.root)).digest('hex');
      const ui = join(userData, 'spaces', key, 'ui');
      const env = { AI_LORE_FAKE_GITHUB: stateFile };

      // First run.
      let launched = await launchSpaceApp({ root: prepared.root, userData, env });
      app = launched.app;
      let files = await openFiles(app, launched.page);
      const page = launched.page;

      // A document in Diff, pinned to the session close.
      await page.evaluate(() =>
        window.cockpit.spaceNavigate({
          to: 'space-files',
          open: { rootId: 'repo:app', relPath: 'src/change-me.ts' },
        }),
      );
      await expect(files.getByTestId('files-doc-tab-repo:app-src/change-me.ts')).toBeVisible({
        timeout: 15_000,
      });
      await files.getByTestId('files-editor-mode-diff').click();
      await files.getByTestId('files-diff-pin').click();
      await files
        .getByRole('region', { name: 'Points to pin this diff to' })
        .getByRole('treeitem', { name: /session close/ })
        .first()
        .click();
      const sentence = files.getByTestId('files-diff-against');
      await expect(sentence).toContainText('against session close', { timeout: 15_000 });

      // A second document, markdown, in Preview.
      await page.evaluate(() =>
        window.cockpit.spaceNavigate({
          to: 'space-files',
          open: { rootId: 'repo:app', relPath: 'README.md' },
        }),
      );
      const readme = files.getByTestId('files-doc-tab-repo:app-README.md');
      await expect(readme).toHaveAttribute('data-active', 'true', { timeout: 15_000 });
      await files.getByTestId('files-editor-mode-preview').click();
      await expect(files.getByTestId('files-editor-mode-preview')).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // A baseline for repo:app, through the channel the picker uses.
      const set = await files.evaluate(
        (commit) => window.cockpit.spaceRootSetBaseline({ rootId: 'repo:app', baseline: commit }),
        prepared.baseCommit,
      );
      expect(set.ok).toBe(true);
      expect(await appBaseline(files)).toBe(prepared.baseCommit);

      // The selected root: lore.
      await files.getByTestId('files-root-tab-lore').click();
      await expect(files.getByTestId('files-root-tab-lore')).toHaveAttribute(
        'aria-selected',
        'true',
      );

      // Move the Files window.
      const moved: Rect = { x: 140, y: 120, width: 1000, height: 700 };
      await app.evaluate(({ BrowserWindow }, rect) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().endsWith(' — Files'));
        win?.setBounds(rect);
      }, moved);
      const placed = await filesBounds(app);
      expect(placed).not.toBeNull();

      // Everything is on disk before the restart, one file per concern.
      await expect
        .poll(() => readJson(join(ui, 'baselines.json')), { timeout: 10_000 })
        .toEqual({ version: 1, roots: { 'repo:app': prepared.baseCommit } });
      await expect
        .poll(() => readJson(join(ui, 'selected-root.json')), { timeout: 10_000 })
        .toEqual({ version: 1, rootId: 'lore' });
      await expect
        .poll(
          () => {
            const editor = readJson(join(ui, 'files-editor.json')) as {
              docs?: { path: string; mode: string; pin: { kind: string } | null }[];
            } | null;
            return editor?.docs?.map((doc) => [doc.path, doc.mode, doc.pin?.kind ?? null]) ?? null;
          },
          { timeout: 10_000 },
        )
        .toEqual([
          ['src/change-me.ts', 'diff', 'session-close'],
          ['README.md', 'preview', null],
        ]);
      await expect
        .poll(() => readJson(join(ui, 'files-window.json')), { timeout: 10_000 })
        .toEqual({ version: 1, ...placed });

      // Restart.
      await closeSpaceApp(app);
      launched = await launchSpaceApp({ root: prepared.root, userData, env });
      app = launched.app;
      files = await openFiles(app, launched.page);

      // The selected root.
      await expect(files.getByTestId('files-root-tab-lore')).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 15_000 },
      );
      // The baseline.
      await expect.poll(() => appBaseline(files), { timeout: 15_000 }).toBe(prepared.baseCommit);
      // The documents, the active one, their modes and the pin.
      await expect(files.getByTestId('files-doc-tab-repo:app-README.md')).toHaveAttribute(
        'data-active',
        'true',
        { timeout: 15_000 },
      );
      await expect(files.getByTestId('files-editor-mode-preview')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await files.getByTestId('files-doc-tab-repo:app-src/change-me.ts').click();
      await expect(files.getByTestId('files-editor-mode-diff')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(files.getByTestId('files-diff-against')).toContainText('against session close', {
        timeout: 15_000,
      });
      // The window's position.
      expect(await filesBounds(app)).toEqual(placed);
      // Nothing was dropped, so no notice.
      await expect(files.getByTestId('files-memory-notices')).toHaveCount(0);
    } finally {
      await closeSpaceApp(app);
      if (spaceRoot)
        rmSync(resolve(spaceRoot, '..'), { recursive: true, force: true, maxRetries: 3 });
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
