import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Renderer component tier — the third test level, beside the node:test headless
 * IPC tier (`test/headless/`, run by `test:headless`) and Playwright e2e
 * (`test/*.spec.ts`). Runs React components in jsdom via vitest; the leaf
 * components that pull xterm / ag-grid are mocked per test so a render stays
 * fast and isolated. Shares vite's resolver, so the renderer's `.js` import
 * specifiers map to their `.tsx` sources exactly as in the build.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/component/**/*.test.{ts,tsx}'],
    css: false,
  },
});
