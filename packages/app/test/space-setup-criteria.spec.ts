import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// Acceptance criteria 5, 8 and 9 of section 8 of `packages/docs/onboarding-product.md`
// (phase M12.2), the three that need no live account, no browser and no engine sign-in:
//
// - Criterion 5: the engines section lists Claude Code, Codex CLI, Antigravity CLI and
//   OpenCode whether installed or not, does not list Gemini CLI unless added by hand,
//   marks Claude Code Required and the other three Optional.
// - Criterion 8: the page is not ready while Claude Code is missing or signed out, and is
//   ready while Codex CLI, Antigravity CLI and OpenCode are all missing.
// - Criterion 9: the Spaces folder is prefilled with `~/Spaces`; "Use this folder" creates
//   it; Settings shows the same value under Spaces, checked in the same launch.
//
// Criteria 5 and 8 state the machine report a test needs — engines present or missing,
// Claude Code missing, signed in or signed out — through `AI_LORE_E2E_MACHINE`
// (`main/space/e2e-machine.ts`'s `checkMachineOfApp`), so the app's own screens render a
// report chosen here rather than what this machine happens to have installed. Nothing here
// reaches live GitHub or a real engine.

const APP_DIR = resolve(process.cwd());

/** Run a module script in a child process with core importable (mirrors `space-fixture.ts`
 *  and `space-setup.spec.ts`: Playwright compiles this spec to CommonJS, and core is an
 *  ES-module package). */
function runCoreScript(lines: string[]): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null');
}

/** Seed `<userData>/settings.json` with the Spaces folder already set (mirrors
 *  `space-setup.spec.ts`'s helper of the same name). */
function seedSpacesFolderSetting(userData: string, folder: string): void {
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, values: { 'spaces.folder': folder }, ignores: [] }),
  );
}

/** Trigger the macOS App menu's Settings… item — Playwright's `keyboard.press` does not fire
 *  native menu accelerators, so the test walks the menu and clicks the item directly. Mirrors
 *  `cockpit.spec.ts`'s and `space-first-session-criteria.spec.ts`'s `openSettingsViaMenu` (the
 *  app menu, and the `settings:open` push IPC it sends the focused window, are the same for a
 *  Space window). */
async function openSettingsViaMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const submenu = menu?.items[0]?.submenu;
    const item = submenu?.items.find((i) => i.label === 'Settings…');
    item?.click();
  });
}

// --- Building an `AI_LORE_E2E_MACHINE` report -----------------------------------------
//
// The shapes below are `MachineCheck` / `EngineCheck` of `packages/core/src/space/machine/
// types.ts`, and the four catalog engines of `packages/core/src/space/engines/catalog.ts`
// (`ENGINE_CATALOG`), reproduced by hand so this file needs no import from core beyond what
// `runCoreScript` already gives it in a child process.

type EngineFixture = {
  catalogId: 'claude-code' | 'codex' | 'antigravity' | 'opencode';
  engineId: string;
  name: string;
  binary: string;
  maker: string | null;
  required: boolean;
  guardedSessions: boolean;
  note: string | null;
  /** Whether the binary is found on the machine. */
  installed: boolean;
  /** `true`/`false` signed in or not (only meaningful when `installed`); `null` when the
   *  catalog engine has no sign-in check of its own, so the probe never runs one. */
  signedIn: boolean | null;
};

/** `EngineInstallState`, `EngineSignInState` and `MachineCheckState`, narrowed to the kinds
 *  this file's fixtures ever produce (`packages/core/src/space/machine/types.ts`). Literal
 *  `kind` fields, so a `===` check narrows the union the way the real types do. */
type InstallFixture = { kind: 'installed'; version: string } | { kind: 'missing' };
type SignInFixture = { kind: 'signed-in' } | { kind: 'not-signed-in' } | { kind: 'not-checked' };
type StateFixture =
  | { kind: 'fine'; version: string | null }
  | { kind: 'missing' }
  | { kind: 'not-signed-in' };

/** One engine of `check.engines`, and the `MachineCheckState` `legacyEngineState`
 *  (`core`'s `machine-check.ts`) derives from the same `installed` and `signIn`. */
