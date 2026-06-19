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
  git('-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--allow-empty', '-q', '-m', 'seed');
  writeFileSync(join(contracts, 'example.md'), '# example contract\n');
  writeFileSync(join(contracts, 'contracts.index.md'), '# contracts index\n');
}

/**
 * Convert an existing default-shape fixture into a publishing-shape project.
 * v0.8 Phase A introduces shape awareness — when `workspace.yaml` declares a
 * `publish:` block, the companion treats the project as having a `payload/`
 * sibling for the workshop and a `publish/` sibling for the deliverable.
 *
 * - Rewrites `workspace.yaml` with the `publish:` block + the same project
 *   name/core_version the default fixture used.
 * - Ensures `<root>/payload/` and `<root>/publish/` exist (the methodology's
 *   `init` would create these; the fixture mirrors that on demand).
 * - Optionally seeds files inside each so e2e can assert what's visible.
 */
export function makePublishingShape(
  root: string,
  opts?: { payloadFiles?: string[]; publishFiles?: string[] },
): void {
  const lore = join(root, '.ai-lore-e2e-fixture');
  const payload = join(root, 'payload');
  const publish = join(root, 'publish');
  mkdirSync(payload, { recursive: true });
  mkdirSync(publish, { recursive: true });
  writeFileSync(
    join(lore, 'workspace.yaml'),
    [
      'project_name: e2e-fixture',
      'core_version: "0.5.1"',
      '',
      'publish:',
      '  path: ./publish',
      '',
    ].join('\n'),
  );
  for (const name of opts?.payloadFiles ?? []) {
    writeFileSync(join(payload, name), `# ${name}\n`);
  }
  for (const name of opts?.publishFiles ?? []) {
    writeFileSync(join(publish, name), `# ${name}\n`);
  }
}

/**
 * Seed the vendored methodology under `<lore>/process/verbs/` so an AI tab's
 * Phase D prompts column has something to read. Writes the minimal set the
 * curated taxonomy expects (`orient`, `chat`, `plan`, `execute`, `ack`,
 * `save-point`, `close-session`) plus an unknown verb to exercise the
 * Advanced group, and a `verbs.index.md` carrying their descriptions in the
 * operations-table shape the parser reads.
 */
export function seedVerbs(root: string): void {
  const lore = join(root, '.ai-lore-e2e-fixture');
  const verbs = join(lore, 'process', 'verbs');
  mkdirSync(verbs, { recursive: true });
  const rows: { name: string; kind: 'verb' | 'bookend'; desc: string }[] = [
    {
      name: 'orient',
      kind: 'bookend',
      desc: 'Session open — load the methodology, walk the focus chain',
    },
    { name: 'chat', kind: 'verb', desc: 'Set posture to Chat — converse only, touch nothing' },
    { name: 'redial', kind: 'verb', desc: 'Set the dials — the conversational register' },
    { name: 'plan', kind: 'verb', desc: 'Set posture to Planning' },
    { name: 'execute', kind: 'verb', desc: 'Set posture to Executing' },
    { name: 'reshape', kind: 'verb', desc: 'Set posture to Reshaping' },
    { name: 'write-lore', kind: 'verb', desc: 'Write or update Memory' },
    { name: 'ack', kind: 'verb', desc: 'Commit both repos with a focused message' },
    { name: 'save-point', kind: 'verb', desc: 'Formal milestone — commit + ledger entry' },
    {
      name: 'close-session',
      kind: 'bookend',
      desc: 'Session close — write the journal, surface drift',
    },
    { name: 'install', kind: 'verb', desc: 'Bind AI-Lore into a specific AI engine' },
  ];
  for (const r of rows) {
    writeFileSync(join(verbs, `${r.name}.md`), `# ${r.name}\n`);
  }
  const tableLines = [
    '# Verbs',
    '',
    '| Operation | Kind | What it does |',
    '|---|---|---|',
    ...rows.map((r) => `| [\`${r.name}\`](./${r.name}.md) | ${r.kind} | ${r.desc} |`),
    '',
  ];
  writeFileSync(join(verbs, 'verbs.index.md'), tableLines.join('\n'));
}

/**
 * Seed the engines store inside a fresh test `userData` directory. The cockpit
 * reads `<userData>/engines.json` at launch and back-fills `claude` / `gemini`
 * only when their binaries resolve on PATH — which they generally don't in a
 * CI environment. Writing the file directly skips the probe and pins the test
 * to known engine ids.
 */
export function seedEngines(
  userData: string,
  engines: { id: string; name: string; binary: string; args?: string[] }[],
): void {
  mkdirSync(userData, { recursive: true });
  // `removedDefaults` lists *all* default ids so the back-fill on load doesn't
  // try to re-add `default.claude` / `default.gemini` on top of these.
  writeFileSync(
    join(userData, 'engines.json'),
    JSON.stringify(
      {
        engines,
        removedDefaults: ['default.claude', 'default.gemini'],
      },
      null,
      2,
    ),
  );
}

/**
 * Build a fake "engine" — a shell script that prints a marker, then sleeps
 * forever so the PTY stays alive long enough for the test to assert. The
 * returned absolute path is what to set as the engine's `binary`.
 */
export function makeFakeEngineBinary(marker: string): {
  dir: string;
  binary: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-e2e-engine-'));
  const binary = join(dir, 'fake-engine.sh');
  // `tail -f /dev/null` keeps the PTY open without burning CPU; the echo
  // lands the marker the test waits for.
  writeFileSync(binary, `#!/bin/sh\necho ${marker}\nexec tail -f /dev/null\n`);
  execFileSync('chmod', ['+x', binary]);
  return {
    dir,
    binary,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
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
  // COCKPIT_E2E bypasses the running-task close/quit confirmation dialogs — a
  // native modal would otherwise block teardown when a spec leaves a terminal
  // task running.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COCKPIT_ROOT: opts.root,
    COCKPIT_E2E: '1',
  };
  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${opts.userData}`],
    cwd: APP_DIR,
    env,
  });
  const page = await app.firstWindow();
  return { app, page };
}
