import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import {
  launchApp,
  makeFakeEngineBinary,
  makeProject,
  makePublishingShape,
  seedEngines,
  seedLoreChanges,
  seedVerbs,
} from './fixture';

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

      // The panel/tab workspace: in v0.9 creators live on the centre column;
      // leftRail is a locked nav rail.
      await page.getByTestId('dock-workspace').getByTestId('new-shell').first().click();
      await expect(page.getByTestId('tab-shell').first()).toBeVisible({ timeout: 5_000 });

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

      await clickNavigateItem(app, 'Find in Project…');
      await page.getByTestId('search-dialog-input').fill('demo');
      // The fixture has memory/status/focus/demo.focus.md — it shows as a result.
      await expect(
        page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' }),
      ).toBeVisible({ timeout: 5_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('content search surfaces in-file matches (or hints to install ripgrep)', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // "gate" is in demo.focus.md's body ("demo gate"), not in any file name —
      // so any hit here came from the ripgrep content path, not the name index.
      await clickNavigateItem(app, 'Find in Project…');
      await page.getByTestId('search-dialog-input').fill('gate');
      // The content round trip ran end-to-end: with ripgrep on PATH a content
      // result shows; without it, the install hint does. Either proves the wire.
      await expect(
        page.getByTestId('content-result').or(page.getByTestId('content-search-hint')).first(),
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
      await clickNavigateItem(app, 'Find in Project…');
      await page.getByTestId('search-dialog-input').fill('demo');
      const hit = page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' });
      await expect(hit).toBeVisible({ timeout: 5_000 });
      await hit.dblclick();

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

      await page.getByTestId('dock-workspace').getByTestId('new-shell').first().click();
      const tab = page.getByTestId('tab-shell').first();
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

  // v0.9 Phase A — `+ AI` opens a new AI tab directly, no popover. The tab
  // opens with the first available engine preselected (or the project's
  // last-picked one when persisted); the user changes the engine in the
  // tab's empty-state dropdown if they want. The dropdown also carries an
  // "+ Add engine…" item that deep-links Settings → Engines.
  test('+ AI opens a new AI tab with the first engine preselected', async () => {
    const fixture = makeProject();
    seedEngines(fixture.userData, [
      { id: 'claude', name: 'Claude', binary: 'claude' },
      { id: 'gemini', name: 'Gemini', binary: 'gemini' },
    ]);
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      const centre = page.getByTestId('dock-workspace');
      // Single click — no popover step.
      await centre.getByTestId('new-ai').first().click();
      // No popover renders at any point.
      await expect(page.getByTestId('new-ai-popover')).toHaveCount(0);

      const aiTab = centre.getByTestId('tab-ai');
      await expect(aiTab).toBeVisible({ timeout: 5_000 });
      // The empty-state body identifies the active engine via data-ai-engine.
      await expect(page.locator('[data-ai-engine="claude"]')).toHaveCount(1);
      // The engine dropdown surfaces the "+ Add engine…" deep-link item.
      await expect(page.getByTestId('ai-engine-picker-add')).toHaveCount(1);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.7 Phase B — the AI-tab empty state. After + AI picks an engine, the
  // empty state shows a Start button + engine dropdown; clicking Start spawns
  // the engine binary in the tab's PTY (via `zsh -l -c '<binary>'`) and the
  // body transitions to the running xterm view. We seed a fake "engine" that
  // prints a unique marker so the test can confirm the binary actually ran.
  test('Start launches the chosen engine in the AI tab PTY', async () => {
    const fixture = makeProject();
    const fake = makeFakeEngineBinary('PHASE_B_ENGINE_RAN');
    seedEngines(fixture.userData, [{ id: 'fake', name: 'Fake', binary: fake.binary }]);
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      const centre = page.getByTestId('dock-workspace');
      // v0.9: `+ AI` opens the tab directly with the only seeded engine
      // (fake) preselected — no popover.
      await centre.getByTestId('new-ai').first().click();

      const aiTab = centre.getByTestId('tab-ai');
      await expect(aiTab).toBeVisible({ timeout: 5_000 });
      // Empty state: the Start button and the engine dropdown are visible,
      // with the fake engine preselected.
      const emptyState = page.locator('[data-ai-state="empty"]');
      await expect(emptyState).toBeVisible();
      await expect(page.getByTestId('ai-engine-picker')).toBeVisible();
      await expect(page.getByTestId('ai-start')).toBeVisible();

      await page.getByTestId('ai-start').click();

      // Running state: the empty pane is gone and the xterm view writes the
      // engine's marker — proof the binary actually spawned in the PTY.
      await expect(page.locator('[data-ai-state="running"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-ai-state="empty"]')).toHaveCount(0);
      // The marker text lands in the xterm view as the binary echoes it.
      await expect(page.locator('.xterm-rows')).toContainText('PHASE_B_ENGINE_RAN', {
        timeout: 10_000,
      });

      await app.close();
    } finally {
      fake.cleanup();
      fixture.cleanup();
    }
  });

  // Focus 2 (Trust Net) — unattended e2e. A window with a running terminal task
  // pops a native confirmation in main on close/quit (`win.on('close')` /
  // `app.on('before-quit')`, both gated on `ptyService.hasRunningTask()`). That
  // modal must be dismissed by a human — so any suite leaving a task running
  // would block teardown forever. The `COCKPIT_E2E` flag the fixture sets
  // bypasses both. This spec *deliberately leaves a task running* at close: the
  // shell tab's StatusDot turning `running` is the same foreground-status feed
  // `hasRunningTask()` reads, so once it lights, the guard branch is live.
  // Without the bypass, `app.close()` would block on the modal until timeout.
  test('a window with a running terminal task tears down unattended', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      const centre = page.getByTestId('dock-workspace');
      await centre.getByTestId('new-shell').first().click();
      await expect(page.getByTestId('tab-shell').first()).toBeVisible({ timeout: 5_000 });
      const terminal = page.getByTestId('terminal').first();
      await expect(terminal).toBeVisible();

      // Type a long-running foreground command into the shell. The keystrokes
      // route through xterm's `onData` → `sendTerminalInput` to the real PTY.
      await terminal.click();
      await page.keyboard.type('sleep 30');
      await page.keyboard.press('Enter');

      // The ~1s foreground poll detects `sleep` as the foreground task and the
      // shell tab's StatusDot flips to `running` — deterministic proof that
      // `hasRunningTask()` is now true on the main side.
      await expect(page.getByTestId('tab-shell').first().getByLabel('running')).toBeVisible({
        timeout: 5_000,
      });

      // With the guard bypassed this resolves promptly; un-bypassed it would
      // hang on the native modal.
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.7 Phase C — the two-column running view. Once Start fires, the AI
  // tab body splits into a prompts column on the left and the xterm PTY on
  // the right, with a draggable resize handle between them. Phase C just
  // builds the structural layout; the prompts column is a placeholder until
  // Phase D fills it.
  test('the running AI tab renders the two-column split with a resize handle', async () => {
    const fixture = makeProject();
    const fake = makeFakeEngineBinary('PHASE_C_SPLIT_VISIBLE');
    seedEngines(fixture.userData, [{ id: 'fake', name: 'Fake', binary: fake.binary }]);
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      const centre = page.getByTestId('dock-workspace');
      // v0.9: `+ AI` opens the tab directly with the only seeded engine
      // (fake) preselected — no popover.
      await centre.getByTestId('new-ai').first().click();
      await page.getByTestId('ai-start').click();

      // The split's three pieces are all present in the running tab.
      await expect(page.getByTestId('ai-prompts-column')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('ai-prompts-resizer')).toBeVisible();
      await expect(page.locator('.xterm-rows')).toBeVisible();

      // The prompts column reports the default width on first open (no
      // persisted value yet).
      const initialWidth = await page
        .getByTestId('ai-prompts-column')
        .getAttribute('data-sidebar-width');
      expect(Number(initialWidth)).toBe(220);

      await app.close();
    } finally {
      fake.cleanup();
      fixture.cleanup();
    }
  });

  // v0.7 Phase C — width persistence. The user drags the resize handle; the
  // new width is written to the per-project engine-state.json sidecar and
  // applied on the next launch. We exercise the IPC handler directly
  // (mirroring the drag handler's mouseup callback), then re-open the app
  // and open a fresh AI tab — layout restore is disabled today, so a fresh
  // tab is the realistic restore vehicle. The width is per-project, not
  // per-tab, so a new tab still picks up the persisted value.
  test('the prompts column width persists across launches', async () => {
    const fixture = makeProject();
    const fake = makeFakeEngineBinary('PHASE_C_WIDTH_PERSISTS');
    seedEngines(fixture.userData, [{ id: 'fake', name: 'Fake', binary: fake.binary }]);
    try {
      // First launch: open an AI tab, start, write a custom width via the
      // same IPC the drag handler invokes on mouseup.
      const first = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(first.page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      // v0.9: `+ AI` opens the tab directly with the only seeded engine.
      await first.page.getByTestId('dock-workspace').getByTestId('new-ai').first().click();
      await first.page.getByTestId('ai-start').click();
      await expect(first.page.getByTestId('ai-prompts-column')).toBeVisible({ timeout: 10_000 });

      await first.page.evaluate(() => window.cockpit.aiPromptsWidthSet(310));
      await first.app.close();

      // Second launch: same userData + project. Open a fresh AI tab and
      // click Start — the running view's prompts column adopts the
      // persisted per-project width.
      const second = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(second.page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await second.page.getByTestId('dock-workspace').getByTestId('new-ai').first().click();
      await second.page.getByTestId('ai-start').click();

      await expect(second.page.getByTestId('ai-prompts-column')).toBeVisible({ timeout: 10_000 });
      // The width may briefly show the default before the IPC read resolves;
      // poll on the attribute rather than reading it once.
      await expect
        .poll(
          async () =>
            Number(
              await second.page.getByTestId('ai-prompts-column').getAttribute('data-sidebar-width'),
            ),
          { timeout: 5_000 },
        )
        .toBe(310);

      await second.app.close();
    } finally {
      fake.cleanup();
      fixture.cleanup();
    }
  });

  // v0.7 Phase D — the prompts catalog. The running AI tab's left column
  // reads `<lore>/process/verbs/*.md` + `verbs.index.md` and renders rows
  // grouped by the curated taxonomy. Clicking a row writes
  // `<slash-form>\n` into the engine's PTY stdin — the test confirms the
  // injected text reaches the xterm view.
  test('the prompts catalog renders grouped verbs and click injects the slash', async () => {
    const fixture = makeProject();
    seedVerbs(fixture.root);
    const fake = makeFakeEngineBinary('PHASE_D_PROMPTS_READY');
    seedEngines(fixture.userData, [{ id: 'fake', name: 'Fake', binary: fake.binary }]);
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId('dock-workspace').getByTestId('new-ai').first().click();
      await page.getByTestId('ai-start').click();
      await expect(page.getByTestId('ai-prompts-column')).toBeVisible({ timeout: 10_000 });

      // Curated-taxonomy verbs show by default.
      await expect(page.getByTestId('prompt-row-orient')).toBeVisible();
      await expect(page.getByTestId('prompt-row-chat')).toBeVisible();
      await expect(page.getByTestId('prompt-row-plan')).toBeVisible();
      await expect(page.getByTestId('prompt-row-save-point')).toBeVisible();
      await expect(page.getByTestId('prompt-row-close-session')).toBeVisible();
      // The lifecycle verbs land in the Advanced section, which is collapsed
      // by default — so `install` is in the DOM only after the toggle fires.
      await expect(page.getByTestId('prompt-row-install')).toHaveCount(0);
      await page.getByTestId('prompts-advanced-toggle').click();
      await expect(page.getByTestId('prompt-row-install')).toBeVisible();

      // Clear the engine's banner output so the injection lands cleanly,
      // then click `/ai-lore-orient`. The slash form arrives in the xterm
      // view (the PTY echoes input back).
      await page.getByTestId('prompt-row-orient').click();
      await expect(page.locator('.xterm-rows')).toContainText('/ai-lore-orient', {
        timeout: 10_000,
      });

      await app.close();
    } finally {
      fake.cleanup();
      fixture.cleanup();
    }
  });

  // A terminal tab carries a live PTY. Dragging the tab between panels must
  // v0.7.2 — three pinned cockpit tabs live in the tab strip directly. They
  // sit alongside shell / AI / browser tabs but are unclosable, unmovable, and
  // un-renameable. Clicking the tab swaps the active pane content.
  test('the three pinned cockpit tabs render in the strip and switch pane content', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      // All three pinned tabs appear in the left strip on launch.
      const leftStrip = page.getByTestId('tab-strip').first();
      await expect(leftStrip.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await expect(leftStrip.getByTestId('tab-payload')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-memory')).toBeVisible();
      // Default: Status pane is shown. All three panes are mounted (the
      // hidden ones are display:none via the tab-host portal contract), so
      // the assertion targets visibility, not count.
      await expect(page.getByTestId('pane-status')).toBeVisible();

      // Click Payload — its pane becomes the visible one.
      await leftStrip.getByTestId('tab-payload').click();
      await expect(page.getByTestId('pane-payload')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('pane-status')).toBeHidden();

      // Click Memory.
      await leftStrip.getByTestId('tab-memory').click();
      await expect(page.getByTestId('pane-memory')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('pane-payload')).toBeHidden();

      // The pinned tabs carry no close button (unlike shell / AI / browser).
      const statusTab = leftStrip.getByTestId('tab-status');
      await expect(statusTab.locator('button[title="Close tab"]')).toHaveCount(0);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.8 Phase A — header chips for lore version and project shape. The
  // identity row reads `coreVersion` + `shape` from the chain push and
  // renders two informational chips: the Lore version chip is always
  // visible when the manifest carries `core_version`; the Shape chip is
  // visible only when the project declares a `publish:` block.
  test('default-shape project shows the lore version chip but not the shape chip', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chip-lore-version')).toBeVisible();
      await expect(page.getByTestId('chip-lore-version')).toContainText('v0.5.1');
      await expect(page.getByTestId('chip-shape')).toHaveCount(0);
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('publishing-shape project shows both the lore version chip and the shape chip', async () => {
    const fixture = makeProject();
    makePublishingShape(fixture.root);
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chip-lore-version')).toBeVisible();
      await expect(page.getByTestId('chip-lore-version')).toContainText('v0.5.1');
      await expect(page.getByTestId('chip-shape')).toBeVisible();
      await expect(page.getByTestId('chip-shape')).toContainText('Publishing');
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.8 Phase B — pane model adapts to the project shape. A publishing-shape
  // project gets a fourth pane (Publish) sandwiched between Payload and
  // Memory; the pane is view-only — no Diff, no Ignore, no write affordances.
  test('publishing-shape project renders the four pinned panes including Publish', async () => {
    const fixture = makeProject();
    makePublishingShape(fixture.root, {
      publishFiles: ['index.html', 'README.md'],
    });
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      // All four pinned tabs render in the left strip in the methodology
      // order: Status, Payload, Publish, Memory.
      const leftStrip = page.getByTestId('tab-strip').first();
      await expect(leftStrip.getByTestId('tab-status')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-payload')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-publish')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-memory')).toBeVisible();
      // Click into the Publish tab — its view-only body renders, and the
      // seeded files surface in the file list.
      await leftStrip.getByTestId('tab-publish').click();
      await expect(page.getByTestId('pane-publish')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('publish-file-list')).toContainText('index.html');
      await expect(page.getByTestId('publish-file-list')).toContainText('README.md');
      // The Publish pane carries no ChangesPanel — drift surfaces are absent.
      await expect(
        page.getByTestId('pane-publish').locator('[data-testid^="changes-"]'),
      ).toHaveCount(0);
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.8 Phase C — Payload re-root. In publishing shape the Payload pane
  // sub-roots to `<project>/payload/` instead of the project root.
  test('publishing-shape Payload pane lists files under payload/, not at the project root', async () => {
    const fixture = makeProject();
    makePublishingShape(fixture.root, {
      payloadFiles: ['workshop.md'],
      publishFiles: ['shipped.html'],
    });
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      const leftStrip = page.getByTestId('tab-strip').first();
      await expect(leftStrip.getByTestId('tab-payload')).toBeVisible({ timeout: 15_000 });
      await leftStrip.getByTestId('tab-payload').click();
      // The Payload pane renders; its tree shows the workshop file.
      await expect(page.getByTestId('pane-payload')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('pane-payload')).toContainText('workshop.md');
      // The publish-only file does NOT appear in the Payload pane (the
      // sub-root narrows to `payload/`).
      await expect(page.getByTestId('pane-payload')).not.toContainText('shipped.html');
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // v0.8 Phase B — default-shape projects are unaffected; the Publish tab
  // does not appear.
  test('default-shape project still shows three pinned panes (no Publish)', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      const leftStrip = page.getByTestId('tab-strip').first();
      await expect(leftStrip.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await expect(leftStrip.getByTestId('tab-payload')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-memory')).toBeVisible();
      await expect(leftStrip.getByTestId('tab-publish')).toHaveCount(0);
      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  // not remount the React subtree that owns the PTY — otherwise long-running
  // CLI sessions (claude, gemini, tail -f) die on every move. The fix is the
  // stable [data-tab-host] container: one DOM node per tab.id, reparented
  // imperatively. This test pins it: the same UUID-tagged host element must
  // survive the move.
  test('a terminal tab survives being moved between dock groups', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // Create a shell on the Dockview workspace.
      const dock = page.getByTestId('dock-workspace');
      await dock.getByTestId('new-shell').first().click();
      await expect(dock.getByTestId('tab-shell').first()).toBeVisible({ timeout: 5_000 });

      // Read the terminal's stable host id. Pane hosts have known string ids
      // (status / payload / memory / assistant-host); the terminal's host is the
      // UUID-shaped one — and it doubles as its Dockview panel id.
      const PANE_IDS = ['status', 'payload', 'memory', 'publish', 'assistant-host'];
      const terminalHostId = await page.evaluate((panes: string[]) => {
        for (const el of Array.from(document.querySelectorAll('[data-tab-host]'))) {
          const id = el.getAttribute('data-tab-host');
          if (id && !panes.includes(id)) return id;
        }
        return null;
      }, PANE_IDS);
      expect(terminalHostId).toBeTruthy();

      // Move the terminal into a different group — the same cross-group move
      // Dockview performs on a drag between docks. Playwright cannot synthesize
      // Dockview's native HTML5 DnD, so the spec drives the move through the API
      // the renderer publishes under COCKPIT_E2E: add a fresh group and move the
      // panel into it. (Dockview's `moveTo` ignores `position` unless a target
      // `group` is given, so a bare `position` on a lone panel is a no-op.) The
      // move fires the layout-change event and the content seam re-parks the host
      // into the new group's slot.
      type DockApiLike = {
        getPanel(
          id: string,
        ): { group: { id: string }; api: { moveTo(o: { group: unknown }): void } } | undefined;
        addGroup(): { id: string };
      };
      const moved = await page.evaluate((id: string) => {
        const api = window.__dockApi as DockApiLike;
        const panel = api.getPanel(id);
        const before = panel?.group.id ?? null;
        const target = api.addGroup();
        panel?.api.moveTo({ group: target });
        const after = api.getPanel(id)?.group.id ?? null;
        return { before, after };
      }, terminalHostId as string);
      // The terminal really changed groups (a drop into a new bottom group).
      expect(moved.before).toBeTruthy();
      expect(moved.after).not.toBe(moved.before);

      // The same host element still exists with the same UUID — a remount would
      // have torn the host down with its React subtree (and killed the PTY),
      // then created a fresh one on remount under a new tab.id.
      await expect(page.locator(`[data-tab-host="${terminalHostId}"]`)).toHaveCount(1);

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

  test('the header renders the identity row and the chain titles are clickable', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // The header is identity only now — search moved to a ⌘F dialog (the bar
      // is gone). The shortcut sub-rows and drift cluster were dropped earlier;
      // per-pane DriftPills + per-file glyphs surface drift where the user acts.
      await expect(page.getByTestId('header-identity')).toBeVisible();
      await expect(page.getByTestId('header-search')).toHaveCount(0);
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

  test('Cmd+F (Find in Project) opens the search dialog', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 15_000 });

      // Click somewhere else first so focus isn't already in a search field.
      await page.getByTestId('pane-status').getByTestId('tree-root').click();
      await clickNavigateItem(app, 'Find in Project…');
      await expect(page.getByTestId('search-dialog')).toBeVisible({ timeout: 3_000 });
      await expect(page.getByTestId('search-dialog-input')).toBeFocused({ timeout: 3_000 });

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('⌘F opens the in-terminal find bar when a terminal has focus', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('pane-status')).toBeVisible({ timeout: 15_000 });

      // Open a shell tab and focus its terminal.
      await page.getByTestId('dock-workspace').getByTestId('new-shell').first().click();
      await expect(page.getByTestId('tab-shell').first()).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('terminal').first().click();

      // The same ⌘F action now opens the terminal find bar (focus is in the
      // terminal), not the global file search.
      await clickNavigateItem(app, 'Find in Project…');
      await expect(page.getByTestId('terminal-find')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('search-dialog')).toHaveCount(0);

      // Esc closes it.
      await page.getByTestId('terminal-find-input').press('Escape');
      await expect(page.getByTestId('terminal-find')).toBeHidden({ timeout: 3_000 });

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
      await clickNavigateItem(app, 'Find in Project…');
      await page.getByTestId('search-dialog-input').fill('demo');
      await expect(
        page.getByTestId('search-result').filter({ hasText: 'demo.focus.md' }),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('search-dialog-input').press('Escape');

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
      await clickNavigateItem(app, 'Find in Project…');
      await page.getByTestId('search-dialog-input').fill('demo');
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

  test('an external edit to status.index.md updates the header (event-driven chain, no poll)', async () => {
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

      // Write the file directly — simulating an AI session or an external
      // editor changing the posture, not a click through the IPC writer. The
      // chain is no longer polled, so the only way this reaches the header is
      // the lore watcher driving a debounced refresh.
      const before = readFileSync(statusPath, 'utf8');
      writeFileSync(statusPath, before.replace(/^posture: execute$/m, 'posture: reshape'));

      await expect(page.getByTestId('chip-posture')).toContainText('reshape', {
        ignoreCase: true,
        timeout: 5_000,
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
      // Stronger assertion: the grid lists `references` as a row of its own
      // (not just the synthetic-root header text). This is the regression
      // gate for the v0.6 bug HL reported on 2026-05-28 — references files
      // surface in the Status pane's tree, not silently absent.
      const grid = statusPane.getByTestId('grid-lore');
      await expect(grid.locator('.ag-row').filter({ hasText: 'references' })).toBeVisible({
        timeout: 5_000,
      });
      await expect(grid.locator('.ag-row').filter({ hasText: 'save-points' })).toBeVisible();
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

  test('the global baseline picker sits beside the pinned tabs and reveals acks', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // One global picker drives every pane's baseline — it lives in the locked
      // leftRail strip beside the pinned tabs, not per-pane.
      const picker = page.getByTestId('baseline-picker');
      await expect(picker).toBeVisible({ timeout: 5_000 });
      // The old per-pane baseline dropdown and inline diff preview are gone.
      await expect(page.getByTestId('changes-baseline-status')).toHaveCount(0);
      await expect(page.getByTestId('changes-preview-status')).toHaveCount(0);

      // Opening it shows the save-points-first popover with the rollup tickbox.
      await picker.click();
      await expect(page.getByTestId('baseline-picker-popover')).toBeVisible();
      await expect(page.getByTestId('baseline-rollup-acks')).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the search dialog shows per-tab scope checkboxes and an include-ignored toggle', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      await clickNavigateItem(app, 'Find in Project…');
      await expect(page.getByTestId('search-dialog')).toBeVisible({ timeout: 3_000 });
      // One scope checkbox per pinned tab (default-shape: Status/Payload/Memory),
      // each checked by default, plus the include-ignored toggle (off).
      for (const id of ['status', 'payload', 'memory']) {
        const box = page.getByTestId(`search-scope-${id}`);
        await expect(box).toBeVisible();
        await expect(box).toBeChecked();
      }
      await expect(page.getByTestId('search-scope-publish')).toHaveCount(0); // default shape
      await expect(page.getByTestId('search-include-ignored')).not.toBeChecked();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('every file/folder surface renders a row-kebab affordance', async () => {
    const fixture = makeProject();
    try {
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // Tree row kebab — the FileTree row carries a `.row-kebab-host` wrapper
      // that the global hover rule targets; the kebab itself is in the DOM
      // even when hidden (opacity 0). data-testid matches the row's path.
      const treeKebab = page.locator('[data-testid^="row-kebab-tree-"]').first();
      await expect(treeKebab).toHaveCount(1);
      // Grid + ChangesPanel kebabs live inside AG-Grid cells. The grid's row
      // count depends on the fixture's tree contents; assertion is "at least
      // one kebab exists" rather than a specific path.
      const gridKebab = page.locator('[data-testid^="row-kebab-grid-"]').first();
      await expect(gridKebab).toHaveCount(1);

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('a project on a pre-v0.5.1 core_version opens in the altered window with an upgrade banner', async () => {
    const fixture = makeProject();
    try {
      // Downgrade the fixture's manifest to a version below the cockpit's
      // minimum so the version-too-old branch fires.
      writeFileSync(
        join(fixture.root, '.ai-lore-e2e-fixture', 'workspace.yaml'),
        'project_name: e2e-fixture\ncore_version: "0.4"\n',
      );

      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      // The altered shell renders — not the cockpit; the version-specific
      // hint identifies which branch fired, and the Reload button stays
      // available for re-detection after the user runs the upgrade.
      await expect(page.getByTestId('altered')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('altered-version-hint')).toBeVisible();
      await expect(page.getByText(/AI-Lore v0\.4 — upgrade required/i)).toBeVisible();
      await expect(page.getByTestId('altered-reload')).toBeVisible();
      // The cockpit's pinned tabs must NOT have rendered.
      await expect(page.getByTestId('tab-status')).toHaveCount(0);

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

  test('the Changes panel grid excludes *.index.md rows by default and the toggle reveals them', async () => {
    const fixture = makeProject();
    try {
      // Seed a Lore git history with two untracked files in blueprint/contracts/:
      // a regular file (must surface) and an index file (filtered out unless
      // the user toggles the index-files visibility on).
      seedLoreChanges(fixture.root);
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });

      // The two seeded files live under memory/blueprint/, which the Memory
      // pane sub-roots to — switch to that tab and read its Changes panel.
      await page.getByTestId('tab-memory').click();
      const panel = page.getByTestId('changes-memory');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      // Default state: index file hidden, real file visible. Asserting on the
      // panel as a whole catches every render path — grid row, count badge,
      // group label — without coupling to AG-Grid's internal DOM shape.
      await expect(panel.getByText('example.md', { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      await expect(panel.getByText('contracts.index.md', { exact: false })).toHaveCount(0);

      // Toggle on. The `.idx` pill lives in each pane's header beside the
      // DriftPill; state is global so clicking from any pane flips them all.
      await page.getByTestId('pane-memory').getByTestId('header-show-index').click();
      await expect(panel.getByText('contracts.index.md', { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      await expect(panel.getByText('example.md', { exact: false })).toBeVisible();

      // Toggle off again: index file hidden, real one still visible.
      await page.getByTestId('pane-memory').getByTestId('header-show-index').click();
      await expect(panel.getByText('contracts.index.md', { exact: false })).toHaveCount(0);
      await expect(panel.getByText('example.md', { exact: false })).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });

  test('the Changes panel renders changed files in the shared navigator tree', async () => {
    const fixture = makeProject();
    try {
      seedLoreChanges(fixture.root);
      const { app, page } = await launchApp({ root: fixture.root, userData: fixture.userData });
      await expect(page.getByTestId('tab-status')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('tab-memory').click();
      const panel = page.getByTestId('changes-memory');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      // Read-only IDE P2: the Changes panel now shares the navigator's tree
      // engine — the same `FileTree` renders a tree pruned to the changed
      // files. It defaults fully expanded, so both the ancestor `blueprint`
      // folder row and the changed leaf file are visible without a swap.
      await expect(panel.getByText('blueprint', { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      await expect(panel.getByText('example.md', { exact: false })).toBeVisible();

      // The old AG-Grid List/Tree dropdown is gone — one engine, one layout.
      await expect(panel.getByTestId('changes-view-mode-memory')).toHaveCount(0);

      // The search box filters the pruned tree to matching paths.
      await panel.getByTestId('changes-search-memory').fill('nonexistent-zzz');
      await expect(panel.getByText('example.md', { exact: false })).toHaveCount(0);
      await panel.getByTestId('changes-search-memory').fill('');
      await expect(panel.getByText('example.md', { exact: false })).toBeVisible();

      await app.close();
    } finally {
      fixture.cleanup();
    }
  });
});