function engineCheck(fixture: EngineFixture): {
  engineId: string;
  name: string;
  binary: string;
  state: StateFixture;
  guidance: null;
  command: null;
  catalogId: string;
  maker: string | null;
  required: boolean;
  guardedSessions: boolean;
  installed: InstallFixture;
  signIn: SignInFixture;
  installCommand: string;
  installNeeds: null;
  signInCommand: string;
  note: string | null;
  page: string;
} {
  const installed: InstallFixture = fixture.installed
    ? { kind: 'installed', version: '1.0.0' }
    : { kind: 'missing' };
  const signIn: SignInFixture = !fixture.installed
    ? { kind: 'not-checked' }
    : fixture.signedIn === null
      ? { kind: 'not-checked' }
      : fixture.signedIn
        ? { kind: 'signed-in' }
        : { kind: 'not-signed-in' };
  const state: StateFixture =
    installed.kind === 'missing'
      ? { kind: 'missing' }
      : signIn.kind === 'not-signed-in'
        ? { kind: 'not-signed-in' }
        : { kind: 'fine', version: installed.version };
  return {
    engineId: fixture.engineId,
    name: fixture.name,
    binary: fixture.binary,
    state,
    guidance: null,
    command: null,
    catalogId: fixture.catalogId,
    maker: fixture.maker,
    required: fixture.required,
    guardedSessions: fixture.guardedSessions,
    installed,
    signIn,
    installCommand: 'true',
    installNeeds: null,
    signInCommand: 'true',
    note: fixture.note,
    page: 'https://example.invalid/engine',
  };
}

/** A whole `MachineCheck`, `git`/`gh`/`python3` always fine, with the four engines built by
 *  `claude` and `others` (in catalog order: Claude Code, Codex CLI, Antigravity CLI,
 *  OpenCode). `ready` follows the same rule `checkMachine` uses: every requirement fine. */
function machineReport(claude: EngineFixture, others: EngineFixture[]): unknown {
  const claudeCheck = engineCheck(claude);
  const engines = [claudeCheck, ...others.map(engineCheck)];
  const requirements = [
    {
      id: 'git',
      binary: 'git',
      state: { kind: 'fine', version: '2.45.0' },
      guidance: null,
      command: null,
    },
    {
      id: 'gh',
      binary: 'gh',
      state: { kind: 'fine', version: '2.82.0' },
      guidance: null,
      command: null,
    },
    {
      id: 'engine',
      binary: claudeCheck.binary,
      state: claudeCheck.state,
      guidance: null,
      command: null,
    },
    {
      id: 'python3',
      binary: 'python3',
      state: { kind: 'fine', version: '3.12.0' },
      guidance: null,
      command: null,
    },
  ];
  return {
    requirements,
    engines,
    ready: requirements.every((requirement) => requirement.state.kind === 'fine'),
    github: { account: 'fake-human', organisations: [] },
    tools: { brew: true, npm: true },
  };
}

const CODEX: Omit<EngineFixture, 'installed' | 'signedIn'> = {
  catalogId: 'codex',
  engineId: 'default.codex',
  name: 'Codex CLI',
  binary: 'codex',
  maker: 'OpenAI',
  required: false,
  guardedSessions: true,
  note: null,
};

const ANTIGRAVITY: Omit<EngineFixture, 'installed' | 'signedIn'> = {
  catalogId: 'antigravity',
  engineId: 'default.antigravity',
  name: 'Antigravity CLI',
  binary: 'agy',
  maker: 'Google',
  required: false,
  guardedSessions: true,
  note: null,
};

const OPENCODE: Omit<EngineFixture, 'installed' | 'signedIn'> = {
  catalogId: 'opencode',
  engineId: 'default.opencode',
  name: 'OpenCode',
  binary: 'opencode',
  maker: null,
  required: false,
  guardedSessions: false,
  note: 'Also runs DeepSeek models: choose DeepSeek when signing in.',
};

const CLAUDE_BASE: Omit<EngineFixture, 'installed' | 'signedIn'> = {
  catalogId: 'claude-code',
  engineId: 'default.claude',
  name: 'Claude Code',
  binary: 'claude',
  maker: 'Anthropic',
  required: true,
  guardedSessions: true,
  note: null,
};

/** Launch the app with `check` as `AI_LORE_E2E_MACHINE`, in a `userData` of its own, cleaned
 *  up (with the app) in `finally`. */
