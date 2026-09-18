import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// Migration from v0.8, end to end, with detection routing on (phase M6.6): open a v0.8
// fixture folder, get the migration screen, fill the fields, see the plan, confirm, watch
// every step and issue, see the verification pass, open the Space; then open the v0.8
// folder again, migrate a second time, and see that nothing new is created. A v0.7
// folder gets the migration screen that says to upgrade to v0.8 first.
//
// Nothing here reaches live GitHub or the real project: the v0.8 project is core's
// `makeV08Fixture`, built in a child process (see `space-fixture.ts`), with its payload's
// origin a bare repository in its temporary folder. The app runs with `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB`, so its GitHub port is core's fake, whose bare repositories are
// in the test's temporary folder too. The folder dialog is replaced in the app's main
// process, so no system dialog opens.

const APP_DIR = resolve(process.cwd());
const OWNER = 'fake-human';
const PAYLOAD = `${OWNER}/fixture-project`;
const SPACE = 'fixture-project-space';
const DESCRIPTION = 'The fixture project, migrated by the end-to-end test.';

/** Run a module script in a child process with core importable (see `space-fixture.ts`). */
function runCoreScript(lines: string[]): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null');
}

/** Build a v0.8 fixture project (or the older variant) and return its folders. */
function makeV08(coreVersion = '0.8'): { root: string; memoryPath: string } {
  return runCoreScript([
    "const { makeV08Fixture } = await import('@ai-lore-companion/core/testing');",
    `const fixture = await makeV08Fixture(${JSON.stringify({ coreVersion })});`,
    'console.log(JSON.stringify({ root: fixture.root, memoryPath: fixture.memoryPath }));',
  ]) as { root: string; memoryPath: string };
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

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['--no-optional-locks', ...args], { cwd: dir, encoding: 'utf8' });
}

/** The source's whole tree (`.git` folders included, times left out) and both repositories' head and status. */
function sourceState(root: string, memoryPath: string): string[] {
  const hash = createHash('sha256');
  const visit = (path: string, rel: string): void => {
    for (const name of readdirSync(path).sort()) {
      const abs = join(path, name);
      const info = lstatSync(abs);
      hash.update(`${rel}/${name}\0${info.mode}\0${info.size}\0`);
      if (info.isSymbolicLink()) hash.update(readlinkSync(abs));
      else if (info.isDirectory()) visit(abs, `${rel}/${name}`);
      else hash.update(readFileSync(abs));
    }
  };
  visit(root, '');
  const state = [hash.digest('hex')];
  for (const dir of [root, memoryPath]) {
    state.push(git(dir, ['rev-parse', 'HEAD']), git(dir, ['status', '--porcelain']));
  }
  return state;
}

type FakeState = {
  repositories: { info: { fullName: string; cloneUrl: string } }[];
  projects: { info: { title: string }; items: unknown[] }[];
  issues: { ref: { repository: string; number: number }; body: string }[];
};

function readFake(stateFile: string): FakeState {
  return JSON.parse(readFileSync(stateFile, 'utf8')) as FakeState;
}

function counts(state: FakeState): Record<string, number> {
  return {
    repositories: state.repositories.length,
    projects: state.projects.length,
    issues: state.issues.length,
    items: state.projects.reduce((sum, project) => sum + project.items.length, 0),
  };
}

/** On the migration screen: choose the folder, fill the fields, make the plan again. */
async function fillAndPlan(app: ElectronApplication, page: Page, parentDir: string) {
  await expect(page.getByTestId('migration-flow')).toBeVisible({ timeout: 15_000 });
  // The screen plans by itself when it opens.
  await expect(page.getByTestId('migration-mapping')).toBeVisible({ timeout: 60_000 });
  await answerFolderDialog(app, parentDir);
  await page.getByTestId('migration-field-parentDir').click();
  await expect(page.getByTestId('migration-parent-dir')).toHaveText(parentDir);
  await page.getByTestId('migration-field-name').fill(SPACE);
  await page.getByTestId('migration-field-owner').fill(OWNER);
  await page.getByTestId('migration-field-description').fill(DESCRIPTION);
  await page.getByTestId('migration-field-payloadGitHub').fill(PAYLOAD);
  await expect(page.getByTestId('migration-plan-changed')).toBeVisible();
  await expect(page.getByTestId('migration-confirm')).toBeDisabled();
  await page.getByTestId('migration-make-plan').click();
  await expect(page.getByTestId('migration-plan-changed')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('migration-confirm')).toBeEnabled({ timeout: 60_000 });
}

