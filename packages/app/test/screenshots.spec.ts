import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// M9.11 — screenshots of the onboarding and first-session flow, for the phase report only.
// This spec touches nothing the normal suite depends on: it is entirely gated on
// `AI_LORE_SCREENSHOTS=1` and skips at once otherwise, so `npm run e2e` is unchanged.
// Like every other spec here, it drives the app against core's fake GitHub and the
// end-to-end fake machine (`AI_LORE_FAKE_GITHUB`, `COCKPIT_E2E=1`); nothing reaches live
// GitHub, and no real install or sign-in command is run.

test.skip(
  process.env.AI_LORE_SCREENSHOTS !== '1',
  'screenshots are only taken on request (AI_LORE_SCREENSHOTS=1)',
);

const APP_DIR = resolve(process.cwd());
const SCREENS_DIR = resolve(APP_DIR, '../../.test-runs/m9-11/screens');
mkdirSync(SCREENS_DIR, { recursive: true });

let shotIndex = 0;

/** Save a full-page screenshot, numbered in flow order. */
async function shot(page: Page, name: string): Promise<void> {
  shotIndex += 1;
  const numbered = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(SCREENS_DIR, numbered), fullPage: true });
}

/** Run a module script in a child process with core importable (see `space-fixture.ts`). */
function runCoreScript(lines: string[]): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null');
}

async function answerFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    const answer = async () => ({ canceled: false, filePaths: [chosen] });
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = answer;
  }, folder);
}

function seedSpacesFolderSetting(userData: string, folder: string): void {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, values: { 'spaces.folder': folder }, ignores: [] }),
  );
}

/** Best-effort screenshot of a transient screen: takes it when caught, does nothing (and
 *  does not fail the test) when the app has already moved past it. */
async function tryShot(page: Page, testId: string, name: string): Promise<void> {
  try {
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 1_500 });
    await shot(page, name);
  } catch {
    // Too fast to observe: not every run of this flow lingers on this screen.
  }
}

