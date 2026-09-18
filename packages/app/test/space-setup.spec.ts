import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp, withSpaceApp } from './space-fixture';

// Setup, end to end, with detection routing on (phase M3.9): create a Space through the
// screens against core's FakeGitHub; open a plain repository and get the offer to create
// a Space about it; open a fixture Space and get the Space window.
//
// Nothing here reaches live GitHub: the app runs with `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB`, so its GitHub port is the fake and its machine check answers
// `gh` and the engine from the fake (`main/space/e2e-machine.ts`). The fake's state file,
// its bare repositories, the folder the Space is created in and `userData` all live in
// one temporary folder, removed with the app closed also when a test fails. The folder
// dialog is replaced in the app's main process, so no system dialog opens.

const APP_DIR = resolve(process.cwd());

/** Run a module script in a child process with core importable (see `space-fixture.ts`). */
function runCoreScript(lines: string[]): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null');
}

/** Every page of the app that shows `testId`, waited for. */
async function pageShowing(app: ElectronApplication, testId: string): Promise<Page> {
  let found: Page | null = null;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          if (page.isClosed()) continue;
          if (
            (await page
              .getByTestId(testId)
              .count()
              .catch(() => 0)) > 0
          ) {
            found = page;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found as unknown as Page;
}

/** Make `dialog.showOpenDialog` in the app's main process answer `folder`. */
async function answerFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    const answer = async () => ({ canceled: false, filePaths: [chosen] });
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = answer;
  }, folder);
}

type FakeState = {
  account: string | null;
  repositories: { info: { fullName: string; cloneUrl: string } }[];
  projects: {
    info: { title: string };
    fields: { name: string; options: { name: string }[] }[];
    linked: string[];
  }[];
};

test.describe('setup of a Space', () => {
  test('create a Space with the fake GitHub through the screens, and open it', async () => {
    test.setTimeout(150_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);
      runCoreScript([
        "const { createFakeGitHub } = await import('@ai-lore-companion/core/testing');",
        `const fake = createFakeGitHub(${JSON.stringify({ stateFile, reposDir: join(temp, 'remotes') })});`,
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);

      const launched = await launchSpaceApp({
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;

      // The welcome screen, with the machine check ready from the fake.
      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('space-welcome-machine-status')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('space-welcome-create')).toHaveAttribute(
        'aria-disabled',
        'false',
      );
      await page.getByTestId('space-welcome-create').click();

      // The form.
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('setup-field-name').fill('e2e-created');
      await page.getByTestId('setup-field-description').fill('A Space made by the setup test.');
      await page.getByTestId('setup-field-owner').fill('fake-human');
      await answerFolderDialog(app, parentDir);
      await page.getByTestId('setup-field-parentDir').click();
      await expect(page.getByTestId('setup-parent-dir')).toHaveText(parentDir);
      await page.getByTestId('setup-show-plan').click();

      // The plan, with the names it will create.
      const plan = page.getByTestId('setup-plan');
      await expect(plan).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('setup-plan-root')).toHaveText(join(parentDir, 'e2e-created'));
      await expect(page.getByTestId('setup-plan-github-repository')).toContainText(
        'fake-human/e2e-created',
      );
      await expect(page.getByTestId('setup-plan-github-project')).toContainText('e2e-created');
      await expect(page.getByTestId('setup-plan-github-labels')).toBeVisible();
      await expect(page.getByTestId('setup-plan-github-views')).toBeVisible();
      await page.getByTestId('setup-confirm').click();

      // Each step done, then the steps left by hand.
      await expect(page.getByTestId('setup-finished')).toBeVisible({ timeout: 90_000 });
      const rows = page.locator('li[data-testid^="setup-step-"]');
      const count = await rows.count();
      expect(count).toBeGreaterThan(3);
      for (let index = 0; index < count; index += 1) {
        await expect(rows.nth(index)).toHaveAttribute('data-state', 'done');
      }
      await expect(page.getByTestId('setup-by-hand')).toBeVisible();

      // What the fake holds: the repository, pushed to its bare remote, and the Project
      // with its Stage field of five stages, linked to the repository.
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as FakeState;
      const repository = state.repositories.find(
        (entry) => entry.info.fullName === 'fake-human/e2e-created',
      );
      expect(repository).toBeDefined();
      const project = state.projects.find((entry) => entry.info.title === 'e2e-created');
      expect(project?.linked).toContain('fake-human/e2e-created');
      const stage = project?.fields.find((field) => field.name === 'Stage');
      expect(stage?.options.map((option) => option.name)).toEqual([
        'Spec',
        'Plan',
        'Build',
        'Review',
        'Done',
      ]);
      const pushed = execFileSync(
        'git',
        ['--git-dir', repository?.info.cloneUrl ?? '', 'rev-list', '--count', '--all'],
        { encoding: 'utf8' },
      );
      expect(Number(pushed.trim())).toBeGreaterThan(0);

      // Open the Space: the Space window, on the new folder.
      await page.getByTestId('setup-open-space').click();
      const spacePage = await pageShowing(app, 'space-window');
      await expect(spacePage.getByTestId('space-name')).toHaveText('e2e-created');
      await expect(spacePage.getByTestId('space-root')).toHaveText(join(parentDir, 'e2e-created'));
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a plain repository opens on the offer to create a Space about it', async () => {
    const { dir } = runCoreScript([
      "const { makePlainRepository } = await import('@ai-lore-companion/core/testing');",
      'const repo = await makePlainRepository();',
      'console.log(JSON.stringify({ dir: repo.dir }));',
    ]) as { dir: string };
    const userData = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-ud-'));
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({ root: dir, userData });
      app = launched.app;
      const { page } = launched;
      await expect(page.getByTestId('not-a-space')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('not-a-space-folder')).toHaveText(dir);
      const offer = page.getByTestId('not-a-space-create');
      await expect(offer).toHaveText('Create a Space about it');

      // The offer leads to the form of adopting this repository.
      await offer.click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('setup-about-folder')).toContainText(dir);
    } finally {
      await closeSpaceApp(app);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a fixture Space opens in the Space window', async () => {
    await withSpaceApp('e2e-setup-fixture', async ({ page, fixture }) => {
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('space-name')).toHaveText('e2e-setup-fixture');
      await expect(page.getByTestId('space-root')).toHaveText(fixture.root);
    });
  });
});
