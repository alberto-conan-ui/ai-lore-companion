import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from 'playwright';

// Playwright resolves test files relative to playwright.config.ts (packages/app/).
// cwd() at run time is the package root when invoked via `npm run test:e2e -w`.
const APP_DIR = resolve(process.cwd());
const APP_MAIN = resolve(APP_DIR, 'out/main/index.js');

export type Fixture = {
  root: string;
  userData: string;
  cleanup: () => void;
};

/** Build a minimal AI-Lore project tree the cockpit can read. */
export function makeProject(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-e2e-'));
  const userData = mkdtempSync(join(tmpdir(), 'cockpit-e2e-ud-'));

  const lore = join(root, '.ai-lore-e2e-fixture');
  mkdirSync(join(lore, 'memory', 'status', 'focus'), { recursive: true });
  mkdirSync(join(lore, 'memory', 'action-tree', 'demo'), { recursive: true });

  writeFileSync(
    join(lore, 'workspace.yaml'),
    'project_name: e2e-fixture\ncore_version: "v0.4"\nplugin: sdlc\n',
  );

  writeFileSync(
    join(lore, 'memory', 'status', 'status.index.md'),
    [
      '# e2e-fixture — Status',
      '',
      '| Field            | Value                                                  |',
      '| ---------------- | ------------------------------------------------------ |',
      '| **Mode**         | Executing                                              |',
      '| **Active focus** | [Demo](./focus/demo.focus.md)                          |',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(lore, 'memory', 'status', 'focus', 'demo.focus.md'),
    [
      '# Demo',
      '',
      '> **Status:** Active',
      '',
      '## Gate',
      '',
      'demo gate',
      '',
      '## Active child pointer',
      '',
      '[Phase A](../../action-tree/demo/A-phase.phase.md)',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(lore, 'memory', 'action-tree', 'demo', 'A-phase.phase.md'),
    [
      '# Phase A — Demo phase',
      '',
      '> **Status:** Active',
      '',
      '## Gate',
      '',
      'phase gate',
      '',
      '## Active child pointer',
      '',
      '(leaf — none)',
      '',
    ].join('\n'),
  );

  return {
    root,
    userData,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/**
 * Launch the AI-Lore Electron app. With `root`, the window opens that folder —
 * a project window for an AI-Lore project, the altered window otherwise.
 * Without `root`, the app opens its welcome window.
 *
 * Electron's `--user-data-dir` flag redirects `app.getPath('userData')` so each
 * test gets its own SQLite scratch space — no interference with real state.
 */
export async function launchApp(opts: {
  root?: string;
  userData: string;
}): Promise<{ app: ElectronApplication; page: Page }> {
  // A welcome-window test must not inherit a COCKPIT_ROOT from the dev's shell;
  // an undefined value is dropped when the child process is spawned.
  const env: NodeJS.ProcessEnv = { ...process.env, COCKPIT_ROOT: opts.root };
  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${opts.userData}`],
    cwd: APP_DIR,
    env,
  });
  const page = await app.firstWindow();
  return { app, page };
}
