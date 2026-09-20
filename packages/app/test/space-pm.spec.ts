import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { closeSpaceApp, launchSpaceApp, makeSpaceE2eFixture } from './space-fixture';

/** Real Electron + PTY + authenticated MCP; only the paid model is a deterministic stand-in. */
test('opening a Space starts one interactive PM and its MCP reply reaches the dashboard', async () => {
  test.setTimeout(90_000);
  const fixture = makeSpaceE2eFixture('e2e-pm-report');
  let app: ElectronApplication | undefined;
  try {
    const installed = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "const core = await import('@ai-lore-companion/core');",
          `const root = ${JSON.stringify(fixture.root)};`,
          `const paths = core.deskPaths(${JSON.stringify(fixture.userData)}, root);`,
          'const lore = await core.readLore(root); if (!lore.ok) throw new Error(lore.error.message);',
          'const installed = await core.installClaudeCode(lore.value, paths.install); if (!installed.ok) throw new Error(installed.error.message);',
          'console.log(JSON.stringify({desk: paths.desk}));',
        ].join('\n'),
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    const { desk } = JSON.parse(installed.trim().split('\n').pop() ?? '{}') as { desk: string };
    const bin = join(fixture.userData, 'bin');
    mkdirSync(bin);
    const engine = join(bin, 'claude');
    const launches = join(fixture.userData, 'pm-launches.txt');
    const sdkRoot = resolve(process.cwd(), '../../node_modules/@modelcontextprotocol/sdk/dist/esm');
    writeFileSync(
      engine,
      [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "if (args[0] === '--version') { console.log('2.1.276 (Claude Code)'); process.exit(0); }",
        "if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true})); process.exit(0); }",
        `fs.appendFileSync(${JSON.stringify(launches)}, JSON.stringify(args) + '\\n');`,
        '(async () => {',
        `const { Client } = await import(${JSON.stringify(pathToFileURL(join(sdkRoot, 'client/index.js')).href)});`,
        `const { StreamableHTTPClientTransport } = await import(${JSON.stringify(pathToFileURL(join(sdkRoot, 'client/streamableHttp.js')).href)});`,
        "const config = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.ailore;",
        "const client = new Client({name:'pm-e2e',version:'1.0'});",
        'await client.connect(new StreamableHTTPClientTransport(new URL(config.url), {requestInit:{headers:config.headers}}));',
        "const lines = require('node:readline').createInterface({input:process.stdin,output:process.stdout});",
        "console.log('PM ready. Ask me to update the dashboard.');",
        'let reports = 0;',
        "lines.on('line', async (line) => {",
        "if (!line.includes('update the dashboard')) return;",
        'reports += 1;',
        "await client.callTool({name:'report_dashboard',arguments:{markdown:'Current position: PM report ' + reports + '\\n<script>not executable</script>',basis:'Deterministic engine exercising the real MCP transport.'}});",
        "console.log('Dashboard updated.');",
        '});',
        '})().catch((error) => { console.error(error); process.exit(1); });',
        '',
      ].join('\n'),
    );
    chmodSync(engine, 0o755);
    writeFileSync(
      join(fixture.userData, 'engines.json'),
      JSON.stringify({
        engines: [
          { id: 'default.claude', name: 'Claude Code', binary: engine, model: 'pm-test-model' },
        ],
      }),
    );

    const launched = await launchSpaceApp({ root: fixture.root, userData: fixture.userData });
    app = launched.app;
    const page = launched.page;
    await expect(page.getByTestId('space-window')).toBeVisible();
    await expect(page.getByTestId('pm-dashboard-request')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pm-dashboard-request').click();
    await page.keyboard.press('Enter');
    await page.getByTestId('space-rail-dashboard').click();
    await expect(page.getByTestId('pm-report-text')).toContainText('PM report 1', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('pm-report-text').locator('script')).toHaveCount(0);
    const readSessions = (): Array<{
      purpose?: string;
      closedAt?: string;
      profile?: { model?: string };
    }> =>
      (
        JSON.parse(readFileSync(join(desk, 'sessions.json'), 'utf8')) as {
          records: Array<{
            purpose?: string;
            closedAt?: string;
            profile?: { model?: string };
          }>;
        }
      ).records;
    expect(readSessions().filter((session) => session.purpose === 'pm')).toHaveLength(1);
    expect(readSessions()[0]?.profile?.model).toBe('pm-test-model');
    const args = JSON.parse(readFileSync(launches, 'utf8').trim()) as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('pm-test-model');
    expect(args.join(' ')).toContain('dashboard.md');

    // Repeated/concurrent attachment requests cannot spawn a second engine.
    // A full renderer reload is not supported by the existing window-init protocol.
    const attachments = await page.evaluate(async () =>
      Promise.all(Array.from({ length: 4 }, () => window.cockpit.spacePmEnsure({}))),
    );
    expect(attachments.every((result) => result.ok)).toBe(true);
    expect(
      new Set(attachments.flatMap((result) => (result.ok ? [result.value.sessionId] : []))).size,
    ).toBe(1);
    await page.getByTestId('space-rail-sessions').click();
    await expect(page.getByTestId('pm-dashboard-request')).toBeVisible();
    await page.getByTestId('pm-dashboard-request').click();
    await page.keyboard.press('Enter');
    await page.getByTestId('space-rail-dashboard').click();
    await expect(page.getByTestId('pm-report-text')).toContainText('PM report 2');
    expect(readFileSync(launches, 'utf8').trim().split('\n')).toHaveLength(1);
    await closeSpaceApp(app);
    expect(readSessions().every((session) => typeof session.closedAt === 'string')).toBe(true);
  } finally {
    await closeSpaceApp(app);
    fixture.cleanup();
  }
});
