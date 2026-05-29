import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  // Playwright Electron specs end in `.spec.ts`. The headless node:test tier
  // under `test/headless/` uses `.test.ts` and runs via `npm run test:headless`;
  // pin the match so Playwright never picks those up (its default matches both).
  testMatch: '**/*.spec.ts',
  // Electron tests are heavy and not parallelisable safely (shared userData paths,
  // chokidar file-system events). Run them serially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