test.describe('migration from v0.8', () => {
  test('migrate a v0.8 fixture through the screen, open the Space, and a second run creates nothing', async () => {
    test.setTimeout(420_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-migration-')));
    const source = makeV08();
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
      const before = sourceState(source.root, source.memoryPath);
      const env = { AI_LORE_FAKE_GITHUB: stateFile };

      // Opening the v0.8 folder shows the migration screen, not the Space window.
      let launched = await launchSpaceApp({ root: source.root, userData, env });
      app = launched.app;
      let page = launched.page;
      await expect(page.getByTestId('migration')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('migration-folder')).toHaveText(source.root);
      await fillAndPlan(app, page, parentDir);

      // The plan: what goes where, before anything is created.
      await expect(page.getByTestId('migration-plan-root')).toHaveText(join(parentDir, SPACE));
      await expect(page.getByTestId('migration-plan-repository')).toHaveText(`${OWNER}/${SPACE}`);
      await expect(page.getByTestId('migration-source-name')).toHaveText('fixture-project');
      await expect(page.getByTestId('migration-source-version')).toHaveText('0.8');
      for (const row of ['archive', 'contracts', 'mirror', 'in-progress-focus', 'backlog']) {
        await expect(page.getByTestId(`migration-mapping-${row}`)).toBeVisible();
      }
      expect(
        Number(await page.getByTestId('migration-mapping-count-archive').innerText()),
      ).toBeGreaterThan(0);
      await expect(page.getByTestId('migration-not-carried')).toBeVisible();
      await expect(page.getByTestId('migration-plan-step-verify')).toBeVisible();
      expect(readFake(stateFile).repositories).toHaveLength(0);

      // Confirm, and watch every step and every issue.
      await page.getByTestId('migration-confirm').click();
      await expect(page.getByTestId('migration-progress')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('migration-finished')).toBeVisible({ timeout: 300_000 });
      await expect(page.getByTestId('migration-run-error')).toHaveCount(0);
      const steps = page.locator('li[data-testid^="migration-step-"]');
      expect(await steps.count()).toBe(13);
      for (let index = 0; index < 13; index += 1) {
        await expect(steps.nth(index)).toHaveAttribute('data-state', 'done');
      }
      await expect(page.getByTestId('migration-step-state-verify')).toContainText('done');
      const issues = page.locator('li[data-testid^="migration-issue-"]');
      const issueCount = await issues.count();
      expect(issueCount).toBeGreaterThan(0);
      for (let index = 0; index < issueCount; index += 1) {
        await expect(page.getByTestId(`migration-issue-${index}`)).toHaveAttribute(
          'data-state',
          'completed',
        );
      }
      await expect(page.getByTestId('migration-verification')).toHaveAttribute(
        'data-passed',
        'true',
      );

      // What the fake holds: the Space repository and its Project, and one issue per planned one.
      const first = readFake(stateFile);
      expect(first.repositories.map((r) => r.info.fullName)).toContain(`${OWNER}/${SPACE}`);
      expect(first.projects.map((p) => p.info.title)).toContain(SPACE);
      expect(first.issues).toHaveLength(issueCount);
      // The v0.8 folder and both of its repositories are exactly as they were.
      expect(sourceState(source.root, source.memoryPath)).toEqual(before);

      // Open the Space: the Space window, on the new folder.
      await page.getByTestId('migration-open-space').click();
      const spacePage = await pageShowing(app, 'space-window');
      await expect(spacePage.getByTestId('space-name')).toHaveText(SPACE);
      await expect(spacePage.getByTestId('space-root')).toHaveText(join(parentDir, SPACE));
      await closeSpaceApp(app);

      // A second run from the screen: every step is found done, the verification runs
      // again and passes, and nothing new is made on GitHub.
      launched = await launchSpaceApp({ root: source.root, userData, env });
      app = launched.app;
      page = launched.page;
      await expect(page.getByTestId('migration')).toBeVisible({ timeout: 20_000 });
      await fillAndPlan(app, page, parentDir);
      await expect(page.getByTestId('migration-refusals')).toHaveCount(0);
      await page.getByTestId('migration-confirm').click();
      await expect(page.getByTestId('migration-finished')).toBeVisible({ timeout: 120_000 });
      const again = page.locator('li[data-testid^="migration-step-"]');
      expect(await again.count()).toBe(13);
      for (let index = 0; index < 12; index += 1) {
        await expect(again.nth(index)).toHaveAttribute('data-state', 'skipped');
      }
      await expect(page.getByTestId('migration-step-verify')).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('migration-verification')).toHaveAttribute(
        'data-passed',
        'true',
      );
      expect(counts(readFake(stateFile))).toEqual(counts(first));
      expect(sourceState(source.root, source.memoryPath)).toEqual(before);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      rmSync(dirname(source.root), { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a v0.7 project gets the migration screen that says to upgrade to v0.8 first', async () => {
    const source = makeV08('0.7');
    const userData = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-migration-ud-'));
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({ root: source.root, userData });
      app = launched.app;
      const { page } = launched;
      await expect(page.getByTestId('migration')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('migration-upgrade-first')).toContainText('0.8');
      await expect(page.getByTestId('migration-flow')).toHaveCount(0);
      await expect(page.getByTestId('migration-confirm')).toHaveCount(0);
    } finally {
      await closeSpaceApp(app);
      rmSync(dirname(source.root), { recursive: true, force: true, maxRetries: 3 });
      rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
