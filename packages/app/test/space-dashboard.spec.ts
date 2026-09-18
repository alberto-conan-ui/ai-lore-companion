import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { closeSpaceApp, launchSpaceApp } from './space-fixture';

// The Dashboard, end to end (phase M7.5), against core's FakeGitHub, with detection
// routing on. Nothing here reaches live GitHub: the app runs with `COCKPIT_E2E=1` and
// `AI_LORE_FAKE_GITHUB`, so its GitHub port is the fake (`main/space/github-service.ts`).
// While the file `<state file>.unreachable` exists, the fake answers `unreachable`; the
// app reads that switch only in an end-to-end run of the unpackaged app.
//
// The fixture Space is installed into Claude Code on its desk, and the app's engine list
// holds one engine: a script named `claude` in the test's temporary folder that only
// sleeps. So Start a session passes the guarded start's checks and starts that script,
// never the real engine. The test then acts as the session's engine: a child process
// reads the session's `mcp.json` and calls the companion's session server, as the
// engine would. The fake's state file, the Space, `userData` and the script all live in
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
  env: Record<string, string>;
  cleanup: () => void;
};

/**
 * The fake Project and the Space: a repository, a Project with the six Stage options
 * and the Agents field, a focus at Build with two items (one closed) and a spec link,
 * and a standalone item. The Space is installed on its desk, and the engine list names
 * the sleeping `claude` script.
 */