async function launchWithMachineReport(
  check: unknown,
  seedSpacesFolder: boolean,
): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-criteria-ud-'));
  if (seedSpacesFolder) {
    const folder = join(userData, 'spaces');
    mkdirSync(folder);
    seedSpacesFolderSetting(userData, folder);
  }
  const launched = await launchSpaceApp({
    userData,
    env: { AI_LORE_E2E_MACHINE: JSON.stringify(check) },
  });
  return { app: launched.app, page: launched.page, userData };
}

test.describe('the setup criteria as end-to-end assertions (M12.2)', () => {
  test('the engines section lists all four catalog engines with Claude Code required and the others optional, whether installed or not (criterion 5)', async () => {
    test.setTimeout(60_000);
    const check = machineReport({ ...CLAUDE_BASE, installed: true, signedIn: true }, [
      { ...CODEX, installed: false, signedIn: null },
      // Installed (unlike Codex CLI and OpenCode below), to show the row lists an optional
      // engine regardless of whether it happens to be installed.
      { ...ANTIGRAVITY, installed: true, signedIn: null },
      { ...OPENCODE, installed: false, signedIn: null },
    ]);
    let app: ElectronApplication | undefined;
    let userData: string | undefined;
    try {
      const launched = await launchWithMachineReport(check, /* seedSpacesFolder */ false);
      app = launched.app;
      userData = launched.userData;
      const { page } = launched;

      await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
      // Claude Code is fine, so the AI engines section starts collapsed (`enginesFine`,
      // `MachineCheckScreen.tsx`); its "Show" toggle is the section's own existing handle.
      await page.getByTestId('machine-section-engines-toggle').click();

      // The row itself is a `<div>` (`EnginesSection.tsx`'s `EngineRow`); its "Installed" and
      // "Signed in" cells and its action button share the same testid prefix but are `<span>`
      // and `<button>` elements, so qualifying by tag isolates the four row containers.
      const rows = page.locator('div[data-testid^="machine-row-engine-"]');
      await expect(rows).toHaveCount(4);

      const claudeRow = page.getByTestId('machine-row-engine-default.claude');
      await expect(claudeRow).toContainText('Claude Code');
      await expect(claudeRow).toContainText('Required — runs the AI sessions in a Space');
      await expect(page.getByTestId('machine-row-engine-default.claude-installed')).toHaveText(
        'Installed 1.0.0',
      );

      const codexRow = page.getByTestId('machine-row-engine-default.codex');
      await expect(codexRow).toContainText('Codex CLI');
      await expect(codexRow).toContainText('Optional');
      await expect(page.getByTestId('machine-row-engine-default.codex-installed')).toHaveText(
        'Not installed',
      );

      const antigravityRow = page.getByTestId('machine-row-engine-default.antigravity');
      await expect(antigravityRow).toContainText('Antigravity CLI');
      await expect(antigravityRow).toContainText('Optional');
      await expect(page.getByTestId('machine-row-engine-default.antigravity-installed')).toHaveText(
        'Installed 1.0.0',
      );

      const opencodeRow = page.getByTestId('machine-row-engine-default.opencode');
      await expect(opencodeRow).toContainText('OpenCode');
      await expect(opencodeRow).toContainText('Optional');
      await expect(page.getByTestId('machine-row-engine-default.opencode-installed')).toHaveText(
        'Not installed',
      );
    } finally {
      await closeSpaceApp(app);
      if (userData !== undefined) rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('the page is ready only with Claude Code fine, and stays ready with Codex CLI, Antigravity CLI and OpenCode all missing (criterion 8)', async () => {
    test.setTimeout(120_000);

    async function assertReadiness(claude: EngineFixture, expectReady: boolean): Promise<void> {
      const check = machineReport(claude, [
        { ...CODEX, installed: false, signedIn: null },
        { ...ANTIGRAVITY, installed: false, signedIn: null },
        { ...OPENCODE, installed: false, signedIn: null },
      ]);
      let app: ElectronApplication | undefined;
      let userData: string | undefined;
      try {
        const launched = await launchWithMachineReport(check, /* seedSpacesFolder */ true);
        app = launched.app;
        userData = launched.userData;
        const { page } = launched;

        if (expectReady) {
          // Ready: the launch opens straight on the welcome screen (`SpaceWelcomeScreen`'s
          // `checkOnLaunch` only redirects when not ready), whose status line carries the
          // same readiness.
          await expect(page.getByTestId('space-welcome')).toBeVisible({ timeout: 15_000 });
          await expect(page.getByTestId('machine-check')).toHaveCount(0);
          await expect(page.getByTestId('space-welcome-machine-status')).toHaveAttribute(
            'data-ready',
            'true',
            { timeout: 15_000 },
          );
        } else {
          await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
          await expect(page.getByTestId('machine-check-overall')).toHaveAttribute(
            'data-ready',
            'false',
            { timeout: 15_000 },
          );
        }
      } finally {
        await closeSpaceApp(app);
        if (userData !== undefined) {
          rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
        }
      }
    }

    // Claude Code missing.
    await assertReadiness({ ...CLAUDE_BASE, installed: false, signedIn: null }, false);
    // Claude Code installed, signed out.
    await assertReadiness({ ...CLAUDE_BASE, installed: true, signedIn: false }, false);
    // Claude Code installed and signed in; the other three engines all missing.
    await assertReadiness({ ...CLAUDE_BASE, installed: true, signedIn: true }, true);
  });

  test('the Spaces folder is prefilled with ~/Spaces, "Use this folder" creates it, and Settings shows the same value in the same launch (criterion 9)', async () => {
    test.setTimeout(60_000);
    const tempHome = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-criteria-home-')));
    const userData = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-setup-criteria-ud-'));
    let app: ElectronApplication | undefined;
    try {
      // An empty `.zshrc` in the fake home, so the login-shell `PATH` read
      // (`main/space/ipc/machine.ts`'s `readLoginShellPath`, run at every check) does not
      // trigger zsh's new-user setup wizard, which only fires when none of
      // `.zshenv`/`.zprofile`/`.zshrc`/`.zlogin` exist.
      writeFileSync(join(tempHome, '.zshrc'), '');

      const stateFile = join(tempHome, 'fake-github.json');
      runCoreScript([
        "const { createFakeGitHub } = await import('@ai-lore-companion/core/testing');",
        `const fake = createFakeGitHub(${JSON.stringify({ stateFile, reposDir: join(tempHome, 'remotes') })});`,
        `fake.save(${JSON.stringify(stateFile)});`,
        'console.log(JSON.stringify(true));',
      ]);

      // `HOME` is overridden for this launch only, so `os.homedir()` in the app's main
      // process (`proposeSpacesFolder`, `main/space/spaces-folder.ts`) proposes a folder
      // under a throwaway home rather than this machine's real one — "Use this folder"
      // below really does create a folder, and it must not be `~/Spaces` of whoever runs
      // this test.
      const launched = await launchSpaceApp({
        userData,
        env: { AI_LORE_FAKE_GITHUB: stateFile, HOME: tempHome },
      });
      app = launched.app;
      const { page } = launched;

      // Clause 1: prefilled with ~/Spaces. `userData` is fresh (no recent Space), so
      // `proposeSpacesFolder` has nothing to prefer over `<home>/Spaces`
      // (`main/space/spaces-folder.ts`).
      await expect(page.getByTestId('machine-check')).toBeVisible({ timeout: 15_000 });
      const expectedFolder = join(tempHome, 'Spaces');
      expect(existsSync(expectedFolder)).toBe(false);
      await expect(page.getByTestId('machine-spaces-folder-path')).toHaveText('~/Spaces');

      // Clause 2: "Use this folder" creates it.
      await page.getByTestId('machine-spaces-folder-use').click();
      await expect.poll(() => existsSync(expectedFolder), { timeout: 15_000 }).toBe(true);

      // The section may have collapsed now that the folder is set (`spacesFolderFine`); its
      // "Show" toggle is the section's own existing handle, used only if needed.
      const toggle = page.getByTestId('machine-section-spaces-folder-toggle');
      if ((await toggle.count()) > 0) await toggle.click();
      await expect(page.getByTestId('machine-spaces-folder-path')).toHaveText('~/Spaces');

      // Clause 3, same launch: Settings shows the same value under Spaces.
      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible({ timeout: 10_000 });
      await sheet.getByRole('button', { name: 'Spaces', exact: true }).click();
      await expect(sheet.getByText('Spaces folder')).toBeVisible();
      await expect(sheet.getByText(expectedFolder, { exact: true })).toBeVisible();
    } finally {
      await closeSpaceApp(app);
      rmSync(tempHome, { recursive: true, force: true, maxRetries: 3 });
      rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
