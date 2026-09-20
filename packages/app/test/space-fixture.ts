import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type ElectronApplication, type Page, _electron as electron } from 'playwright';

/**
 * What the end-to-end tests of the 1.0 windows share: a fixture Space, and the
 * app launched with detection routing on.
 *
 * The fixture is built by `makeSpaceFixture` of `@ai-lore-companion/core/testing`,
 * in a child process. Playwright compiles a spec of this package to CommonJS,
 * so an `import` of core in a spec becomes a `require`, and core is an
 * ES-module package. Measured on 2026-09-18 with a spec that imported
 * `@ai-lore-companion/core/testing`: Playwright loaded it on Node 23.11, and on
 * Node 20.11 it stopped with "require() of ES Module ... not supported". The
 * repository accepts any Node 20. A child process started with
 * `--input-type=module` imports core as
 * an ES module on every one of them. The script is text in this file, so no
 * file of another extension is added.
 */

const APP_DIR = resolve(process.cwd());
const APP_MAIN = resolve(APP_DIR, 'out/main/index.js');
/** `packages/spec/lore-1.0`, the template the fixture Space is scaffolded from. It is only read. */
const LORE_TEMPLATE_DIR = resolve(APP_DIR, '../spec/lore-1.0');

export type SpaceE2eFixture = {
  /** The Space's folder, as a real path. */
  root: string;
  /** A `userData` folder of the test's own, so the real one is never touched. */
  userData: string;
  /** Names of the fixture's repositories under `repos/`, as given to `makeSpaceE2eFixture`. */
  repositories: string[];
  /** Remove the Space, its remote and the `userData` folder. */
  cleanup: () => void;
};

/** Options of `makeSpaceE2eFixture` and `withSpaceApp`. */
export type SpaceE2eFixtureOptions = {
  /**
   * Names of repositories to add under `repos/`, each a clone of a bare remote
   * with the scripted history `makeSpaceFixture` gives it. Default: none.
   */
  repositories?: readonly string[];
};

/** Build a fixture Space named `name` in a temporary folder. */
export function makeSpaceE2eFixture(
  name = 'e2e-space',
  options?: SpaceE2eFixtureOptions,
): SpaceE2eFixture {
  const repositories = options?.repositories ?? [];
  const script = [
    "const { makeSpaceFixture } = await import('@ai-lore-companion/core/testing');",
    `const fixture = await makeSpaceFixture(${JSON.stringify({
      templateDir: LORE_TEMPLATE_DIR,
      name,
      repositories,
    })});`,
    'console.log(JSON.stringify({ root: fixture.root }));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
  const lastLine = out.trim().split('\n').pop() ?? '';
  const { root } = JSON.parse(lastLine) as { root: string };
  const userData = mkdtempSync(join(tmpdir(), 'ai-lore-e2e-space-ud-'));
  return {
    root,
    userData,
    repositories: [...repositories],
    cleanup: () => {
      // The builder puts the Space and its bare remote under one temporary folder.
      rmSync(dirname(root), { recursive: true, force: true, maxRetries: 3 });
      rmSync(userData, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/**
 * Launch the built app on `root` with detection routing on. The variable is
 * given to this launch only and is not set on the test process, because the
 * specs run one after another in one worker and `cockpit.spec.ts` must start
 * the app without it.
 */
export async function launchSpaceApp(opts: {
  /** The folder to open. Without it the app opens on the welcome screen. */
  root?: string;
  userData: string;
  /** Variables for this launch only, such as `AI_LORE_FAKE_GITHUB`. */
  env?: Record<string, string>;
}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.root === undefined ? {} : { COCKPIT_ROOT: opts.root }),
    COCKPIT_E2E: '1',
    AI_LORE_SPACE_ROUTING: '1',
    ...opts.env,
  };
  if (opts.root === undefined) Reflect.deleteProperty(env, 'COCKPIT_ROOT');
  const app = await electron.launch({
    args: [APP_MAIN, `--user-data-dir=${opts.userData}`],
    cwd: APP_DIR,
    env,
  });
  try {
    const page = await app.firstWindow();
    return { app, page };
  } catch (caught) {
    await closeSpaceApp(app);
    throw caught;
  }
}

/** How long `closeSpaceApp` waits for the app to close before it ends the process. */
const CLOSE_TIMEOUT_MS = 10_000;

/** The apps `closeSpaceApp` has been called for. */
const closedApps = new WeakSet<ElectronApplication>();

/**
 * Close the app, whether the test passed or failed. When the app does not
 * close in time, or closing throws, its process is ended with `SIGKILL`, so a
 * failed test leaves no Electron process. It does not throw, and a second call
 * for the same app does nothing: Playwright's `process()` throws once the app
 * has closed.
 */
export async function closeSpaceApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app || closedApps.has(app)) return;
  closedApps.add(app);
  const child = app.process();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('the app did not close in time')),
          CLOSE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    // Ended below.
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

/**
 * Run `body` against the app opened on a new fixture Space. The app is closed
 * and the fixture removed afterwards, also when `body` throws.
 */
export async function withSpaceApp(
  name: string,
  body: (ctx: { app: ElectronApplication; page: Page; fixture: SpaceE2eFixture }) => Promise<void>,
  options?: SpaceE2eFixtureOptions,
): Promise<void> {
  const fixture = makeSpaceE2eFixture(name, options);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchSpaceApp({ root: fixture.root, userData: fixture.userData });
    app = launched.app;
    await body({ app, page: launched.page, fixture });
  } finally {
    await closeSpaceApp(app);
    fixture.cleanup();
  }
}
