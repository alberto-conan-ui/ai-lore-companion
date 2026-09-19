import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp, withSpaceApp } from './space-fixture';

// Setup, end to end, with detection routing on (phase M3.9): from a launch with no Spaces
// folder set, through Set up this computer, create a Space through the screens against
// core's FakeGitHub, and open it on the Dashboard; open a plain repository and get the
// offer to create a Space about it; open a fixture Space and get the Space window.
//
// Nothing here reaches live GitHub: the app runs with `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB`, so its GitHub port is the fake and its machine check answers
// `gh` and the engine from the fake (`main/space/e2e-machine.ts`). The fake's state file,
// its bare repositories, the folder the Space is created in and `userData` all live in
// one temporary folder, removed with the app closed also when a test fails. The folder
// dialog is replaced in the app's main process, so no system dialog opens.

const APP_DIR = resolve(process.cwd());
const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');

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

/** Seed `<userData>/settings.json` with the Spaces folder already set, so the launch
 *  finds Set up this computer ready and opens straight on the welcome screen. */
function seedSpacesFolderSetting(userData: string, folder: string): void {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, values: { 'spaces.folder': folder }, ignores: [] }),
  );
}

/** A fake machine report with everything fine, for a direct `core.createSpace` run
 *  (mirrors `machine()` of `packages/core/test/space/setup.int.test.ts`). */
