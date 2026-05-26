import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launchApp, makeProject } from './fixture';

/** A throwaway userData dir so a test never touches real cockpit state. */
function scratchUserData(): string {
  return mkdtempSync(join(tmpdir(), 'ai-lore-e2e-ud-'));
}

/** Trigger the macOS App menu's Settings… item — Playwright's `keyboard.press`
 *  does not fire native menu accelerators, so we walk the menu and click the
 *  item directly. Mirrors what `⌘,` does for a real user. */
async function openSettingsViaMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const submenu = menu?.items[0]?.submenu;
    const item = submenu?.items.find((i) => i.label === 'Settings…');
    item?.click();
  });
}

/** Click a hidden Navigate-submenu item by label — `keyboard.press` does not
 *  fire native accelerators, so the test triggers the menu item directly. */
async function clickNavigateItem(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(
    ({ Menu }, args) => {
      const menu = Menu.getApplicationMenu();
      const navMenu = menu?.items.find((i) => i.label === 'Navigate')?.submenu;
      const item = navMenu?.items.find((i) => i.label === args.label);
      item?.click();
    },
    { label },
  );
}

test.describe('window modes', () => {
  test('a valid project opens the pinned cockpit tabs', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      // The three pinned cockpit tabs are open on launch.
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('tab-payload')).toBeVisible();
      await expect(page.getByTestId('tab-memory')).toBeVisible();
      // Status is the default tab — its pane is shown.
      await expect(page.getByTestId('pane-status')).toBeVisible();

      // The panel/tab workspace: a new terminal opens in the left panel.
      await page.getByTestId('tab-strip').first().getByTestId('new-terminal').click();
      await expect(page.getByTestId('tab-terminal').first()).toBeVisible({ timeout: 5_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the file tree shows a selectable root node', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 15_000 });
      // The pane's tree has a root node row at its top — selecting it surfaces
      // the files that sit directly at the pane's root.
      await expect(page.getByTestId('pane-status').getByTestId('tree-root')).toBeVisible({
        timeout: 10_000,
      });
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the global search finds a file and lists it', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('global-search').fill('demo');
      // The fixture has memory/status/focus/demo.focus.md — it shows as a result.
      await expect(
        page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' }),
      ).toBeVisible({ timeout: 5_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the global search routes a Lore-pane hit to the right tab', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // `demo.focus.md` lives under `memory/status/focus/` — the Status pane
      // (which groups status + journal + action-tree). Picking it must switch
      // the active pane to Status, not Payload (the routing bug Phase B fixed).
      await page.getByTestId('global-search').fill('demo');
      const hit = page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' });
      await expect(hit).toBeVisible({ timeout: 5_000 });
      await hit.click();

      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // (v0.5 tests for the per-row Project / Lore shortcut surfaces and the
  // Finder default were removed in v0.6 Phase A — those surfaces no longer
  // exist; apps live in the per-node context menu via the Apps catalog.)

  test('a terminal tab can be renamed by hand', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('tab-strip').first().getByTestId('new-terminal').click();
      const tab = page.getByTestId('tab-terminal').first();
      await expect(tab).toBeVisible({ timeout: 5_000 });

      // Double-click the tab to make its title editable; a typed name sticks.
      await tab.dblclick();
      const input = page.getByLabel('Rename tab');
      await expect(input).toBeVisible();
      await input.fill('My shell');
      await input.press('Enter');
      await expect(tab.getByText('My shell')).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('launching with no project opens the welcome window', async () => {
    const userData = scratchUserData();
    try {
      const { app, page } = await launchApp({ userData });
      await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 15_000 });
      await app.close();
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  test('a non-AI-Lore folder opens the altered window', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-plain-'));
    const userData = scratchUserData();
    try {
      const { app, page } = await launchApp({ root: plain, userData });
      await expect(page.getByTestId('altered')).toBeVisible({ timeout: 15_000 });
      await app.close();
    } finally {
      rmSync(plain, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    }
  });

  test('the header renders three rows and the chain titles are clickable', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // v0.6 Phase A reshaped the header down to identity + search. The
      // shortcut sub-rows and the drift cluster (Pill + Dismiss all) are
      // gone; per-pane DriftPills + per-file glyphs surface drift where
      // the user is acting.
      await expect(page.getByTestId('header-identity')).toBeVisible();
      await expect(page.getByTestId('header-search')).toBeVisible();
      await expect(page.getByTestId('header-actions')).toHaveCount(0);
      await expect(page.getByTestId('header-drift')).toHaveCount(0);
      await expect(page.getByTestId('drift-cluster')).toHaveCount(0);

      // The focus and active-child titles are clickable links.
      await expect(page.getByTestId('focus-link')).toHaveText('Demo');
      // The chain reader extracts the leading title from the H1; the rest of
      // the heading after `—` is the chapeau, not the title.
      await expect(page.getByTestId('active-child-link')).toHaveText('Phase A');

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the Settings sheet opens and renders registry sections', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible();

      // Scope tabs and the always-present sections render.
      await expect(sheet.getByTestId('settings-scope-global')).toBeVisible();
      await expect(sheet.getByTestId('settings-scope-project')).toBeVisible();
      await expect(sheet.getByText('Ignore rules')).toBeVisible();
      await expect(sheet.getByText('Shortcuts')).toBeVisible();

      // The Phase E toggle is rendered through the registry.
      await sheet.getByText('Workspace').click();
      await expect(sheet.getByTestId('setting-workspace.restoreLayout')).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('Cmd+1, Cmd+2, Cmd+3 switch the left-panel cockpit tabs', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 15_000 });

      // Cmd+2 — Payload tab is now active; its Pane renders.
      await clickNavigateItem(app, 'Go to Tab 2');
      await expect(page.getByTestId('pane-payload')).toBeVisible({ timeout: 3_000 });

      // Cmd+3 — Memory tab.
      await clickNavigateItem(app, 'Go to Tab 3');
      await expect(page.getByTestId('pane-memory')).toBeVisible({ timeout: 3_000 });

      // Cmd+1 — back to Status.
      await clickNavigateItem(app, 'Go to Tab 1');
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('Cmd+F focuses the global file search', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 15_000 });

      // Click somewhere else first so the search input is not already focused.
      await page.getByTestId('pane-status').getByTestId('tree-root').click();
      await clickNavigateItem(app, 'Find File…');
      await expect(page.getByTestId('global-search')).toBeFocused({ timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('a no-search ignore rule removes a file from the global search', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // The fixture's demo focus appears in search by default.
      await page.getByTestId('global-search').fill('demo');
      await expect(
        page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' }),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('global-search').fill('');

      // Add a project-tier `no-search` rule for the `demo` pattern.
      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible();
      await sheet.getByTestId('settings-scope-project').click();
      await sheet.getByText('Ignore rules').click();
      await sheet.getByTestId('ignore-add-pattern').fill('demo');
      // The select carries the level — default is `no-drift`; switch to `no-search`.
      await sheet.locator('select').first().selectOption('no-search');
      await sheet.getByTestId('ignore-add').click();
      await expect(sheet.getByTestId('ignore-rule').filter({ hasText: 'demo' })).toBeVisible();
      // Close the sheet — the backdrop closes on mousedown.
      await page.mouse.click(5, 5);
      await expect(sheet).toBeHidden();

      // Re-running the search must now find nothing.
      await page.getByTestId('global-search').fill('demo');
      await expect(page.getByTestId('search-result')).toHaveCount(0, { timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the header renders posture / altitude / commitment / focus-type chips from frontmatter', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await expect(page.getByTestId('register-chips')).toBeVisible();
      await expect(page.getByTestId('chip-posture')).toContainText('execute', { ignoreCase: true });
      await expect(page.getByTestId('chip-altitude')).toContainText('mid', { ignoreCase: true });
      await expect(page.getByTestId('chip-commitment')).toContainText('neutral', {
        ignoreCase: true,
      });
      await expect(page.getByTestId('chip-focus-type')).toContainText('build', {
        ignoreCase: true,
      });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('clicking a posture option writes status.index.md and the chip updates', async () => {
    const fixture = makeProject();
    const statusPath = join(
      fixture.root,
      '.ai-lore-e2e-fixture',
      'memory',
      'status',
      'status.index.md',
    );
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-posture')).toContainText('execute', { ignoreCase: true });

      await page.getByTestId('chip-posture').click();
      await page.getByTestId('chip-posture-option-chat').click();

      await expect(page.getByTestId('chip-posture')).toContainText('chat', {
        ignoreCase: true,
        timeout: 5_000,
      });
      const onDisk = readFileSync(statusPath, 'utf8');
      expect(onDisk).toMatch(/^posture: chat$/m);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('clicking an altitude option writes dials.altitude and the chip updates', async () => {
    const fixture = makeProject();
    const statusPath = join(
      fixture.root,
      '.ai-lore-e2e-fixture',
      'memory',
      'status',
      'status.index.md',
    );
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-altitude')).toContainText('mid', { ignoreCase: true });

      await page.getByTestId('chip-altitude').click();
      await page.getByTestId('chip-altitude-option-high').click();

      await expect(page.getByTestId('chip-altitude')).toContainText('high', {
        ignoreCase: true,
        timeout: 5_000,
      });
      const onDisk = readFileSync(statusPath, 'utf8');
      expect(onDisk).toMatch(/^ {2}altitude: high$/m);
      // The sibling commitment line is untouched.
      expect(onDisk).toMatch(/^ {2}commitment: neutral$/m);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the Status pane synthetic root includes save-points and references folders', async () => {
    const fixture = makeProject();
    const lore = join(fixture.root, '.ai-lore-e2e-fixture');
    const { mkdirSync: makeDir } = await import('node:fs');
    // makeProject creates status / journal / blueprint / knowledge-tree;
    // save-points and references are absent. Create them so the Status
    // pane's synthetic root surfaces them as children — that's where the
    // v0.5 areas live in the cockpit (no separate modals).
    makeDir(join(lore, 'memory', 'save-points'), { recursive: true });
    makeDir(join(lore, 'references'), { recursive: true });
    writeFileSync(
      join(lore, 'memory', 'save-points', '2026-05-26_alpha.md'),
      [
        '---',
        'type: save-point',
        'title: Alpha milestone',
        'updated: 2026-05-26',
        'references: []',
        'date: 2026-05-26',
        'lore_commit: deadbeef',
        'payload_commit: cafef00d',
        '---',
        '',
        'first milestone.',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(lore, 'references', 'sibling-project.md'),
      [
        '---',
        'type: reference',
        'title: Sibling project',
        'updated: 2026-05-26',
        'references: []',
        'target_path: /tmp/sibling',
        'purpose: cross-project context',
        'scope: all',
        '---',
        '',
        'how to consult.',
        '',
      ].join('\n'),
    );
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      const statusPane = page.getByTestId('pane-status');
      await expect(statusPane).toBeVisible({ timeout: 15_000 });
      // Both folders surface as children of the Status synthetic root.
      // Drift on either is tracked via the existing watcher + queue +
      // per-row dismiss — no bespoke UI.
      await expect(statusPane).toContainText('save-points', { timeout: 5_000 });
      await expect(statusPane).toContainText('references', { timeout: 5_000 });
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the status chevron opens the in-app view of status.index.md', async () => {
    const fixture = makeProject();
    // Add some prose under `## Current state` so the primary section has
    // visible content — the test asserts a known phrase.
    const statusPath = join(
      fixture.root,
      '.ai-lore-e2e-fixture',
      'memory',
      'status',
      'status.index.md',
    );
    writeFileSync(
      statusPath,
      [
        '---',
        'type: status',
        'title: e2e-fixture — Status',
        'updated: 2026-05-26',
        'references: []',
        'active_focus: ./focus/demo.focus.md',
        'posture: execute',
        'dials:',
        '  altitude: mid',
        '  commitment: neutral',
        '---',
        '',
        '# e2e-fixture — Status',
        '',
        '## Current state',
        '',
        'fixture is healthy; Phase D is next.',
        '',
        '## Focus stack',
        '',
        '1. Demo — Active',
        '',
      ].join('\n'),
    );
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-posture')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('status-view-toggle').click();
      await expect(page.getByTestId('focus-view')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('focus-view-title')).toHaveText('e2e-fixture — Status');
      // Primary section is "Current state" — the status file has no Gate.
      const primary = page.getByTestId('focus-view-primary');
      await expect(primary).toContainText('Current state');
      await expect(primary).toContainText('fixture is healthy; Phase D is next.');
      // Focus stack section also renders.
      await expect(page.getByTestId('focus-view-section-focus-stack')).toContainText('Demo');

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the focus view toggle opens the in-app view of the active child (at-node)', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-posture')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('focus-view-toggle').click();
      await expect(page.getByTestId('focus-view')).toBeVisible({ timeout: 5_000 });

      // The active child is the A-phase at-node — title comes from
      // frontmatter (`title: Phase A`), kind from `node_kind: leaf`.
      await expect(page.getByTestId('focus-view-title')).toHaveText('Phase A');
      await expect(page.getByTestId('focus-view-node-kind')).toContainText('leaf', {
        ignoreCase: true,
      });
      // The Gate section is rendered (an AT node carries a gate too).
      await expect(page.getByTestId('focus-view-primary')).toContainText('phase gate');

      // Pressing Escape closes the sheet.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('focus-view')).toHaveCount(0, { timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the focus view renders Gate for focus_type=build and Vision for focus_type=goal', async () => {
    const fixture = makeProject();
    // Replace the active child with `(leaf — none)` so the view opens on
    // the focus file itself; rewrite the focus as a goal with a Vision.
    const focusPath = join(
      fixture.root,
      '.ai-lore-e2e-fixture',
      'memory',
      'status',
      'focus',
      'demo.focus.md',
    );
    try {
      // First: build focus with a Gate.
      writeFileSync(
        focusPath,
        [
          '---',
          'type: focus',
          'title: Demo',
          'updated: 2026-05-26',
          'references: []',
          'status: Active',
          'focus_type: build',
          '---',
          '',
          '# Demo',
          '',
          '## Gate',
          '',
          'the gate body for build',
          '',
          '## Active child pointer',
          '',
          '(leaf — none)',
          '',
        ].join('\n'),
      );

      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-focus-type')).toContainText('build', {
        ignoreCase: true,
        timeout: 15_000,
      });

      await page.getByTestId('focus-view-toggle').click();
      await expect(page.getByTestId('focus-view')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('focus-view-focus-type')).toContainText('build', {
        ignoreCase: true,
      });
      // The primary section is the Gate — its heading reads "Gate".
      const primary = page.getByTestId('focus-view-primary');
      await expect(primary).toContainText('Gate');
      await expect(primary).toContainText('the gate body for build');

      await app.close();

      // Flip to a goal focus with a Vision and re-launch the same project.
      writeFileSync(
        focusPath,
        [
          '---',
          'type: focus',
          'title: Demo',
          'updated: 2026-05-26',
          'references: []',
          'status: Active',
          'focus_type: goal',
          '---',
          '',
          '# Demo',
          '',
          '## Vision',
          '',
          'the directional prose for a goal',
          '',
          '## Active child pointer',
          '',
          '(leaf — none)',
          '',
        ].join('\n'),
      );

      const second = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(second.page.getByTestId('chip-focus-type')).toContainText('goal', {
        ignoreCase: true,
        timeout: 15_000,
      });
      await second.page.getByTestId('focus-view-toggle').click();
      await expect(second.page.getByTestId('focus-view')).toBeVisible({ timeout: 5_000 });
      await expect(second.page.getByTestId('focus-view-focus-type')).toContainText('goal', {
        ignoreCase: true,
      });
      // The primary section is now the Vision.
      const goalPrimary = second.page.getByTestId('focus-view-primary');
      await expect(goalPrimary).toContainText('Vision');
      await expect(goalPrimary).toContainText('the directional prose for a goal');

      await second.app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('clicking a commitment option writes dials.commitment and the chip updates', async () => {
    const fixture = makeProject();
    const statusPath = join(
      fixture.root,
      '.ai-lore-e2e-fixture',
      'memory',
      'status',
      'status.index.md',
    );
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('chip-commitment')).toContainText('neutral', {
        ignoreCase: true,
      });

      await page.getByTestId('chip-commitment').click();
      await page.getByTestId('chip-commitment-option-go').click();

      await expect(page.getByTestId('chip-commitment')).toContainText('go', {
        ignoreCase: true,
        timeout: 5_000,
      });
      const onDisk = readFileSync(statusPath, 'utf8');
      expect(onDisk).toMatch(/^ {2}commitment: go$/m);
      expect(onDisk).toMatch(/^ {2}altitude: mid$/m);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // Phase E — ACK revamp + diff viewer. The per-row "ack" became "dismiss"
  // (no git); the repo-level Ack / Save-point CTAs commit both repos.
  // These e2e tests focus on the wire-up — the buttons exist, are tied to
  // the right state, and the sheets open. The full git-commit flow is
  // covered by unit tests on the materialise + write helpers.
  // v0.6 Phase A — the header drops its shortcut sub-rows; actions live in
  // file/folder context menus; drift cluster collapses to a passive count;
  // Settings gains an Apps section that drives the catalog.
  test('the header has no shortcut sub-rows, dismiss-all, or global drift cluster (v0.6 Phase A)', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // The two per-row shortcut surfaces are gone.
      await expect(page.getByTestId('actions-row-project')).toHaveCount(0);
      await expect(page.getByTestId('actions-row-lore')).toHaveCount(0);
      // Dismiss-all is gone — drift is git-truth, no parallel acknowledgement.
      await expect(page.getByTestId('dismiss-all')).toHaveCount(0);
      // The global drift cluster is gone too — per-pane DriftPills and
      // per-file glyphs already surface drift where the user is acting.
      await expect(page.getByTestId('drift-cluster')).toHaveCount(0);
      // The repo-level commit buttons live with the AI session, not here.
      await expect(page.getByTestId('repo-ack')).toHaveCount(0);
      await expect(page.getByTestId('repo-save-point')).toHaveCount(0);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the Settings sheet exposes an Apps catalog section', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible({ timeout: 5_000 });
      // The rail has an `Apps` section — click it to open the catalog editor.
      await sheet.getByRole('button', { name: 'Apps', exact: true }).click();
      await expect(page.getByTestId('settings-apps-section')).toBeVisible();
      // Empty catalog state + the Add app button.
      await expect(page.getByTestId('apps-add')).toBeVisible();
      // The deprecated v0.5 Diff section is gone — its settings live in the
      // Apps catalog (entries with role='diff') now.
      await expect(sheet.getByRole('button', { name: 'Diff', exact: true })).toHaveCount(0);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the App picker modal opens from Settings → Apps → Add app', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible({ timeout: 5_000 });
      await sheet.getByRole('button', { name: 'Apps', exact: true }).click();
      await page.getByTestId('apps-add').click();

      const modal = page.getByTestId('app-picker-modal');
      await expect(modal).toBeVisible();
      // The preset list is the default surface.
      await expect(page.getByTestId('app-picker-presets')).toBeVisible();
      // Custom toggle is always reachable.
      await expect(page.getByTestId('app-picker-custom-toggle')).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the Changes panel renders an inline diff preview region', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // Preview testIDs are keyed by pane label so Status (scope=lore) and
      // Memory (scope=lore) don't collide. The Status tab is the default on
      // launch — its preview is rendered + visible.
      const statusPreview = page.getByTestId('changes-preview-status');
      await expect(statusPreview).toBeVisible({ timeout: 5_000 });
      // No selection yet → the empty hint is visible.
      await expect(statusPreview.getByText(/Select a row to preview its diff/i)).toBeVisible();
      // The splitter between the file list and the preview is present.
      await expect(page.getByTestId('changes-splitter-status')).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('apps migration v2 cleans v1 verb-prefixed labels on launch and dedups by tuple', async () => {
    const fixture = makeProject();
    try {
      // Seed the userData settings.json as if v0.6 Phase A v1 migration had run:
      // boolean marker present, plus two entries with the legacy verb-prefix labels
      // that share the same .app path (different scope-bound origins) — v2 must
      // clean both labels and dedup them down to one.
      const seeded = {
        schemaVersion: 1,
        values: { 'apps.migratedFromShortcuts': true },
        ignores: [],
        apps: [
          {
            id: 'a',
            label: 'Open project in WebStorm',
            kind: 'app',
            target: 'folder',
            appPath: '/Applications/WebStorm.app',
          },
          {
            id: 'b',
            label: 'Open Lore in WebStorm',
            kind: 'app',
            target: 'folder',
            appPath: '/Applications/WebStorm.app',
          },
          {
            id: 'c',
            label: 'Open Lore in Obsidian',
            kind: 'app',
            target: 'folder',
            appPath: '/Applications/Obsidian.app',
          },
        ],
      };
      writeFileSync(join(fixture.userData, 'settings.json'), JSON.stringify(seeded, null, 2));

      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await openSettingsViaMenu(app);
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toBeVisible({ timeout: 5_000 });
      await sheet.getByRole('button', { name: 'Apps', exact: true }).click();

      const section = page.getByTestId('settings-apps-section');
      await expect(section).toBeVisible();
      // Two WebStorm entries collapsed to one; Obsidian carries forward. Labels clean.
      await expect(section.getByText('WebStorm', { exact: true })).toHaveCount(1);
      await expect(section.getByText('Obsidian', { exact: true })).toHaveCount(1);
      // The pre-cleaning labels are gone — the menu's "Open with " no longer doubles.
      await expect(section.getByText('Open project in WebStorm')).toHaveCount(0);
      await expect(section.getByText('Open Lore in WebStorm')).toHaveCount(0);
      await expect(section.getByText('Open Lore in Obsidian')).toHaveCount(0);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

});