function seedDashboardRun(): DashboardRun {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'ai-lore-e2e-dashboard-')));
  const userData = join(temp, 'user-data');
  mkdirSync(userData);
  const stateFile = join(temp, 'fake-github.json');
  const options = { temp, userData, stateFile, owner: OWNER, name: NAME, stages: STAGES };
  let root: string | null = null;
  try {
    const seeded = runScript<Seeded>([
      "const core = await import('@ai-lore-companion/core');",
      "const testing = await import('@ai-lore-companion/core/testing');",
      "const { join } = await import('node:path');",
      `const o = ${JSON.stringify(options)};`,
      `const space = await testing.makeSpaceFixture({ templateDir: ${JSON.stringify(LORE_TEMPLATE_DIR)}, name: o.name, owner: o.owner, project: 1 });`,
      'const must = (result, what) => { if (!result.ok) throw new Error(`${what}: ${result.error.message}`); return result.value; };',
      "const fake = testing.createFakeGitHub({ stateFile: o.stateFile, reposDir: join(o.temp, 'remotes') });",
      'const repository = `${o.owner}/${o.name}`;',
      "must(await fake.createRepository({ owner: o.owner, name: o.name, private: true }), 'repository');",
      "const project = must(await fake.createProject({ owner: o.owner, title: o.name }), 'project');",
      "const stage = must(await fake.ensureSingleSelectField({ project, name: 'Stage', options: o.stages }), 'Stage');",
      "must(await fake.ensureSingleSelectField({ project, name: core.AGENTS_FIELD, options: [...core.AGENTS_COLUMNS] }), 'Agents');",
      'must(await fake.ensureLabels({ repository, labels: [',
      "  { name: core.SESSION_LABEL, color: 'ededed', description: 'A session' },",
      "  { name: 'feature', color: 'ededed', description: 'A feature' },",
      "] }), 'labels');",
      'const issue = async (title, body, labels) => must(await fake.createIssue({ repository, title, body, labels }), title);',
      "const focus = await issue('Dashboard focus', core.formatSpecLink('https://example.test/spec'), ['feature']);",
      "const first = await issue('First item', 'Done already.', []);",
      "const second = await issue('Second item', 'Still open.', []);",
      "const standalone = await issue('A standalone item', 'On no focus.', []);",
      'for (const child of [first, second]) must(await fake.addSubIssue({ parent: focus, child }), `sub-issue ${child.number}`);',
      'const placed = {};',
      'for (const one of [focus, first, second, standalone]) placed[one.number] = must(await fake.addIssueToProject({ project, issue: one }), `project item ${one.number}`);',
      "must(await fake.setSingleSelect({ project, item: placed[focus.number], field: stage, option: 'Build' }), 'Stage of the focus');",
      "must(await fake.closeIssue({ issue: first }), 'close');",
      'fake.save(o.stateFile);',
      "const lore = must(await core.readLore(space.root), 'lore');",
      'const desk = core.deskPaths(o.userData, space.root);',
      "must(await core.installClaudeCode(lore, desk.install), 'install');",
      'console.log(JSON.stringify({ root: space.root, sessionsDir: desk.sessions, focus: focus.number, item: second.number, standalone: standalone.number }));',
    ]);
    root = seeded.root;

    // The engine list: one engine, a script named `claude` that only sleeps. The defaults
    // are recorded as removed, so the real `claude` on this machine is never added.
    const bin = join(temp, 'bin');
    mkdirSync(bin);
    const engine = join(bin, 'claude');
    writeFileSync(engine, '#!/bin/sh\nexec sleep 600\n');
    chmodSync(engine, 0o755);
    writeFileSync(
      join(userData, 'engines.json'),
      JSON.stringify({
        engines: [{ id: 'e2e.claude', name: 'Stand-in for Claude Code', binary: engine }],
        removedDefaults: ['default.claude', 'default.gemini'],
      }),
    );

    const spaceDir = dirname(seeded.root);
    return {
      temp,
      userData,
      stateFile,
      seeded,
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

/** The `mcp.json` of the one session started in the run. */
function sessionMcpFile(sessionsDir: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  for (const entry of readdirSync(sessionsDir)) {
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
  const start = page.getByTestId('dashboard-start-session');
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.getByTestId('space-rail-sessions')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('session-header')).toBeVisible({ timeout: 15_000 });
}

test.describe('the Dashboard', () => {
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
      await expect(page.getByTestId('dashboard-state-sentence')).toContainText(
        'Read from GitHub at',
      );

      // The columns are the Stage options in their order, the sixth included.
      const columns = page.getByTestId('dashboard-column');
      await expect(columns).toHaveCount(STAGES.length);
      const stages = await columns.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-stage')),
      );
      expect(stages).toEqual(STAGES);

      // The focus card at Build: kind, item progress, spec link.
      const card = page
        .locator('[data-testid="dashboard-column"][data-stage="Build"]')
        .getByTestId('dashboard-focus-card');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`#${run.seeded.focus} Dashboard focus`);
      await expect(card.getByTestId('dashboard-focus-kind')).toHaveText('kind feature');
      await expect(card.getByTestId('dashboard-focus-items')).toHaveText('1 of 2 items done');
      await expect(card.getByTestId('dashboard-focus-spec')).toBeVisible();

      // The standalone item is beside the columns and never a focus.
      const standalone = page.getByTestId('dashboard-standalone-item');
      await expect(standalone).toHaveCount(1);
      await expect(standalone).toContainText(`#${run.seeded.standalone} A standalone item`);
      await expect(page.getByTestId('dashboard-focus-card')).toHaveCount(1);

      // The focus sheet lists the items with their state.
      await card.getByTestId('dashboard-focus-open').click();
      const sheet = page.getByTestId('dashboard-focus-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('dashboard-sheet-item')).toHaveCount(2);
      await sheet.getByTestId('dashboard-sheet-close').click();
      await expect(sheet).toHaveCount(0);

      // The Agents board has no session yet.
      await expect(page.getByTestId('agents-column-writing')).toContainText('No session.');

      // Start a session from the Dashboard: the guarded start runs the stand-in engine.
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

      // After a refresh the session's issue is on the Agents board, in Writing, named by
      // its engine and start time, never by the session's id.
      await page.getByTestId('space-rail-dashboard').click();
      const writingColumn = page.getByTestId('agents-column-writing');
      await expect
        .poll(
          async () => {
            await refresh(page);
            return writingColumn.getByRole('listitem').count();
          },
          { timeout: 30_000 },
        )
        .toBe(1);
      await expect(writingColumn).toContainText(/The e2e\.claude session that started at /);
      await expect(page.getByTestId('agents-board')).not.toContainText(sessionId);

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
      const first = page.getByTestId('needs-you-0');
      await expect(first).toContainText('Gate');
      await expect(first).toContainText('Is the end-to-end draft agreed?');
      await first.getByRole('button', { name: 'Open the gate dialog' }).click();
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
      const sentence = page.getByTestId('dashboard-state-sentence');
      await expect(sentence).toContainText('GitHub could not be reached.');
      await expect(sentence).toContainText('The last good read is from');
      await expect(sentence).toContainText(/ago\.$/);

      // The cache is shown as it was.
      await expect(page.getByTestId('dashboard-column')).toHaveCount(STAGES.length);
      await expect(page.getByTestId('dashboard-focus-card')).toContainText('Dashboard focus');
      await expect(page.getByTestId('dashboard-standalone-item')).toHaveCount(1);

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
});