const FINE_MACHINE_LINES = [
  'const fineMachine = {',
  '  ready: true,',
  '  engines: [],',
  '  requirements: [',
  "    { id: 'git', binary: 'git', state: { kind: 'fine', version: '1.0' }, guidance: null, command: null },",
  "    { id: 'gh', binary: 'gh', state: { kind: 'fine', version: '1.0' }, guidance: null, command: null },",
  "    { id: 'engine', binary: 'claude', state: { kind: 'fine', version: '1.0' }, guidance: null, command: null },",
  "    { id: 'python3', binary: 'python3', state: { kind: 'fine', version: '1.0' }, guidance: null, command: null },",
  '  ],',
  '  github: { account: null, organisations: [] },',
  '  tools: { brew: true, npm: true },',
  '};',
];

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

      // No Spaces folder is set yet: the launch moves to Set up this computer.
      await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
      await answerFolderDialog(app, parentDir);
      await page.getByTestId('machine-spaces-folder-choose').click();
      await expect(page.getByTestId('machine-check-overall')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30_000 },
      );
      await page.getByTestId('machine-check-continue').click();

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

      // The form: plain labels, the owner is a drop-down (never a text field), and the
      // Location is prefilled from the Spaces folder just set.
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('setup-field-name').fill('e2e-created');
      await page.getByTestId('setup-field-description').fill('A Space made by the setup test.');
      const ownerField = page.getByTestId('setup-field-owner');
      await expect(ownerField).toHaveValue('fake-human', { timeout: 15_000 });
      expect(await ownerField.evaluate((el) => el.tagName)).toBe('SELECT');
      await expect(page.getByTestId('setup-location')).toHaveText(parentDir);

      // The live "What will be created" block.
      const willCreate = page.getByTestId('setup-will-create');
      await expect(willCreate).toContainText(join(parentDir, 'e2e-created'));
      await expect(willCreate).toContainText('a new folder.');
      await page.getByTestId('setup-continue').click();

      // Checking before anything is created, then the confirmation. Against the fake,
      // the checks can resolve within a single tick, so the checking screen with the
      // repository check is caught only best-effort; the confirmation is the hard wait.
      try {
        await expect(page.getByTestId('setup-check-repository')).toBeVisible({ timeout: 500 });
      } catch {
        // Too fast to observe mid-flight: the checks already finished.
      }
      const plan = page.getByTestId('setup-plan');
      await expect(plan).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('setup-confirm-question')).toHaveText(
        'Create the Space e2e-created?',
      );
      await page.getByTestId('setup-confirm').click();

      // While running: no step ever reads the raw word "skipped" ("Already done" replaces
      // it, M9.9). The run does real disk and git work, but against the fake and a tiny
      // template it can still finish before this is observed, so catching the running
      // screen at all is best-effort; the result screen below is the hard wait. Only the
      // "did we catch it" wait is inside the try — the "skipped" assertion always runs
      // once rows are caught, so a real regression is never swallowed as "too fast".
      const rows = page.locator('li[data-testid^="setup-step-"]');
      let sawRunningRows = false;
      try {
        await expect(rows.first()).toBeVisible({ timeout: 2_000 });
        sawRunningRows = true;
      } catch {
        // Too fast to observe the running screen mid-flight.
      }
      if (sawRunningRows) {
        for (const text of await rows.allTextContents()) {
          expect(text.toLowerCase()).not.toContain('skipped');
        }
      }

      // The result: the Space is ready, with the three GitHub view settings by hand.
      const finished = page.getByTestId('setup-finished');
      await expect(finished).toBeVisible({ timeout: 90_000 });
      await expect(finished).toContainText('The Space e2e-created is ready.');
      const byHand = page.getByTestId('setup-by-hand');
      await expect(byHand).toBeVisible();
      await expect(byHand.getByRole('button', { name: 'Open this view' })).toHaveCount(3);

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

      // Open the Space: it opens on the Dashboard, ready to start a Claude Code session.
      await page.getByTestId('setup-open-space').click();
      const spacePage = await pageShowing(app, 'space-window');
      await expect(spacePage.getByTestId('space-name')).toHaveText('e2e-created');
      await expect(spacePage.getByTestId('space-root')).toHaveText(join(parentDir, 'e2e-created'));
      await expect(spacePage.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
      await expect(spacePage.getByTestId('dashboard-start-session')).toHaveText(
        'Start a Claude Code session',
        { timeout: 15_000 },
      );
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a second launch with the Spaces folder set opens the welcome screen', async () => {
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
      seedSpacesFolderSetting(userData, parentDir);

      const launched = await launchSpaceApp({
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('machine-check')).toHaveCount(0);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a complete Space of the same name is found while typing', async () => {
    test.setTimeout(60_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);

      // A real, complete Space made directly through core's `createSpace` (the same
      // steps the screens drive), so the form's local check finds it complete.
      runCoreScript([
        "const core = await import('@ai-lore-companion/core');",
        "const testing = await import('@ai-lore-companion/core/testing');",
        `const fake = testing.createFakeGitHub(${JSON.stringify({ stateFile, reposDir: join(temp, 'remotes') })});`,
        ...FINE_MACHINE_LINES,
        'const deps = {',
        '  runner: core.execFileRunner,',
        '  github: fake,',
        `  templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)},`,
        `  userDataDir: ${JSON.stringify(userData)},`,
        '  checkMachine: async () => fineMachine,',
        "  gitConfig: { 'user.name': 'AI-Lore Test', 'user.email': 'test@ai-lore.invalid', 'commit.gpgsign': 'false' },",
        '};',
        `const form = { name: 'e2e-existing', description: 'A Space for the existing-Space test.', owner: 'fake-human', parentDir: ${JSON.stringify(parentDir)} };`,
        'const made = await core.createSpace(form, deps);',
        "if (!made.ok) throw new Error('createSpace: ' + made.error.message);",
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);
      seedSpacesFolderSetting(userData, parentDir);

      const launched = await launchSpaceApp({
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('space-welcome-create').click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('setup-field-name').fill('e2e-existing');

      await expect(page.getByTestId('setup-open-existing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('setup-continue')).toHaveCount(0);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('Set up this computer with GitHub signed out', async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const userData = join(temp, 'user-data');
      mkdirSync(userData);
      runCoreScript([
        "const { createFakeGitHub } = await import('@ai-lore-companion/core/testing');",
        `const fake = createFakeGitHub(${JSON.stringify({ stateFile, reposDir: join(temp, 'remotes') })});`,
        'fake.signOut();',
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);

      const launched = await launchSpaceApp({
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
      const row = page.getByTestId('machine-row-github');
      await expect(row).toContainText('Sign in with GitHub');
      await expect(row).toContainText(
        'Runs: gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git',
      );
      // Do not click it: this test only checks what the row shows before a command runs.
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
      await expect(page.getByTestId('setup-source')).toContainText(dir);
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
