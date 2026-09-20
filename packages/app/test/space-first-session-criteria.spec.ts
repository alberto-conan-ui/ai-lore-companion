import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type ElectronApplication, type Locator, type Page, expect, test } from '@playwright/test';
import { closeSpaceApp, launchSpaceApp, withSpaceApp } from './space-fixture';

// The first-session acceptance criteria of `packages/docs/onboarding-product.md` section 8
// that need no real engine installed, signed in or signed out (phase M12.4):
//
// - Criterion 22: with a stored `engines.json` in which Gemini is first, `default.claude`
//   is removed and Claude is re-added, a newly opened Space still starts a Claude Code
//   session, and Settings, Engines lists Claude Code exactly once.
// - Criterion 23: `+ AI ▾` in a Space window lists Codex CLI, Antigravity CLI and OpenCode
//   greyed with the reason on the line, and picking one is not possible in a Space.
//
// Criteria 21, 24 and 25 are not asserted here: each needs a real engine installed, signed
// in or signed out on the machine (phase M12.4, "What not to do").

const APP_DIR = resolve(process.cwd());
const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');

/** Run a module script in a child process with core importable (mirrors `space-fixture.ts`
 *  and `space-dashboard.spec.ts`: Playwright compiles this spec to CommonJS, and core is an
 *  ES-module package). */
function runScript<T>(lines: string[]): T {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null') as T;
}

/** Trigger the macOS App menu's Settings… item — Playwright's `keyboard.press` does not fire
 *  native menu accelerators, so the test walks the menu and clicks the item directly.
 *  Mirrors `cockpit.spec.ts`'s `openSettingsViaMenu` (the app menu, and the `settings:open`
 *  push IPC it sends the focused window, are the same for a Space window). */
async function openSettingsViaMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const submenu = menu?.items[0]?.submenu;
    const item = submenu?.items.find((i) => i.label === 'Settings…');
    item?.click();
  });
}

/** Open the Settings sheet and switch it to the Engines section. */
async function openEnginesSettings(app: ElectronApplication, page: Page): Promise<void> {
  await openSettingsViaMenu(app);
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole('button', { name: 'Engines', exact: true }).click();
  await expect(page.getByTestId('settings-engines-section')).toBeVisible();
}

type ClaudeSpaceRun = {
  root: string;
  userData: string;
  /** The absolute path of a stand-in `claude` binary that answers `--version` and
   *  `auth status --json` as the real Claude Code does, so the real readiness check
   *  (`core`'s `checkEngine`) reports it installed and signed in without a real engine. */
  standInClaude: string;
  cleanup: () => void;
};

/**
 * A fixture Space with the Lore installed into Claude Code's desk (so a guarded session's
 * readiness can pass) and a stand-in `claude` binary. The launch is never given
 * `AI_LORE_FAKE_GITHUB`, so `probeEngineOfApp` (`main/space/e2e-machine.ts`) is not the
 * fake that reports every engine installed and signed in — it runs the real `checkEngine`,
 * against whatever `engines.json` names. That is what lets criterion 23's test tell Codex
 * CLI and Antigravity CLI apart (not installed on this machine) from OpenCode (not
 * guarded at all), and what makes criterion 22's stand-in binary carry the check itself.
 */
