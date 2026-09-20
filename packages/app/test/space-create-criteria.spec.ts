import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// The end-to-end proof of the six "Creating a Space" criteria of section 8 of
// `packages/docs/onboarding-product.md` the phase M12.3 assigns to the fake
// GitHub: 11, 12, 13, 16, 18 and 20. This is a new file (M12.3's amendment):
// `space-setup.spec.ts` is left untouched, since another agent may be working
// in it at the same time. Where a test of that file already brushes past part
// of a criterion, this file covers the criterion completely on its own and
// says so in a comment, rather than assuming the other file's coverage.
//
// The harness is copied from `space-setup.spec.ts`: `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB` route the app's GitHub port and its machine check to
// the fake (`main/space/e2e-machine.ts`), so nothing here reaches live
// GitHub. Every test keeps its fake's state file, its bare repositories, the
// folder a Space is created in and `userData` under one temporary folder,
// removed with the app closed, also when the test fails.

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
 *  (mirrors `machine()` of `packages/core/test/space/setup.int.test.ts`, and
 *  `FINE_MACHINE_LINES` of `space-setup.spec.ts`). */
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

/** The lines that build a fake GitHub with its state file, for scripts run with `runCoreScript`. */
function fakeGitHubLines(stateFile: string, reposDir: string): string[] {
  return [
    "const { createFakeGitHub } = await import('@ai-lore-companion/core/testing');",
    `const fake = createFakeGitHub(${JSON.stringify({ stateFile, reposDir })});`,
  ];
}

/** The lines that create a complete Space directly through `core.createSpace`, against
 *  a fake already bound to `fake`, saving its state to `stateFile` afterwards. */
function createSpaceLines(opts: {
  name: string;
  parentDir: string;
  userData: string;
  stateFile: string;
}): string[] {
  return [
    "const core = await import('@ai-lore-companion/core');",
    ...FINE_MACHINE_LINES,
    'const deps = {',
    '  runner: core.execFileRunner,',
    '  github: fake,',
    `  templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)},`,
    `  userDataDir: ${JSON.stringify(opts.userData)},`,
    '  checkMachine: async () => fineMachine,',
    "  gitConfig: { 'user.name': 'AI-Lore Test', 'user.email': 'test@ai-lore.invalid', 'commit.gpgsign': 'false' },",
    '};',
    `const form = { name: ${JSON.stringify(opts.name)}, description: 'A Space for M12.3.', owner: 'fake-human', parentDir: ${JSON.stringify(opts.parentDir)} };`,
    'const made = await core.createSpace(form, deps);',
    "if (!made.ok) throw new Error('createSpace: ' + made.error.message);",
    `fake.save(${JSON.stringify(opts.stateFile)});`,
  ];
}

/** One entry of the running step list's full history, as the DOM ever showed it. */
type StepLogEntry = { stepId: string; state: string; text: string };

/**
 * Install a `MutationObserver` on the page that records every distinct
 * (step, state, text) triple the running step list (`setup-steps`) ever
 * shows, from the moment it is called. Reading it back after the run (with
 * `readStepLog`) proves what the screen displayed for every step at every
 * point of the run, including a state that lasted only a fraction of a
 * second — the run's disk and git work against the fake and the tiny
 * template can finish very fast, so a single DOM snapshot after the fact
 * cannot be trusted to have caught every state a step passed through (see
 * `space-setup.spec.ts`'s own "best-effort" comment on this). Observing
 * every mutation, instead of polling, removes that race for criterion 16.
 */
