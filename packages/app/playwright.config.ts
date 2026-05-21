import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
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
