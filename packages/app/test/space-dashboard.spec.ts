import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp, makeSpaceE2eFixture } from './space-fixture';

// The Dashboard, end to end (phase M7.5), against core's FakeGitHub, with detection
// routing on. Nothing here reaches live GitHub: the app runs with `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB`, so its GitHub port is the fake (`main/space/github-service.ts`).
// While the file `<state file>.unreachable` exists, the fake answers `unreachable`; the
// app reads that switch only in an end-to-end run of the unpackaged app.
//
// The fixture Space is installed into Claude Code on its desk, and the app's engine list
// holds one stand-in `claude` in the test's temporary folder. PM prompts use the authenticated
// MCP connection to submit a small typed report, while ordinary sessions stay alive until the
// app closes them. The fake's state file, the Space, `userData` and the script all live in
// temporary folders, removed with the app closed also when a test fails.

const APP_DIR = resolve(process.cwd());
const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');
const OWNER = 'fake-human';
const NAME = 'e2e-dashboard';
/** The Stage options on the fake Project: the default five and a sixth. */
const STAGES = ['Spec', 'Plan', 'Build', 'Review', 'Done', 'Parked'];

/** Run a module script in a child process with core importable (see `space-fixture.ts`). */
function runScript<T>(lines: string[]): T {
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', lines.join('\n')], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop() ?? 'null') as T;
}

type Seeded = {
  root: string;
  sessionsDir: string;
  focus: number;
  item: number;
  standalone: number;
};

type DashboardRun = {
  temp: string;
  userData: string;
  stateFile: string;
  seeded: Seeded;
  /** Where the stand-in `claude` script writes the arguments it was started with. */
  argvFile: string;
  env: Record<string, string>;
  cleanup: () => void;
};

/**
 * The fake Project and the Space: a repository, a Project with the six Stage options
 * and the Agents field, a focus at Build with two items (one closed) and a spec link,
 * and a standalone item. The Space is installed on its desk, and the engine list names
 * the sleeping `claude` script.
 */