test('the onboarding and first-session flow, screen by screen', async () => {
  test.setTimeout(180_000);
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-screens-')));
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

    const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
    app = launched.app;
    const page = launched.page;

    // Set up this computer: opened at once because the Spaces folder is not set. Open
    // the GitHub and AI engines sections (collapsed when fine) so the fine GitHub row
    // and a not-installed engine (Codex CLI, never installed in an end-to-end run) show.
    await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('machine-section-tools')).toBeVisible({ timeout: 15_000 });
    for (const section of ['github', 'engines']) {
      const toggle = page.getByTestId(`machine-section-${section}-toggle`);
      if ((await toggle.count()) > 0) await toggle.click();
    }
    await expect(page.getByTestId('machine-row-github')).toBeVisible();
    await expect(page.getByTestId('machine-row-engine-default.codex')).toBeVisible();
    await shot(page, 'set-up-this-computer');

    // Welcome, not ready: back from Set up this computer before the Spaces folder is set.
    await page.getByTestId('machine-check-back').click();
    await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('space-welcome-machine-status')).toHaveAttribute(
      'data-ready',
      'false',
    );
    await shot(page, 'welcome-not-ready');

    // Finish Set up this computer: choose the Spaces folder, then Continue.
    await page.getByTestId('space-welcome-setup-reason-continue').click();
    await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
    await answerFolderDialog(app, parentDir);
    await page.getByTestId('machine-spaces-folder-choose').click();
    await expect(page.getByTestId('machine-check-overall')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('machine-check-continue').click();

    // Welcome, ready.
    await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('space-welcome-machine-status')).toHaveAttribute(
      'data-ready',
      'true',
      { timeout: 30_000 },
    );
    await shot(page, 'welcome-ready');

    // The New Space form, with the live "What will be created" line.
    await page.getByTestId('space-welcome-create').click();
    await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('setup-field-name').fill('e2e-shots');
    await page.getByTestId('setup-field-description').fill('A Space made for screenshots.');
    await expect(page.getByTestId('setup-will-create')).toContainText(join(parentDir, 'e2e-shots'));
    await shot(page, 'new-space-form');

    // Checking, then the confirmation (checking is best-effort: it can resolve within a
    // single tick against the fake).
    await page.getByTestId('setup-continue').click();
    await tryShot(page, 'setup-checking', 'checking');
    await expect(page.getByTestId('setup-plan')).toBeVisible({ timeout: 30_000 });
    await shot(page, 'confirmation');

    // The run (best-effort, same reason as checking) and the result.
    await page.getByTestId('setup-confirm').click();
    await tryShot(page, 'setup-running', 'run');
    await expect(page.getByTestId('setup-finished')).toBeVisible({ timeout: 90_000 });
    await shot(page, 'space-ready-result');

    // The Space window, opened on the Dashboard with the start control.
    await page.getByTestId('setup-open-space').click();
    await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-start-session')).toHaveText(
      'Start a Claude Code session',
      { timeout: 15_000 },
    );
    await shot(page, 'dashboard');
    // The Dashboard's own engine menu only appears once two or more engines can start a
    // guarded session (architecture document A.9); with Claude Code the only one that
    // can today, it stays hidden here — the open menu is shown on Sessions below, where
    // it is always offered.
    await expect(
      page.getByTestId('dashboard-start').getByTestId('dashboard-start-menu'),
    ).toHaveCount(0);

    // Sessions, empty (no tab open yet), and its engine menu, open.
    await page.getByTestId('space-rail-sessions').click();
    const empty = page.getByTestId('space-sessions-empty');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await shot(page, 'sessions-empty');

    await empty.getByRole('button', { name: 'Choose the engine' }).click();
    await expect(page.getByTestId('space-sessions-engine-menu')).toBeVisible();
    await shot(page, 'sessions-engine-menu');
    await page.keyboard.press('Escape');
  } finally {
    await closeSpaceApp(app);
    rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('re-running Create with the name of a complete Space offers to open it', async () => {
  test.setTimeout(60_000);
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-screens-')));
  let app: ElectronApplication | undefined;
  try {
    const stateFile = join(temp, 'fake-github.json');
    const parentDir = join(temp, 'spaces');
    const userData = join(temp, 'user-data');
    mkdirSync(parentDir);
    mkdirSync(userData);
    const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');
    runCoreScript([
      "const core = await import('@ai-lore-companion/core');",
      "const testing = await import('@ai-lore-companion/core/testing');",
      `const fake = testing.createFakeGitHub(${JSON.stringify({ stateFile, reposDir: join(temp, 'remotes') })});`,
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
      'const deps = {',
      '  runner: core.execFileRunner,',
      '  github: fake,',
      `  templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)},`,
      `  userDataDir: ${JSON.stringify(userData)},`,
      '  checkMachine: async () => fineMachine,',
      "  gitConfig: { 'user.name': 'AI-Lore Test', 'user.email': 'test@ai-lore.invalid', 'commit.gpgsign': 'false' },",
      '};',
      `const form = { name: 'e2e-shots-existing', description: 'Already made.', owner: 'fake-human', parentDir: ${JSON.stringify(parentDir)} };`,
      'const made = await core.createSpace(form, deps);',
      "if (!made.ok) throw new Error('createSpace: ' + made.error.message);",
      `fake.save(${JSON.stringify(stateFile)});`,
      'console.log(JSON.stringify(true));',
    ]);
    seedSpacesFolderSetting(userData, parentDir);

    const launched = await launchSpaceApp({ userData, env: { AI_LORE_FAKE_GITHUB: stateFile } });
    app = launched.app;
    const page = launched.page;

    await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('space-welcome-create').click();
    await expect(page.getByTestId('setup-form')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('setup-field-name').fill('e2e-shots-existing');
    await expect(page.getByTestId('setup-open-existing')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('setup-continue')).toHaveCount(0);
    await shot(page, 'create-again-already-complete');
  } finally {
    await closeSpaceApp(app);
    rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
});