function seedClaudeSpaceRun(name: string): ClaudeSpaceRun {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-criteria-')));
  const userData = join(temp, 'user-data');
  mkdirSync(userData);
  let root: string | null = null;
  try {
    const seeded = runScript<{ root: string }>([
      "const core = await import('@ai-lore-companion/core');",
      "const testing = await import('@ai-lore-companion/core/testing');",
      `const o = ${JSON.stringify({ userData, name })};`,
      `const space = await testing.makeSpaceFixture({ templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)}, name: o.name });`,
      'const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.error.message}`); return result.value; };',
      "const lore = must(await core.readLore(space.root), 'lore');",
      'const desk = core.deskPaths(o.userData, space.root);',
      "must(await core.installClaudeCode(lore, desk.install), 'install');",
      'console.log(JSON.stringify({ root: space.root }));',
    ]);
    root = seeded.root;

    // A stand-in `claude`: answers exactly what the real readiness check (core's
    // `checkEngine`, `engineInstallState` / `engineSignInState`) asks — `--version`
    // (installed) and `auth status --json` (signed in) — and nothing else, so it is never
    // mistaken for a real engine spawned to do anything more.
    const bin = join(temp, 'bin');
    mkdirSync(bin);
    const standInClaude = join(bin, 'claude');
    writeFileSync(
      standInClaude,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then',
        "  printf '2.1.276 (Claude Code)\\n'",
        '  exit 0',
        'fi',
        'if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then',
        '  printf \'{"loggedIn":true}\\n\'',
        '  exit 0',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(standInClaude, 0o755);

    return {
      root,
      userData,
      standInClaude,
      cleanup: () => {
        rmSync(dirname(root as string), { recursive: true, force: true, maxRetries: 3 });
        rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      },
    };
  } catch (caught) {
    if (root !== null) rmSync(dirname(root), { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
    throw caught;
  }
}

test.describe('the first-session criteria as end-to-end assertions (M12.4)', () => {
  test('an awkward engines.json still starts Claude Code in a Space, and Settings lists it once (criterion 22)', async () => {
    test.setTimeout(120_000);
    const run = seedClaudeSpaceRun('e2e-criterion-22');
    let app: ElectronApplication | undefined;
    try {
      // The Human Lead's own `engines.json`, reproduced faithfully (M12.4 intent): Gemini
      // first, no `default.claude` entry at all, and Claude re-added under a fresh id —
      // exactly as Settings, Engines' "Remove" then "Add engine" would leave it. The merge
      // (core's `mergeEnginesWithCatalog`) must still fold the re-added entry into the
      // catalog's Claude Code slot by its binary name, and put every catalog engine first
      // regardless of this stored order.
      writeFileSync(
        join(run.userData, 'engines.json'),
        JSON.stringify({
          engines: [
            { id: 'user.gemini', name: 'Gemini CLI', binary: 'gemini' },
            { id: 'user.claude-readded', name: 'Claude Code', binary: run.standInClaude },
          ],
        }),
      );

      const launched = await launchSpaceApp({ root: run.root, userData: run.userData });
      app = launched.app;
      const page = launched.page;

      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('space-rail-sessions')).toHaveAttribute('aria-current', 'page');

      // The start control's primary button (the Sessions empty view's `+ AI`, same
      // `EngineStartControl` the Dashboard uses): the merge kept the re-added Claude's
      // stand-in binary but gave it the catalog's own name, so a guarded Claude Code
      // session is what starts, and the button names it so.
      const start = page.getByTestId('space-sessions-empty').getByTestId('new-ai');
      await expect(start).toBeEnabled({ timeout: 15_000 });
      await expect(start).toHaveText('Start a Claude Code session');

      // Settings, Engines: the catalog engine appears once — never duplicated by the
      // re-added entry the merge folded into it, and Gemini (no longer a catalog engine)
      // is kept as the Human Lead's own hand-added entry, not mistaken for Claude Code.
      await openEnginesSettings(app, page);
      const engineRows = page.locator('[data-testid^="engine-row-"]');
      await expect(engineRows).toHaveCount(5);
      await expect(engineRows.filter({ hasText: 'Claude Code' })).toHaveCount(1);
      await expect(page.getByTestId('engine-row-default.claude')).toHaveCount(1);
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('Codex CLI, Antigravity CLI and OpenCode are greyed with a reason in a Space, and cannot be picked (criterion 23)', async () => {
    test.setTimeout(60_000);
    await withSpaceApp('e2e-criterion-23', async ({ app, page }) => {
      await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
      const empty = page.getByTestId('space-sessions-empty');
      const start = empty.getByTestId('new-ai');
      await expect(start).toBeVisible();
      // The fixture Space has no Lore installed into Claude Code, so no engine can start
      // yet (M4.6) — the control the criterion names (its `▾`) is still shown regardless
      // (`EngineStartControl`'s `menu="always"` in Sessions), which is what this test opens.
      const startedBefore = await start.isDisabled();

      await empty.getByRole('button', { name: 'Choose the engine' }).click();
      const engineMenu = page.getByTestId('space-sessions-engine-menu');
      await expect(engineMenu).toBeVisible();

      // Codex CLI and Antigravity CLI can run a guarded Space session in principle (the
      // catalog's `guardedSessions`, M10.9); whether they are greyed for want of the engine
      // or for want of the Lore depends on the machine the suite runs on, and the criterion
      // is about neither — it is about the row being greyed with its reason on the line.
      //
      // `reasonFor` in `main/space/sessions/engine-choice.ts` gives `not installed` when the
      // engine is missing and `the Lore is not installed for it in this Space` when the
      // engine is there and the Space's Lore is not. The first sentence is a SUBSTRING of
      // the second, so `toContainText('not installed')` cannot tell them apart and passes on
      // either machine for either reason. The fixture Space installs no Lore, so on a machine
      // with Codex and Antigravity installed the reason is the Lore one. Assert the whole
      // sentence against the two it may be, so the row's reason is pinned exactly and a
      // future third reason fails here instead of passing silently.
      const ENGINE_MISSING = 'not installed';
      const LORE_MISSING = 'the Lore is not installed for it in this Space';
      const reasonOf = async (row: Locator, name: string): Promise<void> => {
        await expect(row).toHaveAttribute('aria-disabled', 'true');
        await expect(row).toContainText(name);
        // The row's text is `<name> \u2014 <reason>` and, when the failure has a fix, the
        // fix control's own label runs straight on after it with no separator. Match on the
        // start of the reason, so the fix's wording is not mistaken for part of it.
        const text = ((await row.textContent()) ?? '').trim();
        const reason = text.slice(text.indexOf('\u2014') + 1).trim();
        expect(
          reason.startsWith(ENGINE_MISSING) || reason.startsWith(LORE_MISSING),
          `${name} was greyed with an unexpected reason: ${JSON.stringify(reason)}`,
        ).toBe(true);
      };

      const codex = engineMenu.getByTestId('space-sessions-engine-menu-option-default.codex');
      const antigravity = engineMenu.getByTestId(
        'space-sessions-engine-menu-option-default.antigravity',
      );
      await reasonOf(codex, 'Codex CLI');
      await reasonOf(antigravity, 'Antigravity CLI');

      const opencode = engineMenu.getByTestId('space-sessions-engine-menu-option-default.opencode');
      await expect(opencode).toHaveAttribute('aria-disabled', 'true');
      await expect(opencode).toContainText('OpenCode');
      await expect(opencode).toContainText(
        'guarded Space sessions are not available for this engine yet',
      );

      // Picking one is not possible: each disabled row is a `div[role="menuitem"]` with no
      // click handler (only a startable option is a `button`), so clicking it neither closes
      // the menu nor changes what the primary button would start.
      // `force` because Playwright refuses to click an element it considers disabled, and
      // `aria-disabled="true"` is exactly what this row carries. Waiting for it to become
      // enabled is the opposite of what the criterion asks: the point is that the click
      // lands and changes nothing.
      await antigravity.click({ force: true });
      await expect(engineMenu).toBeVisible();
      await expect(codex).toBeVisible();
      await expect(start).toBeDisabled();
      expect(await start.isDisabled()).toBe(startedBefore);
      await expect(start).not.toContainText('Antigravity');
      await expect(start).not.toContainText('Codex');
      await expect(start).not.toContainText('OpenCode');

      await page.keyboard.press('Escape');
      await expect(engineMenu).toHaveCount(0);
    });
  });
});
