import { execFileSync } from 'node:child_process';
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
  // The four cockpit panes each root at a memory area — give them all a folder.
  mkdirSync(join(lore, 'memory', 'journal', 'live'), { recursive: true });
  mkdirSync(join(lore, 'memory', 'blueprint'), { recursive: true });
  mkdirSync(join(lore, 'memory', 'knowledge-tree'), { recursive: true });

  writeFileSync(join(lore, 'workspace.yaml'), 'project_name: e2e-fixture\ncore_version: "0.5.1"\n');

  writeFileSync(
    join(lore, 'memory', 'status', 'status.index.md'),
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
    ].join('\n'),
  );

  writeFileSync(
    join(lore, 'memory', 'status', 'focus', 'demo.focus.md'),
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
      '---',
      'type: at-node',
      'title: Phase A',
      'updated: 2026-05-26',
      'references: []',
      'node_kind: leaf',
      'gated: true',
      'status: Active',
      '---',
      '',
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
 * Add a Lore-repo git history to an existing fixture so the Changes panel has
 * something to show. Seeds two new files at `<lore>/memory/blueprint/`:
 *
 *   - `blueprint/contracts/example.md` — a real content file (should appear).
 *   - `blueprint/contracts/contracts.index.md` — an index file (should be
 *      filtered out by `attachChangesTracker`'s index-file silencing).
 *
 * Both arrive as untracked files at HEAD, so `git status --porcelain` reports
 * both — exercising the filter end-to-end through the renderer's grid.
 */
export function seedLoreChanges(root: string): void {
  const lore = join(root, '.ai-lore-e2e-fixture');
  const repo = join(lore, 'memory');
  const contracts = join(repo, 'blueprint', 'contracts');
  mkdirSync(contracts, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };
  git('init', '-q', '-b', 'main');
  git(
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=T',
    'commit',
    '--allow-empty',
    '-q',
    '-m',
    'seed',
  );
  writeFileSync(join(contracts, 'example.md'), '# example contract\n');
  writeFileSync(join(contracts, 'contracts.index.md'), '# contracts index\n');
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