function seedDashboardRun(busy = false): DashboardRun {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-dashboard-')));
  const userData = join(temp, 'user-data');
  mkdirSync(userData);
  const stateFile = join(temp, 'fake-github.json');
  const options = { temp, userData, stateFile, owner: OWNER, name: NAME, stages: STAGES, busy };
  let root: string | null = null;
  try {
    const seeded = runScript<Seeded>([
      "const core = await import('@ai-lore-companion/core');",
      "const testing = await import('@ai-lore-companion/core/testing');",
      "const { join } = await import('node:path');",
      "const { writeFileSync } = await import('node:fs');",
      `const o = ${JSON.stringify(options)};`,
      `const space = await testing.makeSpaceFixture({ templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)}, name: o.name, owner: o.owner, project: 1, repositories: ['app'] });`,
      'const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.error.message}`); return result.value; };',
      "const fake = testing.createFakeGitHub({ stateFile: o.stateFile, reposDir: join(o.temp, 'remotes') });",
      'const repository = `${o.owner}/app`;',
      "must(await fake.createRepository({ owner: o.owner, name: 'app', private: true }), 'repository');",
      "must(await fake.createRepository({ owner: o.owner, name: o.name, private: true }), 'Space repository');",
      "const project = must(await fake.createProject({ owner: o.owner, title: o.name }), 'project');",
      "const stage = must(await fake.ensureSingleSelectField({ project, name: 'Stage', options: o.stages }), 'Stage');",
      "const agentsField = must(await fake.ensureSingleSelectField({ project, name: core.AGENTS_FIELD, options: [...core.AGENTS_COLUMNS] }), 'Agents');",
      // The Project says which issues are focuses; nothing is derived from the
      // Stage, the kind label or the sub-issues any more. Without a Level every
      // issue here reads as an item and the Dashboard renders no focuses.
      "const level = must(await fake.ensureSingleSelectField({ project, name: core.LEVEL_FIELD, options: [...core.LEVEL_VALUES] }), 'Level');",
      'must(await fake.ensureLabels({ repository, labels: [',
      "  { name: core.SESSION_LABEL, color: 'ededed', description: 'A session' },",
      "  { name: 'feature', color: 'ededed', description: 'A feature' },",
      "  { name: 'paused', color: 'ededed', description: 'A paused focus' },",
      "] }), 'labels');",
      "must(await fake.ensureLabels({ repository: `${o.owner}/${o.name}`, labels: [{ name: core.SESSION_LABEL, color: 'ededed', description: 'A session' }] }), 'Space session label');",
      'const issue = async (title, body, labels) => must(await fake.createIssue({ repository, title, body, labels }), title);',
      "const focus = await issue('Dashboard focus', core.formatSpecLink('https://example.test/spec'), ['feature']);",
      "const first = await issue('First item', 'Done already.', []);",
      "const second = await issue('Second item', 'Still open.', []);",
      "const standalone = await issue('A standalone item', 'On no focus.', []);",
      'for (const child of [first, second]) must(await fake.addSubIssue({ parent: focus, child }), `sub-issue ${child.number}`);',
      'const placed = {};',
      'for (const one of [focus, first, second, standalone]) placed[one.number] = must(await fake.addIssueToProject({ project, issue: one }), `project item ${one.number}`);',
      "must(await fake.setSingleSelect({ project, item: placed[focus.number], field: level, option: core.FOCUS_LEVEL }), 'Level of the focus');",
      "must(await fake.setSingleSelect({ project, item: placed[standalone.number], field: level, option: 'Item' }), 'Level of the standalone item');",
      "must(await fake.setSingleSelect({ project, item: placed[focus.number], field: stage, option: 'Build' }), 'Stage of the focus');",
      "must(await fake.closeIssue({ issue: first }), 'close');",
      "const addFocus = async (title, stageName, labels = ['feature']) => {",
      "  const created = await issue(title, core.formatSpecLink('https://example.test/spec'), labels);",
      '  const projectItem = must(await fake.addIssueToProject({ project, issue: created }), `place ${title}`);',
      '  must(await fake.setSingleSelect({ project, item: projectItem, field: level, option: core.FOCUS_LEVEL }), `level ${title}`);',
      '  if (stageName !== null) must(await fake.setSingleSelect({ project, item: projectItem, field: stage, option: stageName }), `stage ${title}`);',
      '  return created;',
      '};',
      'if (o.busy) {',
      "  await addFocus('Build fixture 2', 'Build');",
      "  await addFocus('Build fixture 3', 'Build');",
      '  for (let index = 1; index <= 6; index += 1)',
      "    await addFocus(`Review fixture ${index}: a decision with enough detail to wrap`, 'Review');",
      "  await addFocus('Dormant fixture', null, ['feature', 'paused']);",
      '  for (let index = 1; index <= 4; index += 1)',
      "    fake.addOpenPullRequest(repository, { repository, number: 100 + index, title: `Open pull request ${index}`, url: `https://github.com/${repository}/pull/${100 + index}`, headBranch: `fixture-${index}`, baseBranch: 'main', draft: index === 4, createdAt: `2026-09-0${index}T00:00:00Z`, updatedAt: `2026-09-1${index}T00:00:00Z`, checks: ['failing', 'passing', 'pending', 'none'][index - 1], review: ['none', 'approved', 'review-required', 'changes-requested'][index - 1], mergeable: 'unknown' });",
      '  for (let index = 1; index <= 4; index += 1)',
      '    writeFileSync(join(space.paths.drafts, `review-fixture-${index}.md`), `# Review fixture ${index}\\n\\nReady for a decision.\\n`);',
      '  for (let index = 1; index <= 6; index += 1)',
      '    writeFileSync(join(space.paths.journal, `2026-09-1${index}-fixture-session-${index}.md`), `# Handover fixture ${index}\\n\\n## Next action\\nContinue fixture handover ${index}.\\n\\n## What happened\\nPrepared the populated dashboard.\\n\\n## Where things stand\\nThe fixture is ready for review.\\n`);',
      '  for (let index = 1; index <= 4; index += 1) {',
      "    const agent = await issue(`Agent fixture ${index}`, 'A Project-only session fixture.', [core.SESSION_LABEL]);",
      '    const projectItem = must(await fake.addIssueToProject({ project, issue: agent }), `place agent ${index}`);',
      "    must(await fake.setSingleSelect({ project, item: projectItem, field: agentsField, option: index === 1 ? 'Blocked' : 'Read only' }), `agent ${index}`);",
      '  }',
      '}',
      'fake.save(o.stateFile);',
      "const lore = must(await core.readLore(space.root), 'lore');",
      'const desk = core.deskPaths(o.userData, space.root);',
      "must(await core.installClaudeCode(lore, desk.install), 'install');",
      'console.log(JSON.stringify({ root: space.root, sessionsDir: desk.sessions, focus: focus.number, item: second.number, standalone: standalone.number }));',
    ]);
    root = seeded.root;

    // The engine list: one engine, a stand-in `claude` that reports for PM prompts and sleeps
    // for ordinary sessions.
    // The catalog merge (M9.4) matches it by binary basename into the
    // catalog's `default.claude` slot, keeping this absolute path, so a
    // guarded session runs the stand-in and never the real `claude` on this
    // machine's PATH. `removedDefaults` is a stale v0.8 field: catalog
    // engines can no longer be removed, and the app drops it on load.
    const bin = join(temp, 'bin');
    mkdirSync(bin);
    const engine = join(bin, 'claude');
    const argvFile = join(bin, 'argv.txt');
    // M10.9 item 5: a parameter ticked on the start control must reach the
    // engine's argument list. The stand-in writes what it was called with
    // before it serves the session, so a test can read it back.
    const sdkRoot = resolve(APP_DIR, '../../node_modules/@modelcontextprotocol/sdk/dist/esm');
    writeFileSync(
      engine,
      [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "if (args[0] === '--version') { console.log('2.1.278 (Claude Code)'); process.exit(0); }",
        "if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true})); process.exit(0); }",
        `fs.writeFileSync(${JSON.stringify(argvFile)} + '-' + (process.env.AI_LORE_SESSION_ID ?? 'unknown'), args.join('\\n') + '\\n');`,
        "const allowed = args.indexOf('--allowedTools');",
        "const initialPrompt = allowed > 0 ? args[allowed - 1] : '';",
        '(async () => {',
        `if (initialPrompt.includes('Read get_dashboard_context first, then update the dashboard by calling report_dashboard with complete typed values.')) { const { Client } = await import(${JSON.stringify(pathToFileURL(join(sdkRoot, 'client/index.js')).href)}); const { StreamableHTTPClientTransport } = await import(${JSON.stringify(pathToFileURL(join(sdkRoot, 'client/streamableHttp.js')).href)}); const config = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')); const server = Object.values(config.mcpServers)[0]; const client = new Client({name:'dashboard-e2e',version:'1.0'}); await client.connect(new StreamableHTTPClientTransport(new URL(server.url), {requestInit:{headers:server.headers}})); const context = await client.callTool({name:'get_dashboard_context',arguments:{}}); const text = context.content?.[0]?.text ?? '{}'; const dashboard = JSON.parse(text); await client.callTool({name:'report_dashboard',arguments:{definitionHash:dashboard.definition?.hash,components:[{id:'next-action-note',type:'text',text:'The current action unblocks the fixture.'},{id:'dormant-note',type:'text',text:'The dormant work needs review.'}],basis:'Deterministic dashboard E2E fixture.'}}); await client.close(); }`,
        'setInterval(() => undefined, 1000);',
        '})().catch((error) => { console.error(error); process.exit(1); });',
        '',
      ].join('\n'),
    );
    chmodSync(engine, 0o755);
    writeFileSync(
      join(userData, 'engines.json'),
      JSON.stringify({
        engines: [
          {
            id: 'e2e.claude',
            name: 'Stand-in for Claude Code',
            binary: engine,
            // Not ticked by default (M10.3 rule 3: Claude Code's seed is `[]`),
            // so the two other tests of this file start exactly as before.
            params: [{ text: '--dangerously-skip-permissions', defaultOn: false }],
          },
        ],
      }),
    );

    const spaceDir = dirname(seeded.root);
    return {
      temp,
      userData,
      stateFile,
      seeded,
      argvFile,
      env: { AI_LORE_FAKE_GITHUB: stateFile },
      cleanup: () => {
        rmSync(spaceDir, { recursive: true, force: true, maxRetries: 3 });
        rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
      },
    };
  } catch (caught) {
    if (root !== null) rmSync(dirname(root), { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
    throw caught;
  }
}

/** The manual session's MCP connection, not the PM automatically started on open. */
function sessionMcpFile(sessionsDir: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  const recordsFile = join(dirname(sessionsDir), 'desk', 'sessions.json');
  if (!existsSync(recordsFile)) return null;
  const records = (
    JSON.parse(readFileSync(recordsFile, 'utf8')) as {
      records: Array<{ id: string; purpose?: string; closedAt?: string }>;
    }
  ).records;
  for (const entry of readdirSync(sessionsDir)) {
    if (
      !records.some(
        (record) =>
          record.id === entry && record.purpose === undefined && record.closedAt === undefined,
      )
    )
      continue;
    const file = join(sessionsDir, entry, 'mcp.json');
    if (existsSync(file)) return file;
  }
  return null;
}

/** Call one tool of the session server as the session's engine would, in a child process. */
function callSessionTool(
  mcpFile: string,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return runScript<Record<string, unknown>>([
    "const { readFileSync } = await import('node:fs');",
    "const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');",
    "const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');",
    `const config = JSON.parse(readFileSync(${JSON.stringify(mcpFile)}, 'utf8'));`,
    'const server = Object.values(config.mcpServers)[0];',
    "const client = new Client({ name: 'e2e-engine', version: '1.0.0' });",
    'await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));',
    `const result = await client.callTool({ name: ${JSON.stringify(name)}, arguments: ${JSON.stringify(args)} });`,
    'await client.close();',
    "if (result.isError) throw new Error(result.content[0]?.text ?? 'the tool failed');",
    'console.log(result.content[0].text);',
  ]);
}

async function showDashboard(page: Page): Promise<void> {
  await expect(page.getByTestId('space-window')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('space-rail-dashboard').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

/** Press Refresh and wait until the refresh has answered. */
async function refresh(page: Page): Promise<void> {
  const button = page.getByTestId('dashboard-refresh');
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  await expect(page.getByTestId('dashboard-state')).toHaveAttribute('data-refreshing', 'false', {
    timeout: 15_000,
  });
}

/** Start a session from the Dashboard; Sessions is shown with the session's header. */
async function startSession(page: Page): Promise<void> {
  await page.getByTestId('space-rail-sessions').click();
  const start = page.getByRole('button', { name: 'Start a Claude Code session', exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.getByTestId('space-rail-sessions')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-testid="session-header"]:visible')).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('the Dashboard', () => {
  test('keeps the three v2 bands useful in an empty Space at a narrow viewport', async () => {
    test.setTimeout(90_000);
    const fixture = makeSpaceE2eFixture('e2e-dashboard-empty');
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({ root: fixture.root, userData: fixture.userData });
      app = launched.app;
      const page = launched.page;
      const viewport = { width: 1000, height: 800 };
      await launched.app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      }, viewport);
      await page.setViewportSize(viewport);
      await showDashboard(page);

      await expect(page.getByRole('heading', { name: 'NEEDS YOU' })).toBeVisible();
      await expect(page.getByTestId('dashboard-v2-needs-you')).toContainText('NOTHING NEEDS YOU');
      await expect(page.getByRole('heading', { name: 'WHAT IS MOVING' })).toBeVisible();
      await expect(page.getByText('Nothing is in progress.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'WHAT IS WAITING' })).toBeVisible();
      await expect(page.getByText('NO OPEN PULL REQUESTS')).toBeVisible();
      await expect(page.getByText('No session is running on this desk.')).toBeVisible();
      await expect(page.getByText('No session issue is open.')).toBeVisible();
      await expect(page.getByText('No handover has been written in this Space yet.')).toBeVisible();
      expect(
        await page
          .getByTestId('dashboard-v2')
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath('dashboard-empty-1000.png') });
    } finally {
      await closeSpaceApp(app);
      fixture.cleanup();
    }
  });

  test('shows a v1-definition fallback diagnostic without replacing the v2 dashboard', async () => {
    test.setTimeout(90_000);
    const run = seedDashboardRun();
    let app: ElectronApplication | undefined;
    try {
      writeFileSync(
        join(run.seeded.root, 'lore', 'corpus', 'dashboard.json'),
        JSON.stringify({ version: 1, sections: [], components: [] }),
      );
      const launched = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = launched.app;
      await showDashboard(launched.page);
      await expect(launched.page.getByTestId('dashboard-definition-diagnostic')).toContainText(
        'The Dashboard requires version 2',
      );
      await expect(launched.page.getByTestId('dashboard-v2')).toBeVisible();
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('shows recent Workbench documents and opens exact paths in the shared Files window', async () => {
    test.setTimeout(120_000);
    const run = seedDashboardRun();
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = launched.app;
      const page = launched.page;
      await showDashboard(page);

      const drafts = join(run.seeded.root, 'workbench', 'drafts');
      mkdirSync(drafts, { recursive: true });
      const firstPath = join(drafts, 'alpha-spec.md');
      const secondPath = join(drafts, 'beta-notes.md');
      writeFileSync(firstPath, '# Alpha review spec\n\nA recent proposal.\n');
      writeFileSync(secondPath, '# Beta notes\n\nA second recent proposal.\n');

      // The Workbench poll supplies context changes without a PM report request.
      const documents = page
        .getByRole('heading', { name: 'drafts awaiting your review' })
        .locator('xpath=ancestor::article');
      const first = documents.getByRole('button', { name: /Alpha review spec/ });
      const second = documents.getByRole('button', { name: /Beta notes/ });
      await expect(first).toBeVisible({ timeout: 15_000 });
      await expect(second).toBeVisible({ timeout: 15_000 });
      await expect(documents).toContainText('LOCAL WORKBENCH');

      // The first click opens the Files window and preserves the exact relative path.
      const filesOpened = app.waitForEvent('window');
      await first.click();
      const files = await filesOpened;
      await expect(files.getByTestId('files-window')).toBeVisible({ timeout: 15_000 });
      const firstTab = files.getByTestId('files-doc-tab-workbench-drafts/alpha-spec.md');
      await expect(firstTab).toHaveAttribute('data-active', 'true', { timeout: 15_000 });
      await expect(files.getByTestId('files-editor-cm-host')).toBeVisible();

      // A second click reuses the already open Files window and activates Beta.
      await second.click();
      const secondTab = files.getByTestId('files-doc-tab-workbench-drafts/beta-notes.md');
      await expect(secondTab).toHaveAttribute('data-active', 'true', { timeout: 15_000 });

      // A stale dashboard entry remains actionable long enough to report a clear
      // editor failure when its Workbench path has been deleted.
      await files.getByTestId('files-doc-close-workbench-drafts/beta-notes.md').click();
      unlinkSync(secondPath);
      await second.click();
      await expect(files.getByTestId('files-editor-status-not-text')).toHaveText(
        'There is no file at this path in the working tree.',
        { timeout: 15_000 },
      );
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('crowded overview and session roster remain usable at wide and narrow sizes', async () => {
    test.setTimeout(150_000);
    const run = seedDashboardRun(true);
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = launched.app;
      const page = launched.page;
      await page.setViewportSize({ width: 1440, height: 900 });
      await showDashboard(page);
      await refresh(page);
      await expect(page.getByRole('heading', { name: 'NEEDS YOU' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'WHAT IS MOVING' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'WHAT IS WAITING' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'HANDOVERS' })).toBeVisible();
      await expect(page.getByText('3 IN PROGRESS · 6 QUEUED')).toBeVisible();
      await expect(
        page.getByTestId('dashboard-v2-overflow').filter({ hasText: 'queued' }),
      ).toContainText('+3 more');
      const dormant = page.locator('.dashboard-v2-dormant-row');
      const reviewBacklog = dormant.getByRole('button', { name: /Review backlog/ });
      await expect(reviewBacklog).toBeVisible();
      const [dormantBounds, backlogBounds] = await Promise.all([
        dormant.boundingBox(),
        reviewBacklog.boundingBox(),
      ]);
      expect(dormantBounds).not.toBeNull();
      expect(backlogBounds).not.toBeNull();
      expect((backlogBounds?.x ?? 0) + (backlogBounds?.width ?? 0)).toBeLessThanOrEqual(
        (dormantBounds?.x ?? 0) + (dormantBounds?.width ?? 0),
      );
      expect((backlogBounds?.y ?? 0) + (backlogBounds?.height ?? 0)).toBeLessThanOrEqual(
        (dormantBounds?.y ?? 0) + (dormantBounds?.height ?? 0),
      );
      await reviewBacklog.click();
      const dormantSheet = page.getByTestId('dashboard-dormant-sheet');
      await expect(dormantSheet).toContainText('DORMANT FOCUSES');
      await dormantSheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(
        page.getByTestId('dashboard-v2-overflow').filter({ hasText: 'drafts' }),
      ).toContainText('+1 more drafts');
      await expect(
        page.getByTestId('dashboard-v2-overflow').filter({ hasText: 'pull requests' }),
      ).toContainText('+1 more pull requests');
      await expect(
        page.getByTestId('dashboard-v2-overflow').filter({ hasText: 'handovers' }),
      ).toContainText('+1 more handovers');
      const agentsPanel = page
        .getByRole('heading', { name: 'AGENTS BOARD', exact: true })
        .locator('xpath=ancestor::article');
      await expect(agentsPanel).toContainText('4 SESSIONS');
      await expect(agentsPanel.getByRole('button', { name: /\+1 more sessions/ })).toBeVisible();
      await expect(page.locator('.dashboard-v2-draft-row')).toHaveCount(3);
      await expect(page.getByRole('link', { name: /Open pull request/ })).toHaveCount(3);
      await expect(page.getByTestId('handover-card')).toHaveCount(5);
      const clippedWaitingPanels = Object.fromEntries(
        await Promise.all(
          ['PULL REQUESTS', 'LIVE SESSIONS', 'AGENTS BOARD'].map(async (name) => {
            const panel = page
              .getByRole('heading', { name, exact: true })
              .locator('xpath=ancestor::article');
            return [
              name,
              await panel.evaluate((node) => {
                const bottom = node.getBoundingClientRect().bottom;
                return [...node.children]
                  .filter((child) => child.getBoundingClientRect().bottom > bottom + 1)
                  .map((child) => child.textContent?.trim().slice(0, 80) ?? child.tagName);
              }),
            ] as const;
          }),
        ),
      );
      expect(clippedWaitingPanels).toEqual({
        'PULL REQUESTS': [],
        'LIVE SESSIONS': [],
        'AGENTS BOARD': [],
      });
      await page.getByTestId('handover-card').first().click();
      await expect(page.getByTestId('handover-sheet')).toBeVisible();
      await page.getByTestId('handover-sheet-close').click();
      // A focus card is keyboard reachable even when the queued rows are capped.
      const focus = page.locator('.dashboard-v2-moving-row').first();
      await expect(focus).toBeVisible();
      await focus.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('dashboard-focus-sheet')).toBeVisible();
      await page.getByTestId('dashboard-sheet-close').click();

      await startSession(page);
      const worker = page.getByTestId('session-roster-worker');
      await expect(worker).toHaveCount(1);
      await expect.poll(() => sessionMcpFile(run.seeded.sessionsDir)).not.toBeNull();
      const mcp = sessionMcpFile(run.seeded.sessionsDir) as string;
      callSessionTool(mcp, 'request_writing', {
        targets: [{ kind: 'lore' }],
        item: run.seeded.item,
        reason: 'Exercise roster claim updates in the isolated test Space.',
      });
      await page.getByTestId('writing-confirm').click();
      await expect(worker).toContainText('Writing');

      // Selecting the PM and the worker must switch the real dock's visible terminal header.
      await page.getByTestId('pm-select').click();
      await expect(page.locator('[data-testid="session-header-mode"]:visible')).toHaveText(
        'Read only',
      );
      const tabId = await worker.getAttribute('data-tab-id');
      await page.getByTestId(`session-roster-select-${tabId}`).click();
      await expect(page.locator('[data-testid="session-header-mode"]:visible')).toHaveText(
        'Writing',
      );

      await page.getByTestId('space-rail-dashboard').click();
      await refresh(page);
      await page.emulateMedia({ colorScheme: 'dark' });

      // Supply typed fixture values through the authenticated PM channel, never renderer injection.
      const recordsFile = join(dirname(run.seeded.sessionsDir), 'desk', 'sessions.json');
      const records = JSON.parse(readFileSync(recordsFile, 'utf8')).records as Array<{
        id: string;
        purpose?: string;
        closedAt?: string;
      }>;
      const pm = records.find((record) => record.purpose === 'pm' && !record.closedAt);
      expect(pm).toBeDefined();
      const pmMcp = join(run.seeded.sessionsDir, pm?.id ?? '', 'mcp.json');
      const dashboardContext = callSessionTool(pmMcp, 'get_dashboard_context', {});
      const definitionHash = (dashboardContext.definition as { hash?: unknown } | undefined)?.hash;
      expect(typeof definitionHash).toBe('string');
      callSessionTool(pmMcp, 'report_dashboard', {
        definitionHash,
        components: [
          {
            id: 'next-action-note',
            type: 'text',
            text: 'Three Build focuses and six focuses awaiting review.',
          },
          {
            id: 'dormant-note',
            type: 'text',
            text: 'The unstaged work needs review before the next release.',
          },
        ],
        basis: 'Isolated E2E Project fixture and its local session records.',
      });

      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1000, height: 800 },
        { width: 800, height: 800 },
      ]) {
        await launched.app.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        }, viewport);
        await page.setViewportSize(viewport);
        await page.getByTestId('space-rail-dashboard').click();
        const pmLine = page.getByText('Three Build focuses and six focuses awaiting review.');
        await expect(pmLine).toBeVisible();
        for (const action of [focus, pmLine]) {
          await action.scrollIntoViewIfNeeded();
          const bounds = await action.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds?.x).toBeGreaterThanOrEqual(0);
          expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
          expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
        }
        await page.getByTestId('dashboard').evaluate((node) => {
          node.scrollTop = 0;
        });
        expect(
          await page
            .getByTestId('dashboard-v2')
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        if (viewport.width === 1440) {
          const dashboard = page.getByTestId('dashboard-v2');
          await page.screenshot({ path: test.info().outputPath('dashboard-1440.png') });
          const geometry = await dashboard.evaluate((node) => {
            const rect = (element: Element) => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return {
                x,
                y,
                width,
                height,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
              };
            };
            return {
              dashboard: rect(node),
              bands: [
                ...node.querySelectorAll(
                  '.dashboard-v2-band-needs-you, .dashboard-v2-band-moving, .dashboard-v2-waiting-band, .dashboard-v2-handovers',
                ),
              ].map(rect),
            };
          });
          await test.info().attach('dashboard-1440-geometry', {
            body: JSON.stringify(geometry, null, 2),
            contentType: 'application/json',
          });
          expect(
            geometry.dashboard.scrollHeight <= geometry.dashboard.clientHeight + 1,
            JSON.stringify(geometry),
          ).toBe(true);
          expect(
            await dashboard.locator('*').evaluateAll((nodes) =>
              nodes
                .filter((node) => {
                  const style = getComputedStyle(node);
                  return (
                    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                    node.scrollHeight > node.clientHeight + 1
                  );
                })
                .map((node) => node.className),
            ),
          ).toEqual([]);
        } else {
          await page.screenshot({
            path: test.info().outputPath(`dashboard-${viewport.width}.png`),
          });
        }
        await page.getByTestId('space-rail-sessions').click();
        await expect(page.getByTestId('session-roster')).toBeVisible();
        await expect(page.locator('[data-testid="session-header-mode"]:visible')).toHaveText(
          'Writing',
        );
        await expect(page.locator('[data-testid="session-header"]:visible')).toBeInViewport();
        // Wait for the restored dock to receive pointer input after switching screens.
        await page
          .getByRole('button', { name: 'Leave Writing', exact: true })
          .click({ trial: true });
        expect(
          await page
            .getByTestId('space-sessions')
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`sessions-${viewport.width}.png`) });
      }

      const toggle = page.getByTestId('session-roster-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-testid="session-header-mode"]:visible')).toHaveText(
        'Writing',
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(worker).toHaveCount(1);
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('with the fake reachable: the Project by Stage, the Agents board and Needs you', async () => {
    test.setTimeout(150_000);
    const run = seedDashboardRun();
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = launched.app;
      const page = launched.page;
      await showDashboard(page);
      await refresh(page);
      const state = page.getByTestId('dashboard-state');
      await expect(state).toHaveAttribute('data-state', 'fresh');
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await expect(page.getByTestId('dashboard-state-sentence')).toContainText(
        'Read from GitHub at',
      );

      // The moving band carries the staged focus and opens the existing focus sheet.
      const card = page.locator('.dashboard-v2-moving-row').filter({ hasText: 'Dashboard focus' });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`#${run.seeded.focus}`);
      await expect(card).toContainText('Build');
      await card.click();
      const sheet = page.getByTestId('dashboard-focus-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('dashboard-sheet-item')).toHaveCount(2);
      await sheet.getByTestId('dashboard-sheet-close').click();
      await expect(sheet).toHaveCount(0);

      // The Agents board is distinct from live sessions and starts empty.
      await expect(
        page.getByRole('heading', { name: 'AGENTS BOARD' }).locator('xpath=ancestor::article'),
      ).toContainText('No session issue is open.');

      // Starting a session is a Sessions action even though the Dashboard opens first.
      await startSession(page);
      let mcpFile: string | null = null;
      await expect
        .poll(
          () => {
            mcpFile = sessionMcpFile(run.seeded.sessionsDir);
            return mcpFile !== null;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      const mcp = mcpFile as unknown as string;
      const sessionId = dirname(mcp).split('/').pop() ?? '';

      // The session asks to enter Writing on the open item; the Human Lead confirms.
      const writing = callSessionTool(mcp, 'request_writing', {
        targets: [{ kind: 'lore' }],
        item: run.seeded.item,
        reason: 'Build the item.',
      });
      expect(typeof writing.ticket).toBe('string');
      const writingDialog = page.getByTestId('writing-dialog');
      await expect(writingDialog).toBeVisible({ timeout: 10_000 });
      await writingDialog.getByTestId('writing-confirm').click();
      await expect(writingDialog).toHaveCount(0, { timeout: 10_000 });

      // After a refresh, both distinct waiting panels reflect the session.
      await page.getByTestId('space-rail-dashboard').click();
      const agents = page
        .getByRole('heading', { name: 'AGENTS BOARD' })
        .locator('xpath=ancestor::article');
      const live = page
        .getByRole('heading', { name: 'LIVE SESSIONS' })
        .locator('xpath=ancestor::article');
      await expect
        .poll(
          async () => {
            await refresh(page);
            return agents.getByText(/WRITING/).count();
          },
          { timeout: 30_000 },
        )
        .toBe(1);
      // The catalog merge (M9.4) normalises the stand-in `claude` entry's id
      // and name to the catalog's own (`default.claude` / "Claude Code"),
      // keeping its stored absolute binary path — the stand-in still runs.
      await expect(agents).toContainText(/The default\.claude session that started at /);
      await expect(agents).not.toContainText(sessionId);
      await expect(live).toContainText('WRITING');

      // A gate the session asks is first in Needs you, and its action opens its dialog.
      const gate = callSessionTool(mcp, 'request_gate', {
        process: 'specify',
        step: 'confirm',
        question: 'Is the end-to-end draft agreed?',
      });
      expect(typeof gate.ticket).toBe('string');
      const gateDialog = page.getByTestId('gate-dialog');
      await expect(gateDialog).toBeVisible({ timeout: 10_000 });
      await gateDialog.getByRole('button', { name: 'Close without answering' }).click();
      await expect(gateDialog).toHaveCount(0);
      const nextAction = page.locator('.dashboard-v2-next-action');
      await expect(nextAction).toContainText('Is the end-to-end draft agreed?');
      await nextAction.getByRole('button', { name: 'Open gate' }).click();
      await expect(gateDialog).toBeVisible();
      await expect(gateDialog.getByTestId('gate-question')).toHaveText(
        'Is the end-to-end draft agreed?',
      );
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('with the fake unreachable: the cache with its age and the offline sentence, and Start a session works', async () => {
    test.setTimeout(150_000);
    const run = seedDashboardRun();
    let app: ElectronApplication | undefined;
    try {
      // A first run reads the Project into the cache.
      const first = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = first.app;
      await showDashboard(first.page);
      await refresh(first.page);
      await expect(first.page.getByTestId('dashboard-state')).toHaveAttribute(
        'data-state',
        'fresh',
      );
      await closeSpaceApp(app);

      // GitHub cannot be reached now.
      writeFileSync(`${run.stateFile}.unreachable`, '');
      const second = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = second.app;
      const page = second.page;
      await showDashboard(page);
      await refresh(page);
      await expect(page.getByTestId('dashboard-state')).toHaveAttribute('data-state', 'offline');
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      const sentence = page.getByTestId('dashboard-state-sentence');
      await expect(sentence).toContainText('GitHub could not be reached.');
      await expect(sentence).toContainText('The last good read is from');
      await expect(sentence).toContainText(/ago\.$/);

      // The cached Project remains visible through the moving band.
      await expect(page.locator('.dashboard-v2-moving-row')).toContainText('Dashboard focus');

      // Start a session does not need GitHub.
      await startSession(page);
      await expect
        .poll(() => sessionMcpFile(run.seeded.sessionsDir) !== null, { timeout: 10_000 })
        .toBe(true);
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });

  test('a guard-changing parameter ticked on the start control reaches the engine, and labels the session unguarded (M10.9 item 5)', async () => {
    test.setTimeout(150_000);
    const run = seedDashboardRun();
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchSpaceApp({
        root: run.seeded.root,
        userData: run.userData,
        env: run.env,
      });
      app = launched.app;
      const page = launched.page;
      await showDashboard(page);

      // Sessions owns starting AI now that the Dashboard opens a Space.
      await page.getByTestId('space-rail-sessions').click();
      await page.getByRole('button', { name: 'Options and readiness', exact: true }).click();
      const param = page.getByTestId('new-ai-param-0');
      await expect(param).toBeVisible({ timeout: 15_000 });
      await expect(param).not.toBeChecked();
      await param.check();
      await expect(page.getByTestId('new-ai-unguarded-note')).toContainText(
        'This session will be unguarded',
      );

      await page
        .getByRole('button', { name: 'Start an unguarded Claude Code session', exact: true })
        .click();
      await expect(page.locator('[data-testid="session-header"]:visible')).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(() => sessionMcpFile(run.seeded.sessionsDir) !== null, { timeout: 10_000 })
        .toBe(true);

      // The ticked parameter reached the stand-in engine's argument list.
      const manualMcp = sessionMcpFile(run.seeded.sessionsDir);
      expect(manualMcp).not.toBeNull();
      const manualArgv = `${run.argvFile}-${dirname(manualMcp as string)
        .split('/')
        .pop()}`;
      await expect.poll(() => existsSync(manualArgv), { timeout: 10_000 }).toBe(true);
      const argv = readFileSync(manualArgv, 'utf8').split('\n');
      expect(argv).toContain('--dangerously-skip-permissions');

      // The tab and the session header say the session is unguarded.
      await expect(page.getByTestId('tab-ai').filter({ hasText: '· unguarded' })).toBeVisible();
      await expect(page.getByTestId('session-header-unguarded')).toHaveText('Unguarded');
    } finally {
      await closeSpaceApp(app);
      run.cleanup();
    }
  });
});