async function installStepObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held: { stepId: string; state: string; text: string }[] = [];
    const seen = new Set<string>();
    const record = (): void => {
      for (const li of Array.from(document.querySelectorAll('li[data-testid^="setup-step-"]'))) {
        const span = li.querySelector('[data-testid^="setup-step-state-"]');
        if (span === null) continue;
        const stepId = li.getAttribute('data-testid') ?? '';
        const state = li.getAttribute('data-state') ?? '';
        const text = span.textContent ?? '';
        const key = `${stepId}:${state}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        held.push({ stepId, state, text });
      }
    };
    record();
    new MutationObserver(record).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    (window as unknown as { __stepLog: typeof held }).__stepLog = held;
  });
}

/** Read back what `installStepObserver` recorded. */
async function readStepLog(page: Page): Promise<StepLogEntry[]> {
  return page.evaluate(() => (window as unknown as { __stepLog?: StepLogEntry[] }).__stepLog ?? []);
}

/** Every page of the app that shows `testId`, waited for (mirrors `space-setup.spec.ts`'s
 *  own helper: opening a Space can land on a different window than the setup screen's). */
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

test.describe('Create a Space — acceptance criteria 11, 12, 13, 16, 18, 20 (M12.3)', () => {
  test('the Create form has no internal name and the owner is a drop-down (criterion 11)', async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit11-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);
      runCoreScript([
        ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);
      seedSpacesFolderSetting(userData, parentDir);

      const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('space-welcome-create').click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });

      const ownerField = page.getByTestId('setup-field-owner');
      await expect(ownerField).toHaveValue('fake-human', { timeout: 15_000 });

      // Open every disclosure of the Create form, so every label it can show is on screen.
      await page.getByTestId('setup-add-repositories').click();
      await page.getByTestId('setup-repository-add').click();

      // Criterion 11, clause 1: no label reads one of core's internal field
      // names (the phase file's own list). The Human Lead's rule is that a
      // label matches its internal target one to one in meaning, not that the
      // internal spelling is shown — so this checks the internal spelling is
      // absent, not a fixed list of allowed words.
      const INTERNAL_NAMES = ['parentDir', 'folderName', 'sourceDir', 'repositoryName', 'github'];
      const labels = await page.locator('[data-testid="setup-form"] label').allTextContents();
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        const trimmed = label.trim();
        for (const internal of INTERNAL_NAMES) {
          expect(trimmed).not.toBe(internal);
        }
      }

      // Criterion 11, clause 2: the owner is a drop-down, never a text field,
      // and it lists the signed-in account.
      //
      // Coverage note for the orchestrator: an end-to-end run's machine check
      // (`main/space/e2e-machine.ts`) answers `gh api user/orgs` with an empty
      // list unconditionally (its own header comment: "gh api user/orgs …: no
      // organisations."), regardless of the `organisations` a `FakeGitHub` is
      // built with. So this harness can never put an organisation in the
      // owner drop-down, and the "...and its organisations" half of criterion
      // 11 cannot be exercised end-to-end with the tools this phase allows;
      // only that the account is listed and the field is never a text input.
      expect(await ownerField.evaluate((element) => element.tagName)).toBe('SELECT');
      const optionTexts = await ownerField.locator('option').allTextContents();
      expect(optionTexts).toEqual(['fake-human (you)']);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('typing a name updates the folder, the repository and the Project, and says the folder is new (criterion 12)', async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit12-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);
      runCoreScript([
        ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);
      seedSpacesFolderSetting(userData, parentDir);

      const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('space-welcome-create').click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });

      // The owner default (from the fake account) must be in before the
      // repository line of "What will be created" can be checked, since it
      // is spelled with the owner.
      const ownerField = page.getByTestId('setup-field-owner');
      await expect(ownerField).toHaveValue('fake-human', { timeout: 15_000 });

      const name = 'e2e-criterion12';
      await page.getByTestId('setup-field-name').fill(name);

      const willCreate = page.getByTestId('setup-will-create');
      // The full folder path, and that it says the folder is new.
      await expect(willCreate).toContainText(`Folder: ${join(parentDir, name)} — a new folder.`, {
        timeout: 15_000,
      });
      // The repository, with its visibility, and the Project — both named for `name`.
      await expect(willCreate).toContainText(
        `On GitHub: the private repository fake-human/${name} and a Project named ${name}.`,
      );
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('a complete Space offers Open it; a half-made one also offers Finish setting it up (criterion 13)', async () => {
    test.setTimeout(90_000);

    // The complete case. `space-setup.spec.ts`'s own
    // "a complete Space of the same name is found while typing" already
    // proves this half; it is reproduced here in full (not just referenced)
    // so this file's coverage of criterion 13 does not depend on that file.
    {
      const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit13-complete-')));
      let app: ElectronApplication | undefined;
      try {
        const stateFile = join(temp, 'fake-github.json');
        const parentDir = join(temp, 'spaces');
        const userData = join(temp, 'user-data');
        mkdirSync(parentDir);
        mkdirSync(userData);
        const name = 'e2e-crit13-complete';
        runCoreScript([
          ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
          ...createSpaceLines({ name, parentDir, userData, stateFile }),
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
        await page.getByTestId('setup-field-name').fill(name);

        const openExisting = page.getByTestId('setup-open-existing');
        await expect(openExisting).toBeVisible({ timeout: 15_000 });
        await expect(openExisting).toHaveText('Open it');
        await expect(page.getByTestId('setup-continue')).toHaveCount(0);
      } finally {
        await closeSpaceApp(app);
        rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      }
    }

    // The half-made case: the same shape of Space, but with its corpus entry
    // removed after creation, mirroring
    // `packages/core/test/space/setup.int.test.ts`'s
    // "inspectExistingSpace tells absent, empty, other-content, complete and
    // incomplete apart" (removing `lore/corpus/<name>.md` is what that test
    // uses to turn a complete Space into an incomplete one, without touching
    // GitHub).
    {
      const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit13-halfmade-')));
      let app: ElectronApplication | undefined;
      try {
        const stateFile = join(temp, 'fake-github.json');
        const parentDir = join(temp, 'spaces');
        const userData = join(temp, 'user-data');
        mkdirSync(parentDir);
        mkdirSync(userData);
        const name = 'e2e-crit13-halfmade';
        runCoreScript([
          ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
          ...createSpaceLines({ name, parentDir, userData, stateFile }),
          'console.log(JSON.stringify(true));',
        ]);
        rmSync(join(parentDir, name, 'lore', 'corpus', `${name}.md`));
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
        await page.getByTestId('setup-field-name').fill(name);

        const continueButton = page.getByTestId('setup-continue');
        await expect(continueButton).toBeVisible({ timeout: 15_000 });
        await expect(continueButton).toHaveText('Finish setting it up');
        const openExisting = page.getByTestId('setup-open-existing');
        await expect(openExisting).toBeVisible();
        await expect(openExisting).toHaveText('Open it');
      } finally {
        await closeSpaceApp(app);
        rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  });

  test('while running, no step reads "skipped", and a step found already done reads "Already done" (criterion 16)', async () => {
    test.setTimeout(120_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit16-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);
      const name = 'e2e-crit16-halfmade';
      // A half-made Space (same construction as criterion 13's half-made
      // case): every step but "corpus entry" is already done, so re-running
      // it is guaranteed to both run a step for real and find others already
      // done — the only way to see "Already done" and to prove "skipped"
      // never appears while some steps really are already done.
      runCoreScript([
        ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
        ...createSpaceLines({ name, parentDir, userData, stateFile }),
        'console.log(JSON.stringify(true));',
      ]);
      rmSync(join(parentDir, name, 'lore', 'corpus', `${name}.md`));
      seedSpacesFolderSetting(userData, parentDir);

      const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('space-welcome-create').click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('setup-field-name').fill(name);
      await page.getByTestId('setup-continue').click();

      const plan = page.getByTestId('setup-plan');
      await expect(plan).toBeVisible({ timeout: 30_000 });

      // Install the observer before confirming, so every state the running
      // list ever shows is recorded, however briefly (see `installStepObserver`).
      await installStepObserver(page);
      await page.getByTestId('setup-confirm').click();

      await expect(page.getByTestId('setup-finished')).toBeVisible({ timeout: 90_000 });
      const stepLog = await readStepLog(page);

      expect(stepLog.length).toBeGreaterThan(0);
      // The word "skipped" is never shown, for any step, in any state it passed through.
      for (const entry of stepLog) {
        expect(entry.text.toLowerCase()).not.toContain('skipped');
      }
      // At least one step was found already done, and it read "Already done".
      const alreadyDone = stepLog.filter((entry) => entry.state === 'skipped');
      expect(alreadyDone.length).toBeGreaterThan(0);
      for (const entry of alreadyDone) {
        expect(entry.text).toContain('Already done');
      }
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('typing the name of a complete Space offers Open it and creates nothing (criterion 18)', async () => {
    test.setTimeout(60_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit18-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);
      const name = 'e2e-crit18-complete';
      runCoreScript([
        ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
        ...createSpaceLines({ name, parentDir, userData, stateFile }),
        'console.log(JSON.stringify(true));',
      ]);
      seedSpacesFolderSetting(userData, parentDir);

      const spaceRoot = join(parentDir, name);
      const stateBefore = readFileSync(stateFile, 'utf8');
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: spaceRoot,
        encoding: 'utf8',
      }).trim();

      const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('space-welcome-create').click();
      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('setup-field-name').fill(name);

      // Mismatch with the criterion's literal wording, reported to the
      // orchestrator rather than papered over: criterion 18 as written in
      // section 8 says running Create again with the name of a complete
      // Space "leads to 'already exists and is complete' and Open the
      // Space" (the plan-level result of screen 7, `setup-complete`,
      // reached by asking for and confirming a dry run). What the shipped
      // `SetupForm` (`packages/app/src/renderer/src/space/setup/SetupForm.tsx`)
      // actually does once the folder's local, GitHub-free check
      // (`inspectExistingSpace`) reports it `complete` is unmount the
      // Continue/Create control entirely (`{!complete && (<button
      // type="submit" data-testid="setup-continue">...`) and show only
      // "Open it" (`setup-open-existing`), which opens the Space directly
      // with no confirmation screen and no "already exists and is complete"
      // wording ever shown. There is no control left on this screen to ask
      // for a fresh dry run of an already-complete name, so the plan-level
      // "already exists and is complete" screen (`setup-complete`,
      // `SetupCompleteView`) cannot be reached this way. This is confirmed
      // independently by the pre-existing
      // `packages/app/test/screenshots.spec.ts` test
      // "re-running Create with the name of a complete Space offers to open
      // it", which asserts exactly this: `setup-open-existing` visible,
      // `setup-continue` at `toHaveCount(0)`. This test instead proves the
      // second half of criterion 18 that does hold: nothing is created (or
      // changed) by typing the name of a complete Space again, whichever
      // screen that leads to.
      const openExisting = page.getByTestId('setup-open-existing');
      await expect(openExisting).toBeVisible({ timeout: 15_000 });
      await expect(openExisting).toHaveText('Open it');
      await expect(page.getByTestId('setup-continue')).toHaveCount(0);

      expect(readFileSync(stateFile, 'utf8')).toBe(stateBefore);
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: spaceRoot, encoding: 'utf8' }).trim(),
      ).toBe(headBefore);

      // Nothing changes from opening it, either.
      await openExisting.click();
      await pageShowing(app, 'space-window');
      expect(readFileSync(stateFile, 'utf8')).toBe(stateBefore);
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: spaceRoot, encoding: 'utf8' }).trim(),
      ).toBe(headBefore);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('making a Space from a repository on this Mac leaves the chosen folder unchanged (criterion 20)', async () => {
    test.setTimeout(150_000);
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-crit20-')));
    let app: ElectronApplication | undefined;
    try {
      const stateFile = join(temp, 'fake-github.json');
      const parentDir = join(temp, 'spaces');
      const userData = join(temp, 'user-data');
      mkdirSync(parentDir);
      mkdirSync(userData);

      // A repository already on the fake GitHub (`fake-human/plain-origin`),
      // and a local checkout of it — built the same way
      // `a plain repository opens on the offer to create a Space about it`
      // of `space-setup.spec.ts` builds its fixture
      // (`makePlainRepository`), so this reuses that test's own construction
      // as the phase file asks, plus an `origin` remote pointing at the fake's
      // own bare repository (adopting always reads the checkout's origin;
      // `core`'s `adoptAsCreate` refuses a checkout with none — see
      // `packages/core/test/space/setup.int.test.ts`, "adoptRepository clones
      // fresh…", the `noOrigin` case). That bare repository is a path on
      // disk, not a `github.com` address, so it does not parse as one — this
      // is exactly why the form's "More options" GitHub address exists: to
      // give the real address by hand when origin does not already carry it.
      const { dir } = runCoreScript([
        ...fakeGitHubLines(stateFile, join(temp, 'remotes')),
        "const created = await fake.createRepository({ owner: 'fake-human', name: 'plain-origin', private: true });",
        "if (!created.ok) throw new Error('createRepository: ' + created.error.message);",
        "const { makePlainRepository } = await import('@ai-lore-companion/core/testing');",
        'const repo = await makePlainRepository();',
        "await repo.git('remote', 'add', 'origin', created.value.cloneUrl);",
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify({ dir: repo.dir }));',
      ]) as { dir: string };

      const statusBefore = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();

      const launched = await launchSpaceApp({
        root: dir,
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile },
      });
      app = launched.app;
      const { page } = launched;

      await expect(page.getByTestId('not-a-space')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('not-a-space-folder')).toHaveText(dir);
      await page.getByTestId('not-a-space-create').click();

      await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('setup-source')).toContainText(dir);

      // Location: not prefilled (this window was opened straight on `dir`,
      // never through "Set up this computer"), so it is chosen by hand, the
      // same way `space-setup.spec.ts` answers the machine check's own
      // folder dialog.
      await answerFolderDialog(app, parentDir);
      await page.getByTestId('setup-location-change').click();
      await expect(page.getByTestId('setup-location')).toHaveText(parentDir, { timeout: 15_000 });

      const name = 'e2e-crit20-space';
      await page.getByTestId('setup-field-name').fill(name);
      const ownerField = page.getByTestId('setup-field-owner');
      await expect(ownerField).toHaveValue('fake-human', { timeout: 15_000 });

      // The GitHub address of the repository being adopted, by hand: the
      // local folder's `origin` is the fake's own bare repository, a path on
      // disk rather than a `github.com` address, so it does not parse into
      // one by itself.
      await page.getByTestId('setup-more-options').click();
      await page.getByTestId('setup-field-github').fill('fake-human/plain-origin');

      const willCreate = page.getByTestId('setup-will-create');
      const expectedRepoLine = `The repository is cloned into ${join(parentDir, name)}/repos/plain-origin. The folder you chose, ${dir}, is not changed.`;
      await expect(willCreate).toContainText(expectedRepoLine, { timeout: 15_000 });

      await page.getByTestId('setup-continue').click();
      const plan = page.getByTestId('setup-plan');
      await expect(plan).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-confirm').click();

      await expect(page.getByTestId('setup-finished')).toBeVisible({ timeout: 90_000 });

      // The chosen folder — `dir`, the repository on this Mac the Space was
      // made from — was never written to: its status and its head commit
      // are exactly as they were before the run.
      const statusAfter = execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      expect(statusAfter).toBe(statusBefore);
      expect(headAfter).toBe(headBefore);
    } finally {
      await closeSpaceApp(app);
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
